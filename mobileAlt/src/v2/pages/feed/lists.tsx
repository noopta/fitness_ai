// The Feed's other lists — Groups, Leaderboard, Train together. Rendered
// under the Feed tab's text links (they swap the list, no push) and inside
// their own pushed pages for chat Open → links.

import React from 'react';
import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Row } from '../../primitives/Row';
import { T } from '../../theme';
import { socialApi, trainTogetherApi } from '../../../lib/api';
import { useGroups } from '../../data';

export const groupsOf = (data: any): any[] => data?.groups ?? (Array.isArray(data) ? data : []);
const liftName = (k?: string) => String(k ?? 'Lift').split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const fmtWhen = (d?: string) => { if (!d) return ''; const x = new Date(d); return Number.isNaN(x.getTime()) ? String(d) : x.toLocaleDateString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }); };

export function GroupsList() {
  const router = useRouter();
  const q = useGroups();
  const groups = groupsOf(q.data);
  if (q.isLoading) return <Text style={T.caption}>Reading…</Text>;
  return (
    <View>
      {groups.map((g) => <Row key={g.id} name={g.name} sub={`${g.memberCount ?? g.members?.length ?? '?'} people`} onPress={() => router.push(`/groups/${g.id}` as any)} />)}
      <Row name={groups.length ? 'Find a group' : 'Find or start a group'} onPress={() => router.push('/groups' as any)} last />
    </View>
  );
}

export function useLeaderboard() {
  return useQuery({
    queryKey: ['v2', 'social', 'leaderboard'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const lifts: any = await socialApi.getLeaderboardLifts();
      const list: string[] = lifts?.lifts ?? (Array.isArray(lifts) ? lifts : []);
      const lift = list[0] ?? 'deadlift';
      const r: any = await socialApi.getLeaderboard(String(lift));
      return { lift, entries: (r?.entries ?? r?.leaderboard ?? (Array.isArray(r) ? r : [])) as any[] };
    },
  });
}

export function LeaderboardList() {
  const q = useLeaderboard();
  const entries = q.data?.entries ?? [];
  if (q.isLoading) return <Text style={T.caption}>Reading…</Text>;
  return (
    <View>
      {q.data ? <Text style={[T.caption, { marginBottom: 10 }]}>{liftName(q.data.lift)} · estimated 1RM, among people you train with</Text> : null}
      {entries.slice(0, 20).map((e, i) => <Row key={e.userId ?? e.id ?? i} name={e.name ?? e.username ?? 'Someone'} sub={e.goal ?? e.phase ?? undefined} value={String(e.e1rm ?? e.oneRm ?? e.value ?? e.score ?? e.sessions ?? '—')} bigValue last={i === Math.min(entries.length, 20) - 1} />)}
      {!entries.length ? <Text style={T.bodyMuted}>No one on the board yet this week.</Text> : null}
    </View>
  );
}

export function TogetherList() {
  const router = useRouter();
  const q = useQuery({ queryKey: ['v2', 'social', 'together'], staleTime: 60_000, queryFn: () => trainTogetherApi.getPins() as Promise<any> });
  const pins: any[] = q.data?.pins ?? (Array.isArray(q.data) ? q.data : []);
  if (q.isLoading) return <Text style={T.caption}>Reading…</Text>;
  return (
    <View>
      {pins.map((p) => <Row key={p.id} name={`${p.hostName ?? p.host?.name ?? 'Someone'} · ${fmtWhen(p.startsAt ?? p.date)}`} sub={[p.sessionName ?? p.title, p.location ?? p.gym].filter(Boolean).join(' · ')} value="Join" onPress={() => router.push(`/train-together/pin/${p.id}` as any)} />)}
      <Row name="Post a session" onPress={() => router.push('/train-together' as any)} last />
    </View>
  );
}
