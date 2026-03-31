import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { socialApi } from '../../src/lib/api';
import { colors, fontSize, fontWeight, radius, spacing } from '../../src/constants/theme';

interface FeedItem {
  id: string;
  sharerId: string;
  sharerName: string;
  itemType: string;
  payload: any;
  createdAt: string;
}

interface Friend {
  id: string;
  name: string | null;
  email: string | null;
}

interface FriendRequest {
  id: string;
  requesterId: string;
  requesterName: string | null;
  requesterEmail: string | null;
}

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

function FeedCard({ item }: { item: FeedItem }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardRow}>
        <View style={styles.avatarCircle}>
          <Text style={styles.avatarText}>{(item.sharerName ?? '?')[0].toUpperCase()}</Text>
        </View>
        <View style={styles.cardContent}>
          <Text style={styles.cardName}>{item.sharerName ?? 'Unknown'}</Text>
          <Text style={styles.cardSub}>{payloadDescription(item.itemType, item.payload)}</Text>
        </View>
        <Text style={styles.timeText}>{relativeTime(item.createdAt)}</Text>
      </View>
    </View>
  );
}

function FriendRow({ friend, onMessage }: { friend: Friend; onMessage: () => void }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardRow}>
        <View style={styles.avatarCircle}>
          <Text style={styles.avatarText}>{((friend.name ?? friend.email ?? '?')[0]).toUpperCase()}</Text>
        </View>
        <View style={styles.cardContent}>
          <Text style={styles.cardName}>{friend.name ?? 'Unnamed'}</Text>
          {friend.email ? <Text style={styles.cardSub}>{friend.email}</Text> : null}
        </View>
        <TouchableOpacity style={styles.smallButton} activeOpacity={0.8} onPress={onMessage}>
          <Ionicons name="chatbubble-outline" size={14} color={colors.primaryForeground} />
          <Text style={styles.smallButtonText}>Message</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function SocialScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'feed' | 'friends'>('feed');
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loadingFeed, setLoadingFeed] = useState(true);
  const [loadingFriends, setLoadingFriends] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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
      const link = data.link ?? data.url ?? data.inviteUrl ?? JSON.stringify(data);
      Alert.alert('Invite Link', link, [{ text: 'OK' }]);
    } catch {
      Alert.alert('Error', 'Could not generate invite link.');
    }
  };

  const handleMessage = (friend: Friend) => {
    router.push(`/social/messages?friendId=${friend.id}&friendName=${encodeURIComponent(friend.name ?? friend.email ?? 'Friend')}`);
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
          loadingFeed ? (
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
            feed.map((item) => <FeedCard key={item.id} item={item} />)
          )
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  screenTitle: { fontSize: fontSize.xxl, fontWeight: fontWeight.bold, color: colors.foreground },
  topBarActions: { flexDirection: 'row', gap: spacing.sm },
  iconButton: { padding: 6 },

  segmentBar: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.muted,
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
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },

  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    backgroundColor: colors.card,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
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
  cardName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  cardSub: { fontSize: fontSize.xs, color: colors.mutedForeground, marginTop: 2 },
  timeText: { fontSize: fontSize.xs, color: colors.mutedForeground },

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

  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxl, gap: spacing.md },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.foreground },
  emptySubtitle: { fontSize: fontSize.sm, color: colors.mutedForeground, textAlign: 'center' },
  mutedText: { fontSize: fontSize.sm, color: colors.mutedForeground },
});
