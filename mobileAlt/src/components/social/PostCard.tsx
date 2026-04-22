import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Image,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withTiming,
  withDelay,
  Easing,
  runOnJS,
  interpolate,
} from 'react-native-reanimated';
import { Heart, MessageCircle, Send, Dumbbell, ChevronUp, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { socialApi } from '../../lib/api';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PostComment {
  id: string;
  text: string;
  createdAt: string;
  author: { id: string; name: string | null; username: string | null; avatarBase64?: string | null };
}

export interface FeedItem {
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

interface WorkoutExercise {
  name: string;
  sets: number;
  reps: number;
  weight: string | number;
  isPR?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function getInitials(sharer: FeedItem['sharer']): string {
  const name = sharer?.username ?? sharer?.name ?? '?';
  return name.slice(0, 2).toUpperCase();
}

// ─── Floating Hearts ─────────────────────────────────────────────────────────

const HEART_CONFIGS = [
  { left: 2,  rotation: '-18deg', delay: 0  },
  { left: 14, rotation:   '5deg', delay: 60 },
  { left: 26, rotation:  '22deg', delay: 30 },
  { left: 8,  rotation:  '-8deg', delay: 90 },
] as const;

function FloatingHeart({ left, rotation, delay }: { left: number; rotation: string; delay: number }) {
  const translateY = useSharedValue(0);
  const opacity    = useSharedValue(1);
  const scale      = useSharedValue(1);

  useEffect(() => {
    const opts = { duration: 720, easing: Easing.out(Easing.ease) };
    translateY.value = withDelay(delay, withTiming(-52, opts));
    opacity.value    = withDelay(delay, withTiming(0,   opts));
    scale.value      = withDelay(delay, withTiming(0.3, opts));
  }, []);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateY: translateY.value } as { translateY: number },
      { scale: scale.value } as { scale: number },
      { rotate: rotation } as { rotate: string },
    ],
    opacity: opacity.value,
  }));

  return (
    <Animated.View style={[{ position: 'absolute', bottom: 0, left }, style]} pointerEvents="none">
      <Heart size={14} color="#EF4444" fill="#EF4444" />
    </Animated.View>
  );
}

function FloatingHearts({ isAnimating }: { isAnimating: boolean }) {
  if (!isAnimating) return null;
  return (
    <>
      {HEART_CONFIGS.map((cfg, i) => (
        <FloatingHeart key={i} left={cfg.left} rotation={cfg.rotation} delay={cfg.delay} />
      ))}
    </>
  );
}

// ─── Card Header ─────────────────────────────────────────────────────────────

function CardHeader({ sharer, time }: { sharer: FeedItem['sharer']; time: string }) {
  const displayName = sharer?.username ? `@${sharer.username}` : (sharer?.name ?? 'Unknown');
  const initials = getInitials(sharer);
  const raw = sharer?.avatarBase64;
  const avatarUri = raw ? (raw.startsWith('data:') ? raw : `data:image/jpeg;base64,${raw}`) : null;

  return (
    <View style={cs.header}>
      <View style={cs.avatarContainer}>
        {avatarUri
          ? <Image source={{ uri: avatarUri }} style={cs.avatarImage} />
          : <Text style={cs.avatarInitials}>{initials}</Text>
        }
      </View>
      <Text style={cs.username} numberOfLines={1}>{displayName}</Text>
      <Text style={cs.timestamp}>{time}</Text>
    </View>
  );
}

// ─── Card Body ───────────────────────────────────────────────────────────────

