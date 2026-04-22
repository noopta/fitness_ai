import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, RefreshControl,
  Modal, TextInput, Pressable, Image, ActivityIndicator, KeyboardAvoidingView, Platform, Dimensions,
} from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, Easing, runOnJS,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import { socialApi } from '../../src/lib/api';
import { useAuth } from '../../src/context/AuthContext';
import { colors, fontSize, fontWeight, radius, spacing } from '../../src/constants/theme';
import { trackScreen, trackScreenTime, Analytics } from '../../src/lib/analytics';
import { PostCard } from '../../src/components/social/PostCard';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PostComment {
  id: string;
  text: string;
  createdAt: string;
  author: { id: string; name: string | null; username: string | null };
}

interface FeedItem {
  id: string;
  sharerId: string;
  sharer: { id: string; name: string | null; username: string | null; avatarBase64: string | null } | null;
  itemType: string;
  payload: any;
  caption?: string | null;
  createdAt: string;
  reactionCount: number;
  likedByMe: boolean;
  commentCount: number;
  comments: PostComment[];
}

interface Friend {
  id: string;
  name: string | null;
  username: string | null;
  avatarBase64?: string | null;
}

interface FriendRequest {
  id: string;
  requesterId: string;
  requester: { id: string; name: string | null; username: string | null };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function payloadDescription(itemType: string, payload: any): string {
  if (!payload) return itemType;
  if (itemType === 'text') return '';
  if (itemType === 'media') return '';
  if (itemType === 'session' || itemType === 'plan') {
    return payload.selectedLift
      ? `Shared a ${itemType}: ${payload.selectedLift.replace(/_/g, ' ')}`
      : `Shared a ${itemType}`;
  }
  if (itemType === 'workout') {
    return payload.title ? `Shared workout: ${payload.title}` : 'Shared a workout';
  }
  return `Shared ${itemType}`;
}

// ─── Friend Row ───────────────────────────────────────────────────────────────

function FriendRow({ friend, onMessage }: { friend: Friend; onMessage: () => void }) {
  const raw = friend.avatarBase64;
  const avatarUri = raw ? (raw.startsWith('data:') ? raw : `data:image/jpeg;base64,${raw}`) : null;
  return (
    <View style={styles.card}>
      <View style={styles.cardRow}>
        <View style={styles.avatarCircle}>
          {avatarUri
            ? <Image source={{ uri: avatarUri }} style={{ width: 40, height: 40, borderRadius: 20 }} />
            : <Text style={styles.avatarText}>{((friend.username ?? friend.name ?? '?')[0]).toUpperCase()}</Text>
          }
        </View>
        <View style={styles.cardContent}>
          <Text style={styles.cardName}>{friend.username ? `@${friend.username}` : (friend.name ?? 'User')}</Text>
          {friend.name && friend.username ? <Text style={styles.cardSub}>{friend.name}</Text> : null}
        </View>
        <TouchableOpacity style={styles.smallButton} activeOpacity={0.8} onPress={onMessage}>
          <Ionicons name="chatbubble-outline" size={14} color={colors.primaryForeground} />
          <Text style={styles.smallButtonText}>Message</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── New Post Modal ───────────────────────────────────────────────────────────

type PostTab = 'text' | 'image' | 'video' | 'workout';

interface WorkoutEntry {
  name: string;
  sets: string;
  reps: string;
  weight: string;
}

interface NewPostModalProps {
  visible: boolean;
  onClose: () => void;
  onPosted: () => void;
}

function NewPostModal({ visible, onClose, onPosted }: NewPostModalProps) {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const slideY = useSharedValue(400);
  const backdropAlpha = useSharedValue(0);

  const [postTab, setPostTab] = useState<PostTab>('text');
  const [textContent, setTextContent] = useState('');
  const [caption, setCaption] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imagePreviewUri, setImagePreviewUri] = useState<string | null>(null);
  const [workoutTitle, setWorkoutTitle] = useState('');
  const [workoutEntries, setWorkoutEntries] = useState<WorkoutEntry[]>([
    { name: '', sets: '3', reps: '8', weight: '' },
  ]);
  const [submitting, setSubmitting] = useState(false);

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: slideY.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdropAlpha.value }));

  function resetForm() {
    setPostTab('text');
    setTextContent('');
    setCaption('');
    setVideoUrl('');
    setImageBase64(null);
    setImagePreviewUri(null);
    setWorkoutTitle('');
    setWorkoutEntries([{ name: '', sets: '3', reps: '8', weight: '' }]);
  }

  function updateWorkoutEntry(index: number, field: keyof WorkoutEntry, value: string) {
    setWorkoutEntries(prev => prev.map((e, i) => i === index ? { ...e, [field]: value } : e));
  }

  function addWorkoutEntry() {
    setWorkoutEntries(prev => [...prev, { name: '', sets: '3', reps: '8', weight: '' }]);
  }

  function removeWorkoutEntry(index: number) {
    setWorkoutEntries(prev => prev.filter((_, i) => i !== index));
  }

  useEffect(() => {
    if (visible) {
      setMounted(true);
      slideY.value = withTiming(0, { duration: 320, easing: Easing.out(Easing.ease) });
      backdropAlpha.value = withTiming(1, { duration: 320 });
    } else if (mounted) {
      resetForm();
      slideY.value = withTiming(400, { duration: 260, easing: Easing.in(Easing.ease) }, (done) => {
        if (done) runOnJS(setMounted)(false);
      });
      backdropAlpha.value = withTiming(0, { duration: 260 });
    }
  }, [visible]);


  async function pickImage() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Please allow photo library access to share images.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.7,
      base64: true,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setImagePreviewUri(asset.uri);
      setImageBase64(asset.base64 ?? null);
    }
  }

  async function handlePost() {
    if (postTab === 'text') {
      if (!textContent.trim()) {
        Alert.alert('Empty post', 'Please write something before posting.');
        return;
      }
      setSubmitting(true);
      try {
        await socialApi.shareItem({
          itemType: 'text',
          payload: { text: textContent.trim() },
          caption: caption.trim() || undefined,
        });
        Analytics.textPostMade();
        Alert.alert('Posted!', 'Your post has been shared.');
        onPosted();
        onClose();
      } catch (err: any) {
        Alert.alert('Post failed', err?.message || 'Could not post. Please try again.');
      } finally {
        setSubmitting(false);
      }
    } else if (postTab === 'image') {
      if (!imageBase64) {
        Alert.alert('No image', 'Please pick an image first.');
        return;
      }
      setSubmitting(true);
      try {
        await socialApi.shareItem({
          itemType: 'media',
          payload: { imageBase64 },
          caption: caption.trim() || undefined,
        });
        Analytics.imagePostMade();
        Alert.alert('Posted!', 'Your image has been shared.');
        onPosted();
        onClose();
      } catch (err: any) {
        Alert.alert('Post failed', err?.message || 'Could not post. Please try again.');
      } finally {
        setSubmitting(false);
      }
    } else if (postTab === 'video') {
      if (!videoUrl.trim()) {
        Alert.alert('No URL', 'Please enter a video URL.');
        return;
      }
      setSubmitting(true);
      try {
        await socialApi.shareItem({
          itemType: 'media',
          payload: { videoUrl: videoUrl.trim() },
          caption: caption.trim() || undefined,
        });
        Analytics.videoPostMade();
        Alert.alert('Posted!', 'Your video link has been shared.');
        onPosted();
        onClose();
      } catch (err: any) {
        Alert.alert('Post failed', err?.message || 'Could not post. Please try again.');
      } finally {
        setSubmitting(false);
      }
    } else if (postTab === 'workout') {
      const validExercises = workoutEntries.filter(e => e.name.trim());
      if (validExercises.length === 0) {
        Alert.alert('No exercises', 'Add at least one exercise before posting.');
        return;
      }
      setSubmitting(true);
      try {
        await socialApi.shareItem({
          itemType: 'workout',
          payload: {
            exercises: validExercises.map(e => ({
              name: e.name.trim(),
              sets: Math.max(parseInt(e.sets, 10) || 1, 1),
              reps: e.reps.trim() || '1',
              weight: parseFloat(e.weight) || 0,
              unit: 'lbs',
            })),
            title: workoutTitle.trim() || undefined,
          },
          caption: caption.trim() || undefined,
        });
        Alert.alert('Posted!', 'Your workout has been shared.');
        onPosted();
        onClose();
      } catch (err: any) {
        Alert.alert('Post failed', err?.message || 'Could not post. Please try again.');
      } finally {
        setSubmitting(false);
      }
    }
  }

  if (!mounted) return null;

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={{ flex: 1, justifyContent: 'flex-end' }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.40)' }, backdropStyle]}
          pointerEvents="none"
        />
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Animated.View
          style={[styles.modalSheet, sheetStyle, { paddingBottom: Math.max(spacing.lg, insets.bottom) }]}
        >
          {/* Tap blocker — prevents overlay dismiss inside the sheet */}
          <Pressable onPress={() => {}}>
            {/* Header */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New Post</Text>
              <TouchableOpacity onPress={onClose} style={styles.modalCloseButton} activeOpacity={0.7}>
                <Ionicons name="close" size={22} color={colors.foreground} />
              </TouchableOpacity>
            </View>

            {/* Post type tabs */}
            <View style={styles.postTabBar}>
              {(['text', 'image', 'video', 'workout'] as PostTab[]).map((tab) => (
                <TouchableOpacity
                  key={tab}
                  style={[styles.postTab, postTab === tab && styles.postTabActive]}
                  activeOpacity={0.8}
                  onPress={() => setPostTab(tab)}
                >
                  <Text style={[styles.postTabLabel, postTab === tab && styles.postTabLabelActive]}>
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Tab content */}
            <ScrollView
              style={postTab === 'workout' ? styles.workoutScrollArea : undefined}
              scrollEnabled={postTab === 'workout'}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
            <View style={styles.modalBody}>
              {postTab === 'text' && (
                <>
                  <TextInput
                    style={styles.textInput}
                    placeholder="What's on your mind?"
                    placeholderTextColor={colors.mutedForeground}
                    multiline
                    value={textContent}
                    onChangeText={setTextContent}
                    maxLength={1000}
                    textAlignVertical="top"
                  />
                  <Text style={styles.charCount}>{textContent.length}/1000</Text>
                  <TextInput
                    style={[styles.textInput, styles.textInputSingleLine, styles.captionInput]}
                    placeholder="Add a caption (optional)…"
                    placeholderTextColor={colors.mutedForeground}
                    value={caption}
                    onChangeText={setCaption}
                    maxLength={200}
                  />
                  <TouchableOpacity
                    style={[styles.postButton, submitting && { opacity: 0.5 }]}
                    activeOpacity={0.82}
                    onPress={handlePost}
                    disabled={submitting}
                  >
                    {submitting
                      ? <ActivityIndicator size="small" color={colors.primaryForeground} />
                      : <Text style={styles.postButtonText}>Post</Text>}
                  </TouchableOpacity>
                </>
              )}

              {postTab === 'image' && (
                <>
                  {imagePreviewUri ? (
                    <Image source={{ uri: imagePreviewUri }} style={styles.imagePreview} resizeMode="cover" />
                  ) : null}
                  <TouchableOpacity
                    style={styles.pickImageButton}
                    activeOpacity={0.82}
                    onPress={pickImage}
                  >
                    <Ionicons name="image-outline" size={18} color={colors.foreground} />
                    <Text style={styles.pickImageButtonText}>
                      {imagePreviewUri ? 'Change image' : 'Pick image from library'}
                    </Text>
                  </TouchableOpacity>
                  <TextInput
                    style={[styles.textInput, styles.textInputSingleLine, styles.captionInput]}
                    placeholder="Add a caption (optional)…"
                    placeholderTextColor={colors.mutedForeground}
                    value={caption}
                    onChangeText={setCaption}
                    maxLength={200}
                  />
                  <TouchableOpacity
                    style={[styles.postButton, (!imageBase64 || submitting) && { opacity: 0.5 }]}
                    activeOpacity={0.82}
                    onPress={handlePost}
                    disabled={!imageBase64 || submitting}
                  >
                    {submitting
                      ? <ActivityIndicator size="small" color={colors.primaryForeground} />
                      : <Text style={styles.postButtonText}>Post Image</Text>}
                  </TouchableOpacity>
                </>
              )}

              {postTab === 'video' && (
                <>
                  <TextInput
                    style={[styles.textInput, styles.textInputSingleLine]}
                    placeholder="Paste a video URL…"
                    placeholderTextColor={colors.mutedForeground}
                    value={videoUrl}
                    onChangeText={setVideoUrl}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                  />
                  <TextInput
                    style={[styles.textInput, styles.textInputSingleLine, styles.captionInput]}
                    placeholder="Add a caption (optional)…"
                    placeholderTextColor={colors.mutedForeground}
                    value={caption}
                    onChangeText={setCaption}
                    maxLength={200}
                  />
                  <TouchableOpacity
                    style={[styles.postButton, (!videoUrl.trim() || submitting) && { opacity: 0.5 }]}
                    activeOpacity={0.82}
                    onPress={handlePost}
                    disabled={!videoUrl.trim() || submitting}
                  >
                    {submitting
                      ? <ActivityIndicator size="small" color={colors.primaryForeground} />
                      : <Text style={styles.postButtonText}>Post Video</Text>}
                  </TouchableOpacity>
                </>
              )}

              {postTab === 'workout' && (
                <>
                  {/* Workout title */}
                  <TextInput
                    style={[styles.textInput, styles.textInputSingleLine]}
                    placeholder="Workout title (e.g. Leg Day)…"
                    placeholderTextColor={colors.mutedForeground}
                    value={workoutTitle}
                    onChangeText={setWorkoutTitle}
                    maxLength={60}
                  />

                  {/* Exercise rows */}
                  {workoutEntries.map((entry, i) => (
                    <View key={i} style={styles.exerciseEntryCard}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <TextInput
                          style={[styles.textInput, styles.textInputSingleLine, { flex: 1, minHeight: 0, height: 44 }]}
                          placeholder="Exercise name"
                          placeholderTextColor={colors.mutedForeground}
                          value={entry.name}
                          onChangeText={v => updateWorkoutEntry(i, 'name', v)}
                        />
                        {workoutEntries.length > 1 && (
                          <TouchableOpacity onPress={() => removeWorkoutEntry(i)} style={{ padding: 4 }} activeOpacity={0.7}>
                            <Ionicons name="close-circle" size={20} color={colors.mutedForeground} />
                          </TouchableOpacity>
                        )}
                      </View>
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.fieldLabel}>Sets</Text>
                          <TextInput
                            style={[styles.textInput, styles.textInputSingleLine, styles.miniInput]}
                            keyboardType="number-pad"
                            value={entry.sets}
                            onChangeText={v => updateWorkoutEntry(i, 'sets', v)}
                            maxLength={3}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.fieldLabel}>Reps</Text>
                          <TextInput
                            style={[styles.textInput, styles.textInputSingleLine, styles.miniInput]}
                            keyboardType="default"
                            placeholder="8"
                            placeholderTextColor={colors.mutedForeground}
                            value={entry.reps}
                            onChangeText={v => updateWorkoutEntry(i, 'reps', v)}
                            maxLength={6}
                          />
                        </View>
                        <View style={{ flex: 1.4 }}>
                          <Text style={styles.fieldLabel}>Weight (lbs)</Text>
                          <TextInput
                            style={[styles.textInput, styles.textInputSingleLine, styles.miniInput]}
                            keyboardType="decimal-pad"
                            placeholder="0"
                            placeholderTextColor={colors.mutedForeground}
                            value={entry.weight}
                            onChangeText={v => updateWorkoutEntry(i, 'weight', v)}
                            maxLength={6}
                          />
                        </View>
                      </View>
                    </View>
                  ))}

                  {/* Add exercise */}
                  <TouchableOpacity style={styles.addExerciseButton} activeOpacity={0.8} onPress={addWorkoutEntry}>
                    <Ionicons name="add" size={16} color={colors.foreground} />
                    <Text style={styles.addExerciseText}>Add Exercise</Text>
                  </TouchableOpacity>

                  {/* Caption */}
                  <TextInput
                    style={[styles.textInput, styles.textInputSingleLine, styles.captionInput]}
                    placeholder="Add a caption (optional)…"
                    placeholderTextColor={colors.mutedForeground}
                    value={caption}
                    onChangeText={setCaption}
                    maxLength={200}
                  />

                  <TouchableOpacity
                    style={[styles.postButton, submitting && { opacity: 0.5 }]}
                    activeOpacity={0.82}
                    onPress={handlePost}
                    disabled={submitting}
                  >
                    {submitting
                      ? <ActivityIndicator size="small" color={colors.primaryForeground} />
                      : <Text style={styles.postButtonText}>Post Workout</Text>}
                  </TouchableOpacity>
                </>
              )}
            </View>
            </ScrollView>
          </Pressable>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function SocialScreen() {
  const router = useRouter();
  const { user, refreshUser } = useAuth();
  const [activeTab, setActiveTab] = useState<'feed' | 'friends'>('feed');
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loadingFeed, setLoadingFeed] = useState(true);
  const [loadingFriends, setLoadingFriends] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [postModalVisible, setPostModalVisible] = useState(false);
  const loadFeed = useCallback(() => {
    setLoadingFeed(true);
    return socialApi.getSharedFeed()
      .then((data) => setFeed(Array.isArray(data) ? data : data.items ?? []))
      .catch(() => setFeed([]))
      .finally(() => setLoadingFeed(false));
  }, []);

  const loadFriends = useCallback(() => {
    setLoadingFriends(true);
    return Promise.all([
      socialApi.getFriends().catch(() => []),
      socialApi.getFriendRequests().catch(() => ({ received: [] })),
    ]).then(([friendsData, reqData]) => {
      setFriends(Array.isArray(friendsData) ? friendsData : friendsData.friends ?? []);
      const received = Array.isArray(reqData) ? reqData : reqData.received ?? [];
      setPendingCount(received.length);
    }).finally(() => setLoadingFriends(false));
  }, []);

  useEffect(() => {
    trackScreen('Social');
    return trackScreenTime('Social');
  }, []);

  useEffect(() => {
    loadFeed();
    loadFriends();
  }, [loadFeed, loadFriends]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadFeed(), loadFriends()]);
    setRefreshing(false);
  }, [loadFeed, loadFriends]);

  const handleInvite = async () => {
    try {
      const data = await socialApi.getInviteLink();
      const code = data.code ?? '';
      const link = data.link ?? data.url ?? data.inviteUrl ?? '';
      const textToCopy = code || link;
      if (textToCopy) {
        await Clipboard.setStringAsync(textToCopy);
      }
      Alert.alert(
        'Invite Code Copied!',
        `Your invite code${code ? ` (${code})` : ''} has been copied to your clipboard. Share it with a friend to invite them to Axiom.`,
        [{ text: 'Done' }]
      );
    } catch {
      Alert.alert('Error', 'Could not generate invite code.');
    }
  };

  const handleMessage = (friend: Friend) => {
    router.push(`/social/messages?friendId=${friend.id}&friendName=${encodeURIComponent(friend.username ? `@${friend.username}` : (friend.name ?? 'Friend'))}`);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <Text style={styles.screenTitle}>Social</Text>
        <View style={styles.topBarActions}>
          <TouchableOpacity style={styles.iconButton} activeOpacity={0.8} onPress={() => router.push('/social/messages')}>
            <Ionicons name="chatbubbles-outline" size={22} color={colors.foreground} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconButton} activeOpacity={0.8} onPress={handleInvite}>
            <Ionicons name="person-add-outline" size={22} color={colors.foreground} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Segment tabs */}
      <View style={styles.segmentBar}>
        <TouchableOpacity
          style={[styles.segmentTab, activeTab === 'feed' && styles.segmentTabActive]}
          activeOpacity={0.8}
          onPress={() => setActiveTab('feed')}
        >
          <Text style={[styles.segmentLabel, activeTab === 'feed' && styles.segmentLabelActive]}>
            Social Feed
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.segmentTab, activeTab === 'friends' && styles.segmentTabActive]}
          activeOpacity={0.8}
          onPress={() => setActiveTab('friends')}
        >
          <View style={styles.segmentTabInner}>
            <Text style={[styles.segmentLabel, activeTab === 'friends' && styles.segmentLabelActive]}>
              Friends
            </Text>
            {pendingCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{pendingCount}</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {activeTab === 'feed' ? (
          <>
            {/* New Post button */}
            <TouchableOpacity
              style={styles.newPostButton}
              activeOpacity={0.82}
              onPress={() => setPostModalVisible(true)}
            >
              <Ionicons name="add-circle-outline" size={18} color={colors.primaryForeground} />
              <Text style={styles.newPostButtonText}>New Post</Text>
            </TouchableOpacity>

            {loadingFeed ? (
              <View style={styles.center}>
                <Text style={styles.mutedText}>Loading feed…</Text>
              </View>
            ) : feed.length === 0 ? (
              <View style={styles.center}>
                <Ionicons name="people-outline" size={40} color={colors.mutedForeground} />
                <Text style={styles.emptyTitle}>No activity yet</Text>
                <Text style={styles.emptySubtitle}>Add friends to see their shared workouts and plans here.</Text>
              </View>
            ) : (
              feed.map((item) => <PostCard key={item.id} item={item} currentUserId={user?.id} friends={friends} />)
            )}
          </>
        ) : (
          <>
            {/* Friends tab actions */}
            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.actionButton} activeOpacity={0.8} onPress={() => router.push('/social/search')}>
                <Ionicons name="search-outline" size={16} color={colors.primaryForeground} />
                <Text style={styles.actionButtonText}>Find Friends</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionButton, styles.actionButtonSecondary]} activeOpacity={0.8} onPress={handleInvite}>
                <Ionicons name="link-outline" size={16} color={colors.foreground} />
                <Text style={styles.actionButtonTextSecondary}>Invite</Text>
              </TouchableOpacity>
            </View>

            {/* Leaderboard CTA */}
            <TouchableOpacity style={styles.leaderboardBanner} activeOpacity={0.8} onPress={() => router.push('/social/leaderboard')}>
              <Text style={styles.leaderboardBannerEmoji}>🏆</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.leaderboardBannerTitle}>Friends Leaderboard</Text>
                <Text style={styles.leaderboardBannerSub}>See who lifts the most — ranked by estimated 1RM</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>

            {/* Pending requests prompt */}
            {pendingCount > 0 && (
              <TouchableOpacity style={styles.requestsBanner} activeOpacity={0.8} onPress={() => router.push('/social/search')}>
                <Ionicons name="notifications-outline" size={18} color={colors.warning} />
                <Text style={styles.requestsBannerText}>
                  {pendingCount} pending friend {pendingCount === 1 ? 'request' : 'requests'}
                </Text>
                <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
              </TouchableOpacity>
            )}

            {loadingFriends ? (
              <View style={styles.center}>
                <Text style={styles.mutedText}>Loading friends…</Text>
              </View>
            ) : friends.length === 0 ? (
              <View style={styles.center}>
                <Ionicons name="people-outline" size={40} color={colors.mutedForeground} />
                <Text style={styles.emptyTitle}>No friends yet</Text>
                <Text style={styles.emptySubtitle}>Search for friends or share your invite link to get started.</Text>
              </View>
            ) : (
              friends.map((f) => (
                <FriendRow key={f.id} friend={f} onMessage={() => handleMessage(f)} />
              ))
            )}
          </>
        )}
      </ScrollView>

      {/* New Post Modal */}
      <NewPostModal
        visible={postModalVisible}
        onClose={() => setPostModalVisible(false)}
        onPosted={loadFeed}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const isSmallScreen = SCREEN_WIDTH < 380;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F5F5F7' },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: isSmallScreen ? spacing.md : spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: '#FFFFFF',
  },
  screenTitle: { fontSize: fontSize.xxl, fontWeight: fontWeight.bold, color: colors.foreground },
  topBarActions: { flexDirection: 'row', gap: spacing.sm },
  iconButton: { padding: 6 },

  segmentBar: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: '#EFEFEF',
    borderRadius: radius.md,
    padding: 4,
  },
  segmentTab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: radius.sm,
  },
  segmentTabActive: {
    backgroundColor: colors.card,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  segmentTabInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  segmentLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.mutedForeground },
  segmentLabelActive: { color: colors.foreground, fontWeight: fontWeight.semibold },

  badge: {
    backgroundColor: colors.destructive,
    borderRadius: radius.full,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: { fontSize: fontSize.xs, color: '#fff', fontWeight: fontWeight.bold },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingVertical: 32, paddingBottom: spacing.xxl, gap: 24 },

  // New Post button
  newPostButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.foreground,
    borderRadius: radius.md,
    paddingVertical: 12,
    marginBottom: spacing.sm,
  },
  newPostButtonText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.primaryForeground,
  },

  // FriendRow card (simpler than PostCard — no shadow treatment needed)
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: isSmallScreen ? spacing.sm : spacing.md,
    backgroundColor: colors.card,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: isSmallScreen ? spacing.xs : spacing.sm },
  avatarCircle: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.foreground },
  cardContent: { flex: 1 },
  cardName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground, flex: 1 },
  cardSub: { fontSize: fontSize.xs, color: colors.mutedForeground, marginTop: 2 },

  smallButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.foreground,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  smallButtonText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.primaryForeground },

  actionRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.foreground,
    paddingVertical: 11,
    borderRadius: radius.md,
  },
  actionButtonSecondary: {
    backgroundColor: colors.muted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionButtonText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.primaryForeground },
  actionButtonTextSecondary: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },

  requestsBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.card,
  },
  requestsBannerText: { flex: 1, fontSize: fontSize.sm, color: colors.foreground, fontWeight: fontWeight.medium },

  leaderboardBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    backgroundColor: colors.card,
  },
  leaderboardBannerEmoji: { fontSize: 22 },
  leaderboardBannerTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  leaderboardBannerSub: { fontSize: fontSize.xs, color: colors.mutedForeground, marginTop: 2 },

  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxl, gap: spacing.md },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.foreground },
  emptySubtitle: { fontSize: fontSize.sm, color: colors.mutedForeground, textAlign: 'center' },
  mutedText: { fontSize: fontSize.sm, color: colors.mutedForeground },

  // ── Modal styles ────────────────────────────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    // Prevent dismiss tap propagation
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.foreground },
  modalCloseButton: { padding: 4 },

  // Post type tab bar
  postTabBar: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    backgroundColor: colors.muted,
    borderRadius: radius.md,
    padding: 4,
    gap: 4,
  },
  postTab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: radius.sm,
  },
  postTabActive: {
    backgroundColor: colors.card,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  postTabLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.mutedForeground },
  postTabLabelActive: { color: colors.foreground, fontWeight: fontWeight.semibold },

  modalBody: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },

  textInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: fontSize.base,
    color: colors.foreground,
    backgroundColor: colors.background,
    minHeight: 120,
  },
  textInputSingleLine: {
    minHeight: 0,
    height: 50,
  },
  captionInput: {
    marginTop: spacing.xs,
    marginBottom: 0,
  },

  charCount: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    textAlign: 'right',
    marginTop: -spacing.xs,
  },

  postButton: {
    backgroundColor: colors.foreground,
    borderRadius: radius.xl,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  postButtonText: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.primaryForeground,
  },

  pickImageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 14,
    backgroundColor: colors.background,
  },
  pickImageButtonText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.foreground },

  imagePreview: {
    width: '100%',
    height: 180,
    borderRadius: radius.md,
    backgroundColor: colors.muted,
  },

  // Workout tab
  workoutScrollArea: {
    maxHeight: 440,
  },
  exerciseEntryCard: {
    backgroundColor: colors.muted,
    borderRadius: radius.md,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  fieldLabel: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    marginBottom: 4,
    fontWeight: fontWeight.medium,
  },
  miniInput: {
    minHeight: 0,
    height: 40,
    textAlign: 'center',
    paddingHorizontal: spacing.xs,
    fontSize: fontSize.sm,
  },
  addExerciseButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 10,
    backgroundColor: colors.background,
    borderStyle: 'dashed',
  },
  addExerciseText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.foreground,
  },

  proGateContainer: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  proGateTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.foreground },
  proGateSubtitle: { fontSize: fontSize.sm, color: colors.mutedForeground, textAlign: 'center' },
  upgradeButton: {
    marginTop: spacing.sm,
    backgroundColor: colors.foreground,
    borderRadius: radius.xl,
    paddingVertical: 12,
    paddingHorizontal: spacing.xl,
  },
  upgradeButtonText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.primaryForeground },
});
