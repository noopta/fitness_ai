import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal,
  SafeAreaView, ActivityIndicator, FlatList, TextInput,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, radius, spacing } from '../../constants/theme';
import { Analytics } from '../../lib/analytics';

export interface FriendForShare {
  id: string;
  name: string | null;
  username: string | null;
}

export interface FeedItem {
  id: string;
  type: 'research' | 'article';
  title: string;
  summary: string;
  url: string;
  source: string;
  tags: string[];
  publishedAt: string | null;
  fetchedAt: string;
}

const TAG_LABEL: Record<string, string> = {
  strength: 'Strength',
  hypertrophy: 'Muscle Building',
  fat_loss: 'Fat Loss',
  nutrition: 'Nutrition',
  recovery: 'Recovery',
  cardio: 'Cardio',
  lifestyle: 'Lifestyle',
  general: 'Fitness',
};

const TAG_COLOR: Record<string, string> = {
  strength: '#6366f1',
  hypertrophy: '#8b5cf6',
  fat_loss: '#f59e0b',
  nutrition: '#f97316',
  recovery: '#22c55e',
  cardio: '#38bdf8',
  lifestyle: '#ec4899',
  general: '#64748b',
};

interface Props {
  item: FeedItem;
  isSaved?: boolean;
  onToggleSave?: () => void;
  friends?: FriendForShare[];
  onShareToFriend?: (friendId: string, note?: string) => Promise<void> | void;
}

