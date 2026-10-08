// Social screens, native (handoff S-05, S-07 – S-09).
//
// Friends (S-05): Feed → Friends, or a profile's friend count. Requests on
//   top, then everyone alphabetically. Add goes to search. Also the picker
//   when a research item is sent to a friend.
// Group (S-07): what the group is working on as the hero, who has trained
//   this week as a line each, the latest messages and a composer. ··· holds
//   settings and Leave.
// Train together (S-08): the days that line up with a friend over the next
//   two weeks; tapping one drafts the invite. Planned sessions sit below.
// Leaderboard (S-09): two text toggles — which lift, and whose. Ranking per
//   bodyweight is one tap away. You're marked in crimson.

import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { v2, T } from '../../theme';
import { PushedPage } from '../../shell/Page';
import { Row, Eyebrow } from '../../primitives/Row';
import { Pressable } from '../../primitives/Pressable';
import { TextAction } from '../../primitives/TextAction';
import { Sheet } from '../../primitives/Sheet';
import { useGroups, useFriendRequests, qk } from '../../data';
import { useUnits } from '../../../context/UnitsContext';
import { socialApi, groupsApi, trainTogetherApi } from '../../../lib/api';
import { haptics } from '../../haptics';
import { Avatar, LinkTabs, RowAction, ago, displayName } from './common';
import { groupsOf } from './lists';

const C = v2.color;
const fmtDay = (d: string) => { const x = new Date(`${String(d).slice(0, 10)}T12:00:00`); return Number.isNaN(x.getTime()) ? d : x.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }); };
const push = (router: ReturnType<typeof useRouter>, key: string, params: Record<string, string> = {}) => router.push({ pathname: '/(v2)/p/[key]', params: { key, ...params } } as any);
export const useFriends = (enabled = true) => useQuery({ queryKey: ['v2', 'social', 'friends'], queryFn: async () => { const r: any = await socialApi.getFriends(); return (r?.friends ?? (Array.isArray(r) ? r : [])) as any[]; }, staleTime: 60_000, enabled });

// ─── S-05 Friends ────────────────────────────────────────────────────────────

export function FriendsPage({ params }: { params: Record<string, string> }) {
  const router = useRouter();
  const qc = useQueryClient();
  const friends = useFriends();
  const requests = useFriendRequests();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const sending = params.forwardArticle;
  const list = useMemo(() => [...(friends.data ?? [])].sort((a, b) => displayName(a).localeCompare(displayName(b))).filter((f) => !q.trim() || displayName(f).toLowerCase().includes(q.trim().toLowerCase()) || String(f.username ?? '').toLowerCase().includes(q.trim().toLowerCase())), [friends.data, q]);
  const reqs: any[] = sending ? [] : Array.isArray(requests.data) ? requests.data : [];
  const answer = async (r: any, accept: boolean) => {
    const id = r.requester?.id ?? r.requesterId;
    setBusy(id);
    try {
      await (accept ? socialApi.acceptFriendRequest(id) : socialApi.declineFriendRequest(id));
      haptics.success();
      await Promise.all([qc.invalidateQueries({ queryKey: qk.friendRequests }), qc.invalidateQueries({ queryKey: ['v2', 'social', 'friends'] }), qc.invalidateQueries({ queryKey: qk.socialCounts })]);
    } catch (e: any) { Alert.alert('Couldn’t do that', e?.message ?? ''); }
    setBusy(null);
  };
  const message = async (f: any) => {
    setBusy(f.id);
    try {
      if (sending) { await socialApi.forwardArticle(sending, f.id); haptics.success(); Alert.alert('Sent', `Sent to ${displayName(f)}.`); router.back(); return; }
      const c: any = await socialApi.createConversation(f.id);
      const id = c?.id ?? c?.conversation?.id;
      if (id) push(router, `thread:${id}`, { name: displayName(f) });
    } catch (e: any) { Alert.alert('Couldn’t open that', e?.message ?? ''); }
    setBusy(null);
  };
  return (
    <PushedPage back="Feed" title={sending ? 'Send to…' : `Friends · ${friends.data?.length ?? 0}`} meta={sending ? (params.title ?? null) : null}
      right={sending ? undefined : <RowAction label="Add" onPress={() => push(router, 'feedsearch', { scope: 'people' })} />}
      loading={friends.isLoading} refreshing={friends.isRefetching} onRefresh={() => { void friends.refetch(); void requests.refetch(); }}>
      <TextInput value={q} onChangeText={setQ} placeholder="Search friends" placeholderTextColor={C.placeholder} style={styles.search} accessibilityLabel="Search friends" />
      {reqs.length ? (
        <View style={{ marginBottom: 22 }}>
          <Eyebrow>Requests · {reqs.length}</Eyebrow>
          {reqs.map((r) => {
            const id = r.requester?.id ?? r.requesterId;
            return (
              <View key={id} style={styles.person}>
                <Avatar user={r.requester} size={36} />
                <View style={{ flex: 1 }}><Text style={styles.name} numberOfLines={1}>{displayName(r.requester)}</Text>{r.mutualCount != null ? <Text style={T.caption}>{r.mutualCount ? `${r.mutualCount} mutual` : 'No mutuals'}</Text> : null}</View>
                <RowAction label="Accept" primary busy={busy === id} onPress={() => void answer(r, true)} />
                <RowAction label="Ignore" busy={busy === id} onPress={() => void answer(r, false)} />
              </View>
            );
          })}
        </View>
      ) : null}
      {!sending && reqs.length ? <Eyebrow>Friends</Eyebrow> : null}
      {list.map((f) => (
        <View key={f.id} style={styles.person}>
          <Pressable onPress={() => router.push({ pathname: '/social/profile', params: { userId: f.id } } as any)} style={styles.personMain} accessibilityRole="button">
            <Avatar user={f} size={36} />
            <View style={{ flex: 1 }}><Text style={styles.name} numberOfLines={1}>{displayName(f)}</Text>{f.username ? <Text style={T.caption} numberOfLines={1}>@{f.username}</Text> : null}</View>
          </Pressable>
          <RowAction label={sending ? 'Send' : 'Message'} busy={busy === f.id} onPress={() => void message(f)} />
        </View>
      ))}
      {!friends.isLoading && !list.length ? <Text style={[T.bodyMuted, { marginTop: 8 }]}>{q ? 'No one by that name.' : 'No friends yet. Add someone you train with.'}</Text> : null}
    </PushedPage>
  );
}

