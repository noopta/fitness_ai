// Feed (index 3) — the tab IS the feed (bug fixes 5 Oct 2026, 3a).
//
// Header right: Search · Messages (crimson dot when unread) · Saved, each a
// pushed page. Under the header, text links swap the list below — Friends
// (posts, FlashList, cursor-paged) · Groups · N · Leaderboard · Train
// together. They never push and never swipe: the track owns horizontal
// gestures. No menu rows, and nothing here routes to the classic tabs.

import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet, Alert } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { interleave } from '@axiom/agent-ui-core';
import { Pressable } from '../primitives/Pressable';
import { socialApi } from '../../lib/api';
import { PostMenu } from './feed/PostMenu';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { v2, T } from '../theme';
import { headerClearance } from '../shell/Header';
import { TextAction } from '../primitives/TextAction';
import { useFeedPages, useGroups, useSocialCounts } from '../data';
import { useUnits } from '../../context/UnitsContext';
import { FeedHeaderActions, LinkTabs } from './feed/common';
import { Post, ResearchItem, type PostModel } from './feed/Post';
import { GroupsList, groupsOf } from './feed/lists';
import { LeaderboardBoard, TrainTogetherView } from './feed/People';

type List = 'friends' | 'groups' | 'leaderboard' | 'together';

/** The header's right side on the Feed page. */
export function FeedHeaderRight() {
  const counts = useSocialCounts();
  return <FeedHeaderActions unread={(counts.data?.unreadMessages ?? 0) > 0} />;
}

