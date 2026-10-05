// Saved (bug fixes 5 Oct 2026, 3d) and the post page.
//
// Saved: filters All · Workouts · Posts · Articles. Each row: eyebrow (type ·
// author), title, one action. "Try it" on a workout sends
// program.fitWorkout(id) to Anakin; the reply is a Proposal card in chat.
//
// Post: the post as in the feed, its comments, and a line to add one.

import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PushedPage } from '../../shell/Page';
import { v2, T } from '../../theme';
import { haptics } from '../../haptics';
import { socialApi } from '../../../lib/api';
import { useUnits } from '../../../context/UnitsContext';
import { useShellOptional } from '../../shell/ShellContext';
import { useSaved, qk } from '../../data';
import { LinkTabs, RowAction, Avatar, ago, displayName } from './common';
import { Post, type PostModel } from './Post';

const C = v2.color;
type Filter = 'all' | 'workouts' | 'posts' | 'articles';

export function SavedPage() {
  const router = useRouter();
  const shell = useShellOptional();
  const [filter, setFilter] = useState<Filter>('all');
  const q = useSaved(filter);
  const items: any[] = q.data?.items ?? [];

  const act = (it: any) => {
    if (it.kind === 'workout') {
      // Anakin reads it next to the program and replies with a Proposal card.
      shell?.ask(`program.fitWorkout(${it.id}) — fit “${it.title}” into my program.`);
      router.replace('/(v2)' as any);
    } else if (it.kind === 'article') {
      if (it.url) void WebBrowser.openBrowserAsync(String(it.url));
    } else {
      router.push({ pathname: '/(v2)/p/[key]', params: { key: `post:${it.id}` } } as any);
    }
  };
  const label = (it: any) => (it.kind === 'workout' ? 'Try it' : it.kind === 'article' ? 'Read' : 'Open');

  return (
    <PushedPage back="Feed" title="Saved" meta={q.data ? `${items.length} saved` : null} loading={q.isLoading}
      error={q.isError ? 'Couldn’t load what you saved.' : null} onRetry={() => void q.refetch()}
      refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <LinkTabs items={[{ key: 'all', label: 'All' }, { key: 'workouts', label: 'Workouts' }, { key: 'posts', label: 'Posts' }, { key: 'articles', label: 'Articles' }]}
        value={filter} onChange={setFilter} style={{ marginBottom: 16 }} />
      {items.map((it, i) => (
        <View key={`${it.kind}:${it.id}`} style={[styles.row, i === items.length - 1 && styles.last]}>
          <Pressable style={{ flex: 1, minWidth: 0 }} onPress={() => (it.kind === 'workout' ? router.push({ pathname: '/(v2)/p/[key]', params: { key: `post:${it.id}` } } as any) : act(it))} accessibilityRole="button">
            <Text style={T.eyebrow} numberOfLines={1}>{it.eyebrow}</Text>
            <Text style={[T.rowStrong, { marginTop: 4 }]} numberOfLines={2}>{it.title}</Text>
          </Pressable>
          <RowAction label={label(it)} primary={it.kind === 'workout'} onPress={() => act(it)} />
        </View>
      ))}
      {!items.length && q.data ? <Text style={T.bodyMuted}>{filter === 'all' ? 'Nothing saved yet. Tap Save on a post or workout and it lands here.' : `No saved ${filter}.`}</Text> : null}
    </PushedPage>
  );
}

export function PostPage({ id }: { id: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { unit } = useUnits();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const post = useQuery({ queryKey: ['v2', 'social', 'post', id], queryFn: () => socialApi.getPost(id) as Promise<any>, enabled: !!id });
  const comments = useQuery({ queryKey: ['v2', 'social', 'comments', id], queryFn: () => socialApi.getComments(id) as Promise<any>, enabled: !!id });
  const p: PostModel | null = post.data?.post ?? null;
  const list: any[] = comments.data?.comments ?? (Array.isArray(comments.data) ? comments.data : []);

  const add = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      await socialApi.addComment(id, t);
      setText(''); haptics.light();
      await comments.refetch();
      void qc.invalidateQueries({ queryKey: qk.feedPages });
    } catch (e: any) { Alert.alert('Couldn’t comment', e?.message ?? ''); }
    setBusy(false);
  };

  return (
    <PushedPage back="Feed" title={p ? displayName(p.sharer) : 'Post'} meta={p ? ago(p.createdAt) : null} loading={post.isLoading}
      error={post.isError ? 'This post isn’t available.' : null}>
      {p ? <Post post={p} unit={unit === 'kg' ? 'kg' : 'lbs'} onComment={() => {}} onAuthor={(x) => router.push({ pathname: '/(v2)/p/[key]', params: { key: `person:${x.sharer?.id ?? ''}`, name: displayName(x.sharer) } } as any)} /> : null}
      {p ? (
        <View style={{ marginTop: 8 }}>
          {list.map((c) => (
            <View key={c.id} style={styles.comment}>
              <Avatar user={c.author} size={28} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={T.captionStrong}><Text style={{ color: C.ink }}>{displayName(c.author)}</Text> · {ago(c.createdAt)}</Text>
                <Text style={[T.body, { marginTop: 2 }]}>{c.text}</Text>
              </View>
            </View>
          ))}
          <View style={styles.composer}>
            <TextInput value={text} onChangeText={setText} placeholder="Add a comment" placeholderTextColor={C.placeholder} style={styles.input} multiline maxLength={1000} accessibilityLabel="Add a comment" />
            <RowAction label="Post" primary busy={busy || !text.trim()} onPress={() => void add()} />
          </View>
        </View>
      ) : null}
    </PushedPage>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 14, borderTopWidth: 1, borderTopColor: C.hairline },
  last: { borderBottomWidth: 1, borderBottomColor: C.hairline },
  comment: { flexDirection: 'row', gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: C.hairline },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 16, marginTop: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.ink },
  input: { flex: 1, maxHeight: 120, fontFamily: v2.font.regular, fontSize: 15, lineHeight: 22, color: C.ink, paddingVertical: 4 },
});
