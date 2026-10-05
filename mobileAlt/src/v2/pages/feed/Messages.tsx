// Messages (bug fixes 5 Oct 2026, 3b) and a direct thread.
//
// Messages: header "New"; a Requests section (Accept crimson / Ignore); then
// conversation rows, 68 pt — avatar 40, name 15/600, time 12, last line 13;
// unread rows are ink with a crimson dot, read rows muted. The Ask line at
// the foot. A thread uses the chat thread styles (signed turns) without
// receipts: yours right-aligned under "You", theirs under their name.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PushedPage } from '../../shell/Page';
import { Eyebrow } from '../../primitives/Row';
import { v2, T } from '../../theme';
import { haptics } from '../../haptics';
import { socialApi } from '../../../lib/api';
import { useAuth } from '../../../context/AuthContext';
import { useConversations, useFriendRequests, qk } from '../../data';
import { Avatar, AskLine, RowAction, ago, displayName } from './common';

const C = v2.color;

export function MessagesPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const convos = useConversations();
  const requests = useFriendRequests();
  const [busy, setBusy] = useState<string | null>(null);
  const list: any[] = Array.isArray(convos.data) ? convos.data : [];
  const reqs: any[] = Array.isArray(requests.data) ? requests.data : [];

  const answer = async (r: any, accept: boolean) => {
    const id = r.requester?.id ?? r.requesterId;
    setBusy(id);
    try {
      await (accept ? socialApi.acceptFriendRequest(id) : socialApi.declineFriendRequest(id));
      haptics.success();
      await Promise.all([qc.invalidateQueries({ queryKey: qk.friendRequests }), qc.invalidateQueries({ queryKey: qk.socialCounts }), qc.invalidateQueries({ queryKey: qk.feedPages })]);
    } catch (e: any) { Alert.alert('Couldn’t do that', e?.message ?? ''); }
    setBusy(null);
  };
  const openThread = (c: any) => router.push({ pathname: '/(v2)/p/[key]', params: { key: `thread:${c.id}`, name: displayName(c.otherUser) } } as any);

  return (
    <PushedPage back="Feed" title="Messages" loading={convos.isLoading}
      right={<RowAction label="New" onPress={() => router.push({ pathname: '/(v2)/p/[key]', params: { key: 'feedsearch', scope: 'people' } } as any)} />}
      refreshing={convos.isRefetching} onRefresh={() => { void convos.refetch(); void requests.refetch(); }}
      error={convos.isError ? 'Couldn’t load messages.' : null} onRetry={() => void convos.refetch()}>
      {reqs.length ? (
        <View style={{ marginBottom: 28 }}>
          <Eyebrow>Requests</Eyebrow>
          <View style={{ marginTop: 10 }}>
            {reqs.map((r) => (
              <View key={r.id ?? r.requester?.id} style={styles.row}>
                <Avatar user={r.requester} size={40} />
                <View style={styles.main}>
                  <Text style={styles.name} numberOfLines={1}>{displayName(r.requester)}</Text>
                  <Text style={[styles.last, { color: C.muted }]} numberOfLines={1}>Wants to add you</Text>
                </View>
                <View style={styles.reqActions}>
                  <RowAction label="Accept" primary busy={busy === (r.requester?.id ?? r.requesterId)} onPress={() => void answer(r, true)} />
                  <RowAction label="Ignore" busy={busy === (r.requester?.id ?? r.requesterId)} onPress={() => void answer(r, false)} />
                </View>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {list.map((c) => {
        const unread = (c.unreadCount ?? 0) > 0;
        return (
          <Pressable key={c.id} onPress={() => { haptics.select(); openThread(c); }} style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
            accessibilityRole="button" accessibilityLabel={`${displayName(c.otherUser)}${unread ? ', unread' : ''}. ${c.lastMessage ?? ''}`}>
            <Avatar user={c.otherUser} size={40} />
            <View style={styles.main}>
              <View style={styles.topLine}>
                <Text style={styles.name} numberOfLines={1}>{displayName(c.otherUser)}</Text>
                <Text style={styles.time}>{ago(c.lastMessageAt)}</Text>
              </View>
              <View style={styles.topLine}>
                <Text style={[styles.last, { color: unread ? C.ink : C.muted }]} numberOfLines={1}>{c.lastMessage ?? 'No messages yet'}</Text>
                {unread ? <View style={styles.dot} /> : null}
              </View>
            </View>
          </Pressable>
        );
      })}
      {!list.length && !convos.isLoading ? <Text style={T.bodyMuted}>No conversations yet. Tap New to message someone.</Text> : null}

      <AskLine hint="e.g. message Sam about Saturday" style={{ marginTop: 32 }} />
    </PushedPage>
  );
}

// ─── Thread ──────────────────────────────────────────────────────────────────

const GAP_MS = 60 * 60 * 1000;

export function ThreadPage({ id, name }: { id: string; name?: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { user } = useAuth();
  const me = (user as any)?.id;
  const scroll = useRef<ScrollView>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const q = useQuery({ queryKey: ['v2', 'social', 'thread', id], queryFn: () => socialApi.getMessages(id, 60) as Promise<any[]>, refetchInterval: 5000, enabled: !!id });
  const msgs: any[] = Array.isArray(q.data) ? q.data : [];

  // Opening the thread reads it.
  useEffect(() => {
    if (!id) return;
    void socialApi.markRead(id).then(() => { void qc.invalidateQueries({ queryKey: qk.conversations }); void qc.invalidateQueries({ queryKey: qk.socialCounts }); }).catch(() => {});
  }, [id, msgs.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await socialApi.sendMessage(id, body);
      setText('');
      haptics.light();
      await q.refetch();
      void qc.invalidateQueries({ queryKey: qk.conversations });
    } catch (e: any) { Alert.alert('Couldn’t send', e?.message ?? ''); }
    setSending(false);
  };

  // Signed-turn layout: a label on the first of a run from one sender, a centred stamp after an hour's gap.
  const rows = useMemo(() => msgs.map((m, i) => {
    const prev = msgs[i - 1];
    const mine = m.senderId === me || m.sender?.id === me;
    const t = new Date(m.createdAt).getTime();
    const stamp = !prev || t - new Date(prev.createdAt).getTime() > GAP_MS
      ? new Date(m.createdAt).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : null;
    const label = !!stamp || !prev || (prev.senderId ?? prev.sender?.id) !== (m.senderId ?? m.sender?.id);
    return { m, mine, stamp, label };
  }), [msgs, me]);

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: C.white }}>
      <View style={[styles.threadTop, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => { haptics.select(); if (router.canGoBack()) router.back(); else router.replace('/(v2)' as any); }} hitSlop={10} accessibilityRole="button">
          <Text style={[T.body, { color: C.muted }]}>← Messages</Text>
        </Pressable>
        <Text style={[T.captionStrong, { color: C.ink }]} numberOfLines={1}>{name || 'Conversation'}</Text>
      </View>
      <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: v2.space.gutter, paddingTop: 20, paddingBottom: 20 }}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {q.isLoading ? <Text style={T.caption}>Reading…</Text> : null}
        {rows.map(({ m, mine, stamp, label }, i) => (
          <View key={m.id} style={{ marginTop: i === 0 ? 0 : label ? 22 : 6 }}>
            {stamp ? <Text style={styles.stamp}>{stamp}</Text> : null}
            <View style={mine ? styles.mine : styles.theirs}>
              {label ? <Text style={mine ? styles.youLabel : styles.theirLabel}>{mine ? 'You' : displayName(m.sender) }</Text> : null}
              <Text style={mine ? styles.mineText : styles.theirText}>{messageText(m.body)}</Text>
            </View>
          </View>
        ))}
      </ScrollView>
      <View style={[styles.composer, { paddingBottom: Math.max(12, insets.bottom) }]}>
        <TextInput value={text} onChangeText={setText} placeholder={`Message ${name || ''}`.trim()} placeholderTextColor={C.placeholder}
          style={styles.input} multiline maxLength={2000} accessibilityLabel="Message" />
        <Pressable onPress={() => void send()} disabled={!text.trim() || sending} hitSlop={10} accessibilityRole="button" accessibilityLabel="Send">
          <Text style={[styles.send, { color: text.trim() ? C.crimson : C.placeholder }]}>↑</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

/** Forwarded posts and articles arrive as JSON; read them as a line. */
function messageText(body: string): string {
  if (!body || body[0] !== '{') return body;
  try {
    const p = JSON.parse(body);
    if (p.title) return `Shared · ${p.title}`;
    if (p.txt) return `Forwarded · “${String(p.txt).slice(0, 80)}”`;
  } catch { /* plain text */ }
  return body;
}

const styles = StyleSheet.create({
  row: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, borderTopColor: C.hairline, paddingVertical: 10 },
  main: { flex: 1, minWidth: 0, gap: 3 },
  topLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, fontFamily: v2.font.semibold, fontSize: 15, lineHeight: 20, color: C.ink },
  time: { fontFamily: v2.font.regular, fontSize: 12, lineHeight: 16, color: C.muted, fontVariant: ['tabular-nums'] },
  last: { flex: 1, fontFamily: v2.font.regular, fontSize: 13, lineHeight: 18 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.crimson },
  reqActions: { flexDirection: 'row', gap: 16 },

  threadTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, paddingHorizontal: v2.space.gutter, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: C.hairline },
  stamp: { fontFamily: v2.font.semibold, fontSize: 11, lineHeight: 14, color: C.placeholder, textAlign: 'center', marginBottom: 22 },
  mine: { alignSelf: 'flex-end', maxWidth: '80%', alignItems: 'flex-end' },
  theirs: { alignSelf: 'flex-start', maxWidth: '80%' },
  youLabel: { fontFamily: v2.font.semibold, fontSize: 12, lineHeight: 16, color: C.placeholder, marginBottom: 6 },
  theirLabel: { fontFamily: v2.font.semibold, fontSize: 12, lineHeight: 16, color: C.ink, marginBottom: 6 },
  mineText: { fontFamily: v2.font.medium, fontSize: 17, lineHeight: 24.65, color: C.ink, textAlign: 'right' },
  theirText: { fontFamily: v2.font.regular, fontSize: 17, lineHeight: 25.5, color: C.ink },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 16, paddingHorizontal: v2.space.gutter, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.hairline, backgroundColor: C.white },
  input: { flex: 1, maxHeight: 120, fontFamily: v2.font.regular, fontSize: 17, lineHeight: 23, color: C.ink, paddingVertical: 6 },
  send: { fontFamily: v2.font.bold, fontSize: 22, lineHeight: 28 },
});
