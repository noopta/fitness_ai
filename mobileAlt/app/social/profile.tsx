import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getToken, socialApi } from '../../src/lib/api';
import { ContributionGraph } from '../../src/components/ContributionGraph';
import { colors, fontSize, fontWeight, radius, spacing } from '../../src/constants/theme';

const API_BASE = 'https://api.airthreads.ai:4009/api';

interface ProfileUser {
  id: string;
  name: string | null;
  email: string | null;
  tier: string;
  createdAt: string;
}

interface ProfileData {
  user: ProfileUser;
  isFriend: boolean;
  friendshipStatus: 'none' | 'pending_sent' | 'pending_received' | 'accepted' | 'blocked';
  mutualFriendsCount: number;
}

function initials(name: string | null, email: string | null): string {
  if (name) return name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2);
  if (email) return email[0].toUpperCase();
  return '?';
}

function formatMemberSince(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export default function ProfileScreen() {
  const router = useRouter();
  const { userId, currentUserId } = useLocalSearchParams<{ userId: string; currentUserId?: string }>();

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [friendshipStatus, setFriendshipStatus] = useState<ProfileData['friendshipStatus']>('none');
  const [addingFriend, setAddingFriend] = useState(false);

  const isSelf = !!currentUserId && currentUserId === userId;

  useEffect(() => {
    if (!userId) return;

    async function loadProfile() {
      try {
        const token = await getToken();
        const res = await fetch(`${API_BASE}/social/profile/${encodeURIComponent(userId)}`, {
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        if (!res.ok) throw new Error('Failed to load profile');
        const data: ProfileData = await res.json();
        setProfile(data);
        setFriendshipStatus(data.friendshipStatus);
      } catch (err: any) {
        Alert.alert('Error', err?.message ?? 'Could not load profile.');
      } finally {
        setLoading(false);
      }
    }

    loadProfile();
  }, [userId]);

  async function handleAddFriend() {
    setAddingFriend(true);
    try {
      await socialApi.sendFriendRequest(userId);
      setFriendshipStatus('pending_sent');
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Could not send friend request.');
    } finally {
      setAddingFriend(false);
    }
  }

  function handleMessage() {
    if (!profile) return;
    const name = profile.user.name ?? profile.user.email ?? 'User';
    router.push(`/social/messages?friendId=${encodeURIComponent(profile.user.id)}&friendName=${encodeURIComponent(name)}`);
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.backButton} activeOpacity={0.8} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={styles.screenTitle}>Profile</Text>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={colors.foreground} />
        </View>
      </SafeAreaView>
    );
  }

  if (!profile) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.backButton} activeOpacity={0.8} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={styles.screenTitle}>Profile</Text>
        </View>
        <View style={styles.loadingContainer}>
          <Text style={styles.mutedText}>Profile not found.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const { user } = profile;
  const displayName = user.name || user.email || 'Unknown User';
  const isPro = user.tier === 'pro' || user.tier === 'enterprise';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backButton} activeOpacity={0.8} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={styles.screenTitle}>Profile</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Avatar + info */}
        <View style={styles.profileCard}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>{initials(user.name, user.email)}</Text>
          </View>

          <View style={styles.profileInfo}>
            <View style={styles.nameRow}>
              <Text style={styles.displayName} numberOfLines={1}>{displayName}</Text>
              <View style={[styles.tierBadge, isPro && styles.tierBadgePro]}>
                <Text style={[styles.tierBadgeText, isPro && styles.tierBadgeTextPro]}>
                  {isPro ? 'Pro' : 'Free'}
                </Text>
              </View>
            </View>

            {user.name && user.email && (
              <Text style={styles.emailText} numberOfLines={1}>{user.email}</Text>
            )}

            <View style={styles.metaRow}>
              <Ionicons name="calendar-outline" size={13} color={colors.mutedForeground} />
              <Text style={styles.metaText}>Member since {formatMemberSince(user.createdAt)}</Text>
            </View>

            {!isSelf && profile.mutualFriendsCount > 0 && (
              <View style={styles.metaRow}>
                <Ionicons name="people-outline" size={13} color={colors.mutedForeground} />
                <Text style={styles.metaText}>
                  {profile.mutualFriendsCount} mutual friend{profile.mutualFriendsCount !== 1 ? 's' : ''}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Action buttons */}
        {!isSelf && friendshipStatus !== 'blocked' && (
          <View style={styles.actionsRow}>
            {friendshipStatus === 'accepted' ? (
              <View style={styles.friendsBadge}>
                <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                <Text style={styles.friendsBadgeText}>Friends</Text>
              </View>
            ) : friendshipStatus === 'pending_sent' ? (
              <View style={styles.pendingBadge}>
                <Ionicons name="time-outline" size={15} color={colors.mutedForeground} />
                <Text style={styles.pendingBadgeText}>Request Sent</Text>
              </View>
            ) : friendshipStatus === 'pending_received' ? (
              <View style={styles.pendingBadge}>
                <Text style={styles.pendingBadgeText}>Respond in Friends</Text>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.addFriendButton}
                activeOpacity={0.8}
                onPress={handleAddFriend}
                disabled={addingFriend}
              >
                {addingFriend
                  ? <ActivityIndicator color={colors.primaryForeground} size="small" />
                  : <>
                      <Ionicons name="person-add-outline" size={16} color={colors.primaryForeground} />
                      <Text style={styles.addFriendButtonText}>Add Friend</Text>
                    </>
                }
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.messageButton}
              activeOpacity={0.8}
              onPress={handleMessage}
            >
              <Ionicons name="chatbubble-outline" size={16} color={colors.foreground} />
              <Text style={styles.messageButtonText}>Message</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Activity graph */}
        <View style={styles.activityCard}>
          <Text style={styles.sectionTitle}>Workout Activity</Text>
          <ContributionGraph userId={userId} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: { padding: 4 },
  screenTitle: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.foreground },

  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },

  profileCard: {
    flexDirection: 'row',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    backgroundColor: colors.card,
    alignItems: 'flex-start',
  },
  avatarCircle: {
    width: 64,
    height: 64,
    borderRadius: radius.full,
    backgroundColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
  },
  profileInfo: { flex: 1, gap: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  displayName: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
    flexShrink: 1,
  },
  tierBadge: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  tierBadgePro: {
    backgroundColor: colors.foreground,
    borderColor: colors.foreground,
  },
  tierBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.mutedForeground,
  },
  tierBadgeTextPro: {
    color: colors.primaryForeground,
  },
  emailText: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  metaText: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
  },

  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  addFriendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.foreground,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.md,
  },
  addFriendButtonText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.primaryForeground,
  },
  messageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.md,
  },
  messageButtonText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
  },
  friendsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  friendsBadgeText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.success,
  },
  pendingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pendingBadgeText: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
  },

  activityCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    backgroundColor: colors.card,
    gap: spacing.sm,
  },
  sectionTitle: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
  },

  mutedText: { fontSize: fontSize.sm, color: colors.mutedForeground },
});