export function FeedItemCard({ item, isSaved, onToggleSave, friends, onShareToFriend }: Props) {
  const [webViewOpen, setWebViewOpen] = useState(false);
  const [webViewLoading, setWebViewLoading] = useState(true);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareSearch, setShareSearch] = useState('');
  const [shareNote, setShareNote] = useState('');
  const [sendingTo, setSendingTo] = useState<string | null>(null);

  const primaryTag = item.tags[0] ?? 'general';
  const tagColor = TAG_COLOR[primaryTag] ?? TAG_COLOR.general;
  const tagLabel = TAG_LABEL[primaryTag] ?? 'Fitness';
  const isResearch = item.type === 'research';

  const filteredFriends = (friends ?? []).filter(f => {
    if (!shareSearch.trim()) return true;
    const q = shareSearch.toLowerCase();
    return (
      (f.username ?? '').toLowerCase().includes(q) ||
      (f.name ?? '').toLowerCase().includes(q)
    );
  });

  async function handleSendTo(friendId: string) {
    if (!onShareToFriend) return;
    setSendingTo(friendId);
    try {
      await onShareToFriend(friendId, shareNote.trim() || undefined);
      setShareOpen(false);
      setShareNote('');
      setShareSearch('');
    } finally {
      setSendingTo(null);
    }
  }

  return (
    <>
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.85}
        onPress={() => {
          Analytics.articleOpened({ articleId: item.id, source: 'feed' });
          setWebViewOpen(true);
        }}
      >
        {/* Top row: type badge + source + actions */}
        <View style={styles.topRow}>
          <View style={[styles.typeBadge, { backgroundColor: tagColor + '18' }]}>
            <Ionicons
              name={isResearch ? 'document-text-outline' : 'newspaper-outline'}
              size={11}
              color={tagColor}
            />
            <Text style={[styles.typeBadgeText, { color: tagColor }]}>
              {isResearch ? 'RESEARCH' : 'ARTICLE'}
            </Text>
          </View>
          <View style={styles.topRowRight}>
            <Text style={styles.source}>{item.source}</Text>
            {onToggleSave && (
              <TouchableOpacity
                onPress={(e) => { e.stopPropagation?.(); onToggleSave(); }}
                hitSlop={8}
                style={styles.iconAction}
              >
                <Ionicons
                  name={isSaved ? 'bookmark' : 'bookmark-outline'}
                  size={18}
                  color={isSaved ? colors.primary : colors.mutedForeground}
                />
              </TouchableOpacity>
            )}
            {onShareToFriend && (
              <TouchableOpacity
                onPress={(e) => { e.stopPropagation?.(); setShareOpen(true); }}
                hitSlop={8}
                style={styles.iconAction}
              >
                <Ionicons name="paper-plane-outline" size={18} color={colors.mutedForeground} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Title */}
        <Text style={styles.title} numberOfLines={3}>{item.title}</Text>

        {/* GPT summary */}
        <Text style={styles.summary} numberOfLines={4}>{item.summary}</Text>

        {/* Bottom row: tag pill + read more */}
        <View style={styles.bottomRow}>
          <View style={[styles.tagPill, { backgroundColor: tagColor + '18' }]}>
            <Text style={[styles.tagPillText, { color: tagColor }]}>{tagLabel}</Text>
          </View>
          <View style={styles.readMore}>
            <Text style={styles.readMoreText}>Read more</Text>
            <Ionicons name="arrow-forward" size={13} color={colors.mutedForeground} />
          </View>
        </View>
      </TouchableOpacity>

      {/* Share-to-friend modal */}
      <Modal
        visible={shareOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShareOpen(false)}
      >
        <SafeAreaView style={styles.shareContainer}>
          <View style={styles.shareHeader}>
            <TouchableOpacity onPress={() => setShareOpen(false)} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={colors.foreground} />
            </TouchableOpacity>
            <Text style={styles.shareTitle}>Share article</Text>
            <View style={{ width: 30 }} />
          </View>
          <Text style={styles.shareSubtitle} numberOfLines={2}>{item.title}</Text>
          <TextInput
            style={styles.shareNoteInput}
            placeholder="Add a note (optional)"
            placeholderTextColor={colors.mutedForeground}
            value={shareNote}
            onChangeText={setShareNote}
            multiline
            maxLength={240}
          />
          <TextInput
            style={styles.shareSearchInput}
            placeholder="Search friends…"
            placeholderTextColor={colors.mutedForeground}
            value={shareSearch}
            onChangeText={setShareSearch}
            autoCapitalize="none"
          />
          <FlatList
            data={filteredFriends}
            keyExtractor={(f) => f.id}
            ListEmptyComponent={
              <Text style={styles.shareEmpty}>
                {(friends?.length ?? 0) === 0 ? 'Add friends to share articles.' : 'No friends match your search.'}
              </Text>
            }
            renderItem={({ item: friend }) => (
              <TouchableOpacity
                style={styles.shareFriendRow}
                activeOpacity={0.85}
                disabled={sendingTo !== null}
                onPress={() => handleSendTo(friend.id)}
              >
                <View style={styles.shareFriendAvatar}>
                  <Text style={styles.shareFriendAvatarText}>
                    {((friend.username ?? friend.name ?? '?')[0] ?? '?').toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.shareFriendName}>
                  {friend.username ? `@${friend.username}` : (friend.name ?? 'User')}
                </Text>
                {sendingTo === friend.id ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Ionicons name="paper-plane" size={16} color={colors.primary} />
                )}
              </TouchableOpacity>
            )}
          />
        </SafeAreaView>
      </Modal>

      {/* Full-screen WebView modal */}
      <Modal
        visible={webViewOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setWebViewOpen(false)}
      >
        <SafeAreaView style={styles.webViewContainer}>
          {/* Header */}
          <View style={styles.webViewHeader}>
            <TouchableOpacity onPress={() => setWebViewOpen(false)} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={colors.foreground} />
            </TouchableOpacity>
            <Text style={styles.webViewTitle} numberOfLines={1}>{item.source}</Text>
            <View style={{ width: 30 }} />
          </View>

          {/* WebView */}
          <WebView
            source={{ uri: item.url }}
            style={styles.webView}
            onLoadStart={() => setWebViewLoading(true)}
            onLoadEnd={() => setWebViewLoading(false)}
            onError={() => setWebViewLoading(false)}
          />

          {/* Loading overlay */}
          {webViewLoading && (
            <View style={styles.webViewLoader}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          )}
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },

  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  typeBadgeText: {
    fontSize: 10,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.6,
  },
  source: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
  },
  topRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconAction: {
    padding: 2,
  },
  shareContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  shareHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  shareTitle: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
  },
  shareSubtitle: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    fontStyle: 'italic',
  },
  shareNoteInput: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    padding: spacing.sm,
    backgroundColor: colors.muted,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.foreground,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  shareSearchInput: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
    padding: spacing.sm,
    backgroundColor: colors.muted,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.foreground,
  },
  shareEmpty: {
    textAlign: 'center',
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    paddingVertical: spacing.lg,
  },
  shareFriendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  shareFriendAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareFriendAvatarText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
  },
  shareFriendName: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.foreground,
  },

  title: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
    lineHeight: 22,
  },

  summary: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    lineHeight: 20,
  },

  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  tagPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  tagPillText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  readMore: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  readMoreText: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
  },

  // WebView modal
  webViewContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  webViewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  closeBtn: {
    padding: 4,
  },
  webViewTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
    flex: 1,
    textAlign: 'center',
    marginHorizontal: spacing.xs,
  },
  webView: {
    flex: 1,
  },
  webViewLoader: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
