import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { socialApi } from '../../src/lib/api';
import { colors, fontSize, fontWeight, radius, spacing } from '../../src/constants/theme';

interface Conversation {
  id: string;
  otherUser: {
    id: string;
    name: string | null;
    email: string | null;
  };
  lastMessage: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
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
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const didCreate = React.useRef(false);

  const loadConversations = useCallback(() => {
    return socialApi.getConversations()
      .then((data) => setConversations(Array.isArray(data) ? data : data.conversations ?? []))
      .catch(() => setConversations([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

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
          onPress={() => router.push('/social/search')}
        >
          <Ionicons name="create-outline" size={22} color={colors.foreground} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <Text style={styles.mutedText}>Loading conversations…</Text>
        </View>
      ) : conversations.length === 0 ? (
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
        >
          {conversations.map((conv) => {
            const name = conv.otherUser.name ?? conv.otherUser.email ?? 'User';
            return (
              <TouchableOpacity
                key={conv.id}
                style={styles.convRow}
                activeOpacity={0.8}
                onPress={() => openConversation(conv)}
              >
                <View style={styles.avatarCircle}>
                  <Text style={styles.avatarText}>{name[0].toUpperCase()}</Text>
                </View>
                <View style={styles.convContent}>
                  <View style={styles.convTopRow}>
                    <Text style={styles.convName} numberOfLines={1}>{name}</Text>
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
          })}
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
