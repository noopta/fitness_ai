// Training without a program, and suggestions nobody asked for.
//
// Freestyle home (T-04): the Training tab for users with no program. No fake
//   schedule — the week as actually trained, Anakin's pick for today, and the
//   way into a program.
// Guided freestyle (T-05): Start a session. Anakin builds today from the last
//   3 weeks (suggest_session, same as chat); Begin opens the normal Active
//   workout. Swap a lift, make it shorter or pick your own without leaving.
// Progression suggestion (T-06): above the bands after a session that earns
//   one — the same proposal the engine files. Not now moves it to
//   Archive → Suggestions, where it can still be applied.

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { proposalRows } from '@axiom/agent-ui-core';
import { v2, T } from '../../theme';
import { PushedPage, AnakinRead } from '../../shell/Page';
import { Row, Eyebrow } from '../../primitives/Row';
import { TextAction } from '../../primitives/TextAction';
import { Sheet } from '../../primitives/Sheet';
import { useFreestyle, useAdaptationPending, useInvalidate, qk } from '../../data';
import { useUnits } from '../../../context/UnitsContext';
import { adaptationApi } from '../../../lib/api';
import { v2Api } from '../../api';
import { setSessionSeed } from '../../sessionSeed';
import { todayStr } from '../../../lib/localDate';
import { haptics } from '../../haptics';