export function FeedPage() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { unit } = useUnits();
  const [list, setList] = useState<List>('friends');
  const feed = useFeedPages();
  const groups = useGroups();
  const nGroups = groupsOf(groups.data).length;

  // S-02: research comes back — cached separately so the posts never wait on it — one after every 4 posts.
  const research = useQuery({ queryKey: ['v2', 'feed', 'research'], queryFn: () => socialApi.getFeedArticles() as Promise<{ items: any[] }>, staleTime: 30 * 60_000, retry: 0 });
  const [menu, setMenu] = useState<PostModel | null>(null);
  const [gone, setGone] = useState<string[]>([]);
  const [savedArticles, setSavedArticles] = useState<string[]>([]);
  const rows = useMemo<FeedRow[]>(() => {
    const seen = new Set<string>();
    const posts: PostModel[] = [];
    for (const page of feed.data?.pages ?? []) {
      for (const it of page?.items ?? []) {
        if (it?.kind !== 'post' || !it.data?.id || seen.has(it.data.id) || gone.includes(it.data.id)) continue;
        seen.add(it.data.id);
        posts.push(it.data);
      }
    }
    return interleave(posts, research.data?.items ?? [], 4);
  }, [feed.data, research.data, gone]);
  const saveArticle = useCallback(async (a: any) => {
    const on = !savedArticles.includes(a.id);
    setSavedArticles((x) => (on ? [...x, a.id] : x.filter((i) => i !== a.id)));
    try { await (on ? socialApi.saveArticle(a.id) : socialApi.unsaveArticle(a.id)); } catch { setSavedArticles((x) => (on ? x.filter((i) => i !== a.id) : [...x, a.id])); }
  }, [savedArticles]);
  const sendArticle = useCallback((a: any) => { router.push({ pathname: '/(v2)/p/[key]', params: { key: 'friends', forwardArticle: a.id, title: a.title } } as any); }, [router]);

  const openPost = useCallback((p: PostModel) => router.push({ pathname: '/(v2)/p/[key]', params: { key: `post:${p.id}` } } as any), [router]);
  const openAuthor = useCallback((p: PostModel) => router.push({ pathname: '/(v2)/p/[key]', params: { key: `person:${p.sharer?.id ?? ''}`, name: p.sharer?.name ?? p.sharer?.username ?? '' } } as any), [router]);
  const renderItem = useCallback(({ item }: { item: FeedRow }) => (item.kind === 'research'
    ? <ResearchItem item={item.data} saved={savedArticles.includes(item.data.id)} onSave={saveArticle} onSend={sendArticle} />
    : <Post post={item.data} unit={unit === 'kg' ? 'kg' : 'lbs'} onOpen={openPost} onComment={openPost} onAuthor={openAuthor} onMenu={setMenu} />
  ), [unit, openPost, openAuthor, savedArticles, saveArticle, sendArticle]);

  const pad = { paddingHorizontal: v2.space.gutter };
  const bottom = v2.space.tabBarClearance + insets.bottom;
  const tabs = [
    { key: 'friends' as const, label: 'Friends' },
    { key: 'groups' as const, label: nGroups ? `Groups · ${nGroups}` : 'Groups' },
    { key: 'leaderboard' as const, label: 'Leaderboard' },
    { key: 'together' as const, label: 'Train together' },
  ];

  return (
    <View style={[styles.page, { paddingTop: headerClearance(insets.top) }]}>
      <View style={[pad, styles.tabsRow]}>
        <LinkTabs items={tabs} value={list} onChange={setList} style={{ flex: 1 }} />
        {/* S-01: create a post. */}
        <Pressable onPress={() => router.push({ pathname: '/(v2)/p/[key]', params: { key: 'compose' } } as any)} hitSlop={10} accessibilityRole="button" accessibilityLabel="New post">
          <Text style={[T.captionStrong, { color: v2.color.ink }]}>+ Post</Text>
        </Pressable>
      </View>
      {list === 'friends' ? (
        <FlashList
          data={rows}
          keyExtractor={(r) => `${r.kind}:${r.data.id}`}
          getItemType={(r) => r.kind}
          renderItem={renderItem}
          ItemSeparatorComponent={Separator}
          contentContainerStyle={{ ...pad, paddingBottom: bottom }}
          onEndReachedThreshold={0.6}
          onEndReached={() => { if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage(); }}
          refreshControl={<RefreshControl refreshing={feed.isRefetching} onRefresh={() => void feed.refetch()} tintColor={v2.color.muted} />}
          ListEmptyComponent={feed.isLoading ? <Text style={[T.caption, { marginTop: 18 }]}>Reading…</Text>
            : feed.isError ? <View style={{ marginTop: 18 }}><Text style={T.bodyMuted}>Couldn’t load the feed.</Text><TextAction onPress={() => void feed.refetch()} style={{ marginTop: 8 }}>Try again</TextAction></View>
            : <Empty onFind={() => router.push({ pathname: '/(v2)/p/[key]', params: { key: 'feedsearch' } } as any)} />}
          ListFooterComponent={feed.isFetchingNextPage ? <Text style={[T.caption, { paddingVertical: 18 }]}>Reading…</Text> : null}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        />
      ) : (
        <ScrollView contentContainerStyle={{ ...pad, paddingTop: 14, paddingBottom: bottom }} showsVerticalScrollIndicator={false}>
          {list === 'groups' ? <GroupsList /> : list === 'leaderboard' ? <LeaderboardBoard /> : <TrainTogetherView />}
        </ScrollView>
      )}
      <PostMenu post={menu} onClose={() => setMenu(null)} onDeleted={(id) => setGone((g) => [...g, id])} />
    </View>
  );
}

type FeedRow = { kind: 'post'; data: PostModel } | { kind: 'research'; data: any };

function Separator() {
  return <View style={styles.hairline} />;
}

function Empty({ onFind }: { onFind: () => void }) {
  return (
    <View style={{ marginTop: 18 }}>
      <Text style={T.bodyMuted}>Nothing yet. Add a friend, or post your next session.</Text>
      <TextAction size={15} onPress={onFind} style={{ marginTop: 10 }}>Find people</TextAction>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: v2.color.white },
  tabsRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 8, paddingBottom: 4 },
  hairline: { height: 1, backgroundColor: v2.color.hairline },
});
