// Feed search (bug fixes 5 Oct 2026, 3c). The input is the header (20/600,
// ink underline, Cancel). Scopes: People · Groups · Posts. Result rows end in
// Message, or Add (crimson). Recent searches sit under the results. Typing
// is debounced 250 ms.

import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Row, Eyebrow } from '../../primitives/Row';
import { v2, T } from '../../theme';
import { socialApi } from '../../../lib/api';
import { useGroups, qk } from '../../data';
import { SearchHeader, LinkTabs, Avatar, RowAction, displayName } from './common';
import { groupsOf } from './lists';

type Scope = 'people' | 'groups' | 'posts';
const RECENT_KEY = 'v2:feedsearch:recent';
const RECENT_MAX = 8;

export function FeedSearchPage({ initialScope }: { initialScope?: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<Scope>(initialScope === 'groups' || initialScope === 'posts' ? initialScope : 'people');
  const [recent, setRecent] = useState<string[]>([]);
  const [status, setStatus] = useState<Record<string, string>>({});

  useEffect(() => { void AsyncStorage.getItem(RECENT_KEY).then((v) => { try { setRecent(v ? JSON.parse(v) : []); } catch { /* empty */ } }); }, []);
  const remember = (q: string) => {
    if (q.length < 2) return;
    const next = [q, ...recent.filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(0, RECENT_MAX);
    setRecent(next);
    void AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next));
  };
  const run = (q: string) => { setQuery(q); if (q.length >= 2) remember(q); };

  const people = useQuery({ queryKey: ['v2', 'search', 'people', query], enabled: scope === 'people' && query.length >= 2, queryFn: () => socialApi.searchUsers(query) as Promise<any[]> });
  const posts = useQuery({ queryKey: ['v2', 'search', 'posts', query], enabled: scope === 'posts' && query.length >= 2, queryFn: () => socialApi.searchPosts(query) as Promise<any> });
  const groups = useGroups();
  const groupHits = groupsOf(groups.data).filter((g) => query.length >= 1 && String(g.name ?? '').toLowerCase().includes(query.toLowerCase()));

  const message = async (u: any) => {
    try {
      const c: any = await socialApi.createConversation(u.id);
      const id = c?.id ?? c?.conversation?.id;
      if (id) router.push({ pathname: '/(v2)/p/[key]', params: { key: `thread:${id}`, name: displayName(u) } } as any);
    } catch (e: any) { Alert.alert('Couldn’t open a message', e?.message ?? ''); }
  };
  const add = async (u: any) => {
    setStatus((s) => ({ ...s, [u.id]: 'pending_sent' }));
    try { await socialApi.sendFriendRequest(u.id); void qc.invalidateQueries({ queryKey: qk.friendRequests }); }
    catch (e: any) { setStatus((s) => ({ ...s, [u.id]: u.friendshipStatus ?? 'none' })); Alert.alert('Couldn’t add', e?.message ?? ''); }
  };
  const accept = async (u: any) => {
    setStatus((s) => ({ ...s, [u.id]: 'accepted' }));
    try { await socialApi.acceptFriendRequest(u.id); void qc.invalidateQueries({ queryKey: qk.feedPages }); }
    catch { setStatus((s) => ({ ...s, [u.id]: 'pending_received' })); }
  };

  const peopleList: any[] = Array.isArray(people.data) ? people.data : [];
  const postList: any[] = posts.data?.items ?? [];
  const loading = (scope === 'people' && people.isFetching) || (scope === 'posts' && posts.isFetching);
  const nothing = query.length >= 2 && !loading && (scope === 'people' ? !peopleList.length : scope === 'posts' ? !postList.length : !groupHits.length);

  return (
    <View style={styles.page}>
      <SearchHeader placeholder="Search people, groups, posts" value={text} onChange={setText} onQuery={run} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false}>
        <LinkTabs items={[{ key: 'people', label: 'People' }, { key: 'groups', label: 'Groups' }, { key: 'posts', label: 'Posts' }]} value={scope} onChange={setScope} style={{ marginBottom: 14 }} />

        {loading ? <Text style={T.caption}>Searching…</Text> : null}
        {nothing ? <Text style={T.bodyMuted}>Nothing for “{query}”.</Text> : null}

        {scope === 'people' ? peopleList.map((u, i) => {
          const st = status[u.id] ?? u.friendshipStatus ?? 'none';
          return (
            <PersonRow key={u.id} user={u} last={i === peopleList.length - 1}
              onOpen={() => router.push({ pathname: '/(v2)/p/[key]', params: { key: `person:${u.id}`, name: displayName(u) } } as any)}
              action={st === 'accepted' ? <RowAction label="Message" onPress={() => void message(u)} />
                : st === 'pending_received' ? <RowAction label="Accept" primary onPress={() => void accept(u)} />
                : st === 'pending_sent' ? <Text style={[T.captionStrong, { color: v2.color.placeholder }]}>Requested</Text>
                : <RowAction label="Add" primary onPress={() => void add(u)} />} />
          );
        }) : null}

        {scope === 'groups' ? groupHits.map((g, i) => (
          <Row key={g.id} name={g.name} sub={`${g.memberCount ?? g.members?.length ?? '?'} people`} last={i === groupHits.length - 1} onPress={() => router.push(`/groups/${g.id}` as any)} />
        )) : null}

        {scope === 'posts' ? postList.map((p, i) => (
          <Row key={p.id} name={p.title} sub={`${p.workout ? 'Workout' : 'Post'} · ${displayName(p.author)}`} last={i === postList.length - 1}
            onPress={() => router.push({ pathname: '/(v2)/p/[key]', params: { key: `post:${p.id}` } } as any)} />
        )) : null}

        {recent.length ? (
          <View style={{ marginTop: 32 }}>
            <Eyebrow>Recent</Eyebrow>
            <View style={{ marginTop: 10 }}>
              {recent.map((r, i) => <Row key={r} name={r} last={i === recent.length - 1} onPress={() => { setText(r); run(r); }} />)}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

/** Avatar · name / @username · trailing action (Message, Add, Accept). */
function PersonRow({ user, action, onOpen, last }: { user: any; action: React.ReactNode; onOpen: () => void; last: boolean }) {
  return (
    <View style={[styles.person, last && { borderBottomWidth: 1, borderBottomColor: v2.color.hairline }]}>
      <Pressable onPress={onOpen} style={styles.personMain} accessibilityRole="button" accessibilityLabel={displayName(user)}>
        <Avatar user={user} size={36} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={T.rowStrong} numberOfLines={1}>{displayName(user)}</Text>
          {user.username ? <Text style={[T.caption, { marginTop: 2 }]} numberOfLines={1}>@{user.username}</Text> : null}
        </View>
      </Pressable>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: v2.color.white },
  body: { paddingHorizontal: v2.space.gutter, paddingTop: 18, paddingBottom: 48 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: v2.space.rowH + 8, paddingVertical: 10, borderTopWidth: 1, borderTopColor: v2.color.hairline },
  personMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 },
});
