import React, { useEffect, useState, useCallback, useRef } from 'react';
import { RefreshControl } from 'react-native';
import { useFocusEffect } from 'expo-router';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { socialApi, groupsApi } from '../../src/lib/api';
import { colors, fontSize, fontWeight, radius, spacing } from '../../src/constants/theme';

interface Conversation {
  id: string;
  otherUser: {
    id: string;
    name: string | null;
    username?: string | null;
    email: string | null;
    avatarBase64?: string | null;
  };
  lastMessage: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
}

interface GroupSummary {
  id: string;
  name: string;
  createdAt?: string;
  members?: Array<{ user?: { id: string; name: string | null; username: string | null; avatarBase64: string | null } }>;
  messages?: Array<{ text: string; senderId: string | null; createdAt: string }>;
}

// Unified row across 1:1 conversations and group chats, sorted by last activity
// so groups are interleaved among DMs rather than hidden in a separate tab.
type ChatRow =
  | { kind: 'dm'; sortAt: number; conv: Conversation }
  | { kind: 'group'; sortAt: number; group: GroupSummary };

function avatarUriFrom(raw?: string | null): string | null {
  if (!raw) return null;
  return raw.startsWith('data:') ? raw : `data:image/jpeg;base64,${raw}`;
}

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function MessagesScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ friendId?: string; friendName?: string }>();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const didCreate = React.useRef(false);

  const loadAll = useCallback(() => {
    return Promise.all([
      socialApi.getConversations()
        .then((data) => setConversations(Array.isArray(data) ? data : data.conversations ?? []))
        .catch(() => setConversations([])),
      // Groups are flag-gated server-side (404 when the agent surface is off) —
      // treat any failure as "no groups" so the DM list still renders.
      groupsApi.list()
        .then((data: any) => setGroups(Array.isArray(data) ? data : data.groups ?? []))
        .catch(() => setGroups([])),
    ]).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Focused polling — refresh the inbox every 5s while the user is on this
  // screen so new DMs/group messages show up without a screen-leave-return.
  // Hibernates when the screen blurs (the cleanup) and on logout/unmount.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useFocusEffect(
    useCallback(() => {
      // Refresh once on focus (covers the "left screen, came back" path).
      void loadAll();
      pollRef.current = setInterval(() => { void loadAll(); }, 5000);
      return () => {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      };
    }, [loadAll]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await loadAll(); } finally { setRefreshing(false); }
  }, [loadAll]);

  // Merge DMs + groups into one list sorted by most recent activity.
  const rows: ChatRow[] = React.useMemo(() => {
    const dmRows: ChatRow[] = conversations.map((conv) => ({
      kind: 'dm',
      sortAt: conv.lastMessageAt ? new Date(conv.lastMessageAt).getTime() : 0,
      conv,
    }));
    const groupRows: ChatRow[] = groups.map((group) => {
      const last = group.messages?.[0];
      const sortAt = last?.createdAt
        ? new Date(last.createdAt).getTime()
        : (group.createdAt ? new Date(group.createdAt).getTime() : 0);
      return { kind: 'group', sortAt, group };
    });
    return [...dmRows, ...groupRows].sort((a, b) => b.sortAt - a.sortAt);
  }, [conversations, groups]);

  // If opened from Friends "Message" button, auto-create conversation
  useEffect(() => {
    if (!params.friendId || didCreate.current) return;
    didCreate.current = true;
    setCreating(true);
    socialApi.createConversation(params.friendId)
      .then((data) => {
        const convId = data.id ?? data.conversationId;
        const name = params.friendName ?? 'Friend';
        if (convId) {
          router.replace(`/social/conversation?id=${convId}&name=${encodeURIComponent(name)}`);
        } else {
          Alert.alert('Error', 'Could not start conversation.');
          setCreating(false);
        }
      })
      .catch((err) => {
        Alert.alert('Error', err?.message ?? 'Could not start conversation.');
        setCreating(false);
      });
  }, [params.friendId, params.friendName, router]);

  const openConversation = (conv: Conversation) => {
    const name = conv.otherUser.name ?? conv.otherUser.email ?? 'User';
    router.push(`/social/conversation?id=${conv.id}&name=${encodeURIComponent(name)}`);
  };

  const openGroup = (group: GroupSummary) => {
    router.push(`/groups/${group.id}`);
  };

  const renderDmRow = (conv: Conversation) => {
    const displayName = conv.otherUser.username
      ? `@${conv.otherUser.username}`
      : (conv.otherUser.name ?? conv.otherUser.email ?? 'User');
    const initials = (conv.otherUser.username ?? conv.otherUser.name ?? conv.otherUser.email ?? '?')[0].toUpperCase();
    const avatarUri = avatarUriFrom(conv.otherUser.avatarBase64);
    return (
      <TouchableOpacity
        key={`dm-${conv.id}`}
        style={styles.convRow}
        activeOpacity={0.8}
        onPress={() => openConversation(conv)}
      >
        <View style={styles.avatarCircle}>
          {avatarUri
            ? <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
            : <Text style={styles.avatarText}>{initials}</Text>
          }
        </View>
        <View style={styles.convContent}>
          <View style={styles.convTopRow}>
            <Text style={styles.convName} numberOfLines={1}>{displayName}</Text>
            <Text style={styles.timeText}>{relativeTime(conv.lastMessageAt)}</Text>
          </View>
          {conv.lastMessage ? (
            <Text style={styles.lastMessage} numberOfLines={1}>{conv.lastMessage}</Text>
          ) : null}
        </View>
        {conv.unreadCount > 0 && (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadText}>{conv.unreadCount}</Text>
          </View>
        )}
        <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
      </TouchableOpacity>
    );
  };

  const renderGroupRow = (group: GroupSummary) => {
    const last = group.messages?.[0];
    const preview = last
      ? (last.senderId === null ? `Anakin: ${last.text}` : last.text)
      : `${group.members?.length ?? 0} members`;
    return (
      <TouchableOpacity
        key={`group-${group.id}`}
        style={styles.convRow}
        activeOpacity={0.8}
        onPress={() => openGroup(group)}
      >
        <View style={[styles.avatarCircle, styles.groupAvatarCircle]}>
          <Ionicons name="people" size={22} color={colors.primaryForeground} />
        </View>
        <View style={styles.convContent}>
          <View style={styles.convTopRow}>
            <Text style={styles.convName} numberOfLines={1}>{group.name}</Text>
            <Text style={styles.timeText}>{relativeTime(last?.createdAt ?? null)}</Text>
          </View>
          <Text style={styles.lastMessage} numberOfLines={1}>{preview}</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
      </TouchableOpacity>
    );
  };

  if (creating) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.center}>
          <Text style={styles.mutedText}>Opening conversation…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backButton} activeOpacity={0.8} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={styles.screenTitle}>Messages</Text>
        <TouchableOpacity
          style={styles.newButton}
          activeOpacity={0.8}
          onPress={() => router.push('/groups')}
        >
          <Ionicons name="people-circle-outline" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.newButton}
          activeOpacity={0.8}
          onPress={() => router.push('/social/search')}
        >
          <Ionicons name="create-outline" size={22} color={colors.foreground} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <Text style={styles.mutedText}>Loading conversations…</Text>
        </View>
      ) : rows.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="chatbubbles-outline" size={40} color={colors.mutedForeground} />
          <Text style={styles.emptyTitle}>No messages yet</Text>
          <Text style={styles.emptySubtitle}>Start a conversation with a friend.</Text>
          <TouchableOpacity
            style={styles.startButton}
            activeOpacity={0.8}
            onPress={() => router.push('/social/search')}
          >
            <Text style={styles.startButtonText}>New Message</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.foreground} />
          }
        >
          {rows.map((row) =>
            row.kind === 'dm'
              ? renderDmRow(row.conv)
              : renderGroupRow(row.group),
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: { padding: 4, marginRight: spacing.sm },
  screenTitle: { flex: 1, fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.foreground },
  newButton: { padding: 4 },

  scroll: { flex: 1 },
  scrollContent: { paddingBottom: spacing.xxl },

  convRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  avatarCircle: {
    width: 46,
    height: 46,
    borderRadius: radius.full,
    backgroundColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.foreground },
  avatarImage: { width: 46, height: 46, borderRadius: radius.full },
  groupAvatarCircle: { backgroundColor: colors.foreground },
  convContent: { flex: 1 },
  convTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  convName: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.foreground, flex: 1 },
  timeText: { fontSize: fontSize.xs, color: colors.mutedForeground, marginLeft: 8 },
  lastMessage: { fontSize: fontSize.sm, color: colors.mutedForeground, marginTop: 2 },

  unreadBadge: {
    backgroundColor: colors.foreground,
    borderRadius: radius.full,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    marginRight: 4,
  },
  unreadText: { fontSize: fontSize.xs, color: colors.primaryForeground, fontWeight: fontWeight.bold },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.foreground },
  emptySubtitle: { fontSize: fontSize.sm, color: colors.mutedForeground, textAlign: 'center' },
  startButton: {
    backgroundColor: colors.foreground,
    paddingHorizontal: spacing.xl,
    paddingVertical: 13,
    borderRadius: radius.xl,
    marginTop: spacing.sm,
  },
  startButtonText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.primaryForeground },
  mutedText: { fontSize: fontSize.sm, color: colors.mutedForeground },
});