function CardBody({
  text,
  caption,
  imageUri,
  onImagePress,
}: {
  text?: string | null;
  caption?: string | null;
  imageUri?: string | null;
  onImagePress?: () => void;
}) {
  if (!text && !caption && !imageUri) return null;
  return (
    <View>
      {imageUri && (
        <TouchableOpacity onPress={onImagePress} activeOpacity={0.9} style={cs.imageBlock}>
          <Image source={{ uri: imageUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        </TouchableOpacity>
      )}
      {caption ? <Text style={cs.caption}>{caption}</Text> : null}
      {text ? <Text style={cs.postBody}>{text}</Text> : null}
    </View>
  );
}

// ─── Workout Section ─────────────────────────────────────────────────────────

function WorkoutSection({ exercises, title }: { exercises: WorkoutExercise[]; title?: string }) {
  const [expanded, setExpanded] = useState(true);
  const chevronRot = useSharedValue(0);

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${interpolate(chevronRot.value, [0, 1], [0, 180])}deg` }],
  }));

  function toggle() {
    const next = !expanded;
    chevronRot.value = withTiming(next ? 0 : 1, { duration: 200 });
    setExpanded(next);
  }

  return (
    <View style={cs.workoutOuter}>
      <TouchableOpacity style={cs.workoutToggle} onPress={toggle} activeOpacity={0.8}>
        <Dumbbell size={16} color="#6B7280" />
        <Text style={cs.workoutLabel}>{title?.toUpperCase() ?? "TODAY'S WORKOUT"}</Text>
        <View style={cs.exerciseCountPill}>
          <Text style={cs.exerciseCountText}>
            {exercises.length} exercise{exercises.length !== 1 ? 's' : ''}
          </Text>
        </View>
        <View style={{ flex: 1 }} />
        <Animated.View style={chevronStyle}>
          <ChevronUp size={16} color="#9CA3AF" />
        </Animated.View>
      </TouchableOpacity>

      {expanded && (
        <View>
          {exercises.map((ex, i) => (
            <View
              key={i}
              style={[cs.exerciseRow, i < exercises.length - 1 && cs.exerciseRowBorder]}
            >
              <View style={cs.exerciseLine1}>
                <Text style={cs.exerciseName}>{ex.name}</Text>
                {ex.isPR && (
                  <View style={cs.prBadge}>
                    <Text style={cs.prBadgeText}>PR</Text>
                  </View>
                )}
              </View>
              <View style={cs.exerciseLine2}>
                <Text style={cs.exerciseSetsReps}>{ex.sets} sets × {ex.reps} reps</Text>
                <View style={cs.weightPill}>
                  <Text style={cs.weightPillText}>{ex.weight} lbs</Text>
                </View>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ─── Action Bar ───────────────────────────────────────────────────────────────

function ActionBar({
  liked,
  likeCount,
  commentCount,
  onLike,
  onComment,
  onShare,
}: {
  liked: boolean;
  likeCount: number;
  commentCount: number;
  onLike: () => void;
  onComment: () => void;
  onShare: () => void;
}) {
  const [showHearts, setShowHearts] = useState(false);
  const heartsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const heartScale    = useSharedValue(1);
  const rippleScale   = useSharedValue(1);
  const rippleOpacity = useSharedValue(0);

  const heartStyle = useAnimatedStyle(() => ({
    transform: [{ scale: heartScale.value }],
  }));

  const rippleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: rippleScale.value }],
    opacity: rippleOpacity.value,
  }));

  function triggerLikeAnimation() {
    heartScale.value = withSequence(
      withSpring(1.55, { damping: 5, stiffness: 300 }),
      withSpring(0.85, { damping: 8, stiffness: 400 }),
      withSpring(1.2,  { damping: 6, stiffness: 350 }),
      withTiming(1.0,  { duration: 200 }),
    );
    rippleScale.value   = 1;
    rippleOpacity.value = 0.8;
    rippleScale.value   = withTiming(3.2, { duration: 520, easing: Easing.out(Easing.ease) });
    rippleOpacity.value = withTiming(0,   { duration: 520, easing: Easing.out(Easing.ease) });

    setShowHearts(true);
    if (heartsTimer.current) clearTimeout(heartsTimer.current);
    heartsTimer.current = setTimeout(() => setShowHearts(false), 820);
  }

  function handleLike() {
    if (!liked) triggerLikeAnimation();
    onLike();
  }

  useEffect(() => () => {
    if (heartsTimer.current) clearTimeout(heartsTimer.current);
  }, []);

  return (
    <View style={cs.actionBar}>
      {/* Like */}
      <View style={{ position: 'relative', overflow: 'visible' }}>
        <Animated.View style={[cs.ripple, rippleStyle]} pointerEvents="none" />
        <TouchableOpacity style={cs.actionBtn} onPress={handleLike} activeOpacity={0.7}>
          <Animated.View style={heartStyle}>
            <Heart
              size={22}
              color={liked ? '#EF4444' : '#9CA3AF'}
              fill={liked ? '#EF4444' : 'transparent'}
            />
          </Animated.View>
          {likeCount > 0 && (
            <Text style={[cs.actionCount, liked && { color: '#EF4444' }]}>{likeCount}</Text>
          )}
        </TouchableOpacity>
        <FloatingHearts isAnimating={showHearts} />
      </View>

      {/* Comment */}
      <TouchableOpacity style={cs.actionBtn} onPress={onComment} activeOpacity={0.7}>
        <MessageCircle size={22} color="#9CA3AF" />
        {commentCount > 0 && <Text style={cs.actionCount}>{commentCount}</Text>}
      </TouchableOpacity>

      {/* Share — pushed to far right */}
      <View style={{ flex: 1, alignItems: 'flex-end' }}>
        <TouchableOpacity onPress={onShare} activeOpacity={0.7}>
          <Send size={22} color="#9CA3AF" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Comment Sheet ────────────────────────────────────────────────────────────

function CommentSheet({
  visible,
  post,
  onClose,
  onCommentAdded,
}: {
  visible: boolean;
  post: FeedItem;
  onClose: () => void;
  onCommentAdded: (c: PostComment) => void;
}) {
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const [localComments, setLocalComments] = useState<PostComment[]>(post.comments);
  const [commentText, setCommentText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { setLocalComments(post.comments); }, [post.comments]);

  const slideY      = useSharedValue(700);
  const backdropAlpha = useSharedValue(0);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: slideY.value }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropAlpha.value,
  }));

  useEffect(() => {
    if (visible) {
      setMounted(true);
      slideY.value      = withTiming(0,   { duration: 320, easing: Easing.out(Easing.ease) });
      backdropAlpha.value = withTiming(1, { duration: 320 });
    } else if (mounted) {
      slideY.value      = withTiming(700, { duration: 260, easing: Easing.in(Easing.ease) }, (done) => {
        if (done) runOnJS(setMounted)(false);
      });
      backdropAlpha.value = withTiming(0, { duration: 260 });
    }
  }, [visible]);

  async function handleSubmit() {
    if (!commentText.trim() || submitting) return;
    setSubmitting(true);
    try {
      const newComment = await socialApi.addComment(post.id, commentText.trim());
      setLocalComments(prev => [...prev, newComment]);
      onCommentAdded(newComment);
      setCommentText('');
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not post comment.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!mounted) return null;

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView
        style={{ flex: 1, justifyContent: 'flex-end' }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Backdrop */}
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.30)' }, backdropStyle]}
          pointerEvents="none"
        />
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        {/* Sheet */}
        <Animated.View style={[cs.commentSheet, sheetStyle, { paddingBottom: Math.max(12, insets.bottom) }]}>
          <Pressable onPress={() => {}} style={{ flex: 1 }}>
            {/* Drag handle */}
            <View style={cs.dragHandle} />

            {/* Header */}
            <View style={cs.sheetHeader}>
              <Text style={cs.sheetTitle}>
                Comments{localComments.length > 0 ? ` ${localComments.length}` : ''}
              </Text>
              <TouchableOpacity onPress={onClose} activeOpacity={0.7} style={{ padding: 4 }}>
                <X size={20} color="#6B7280" />
              </TouchableOpacity>
            </View>
            <View style={cs.sheetDivider} />

            {/* Comment list */}
            <FlatList
              data={localComments}
              keyExtractor={(c) => c.id}
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: 16, gap: 16 }}
              ListEmptyComponent={
                <Text style={cs.emptyComments}>No comments yet. Be the first!</Text>
              }
              renderItem={({ item: c }) => {
                const raw = c.author.avatarBase64;
                const avatarUri = raw ? (raw.startsWith('data:') ? raw : `data:image/jpeg;base64,${raw}`) : null;
                return (
                <View style={cs.commentRow}>
                  <View style={cs.commentAvatar}>
                    {avatarUri
                      ? <Image source={{ uri: avatarUri }} style={{ width: 32, height: 32, borderRadius: 16 }} />
                      : <Text style={cs.commentAvatarText}>
                          {(c.author.username ?? c.author.name ?? '?')[0].toUpperCase()}
                        </Text>
                    }
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <Text style={cs.commentAuthor}>
                        {c.author.username ? `@${c.author.username}` : (c.author.name ?? 'User')}
                      </Text>
                      <Text style={cs.commentTime}>{relativeTime(c.createdAt)}</Text>
                    </View>
                    <Text style={cs.commentBody}>{c.text}</Text>
                  </View>
                </View>
                );
              }}
            />

            {/* Reply input */}
            <View style={cs.replyRow}>
              <View style={cs.replyAvatar}>
                <Text style={cs.replyAvatarText}>Y</Text>
              </View>
              <TextInput
                style={cs.replyInput}
                placeholder="Add a comment…"
                placeholderTextColor="#9CA3AF"
                value={commentText}
                onChangeText={setCommentText}
                returnKeyType="send"
                onSubmitEditing={handleSubmit}
              />
              <TouchableOpacity
                onPress={handleSubmit}
                disabled={!commentText.trim() || submitting}
                activeOpacity={0.7}
              >
                {submitting
                  ? <ActivityIndicator size="small" color="#EF4444" />
                  : <Send size={20} color={commentText.trim() ? '#EF4444' : '#D1D5DB'} />
                }
              </TouchableOpacity>
            </View>
          </Pressable>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Post Card ────────────────────────────────────────────────────────────────

export function PostCard({
  item: initialItem,
  currentUserId,
  friends,
}: {
  item: FeedItem;
  currentUserId?: string;
  friends: { id: string; name: string | null; username: string | null }[];
}) {
  const [item, setItem] = useState(initialItem);
  const [commentSheetVisible, setCommentSheetVisible] = useState(false);
  const [imageExpanded, setImageExpanded] = useState(false);
  const [showForwardPicker, setShowForwardPicker] = useState(false);
  const [forwardMessage, setForwardMessage] = useState('');
  const [forwarding, setForwarding] = useState(false);
  const [reposting, setReposting] = useState(false);
  const [deleted, setDeleted] = useState(false);

  useEffect(() => {
    setItem(initialItem);
  }, [initialItem.id, initialItem.reactionCount, initialItem.commentCount]);

  if (deleted) return null;

  const isRepost  = item.itemType === 'repost';
  const isText    = item.itemType === 'text';
  const isOwnPost = item.sharerId === currentUserId;

  const rawBase64 = isRepost
    ? item.payload?.originalPayload?.imageBase64
    : item.payload?.imageBase64;
  const imageUri = rawBase64
    ? (rawBase64.startsWith('data:') ? rawBase64 : `data:image/jpeg;base64,${rawBase64}`)
    : null;

  const postText: string | null = isRepost
    ? (item.payload?.originalPayload?.text ?? item.payload?.originalCaption ?? null)
    : (isText ? (item.payload?.text ?? null) : null);

  const postCaption = isRepost ? null : (item.caption ?? null);

  const exercises: WorkoutExercise[] = Array.isArray(item.payload?.exercises)
    ? item.payload.exercises
    : [];
  const workoutTitle: string | undefined = item.payload?.title;

  function handleLongPress() {
    if (isOwnPost) {
      Alert.alert('Delete Post', 'Remove this post from your feed?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await socialApi.deletePost(item.id);
              setDeleted(true);
            } catch (err: any) {
              Alert.alert('Error', err?.message || 'Could not delete post.');
            }
          },
        },
      ]);
    } else {
      Alert.alert('Report Post', 'Is this content inappropriate?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Report',
          style: 'destructive',
          onPress: () => {
            socialApi.reportPost(item.id, 'inappropriate').catch(() => {});
            Alert.alert('Reported', "Thank you — we'll review this post.");
          },
        },
      ]);
    }
  }

  async function handleReact() {
    const wasLiked = item.likedByMe;
    setItem(prev => ({
      ...prev,
      likedByMe: !wasLiked,
      reactionCount: prev.reactionCount + (wasLiked ? -1 : 1),
    }));
    try {
      await socialApi.reactToPost(item.id);
    } catch {
      setItem(prev => ({
        ...prev,
        likedByMe: wasLiked,
        reactionCount: prev.reactionCount + (wasLiked ? 1 : -1),
      }));
    }
  }

  function handleCommentAdded(comment: PostComment) {
    setItem(prev => ({
      ...prev,
      comments: [...prev.comments, comment],
      commentCount: prev.commentCount + 1,
    }));
  }

  async function handleForward(friendId: string) {
    setForwarding(true);
    try {
      await socialApi.forwardPost(item.id, friendId, forwardMessage.trim() || undefined);
      setShowForwardPicker(false);
      setForwardMessage('');
      Alert.alert('Sent!', 'Post forwarded to your friend.');
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not forward post.');
    } finally {
      setForwarding(false);
    }
  }

  async function handleRepost() {
    setReposting(true);
    try {
      await socialApi.shareItem({
        itemType: 'repost',
        payload: {
          originalPostId: item.id,
          originalSharerId: item.sharerId,
          originalSharerName: item.sharer?.name ?? null,
          originalSharerUsername: item.sharer?.username ?? null,
          originalItemType: item.itemType,
          originalPayload: item.payload,
          originalCaption: item.caption ?? null,
        },
      });
      Alert.alert('Reposted!', 'Added to your feed.');
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not repost.');
    } finally {
      setReposting(false);
    }
  }

  return (
    <Pressable onLongPress={handleLongPress} delayLongPress={400}>
      <View style={cs.card}>
        <CardHeader sharer={item.sharer} time={relativeTime(item.createdAt)} />

        {/* Repost attribution */}
        {isRepost && (
          <Text style={cs.repostLabel}>
            reposted from{' '}
            {item.payload?.originalSharerUsername
              ? `@${item.payload.originalSharerUsername}`
              : (item.payload?.originalSharerName ?? 'Unknown')}
          </Text>
        )}

        <CardBody
          text={postText}
          caption={postCaption}
          imageUri={imageUri}
          onImagePress={() => setImageExpanded(true)}
        />

        {exercises.length > 0 && (
          <WorkoutSection exercises={exercises} title={workoutTitle} />
        )}

        <ActionBar
          liked={item.likedByMe}
          likeCount={item.reactionCount}
          commentCount={item.commentCount}
          onLike={handleReact}
          onComment={() => setCommentSheetVisible(true)}
          onShare={() => setShowForwardPicker(true)}
        />
      </View>

      {/* Fullscreen image modal */}
      {imageUri && (
        <Modal
          visible={imageExpanded}
          transparent
          animationType="fade"
          onRequestClose={() => setImageExpanded(false)}
        >
          <Pressable
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' }}
            onPress={() => setImageExpanded(false)}
          >
            <Image source={{ uri: imageUri }} style={{ width: '100%', height: '85%' }} resizeMode="contain" />
          </Pressable>
        </Modal>
      )}

      {/* Comment bottom sheet */}
      <CommentSheet
        visible={commentSheetVisible}
        post={item}
        onClose={() => setCommentSheetVisible(false)}
        onCommentAdded={handleCommentAdded}
      />

      {/* Forward picker */}
      <Modal
        visible={showForwardPicker}
        transparent
        animationType="slide"
        onRequestClose={() => { setShowForwardPicker(false); setForwardMessage(''); }}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}
          onPress={() => { setShowForwardPicker(false); setForwardMessage(''); }}
        >
          <View style={cs.forwardSheet}>
            <Pressable onPress={() => {}}>
              <Text style={cs.forwardTitle}>Send to a Friend</Text>
              <TextInput
                style={cs.forwardMessageInput}
                placeholder="Add a message (optional)…"
                placeholderTextColor="#9CA3AF"
                value={forwardMessage}
                onChangeText={setForwardMessage}
                maxLength={300}
              />
              {!isOwnPost && (
                <TouchableOpacity
                  style={cs.repostRow}
                  activeOpacity={0.75}
                  disabled={reposting}
                  onPress={handleRepost}
                >
                  <Text style={cs.repostRowText}>
                    {reposting ? 'Reposting…' : 'Repost to my feed'}
                  </Text>
                </TouchableOpacity>
              )}
              {friends.map(f => (
                <TouchableOpacity
                  key={f.id}
                  style={cs.forwardRow}
                  activeOpacity={0.75}
                  disabled={forwarding}
                  onPress={() => handleForward(f.id)}
                >
                  <View style={cs.forwardAvatar}>
                    <Text style={cs.forwardAvatarText}>
                      {((f.username ?? f.name ?? '?')[0]).toUpperCase()}
                    </Text>
                  </View>
                  <Text style={cs.forwardName}>
                    {f.username ? `@${f.username}` : (f.name ?? 'User')}
                  </Text>
                  {forwarding && <ActivityIndicator size="small" color="#9CA3AF" />}
                </TouchableOpacity>
              ))}
              {friends.length === 0 && (
                <Text style={{ color: '#9CA3AF', fontSize: 14, textAlign: 'center', paddingVertical: 12 }}>
                  Add friends to forward posts
                </Text>
              )}
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const cs = StyleSheet.create({
  // Card
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
    gap: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 4,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  avatarInitials: {
    fontSize: 13,
    fontWeight: '500',
    color: '#1F2937',
  },
  username: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  timestamp: {
    fontSize: 14,
    fontWeight: '500',
    color: '#9CA3AF',
  },

  // Body
  imageBlock: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 16,
    backgroundColor: '#1F2937',
    marginBottom: 12,
    overflow: 'hidden',
  },
  caption: {
    fontSize: 15,
    fontWeight: '400',
    color: '#9CA3AF',
    fontStyle: 'italic',
    marginBottom: 4,
  },
  postBody: {
    fontSize: 15,
    fontWeight: '400',
    color: '#1F2937',
    lineHeight: 22,
  },
  repostLabel: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: -8,
  },

  // Workout
  workoutOuter: {
    backgroundColor: '#F5F5F7',
    borderRadius: 12,
    overflow: 'hidden',
    paddingBottom: 8,
  },
  workoutToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  workoutLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: '#6B7280',
    textTransform: 'uppercase',
  },
  exerciseCountPill: {
    backgroundColor: 'rgba(209,213,219,0.4)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  exerciseCountText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#9CA3AF',
  },
  exerciseRow: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 4,
  },
  exerciseRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(209,213,219,0.6)',
  },
  exerciseLine1: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  exerciseName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#111827',
  },
  prBadge: {
    backgroundColor: '#F0FDF4',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    marginLeft: 8,
  },
  prBadgeText: {
    color: '#15803D',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  exerciseLine2: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  exerciseSetsReps: {
    fontSize: 12,
    fontWeight: '400',
    color: '#6B7280',
  },
  weightPill: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(243,244,246,0.5)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  weightPillText: {
    color: '#374151',
    fontSize: 12,
    fontWeight: '600',
  },

  // Action bar
  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F9FAFB',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionCount: {
    fontSize: 14,
    fontWeight: '500',
    color: '#9CA3AF',
  },
  ripple: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#F87171',
  },

  // Comment sheet
  commentSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    height: '75%',
    overflow: 'hidden',
  },
  dragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D1D5DB',
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 4,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  sheetTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  sheetDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E5E7EB',
  },
  commentRow: {
    flexDirection: 'row',
    gap: 12,
  },
  commentAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  commentAvatarText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1F2937',
  },
  commentAuthor: {
    fontSize: 12,
    fontWeight: '700',
    color: '#111827',
  },
  commentTime: {
    fontSize: 11,
    fontWeight: '400',
    color: '#9CA3AF',
  },
  commentBody: {
    fontSize: 14,
    fontWeight: '400',
    color: '#1F2937',
    lineHeight: 19,
  },
  emptyComments: {
    textAlign: 'center',
    color: '#9CA3AF',
    paddingVertical: 24,
    fontSize: 14,
  },
  replyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    backgroundColor: '#FFFFFF',
  },
  replyAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  replyAvatarText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1F2937',
  },
  replyInput: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
    fontSize: 14,
    color: '#111827',
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },

  // Forward sheet
  forwardSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
    gap: 8,
  },
  forwardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 12,
  },
  forwardMessageInput: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: '#111827',
    fontSize: 14,
    marginBottom: 12,
  },
  forwardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F3F4F6',
  },
  forwardAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  forwardAvatarText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1F2937',
  },
  forwardName: {
    flex: 1,
    fontSize: 14,
    color: '#111827',
  },
  repostRow: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F3F4F6',
  },
  repostRowText: {
    fontSize: 14,
    color: '#6B7280',
    fontWeight: '500',
  },
});
