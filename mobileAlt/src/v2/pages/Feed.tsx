// Feed (index 3) — the tab IS the feed (bug fixes 5 Oct 2026, 3a).
//
// Header right: Search · Messages (crimson dot when unread) · Saved, each a
// pushed page. Under the header, text links swap the list below — Friends
// (posts, FlashList, cursor-paged) · Groups · N · Leaderboard · Train
// together. They never push and never swipe: the track owns horizontal
// gestures. No menu rows, and nothing here routes to the classic tabs.

import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { v2, T } from '../theme';
import { headerClearance } from '../shell/Header';
import { TextAction } from '../primitives/TextAction';
import { useFeedPages, useGroups, useSocialCounts } from '../data';
import { useUnits } from '../../context/UnitsContext';
import { FeedHeaderActions, LinkTabs } from './feed/common';
import { Post, type PostModel } from './feed/Post';
import { GroupsList, LeaderboardList, TogetherList, groupsOf } from './feed/lists';

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

  const posts = useMemo<PostModel[]>(() => {
    const seen = new Set<string>();
    const out: PostModel[] = [];
    for (const page of feed.data?.pages ?? []) {
      for (const it of page?.items ?? []) {
        if (it?.kind !== 'post' || !it.data?.id || seen.has(it.data.id)) continue;
        seen.add(it.data.id);
        out.push(it.data);
      }
    }
    return out;
  }, [feed.data]);

  const openPost = useCallback((p: PostModel) => router.push({ pathname: '/(v2)/p/[key]', params: { key: `post:${p.id}` } } as any), [router]);
  const openAuthor = useCallback((p: PostModel) => router.push({ pathname: '/(v2)/p/[key]', params: { key: `person:${p.sharer?.id ?? ''}`, name: p.sharer?.name ?? p.sharer?.username ?? '' } } as any), [router]);
  const renderItem = useCallback(({ item }: { item: PostModel }) => (
    <Post post={item} unit={unit === 'kg' ? 'kg' : 'lbs'} onOpen={openPost} onComment={openPost} onAuthor={openAuthor} />
  ), [unit, openPost, openAuthor]);

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
      <LinkTabs items={tabs} value={list} onChange={setList} style={[pad, { paddingTop: 8, paddingBottom: 4 }]} />
      {list === 'friends' ? (
        <FlashList
          data={posts}
          keyExtractor={(p) => p.id}
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
          {list === 'groups' ? <GroupsList /> : list === 'leaderboard' ? <LeaderboardList /> : <TogetherList />}
        </ScrollView>
      )}
    </View>
  );
}

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
  hairline: { height: 1, backgroundColor: v2.color.hairline },
});
