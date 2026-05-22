import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { socialApi } from '../../src/lib/api';
import { colors, fontSize, fontWeight, radius, spacing } from '../../src/constants/theme';
import { FeedItemCard, type FeedItem, type FriendForShare } from '../../src/components/social/FeedItemCard';
import { trackScreen, trackScreenTime, Analytics } from '../../src/lib/analytics';

export default function SavedArticlesScreen() {
  const router = useRouter();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [friends, setFriends] = useState<FriendForShare[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    trackScreen('SavedArticles');
    return trackScreenTime('SavedArticles');
  }, []);

  const load = useCallback(async () => {
    try {
      const [savedRes, friendsRes] = await Promise.all([
        socialApi.getSavedArticles().catch(() => ({ items: [] })),
        socialApi.getFriends().catch(() => ({ friends: [] })),
      ]);
      const savedItems: any[] = Array.isArray(savedRes) ? savedRes : savedRes.items ?? [];
      setItems(savedItems);
      const friendsArr: any[] = Array.isArray(friendsRes) ? friendsRes : friendsRes.friends ?? [];
      setFriends(friendsArr);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const handleUnsave = async (articleId: string) => {
    // Optimistic remove
    setItems(prev => prev.filter(i => i.id !== articleId));
    try {
      await socialApi.unsaveArticle(articleId);
      Analytics.articleUnsaved(articleId);
    } catch {
      // Reload on failure to recover state
      load();
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backButton} activeOpacity={0.8} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={styles.screenTitle}>Saved Articles</Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.foreground} />
          </View>
        ) : items.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="bookmark-outline" size={40} color={colors.mutedForeground} />
            <Text style={styles.emptyTitle}>Nothing saved yet</Text>
            <Text style={styles.emptySubtitle}>
              Tap the bookmark icon on an article in your feed to save it here.
            </Text>
          </View>
        ) : (
          items.map(item => (
            <FeedItemCard
              key={item.id}
              item={item}
              isSaved
              onToggleSave={() => handleUnsave(item.id)}
              friends={friends}
              onShareToFriend={async (friendId, note) => {
                try {
                  await socialApi.forwardArticle(item.id, friendId, note);
                  Analytics.articleShared(item.id);
                } catch { /* surfaced inside the card */ }
              }}
            />
          ))
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
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  backButton: { padding: 4, width: 30 },
  screenTitle: {
    flex: 1,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
    textAlign: 'center',
  },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  center: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.sm },
  emptyTitle: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.foreground },
  emptySubtitle: { fontSize: fontSize.sm, color: colors.mutedForeground, textAlign: 'center', paddingHorizontal: spacing.lg },
});