// ─── S-07 Group ──────────────────────────────────────────────────────────────

export function GroupPage({ id }: { id: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const g = useQuery({ queryKey: ['v2', 'group', id], queryFn: () => groupsApi.get(id) as Promise<any>, staleTime: 15_000 });
  const p = useQuery({ queryKey: ['v2', 'group', id, 'progress'], queryFn: () => groupsApi.progress(id) as Promise<any>, staleTime: 60_000 });
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [menu, setMenu] = useState(false);
  const [goalEdit, setGoalEdit] = useState<string | null>(null);
  const group = g.data?.group;
  const members: any[] = p.data?.members ?? [];
  const msgs: any[] = (group?.messages ?? []).slice(-4);
  const nameOf = (senderId: string | null) => (senderId ? displayName(group?.members?.find((m: any) => m.userId === senderId)?.user) : 'Anakin');
  const send = async () => {
    const t = text.trim(); if (!t || sending) return;
    setSending(true);
    try { await groupsApi.postMessage(id, t); setText(''); haptics.success(); await qc.invalidateQueries({ queryKey: ['v2', 'group', id] }); }
    catch (e: any) { Alert.alert('Couldn’t send', e?.message ?? ''); }
    setSending(false);
  };
  const leave = () => Alert.alert(`Leave ${group?.name ?? 'the group'}?`, 'You’ll stop seeing its messages. Someone can add you back.', [
    { text: 'Stay', style: 'cancel' },
    { text: 'Leave', style: 'destructive', onPress: async () => { try { await groupsApi.leave(id); await qc.invalidateQueries({ queryKey: qk.groups }); router.back(); } catch (e: any) { Alert.alert('Couldn’t leave', e?.message ?? ''); } } },
  ]);
  const toggleAnakin = async () => { try { await groupsApi.patch(id, { anakinDailyEnabled: !group?.anakinDailyEnabled }); await qc.invalidateQueries({ queryKey: ['v2', 'group', id] }); } catch (e: any) { Alert.alert('Couldn’t change it', e?.message ?? ''); } };
  const saveGoal = async (v: string) => { try { await groupsApi.patch(id, { groupGoal: v.trim() || null }); setGoalEdit(null); await qc.invalidateQueries({ queryKey: ['v2', 'group', id] }); } catch (e: any) { Alert.alert('Couldn’t save', e?.message ?? ''); } };
  return (
    <PushedPage back="Groups" eyebrow={group ? `Group · ${group.members?.length ?? members.length} members` : null} title={group?.name ?? 'Group'}
      right={<Pressable onPress={() => setMenu(true)} hitSlop={10} accessibilityLabel="Group settings"><Text style={[T.row, { color: C.muted }]}>···</Text></Pressable>}
      hero={p.data ? { value: `${p.data.trained} of ${members.length}`, unit: 'trained this week' } : null}
      lead={group?.groupGoal ? `Working on: ${group.groupGoal}` : null}
      loading={g.isLoading} error={g.isError ? 'Couldn’t load this group.' : null} onRetry={() => void g.refetch()}>
      {members.map((m, i) => <Row key={m.userId} name={m.isYou ? 'You' : displayName(m)} sub={m.goal ?? undefined} value={`${m.sessionsThisWeek} session${m.sessionsThisWeek === 1 ? '' : 's'}`} emphasis={m.isYou} last={i === members.length - 1} />)}
      {msgs.length ? (
        <>
          <Eyebrow style={{ marginTop: 28 }}>Latest</Eyebrow>
          {msgs.map((m) => (
            <View key={m.id} style={styles.msg}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{nameOf(m.senderId)}</Text>
                <Text style={[T.body, { marginTop: 2 }]}>{m.text}</Text>
              </View>
              <Text style={T.caption}>{ago(m.createdAt)}</Text>
            </View>
          ))}
        </>
      ) : null}
      <View style={styles.composer}>
        <TextInput value={text} onChangeText={setText} placeholder={`Message ${group?.name ?? 'the group'}`} placeholderTextColor={C.placeholder} style={styles.composerInput} onSubmitEditing={() => void send()} returnKeyType="send" />
        <Pressable onPress={() => void send()} disabled={!text.trim() || sending} hitSlop={10} accessibilityLabel="Send"><Text style={[T.rowStrong, { color: text.trim() ? C.crimson : C.placeholder }]}>↑</Text></Pressable>
      </View>
      <Sheet visible={menu} onClose={() => setMenu(false)} title={group?.name}>
        <Row name="Group goal" sub={group?.groupGoal || 'None yet'} value="→" onPress={() => { setMenu(false); setGoalEdit(group?.groupGoal ?? ''); }} />
        <Row name="Anakin’s daily check-in" sub="Who’s trained, posted each day" value={group?.anakinDailyEnabled ? 'On' : 'Off'} onPress={() => void toggleAnakin()} />
        <Row name="Leave group" muted last onPress={() => { setMenu(false); leave(); }} />
      </Sheet>
      <Sheet visible={goalEdit != null} onClose={() => setGoalEdit(null)} title="What’s the group working on?">
        <TextInput value={goalEdit ?? ''} onChangeText={setGoalEdit} placeholder="e.g. Fall cut, 30 lb together" placeholderTextColor={C.placeholder} style={styles.search} autoFocus />
        <TextAction primary onPress={() => void saveGoal(goalEdit ?? '')}>Save</TextAction>
      </Sheet>
    </PushedPage>
  );
}

// ─── S-08 Train together ─────────────────────────────────────────────────────

/** Days that line up with one friend; the list under the Feed's Train together link and its own page. */
export function TrainTogetherView() {
  const qc = useQueryClient();
  const sharing = useQuery({ queryKey: ['v2', 'tt', 'sharing'], queryFn: () => trainTogetherApi.getSharing() as Promise<any>, staleTime: 60_000 });
  const ttFriends = useQuery({ queryKey: ['v2', 'tt', 'friends'], queryFn: async () => { const r: any = await trainTogetherApi.getFriends(); return (r?.friends ?? (Array.isArray(r) ? r : [])) as any[]; }, staleTime: 60_000 });
  const [pick, setPick] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // Only friends who share a schedule and have a program can be matched.
  const usable = (ttFriends.data ?? []).filter((f) => f.selectable);
  const friend = usable.find((f) => (f.id ?? f.userId) === pick) ?? usable[0] ?? null;
  const fid = friend ? friend.id ?? friend.userId : null;
  const overlap = useQuery({ queryKey: ['v2', 'tt', 'overlap', fid], queryFn: () => trainTogetherApi.getOverlap([fid!], 2) as Promise<any>, enabled: !!fid && sharing.data?.scheduleSharing === true, staleTime: 5 * 60_000, retry: 0 });
  const pins = useQuery({ queryKey: ['v2', 'tt', 'pins'], queryFn: () => trainTogetherApi.getPins() as Promise<any>, staleTime: 60_000 });
  const days: any[] = (overlap.data?.days ?? []).filter((d: any) => d.tier !== 'none');
  const planned: any[] = (pins.data?.pins ?? (Array.isArray(pins.data) ? pins.data : [])).slice(0, 6);
  const name = friend ? displayName(friend).split(' ')[0] : '';
  const label = (d: any) => {
    const mine = d.sessions?.find((s: any) => s.userId === overlap.data?.participants?.find((p: any) => p.isMe)?.userId);
    const theirs = d.sessions?.find((s: any) => s !== mine);
    return mine?.label && theirs?.label ? (mine.label === theirs.label ? `Both ${String(mine.label).toLowerCase()}` : `You ${String(mine.label).toLowerCase()} · ${name} ${String(theirs.label).toLowerCase()}`) : d.reason ?? 'Lines up';
  };
  const invite = (d: any) => Alert.alert(`Train with ${name} on ${fmtDay(d.date)}?`, 'I’ll send the invite; they confirm.', [
    { text: 'Not now', style: 'cancel' },
    { text: 'Send invite', onPress: async () => { setBusy(d.date); try { await trainTogetherApi.createPin(d.date, [fid!]); haptics.success(); await qc.invalidateQueries({ queryKey: ['v2', 'tt', 'pins'] }); } catch (e: any) { Alert.alert('Couldn’t send it', e?.message ?? ''); } setBusy(null); } },
  ]);
  if (sharing.data && sharing.data.scheduleSharing === false) {
    return (
      <View>
        <Text style={T.bodyMuted}>Share your schedule and I’ll find the days that line up with your friends.</Text>
        <TextAction primary style={{ marginTop: 14 }} onPress={async () => { try { await trainTogetherApi.setSharing(true); await qc.invalidateQueries({ queryKey: ['v2', 'tt'] }); } catch (e: any) { Alert.alert('Couldn’t turn it on', e?.message ?? ''); } }}>Share my schedule</TextAction>
      </View>
    );
  }
  return (
    <View>
      {friend ? (
        <Text style={T.readSm}>{days.length ? `${days.length} day${days.length === 1 ? '' : 's'} line up with ${name} in the next two weeks.` : overlap.isLoading ? `Checking ${name}’s week…` : overlap.isError ? `${name} isn’t sharing a schedule yet.` : `Nothing lines up with ${name} in the next two weeks.`}</Text>
      ) : <Text style={T.bodyMuted}>{ttFriends.isLoading ? 'Reading…' : 'None of your friends share a schedule yet.'}</Text>}
      {days.length ? <Eyebrow style={{ marginTop: 22 }}>Matching days</Eyebrow> : null}
      <View style={{ marginTop: 6 }}>
        {days.map((d, i) => <Row key={d.date} name={fmtDay(d.date)} sub={label(d)} value={busy === d.date ? '…' : '→'} last={i === days.length - 1} onPress={() => invite(d)} />)}
      </View>
      {planned.length ? <Eyebrow style={{ marginTop: 26 }}>Planned</Eyebrow> : null}
      <View style={{ marginTop: 6 }}>
        {planned.map((pn, i) => <Row key={pn.id} name={`${fmtDay(pn.date)}${pn.sessionName ? ` · ${pn.sessionName}` : ''}`} sub={`${(pn.members ?? []).map((m: any) => displayName(m.user ?? m)).filter(Boolean).join(', ')}${pn.status ? ` · ${pn.status}` : ''}`} value={pn.status === 'confirmed' ? '✓' : undefined} last={i === planned.length - 1} />)}
      </View>
      {usable.length > 1 ? <TextAction muted arrow={false} size={15} style={{ marginTop: 18 }} onPress={() => setPicking(true)}>Plan with someone else</TextAction> : null}
      <Sheet visible={picking} onClose={() => setPicking(false)} title="Plan with…">
        {usable.map((f, i) => <Row key={f.id ?? f.userId} name={displayName(f)} value={(f.id ?? f.userId) === fid ? '✓' : '→'} last={i === usable.length - 1} onPress={() => { setPick(f.id ?? f.userId); setPicking(false); }} />)}
      </Sheet>
    </View>
  );
}
export function TrainTogetherPage() { return <PushedPage back="Feed" title="Train together"><TrainTogetherView /></PushedPage>; }

// ─── S-09 Leaderboard ────────────────────────────────────────────────────────

const LIFTS = [{ key: 'bench', label: 'Bench' }, { key: 'squat', label: 'Squat' }, { key: 'deadlift', label: 'Deadlift' }, { key: 'total', label: 'Total' }, { key: 'sessions', label: 'Sessions' }] as const;

export function LeaderboardBoard() {
  const { fromKg, unit } = useUnits();
  const groups = useGroups();
  const [lift, setLift] = useState<(typeof LIFTS)[number]['key']>('bench');
  const [scope, setScope] = useState('friends');
  const [perBw, setPerBw] = useState(false);
  const q = useQuery({ queryKey: ['v2', 'board', lift, scope, perBw], queryFn: () => socialApi.getBoard(lift, scope, perBw) as Promise<any>, staleTime: 60_000 });
  const scopes = [{ key: 'friends', label: 'Friends' }, ...groupsOf(groups.data).slice(0, 3).map((g: any) => ({ key: `group:${g.id}`, label: g.name }))];
  const entries: any[] = q.data?.entries ?? [];
  const value = (e: any) => (lift === 'sessions' ? String(e.value) : perBw ? `${e.perBw}×` : String(Math.round(fromKg(e.value))));
  return (
    <View>
      <LinkTabs items={LIFTS as any} value={lift} onChange={(k: any) => { haptics.select(); setLift(k); }} />
      <LinkTabs items={scopes} value={scope} onChange={(k) => { haptics.select(); setScope(k); }} style={{ marginTop: 10, marginBottom: 14 }} />
      {q.isLoading ? <ActivityIndicator color={C.muted} style={{ alignSelf: 'flex-start', marginVertical: 12 }} /> : null}
      {entries.slice(0, 30).map((e, i) => (
        <View key={e.userId} style={styles.rank}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.name, e.isYou && { color: C.crimson }]} numberOfLines={1}>{e.rank} · {e.isYou ? 'You' : displayName(e)}</Text>
            {e.isYou && e.monthDelta ? <Text style={T.caption}>{e.monthDelta > 0 ? '+' : ''}{Math.round(fromKg(e.monthDelta))} this month</Text> : null}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.rankValue, e.isYou && { color: C.crimson }]}>{value(e)}</Text>
            <Text style={T.caption}>{lift === 'sessions' ? 'this month' : perBw ? 'per bodyweight' : `e1RM · ${unit}`}</Text>
          </View>
        </View>
      ))}
      {!q.isLoading && !entries.length ? <Text style={T.bodyMuted}>{lift === 'total' ? 'No one has all three lifts logged yet.' : 'Nothing logged here yet.'}</Text> : null}
      {lift !== 'sessions' ? <TextAction muted arrow={false} size={15} style={{ marginTop: 16 }} onPress={() => { haptics.select(); setPerBw((v) => !v); }}>{perBw ? 'Rank by weight lifted' : 'Rank per bodyweight'}</TextAction> : null}
    </View>
  );
}
export function LeaderboardPage() { return <PushedPage back="Feed" title="Leaderboard"><LeaderboardBoard /></PushedPage>; }

const styles = StyleSheet.create({
  search: { fontFamily: v2.font.regular, fontSize: 16, color: C.ink, borderBottomWidth: 1, borderBottomColor: C.hairline, paddingVertical: 8, marginBottom: 18 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.hairline },
  personMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { fontFamily: v2.font.semibold, fontSize: 15, lineHeight: 20, color: C.ink },
  msg: { flexDirection: 'row', gap: 12, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.hairline },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, borderTopColor: C.ink, marginTop: 24, paddingTop: 10 },
  composerInput: { flex: 1, fontFamily: v2.font.regular, fontSize: 16, color: C.ink, paddingVertical: 6 },
  rank: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.hairline },
  rankValue: { fontFamily: v2.font.bold, fontSize: 20, lineHeight: 24, color: C.ink, fontVariant: ['tabular-nums'] },
});