const C = v2.color;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dow = (d: string) => DOW[new Date(`${String(d).slice(0, 10)}T12:00:00`).getDay()];
const mondayOf = (date: string) => { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export interface Suggested { theme?: string; label: string; why?: string[]; exercises: { name: string; scheme: string; load: string; note?: string | null }[]; unavailable?: boolean; message?: string }

/** Anakin's pick for today (suggest_session, no chat turn). Cached for half an hour. */
export function useSuggestedSession(minutes?: number) {
  return useQuery({
    queryKey: ['v2', 'suggest', minutes ?? 0],
    queryFn: async () => (await v2Api.runTool('suggest_session', minutes ? { minutes } : {})).result as Suggested,
    staleTime: 30 * 60_000, retry: 0,
  });
}
export const minutesFor = (n: number) => Math.max(20, Math.round(n * 9 / 5) * 5);
const sessionLine = (s?: Suggested | null) => (s?.exercises ?? []).slice(0, 4).map((e) => e.name.toLowerCase()).join(', ');

// ─── T-04 Freestyle home ─────────────────────────────────────────────────────

export function FreestyleHome({ onLog }: { onLog: () => void }) {
  const router = useRouter();
  const home = useFreestyle();
  const pick = useSuggestedSession();
  const week = mondayOf(todayStr());
  const sessions: any[] = (home.data?.recentSessions ?? []).filter((s: any) => String(s.date).slice(0, 10) >= week).reverse();
  const s = pick.data && !pick.data.unavailable ? pick.data : null;
  const read = s?.why?.[0] ?? (sessions.length ? 'You train your way. I keep the log.' : 'Log what you do and I’ll start picking sessions from it.');
  return (
    <View>
      <Text style={T.eyebrow}>Freestyle · no program</Text>
      <Text style={[T.headlineSm, { marginTop: 10 }]}>You train your way.{'\n'}I keep the log.</Text>
      <View style={{ marginTop: 14 }}><AnakinRead text={read} /></View>
      <Eyebrow style={{ marginTop: 26 }}>This week · {sessions.length} session{sessions.length === 1 ? '' : 's'}</Eyebrow>
      <View style={{ marginTop: 6 }}>
        {sessions.map((x, i) => <Row key={x.id} name={x.title || (x.topLifts ?? []).slice(0, 2).join(', ') || 'Workout'} sub={dow(x.date)} value={`${x.setCount} sets`} leading={<Text style={styles.tick}>✓</Text>} last={i === sessions.length - 1} />)}
        {!sessions.length && !home.isLoading ? <Text style={T.bodyMuted}>Nothing logged this week yet.</Text> : null}
      </View>
      <Eyebrow style={{ marginTop: 26 }}>Suggested today</Eyebrow>
      <View style={{ marginTop: 6 }}>
        {pick.isLoading ? <ActivityIndicator color={C.muted} style={{ alignSelf: 'flex-start', marginVertical: 12 }} /> : s ? (
          <Row name={`${s.label}${s.exercises.length ? ` · ${minutesFor(s.exercises.length)} min` : ''}`} sub={sessionLine(s)} arrow last
            onPress={() => router.push({ pathname: '/(v2)/p/[key]', params: { key: 'freestyle' } } as any)} />
        ) : <Text style={T.bodyMuted}>{pick.data?.message ? 'Log a few sessions and I’ll start suggesting them.' : 'Couldn’t build a suggestion right now.'}</Text>}
      </View>
      <View style={styles.actions}>
        <TextAction primary onPress={() => (s ? router.push({ pathname: '/(v2)/p/[key]', params: { key: 'freestyle' } } as any) : onLog())}>Start a session</TextAction>
        <TextAction muted arrow={false} size={15} onPress={() => router.push('/(v2)/onboarding' as any)}>Build a program</TextAction>
      </View>
    </View>
  );
}

// ─── T-05 Guided freestyle ───────────────────────────────────────────────────

export function GuidedFreestylePage() {
  const router = useRouter();
  const [minutes, setMinutes] = useState<number | undefined>(undefined);
  const q = useSuggestedSession(minutes);
  const [list, setList] = useState<Suggested['exercises'] | null>(null);
  const [swapping, setSwapping] = useState(false);
  useEffect(() => { if (q.data?.exercises) setList(q.data.exercises); }, [q.data]);
  const s = q.data;
  const ex = list ?? s?.exercises ?? [];
  const m = minutesFor(ex.length || 5);
  const begin = () => {
    haptics.light();
    setSessionSeed({ name: s?.label ?? 'Freestyle', exercises: ex.map((e) => { const [sets, reps] = e.scheme.split('×').map((x) => x.trim()); return { name: e.name, sets: Number(sets) || 3, reps: reps || '8', notes: e.note ?? null }; }) });
    router.push('/(v2)/session' as any);
  };
  if (s?.unavailable) return <PushedPage back="Training" title="Freestyle" lead="Session suggestions aren’t on for your account yet. Log as you go instead." cta={{ label: 'Log a workout', onPress: () => router.replace('/(v2)/log' as any) }} />;
  return (
    <PushedPage back="Training" meta="Freestyle" eyebrow="Suggested for today" title={s ? `${s.label} · ${m} min` : 'Today'} lead={s?.why?.slice(0, 2).join(' ') || (s ? 'Built from your last 3 weeks.' : null)}
      loading={q.isLoading} error={q.isError ? 'Couldn’t build a session — try again.' : null} onRetry={() => void q.refetch()}
      cta={ex.length ? { label: 'Begin', onPress: begin } : null} foot={[{ label: 'Not today', onPress: () => router.back() }]}>
      {ex.map((e, i) => <Row key={`${e.name}${i}`} name={e.name} sub={e.note || undefined} value={`${e.scheme}${/\d/.test(e.load) ? ` · ${e.load.replace(/\s*(lb|kg)s?$/i, '')}` : ''}`} last={i === ex.length - 1} />)}
      {ex.length ? (
        <View style={styles.actions}>
          <TextAction muted arrow={false} size={15} onPress={() => setSwapping(true)}>Swap a lift</TextAction>
          <TextAction muted arrow={false} size={15} onPress={() => { haptics.select(); setList(null); setMinutes(Math.max(20, m - 20)); }}>Make it shorter</TextAction>
          <TextAction muted arrow={false} size={15} onPress={() => router.replace('/(v2)/log' as any)}>Pick my own</TextAction>
        </View>
      ) : null}
      <SwapLiftSheet visible={swapping} onClose={() => setSwapping(false)} exercises={ex}
        onSwap={(i, name) => { setList(ex.map((e, k) => (k === i ? { ...e, name, load: 'pick a load', note: 'New to this session — pick a load you could lift for 2–3 more reps.' } : e))); setSwapping(false); }} />
    </PushedPage>
  );
}

function SwapLiftSheet({ visible, onClose, exercises, onSwap }: { visible: boolean; onClose: () => void; exercises: Suggested['exercises']; onSwap: (i: number, name: string) => void }) {
  const [which, setWhich] = useState<number | null>(null);
  const name = which != null ? exercises[which]?.name : '';
  const alts = useQuery({ queryKey: ['v2', 'alts', (name ?? '').toLowerCase()], queryFn: () => v2Api.exerciseAlternatives(name!), enabled: visible && !!name, staleTime: Infinity });
  const close = () => { setWhich(null); onClose(); };
  return (
    <Sheet visible={visible} onClose={close} title={which == null ? 'Swap which lift?' : `Instead of ${name}`}>
      {which == null
        ? exercises.map((e, i) => <Row key={`${e.name}${i}`} name={e.name} value="→" last={i === exercises.length - 1} onPress={() => setWhich(i)} />)
        : (
          <View>
            {alts.isLoading ? <ActivityIndicator color={C.muted} style={{ marginVertical: 12 }} /> : null}
            {(alts.data?.alternatives ?? []).map((a, i, arr) => <Row key={a.name} name={a.name} value="→" last={i === arr.length - 1} onPress={() => { haptics.select(); onSwap(which, a.name); setWhich(null); }} />)}
            {!alts.isLoading && !alts.data?.alternatives?.length ? <Text style={T.bodyMuted}>No alternatives for this one.</Text> : null}
            <TextAction muted arrow={false} size={15} style={{ marginTop: 16 }} onPress={() => setWhich(null)}>← Back</TextAction>
          </View>
        )}
    </Sheet>
  );
}

// ─── T-06 Progression suggestion ─────────────────────────────────────────────

const DISMISSED = 'v2.dismissedSuggestions.v1';
const readDismissed = async (): Promise<string[]> => { try { return JSON.parse((await AsyncStorage.getItem(DISMISSED)) ?? '[]'); } catch { return []; } };

function SuggestionBlock({ p, onDone, onLater }: { p: any; onDone: () => void; onLater?: () => void }) {
  const { fromKg, unit } = useUnits();
  const invalidate = useInvalidate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fmt = (kg: number | null | undefined) => (kg != null ? `${Math.round(fromKg(kg))} ${unit}` : '—');
  const rows = proposalRows(p, fmt);
  const apply = async () => {
    setBusy(true); setError(null);
    try { await adaptationApi.decide(p.id, 'apply'); haptics.success(); await invalidate.afterProgram(); onDone(); }
    catch (e: any) { setError(e?.message ?? 'Couldn’t apply it.'); }
    setBusy(false);
  };
  return (
    <View style={styles.suggestion}>
      <View style={styles.sugHead}>
        <Text style={[T.eyebrow, { color: C.crimson }]}>Proposed</Text>
        <Text style={[T.caption, { flexShrink: 1 }]} numberOfLines={1}>{p.title}</Text>
      </View>
      {rows.map((r, i) => (
        <View key={i} style={styles.sugRow}>
          <Text style={[T.body, { flex: 1 }]} numberOfLines={1}>{r.key}</Text>
          <View style={{ alignItems: 'flex-end' }}>
            {r.from ? <Text style={[T.caption, T.num, { textDecorationLine: 'line-through' }]}>{r.from}</Text> : null}
            <Text style={[T.rowStrong, T.num, { fontSize: 15 }]}>{r.to}</Text>
          </View>
        </View>
      ))}
      {p.reasoning ? <Text style={[T.caption, { marginTop: 8 }]} numberOfLines={3}>{p.reasoning}</Text> : null}
      {error ? <Text style={[T.caption, { color: C.crimson, marginTop: 6 }]}>{error}</Text> : null}
      <View style={[styles.actions, { marginTop: 12 }]}>
        <TextAction primary size={15} onPress={() => void apply()} loading={busy}>Apply</TextAction>
        {onLater ? <TextAction muted arrow={false} size={15} onPress={onLater}>Not now</TextAction> : null}
      </View>
    </View>
  );
}

/** The newest pending suggestion not set aside with Not now. Renders nothing otherwise. */
export function SuggestionBand() {
  const q = useAdaptationPending();
  const qc = useQueryClient();
  const [dismissed, setDismissed] = useState<string[] | null>(null);
  useEffect(() => { void readDismissed().then(setDismissed); }, []);
  const p = useMemo(() => (dismissed ? (q.data?.proposals ?? []).find((x: any) => !dismissed.includes(x.id)) : null), [q.data, dismissed]);
  if (!p) return null;
  const later = () => {
    haptics.select();
    const next = [...(dismissed ?? []), p.id].slice(-50);
    setDismissed(next);
    void AsyncStorage.setItem(DISMISSED, JSON.stringify(next)).catch(() => {});
  };
  return <SuggestionBlock p={p} onLater={later} onDone={() => void qc.invalidateQueries({ queryKey: qk.adaptation })} />;
}

/** Archive → Suggestions: everything pending, including what Not now set aside. */
export function SuggestionsPage() {
  const q = useAdaptationPending();
  const qc = useQueryClient();
  const list: any[] = q.data?.proposals ?? [];
  return (
    <PushedPage back="Archive" title="Suggestions" lead="Changes I’ve proposed from your training. Nothing changes until you apply one." loading={q.isLoading}>
      {list.map((p) => <View key={p.id} style={{ marginBottom: 22 }}><SuggestionBlock p={p} onDone={() => void qc.invalidateQueries({ queryKey: qk.adaptation })} /></View>)}
      {!list.length && !q.isLoading ? <Text style={T.bodyMuted}>Nothing waiting.</Text> : null}
    </PushedPage>
  );
}

const styles = StyleSheet.create({
  tick: { width: 22, fontSize: 14, color: C.ink, fontFamily: v2.font.semibold },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 24, rowGap: 10, marginTop: 26 },
  suggestion: { borderTopWidth: 1, borderTopColor: C.hairline, paddingTop: 12, paddingBottom: 14 },
  sugHead: { flexDirection: 'row', alignItems: 'baseline', gap: 10, marginBottom: 6 },
  sugRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
});
