// Inline chat cards — the feature rendered live inside the thread.
//
// Each card uses the page's own components and has an "Open →" link to its
// full page. The user can act on the card directly or ask Anakin to.

import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, TextInput, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { v2, T } from '../theme';
import { Row } from '../primitives/Row';
import { TextAction, ActionPair } from '../primitives/TextAction';
import { Receipt } from '../primitives/Receipt';
import { Enter } from '../primitives/Enter';
import { LineForecast } from '../charts';
import { WeekStrip } from '../pages/Training';
import { coachApi, workoutsApi } from '../../lib/api';
import { v2Api } from '../api';
import { useUnits } from '../../context/UnitsContext';
import { qk, useInvalidate } from '../data';
import { unitLabel } from '../format';
import type { Turn } from '@axiom/agent-ui-core';
import { haptics } from '../haptics';

interface CardProps {
  turn: Turn;
  patch: (p: Record<string, any>) => void;
  resolve: (line: string) => void;
  ask: (m: string) => void;
}

function OpenLink({ label, onPress }: { label: string; onPress: () => void }) {
  return <TextAction muted size={13} onPress={onPress} style={{ marginTop: 10 }}>{label}</TextAction>;
}

/** Week card: proposal (Accept / Keep), or tap two days to swap manually; Undo. */
export function WeekCard({ turn, patch, resolve }: CardProps) {
  const router = useRouter();
  const qc = useQueryClient();
  const d = turn.card?.data ?? {};
  const cs = turn.cardState ?? {};
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const days: any[] = cs.week ?? d.weekDays ?? [];
  const proposal = d.proposal;
  const proposalDates: string[] = proposal?.proposedWeek?.filter((x: any, i: number) => JSON.stringify(x?.session?.name) !== JSON.stringify(days[i]?.session?.name)).map((x: any) => String(x.date).slice(0, 10)) ?? [];
  const apply = async (week: any[], reason: string, status: string) => {
    setBusy(true);
    try {
      await coachApi.applyWeekPlan({ week: week.map((x: any) => ({ date: String(x.date).slice(0, 10), session: x.session ?? null, locked: !!x.locked })), reason });
      patch({ status, prev: days, week });
      await qc.invalidateQueries({ queryKey: qk.schedule });
      await qc.invalidateQueries({ queryKey: qk.today });
      haptics.success();
    } catch (e: any) { patch({ error: e?.message ?? 'Could not apply' }); }
    setBusy(false);
  };
  const tapDay = (day: any) => {
    if (cs.status && cs.status !== 'pending' && cs.status !== 'idle') return;
    if (day.isLogged || day.isPast) return;
    const id = String(day.date).slice(0, 10);
    if (!sel) return setSel(id);
    if (sel === id) return setSel(null);
    const a = days.findIndex((x) => String(x.date).slice(0, 10) === sel);
    const b = days.findIndex((x) => String(x.date).slice(0, 10) === id);
    if (a < 0 || b < 0) return;
    const next = days.map((x) => ({ ...x }));
    const tmp = next[a].session; next[a].session = next[b].session; next[b].session = tmp;
    setSel(null);
    void apply(next, 'Swapped by you in chat', 'manual');
  };
  const line = { applied: proposal?.summary ? `Moved — ${proposal.summary}` : 'Applied.', kept: 'Kept the week as it was.', manual: 'Swapped by you — Anakin re-checked recovery.', undone: 'Undone — back to the original week.' }[cs.status as string] ?? '';
  useEffect(() => { if (cs.status === 'applied' || cs.status === 'kept') resolve(line); }, [cs.status]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View style={styles.card}>
      <WeekStrip days={days} onDay={tapDay} proposalDates={cs.status === 'pending' ? proposalDates : undefined} />
      {cs.status === 'pending' && proposal ? (
        <View style={{ marginTop: 14 }}>
          <Text style={T.caption}>{proposal.rationale || proposal.summary}</Text>
          <ActionPair primaryLabel={busy ? 'Applying' : 'Accept'} onPrimary={() => void apply(proposal.proposedWeek, proposal.summary, 'applied')} onSecondary={() => patch({ status: 'kept' })} />
        </View>
      ) : null}
      {cs.status === 'idle' || (!cs.status && !proposal) ? <Text style={[T.caption, { marginTop: 10 }]}>{sel ? 'Now tap the day it moves to.' : 'Tap two days to swap them — or ask Anakin.'}</Text> : null}
      {line ? (
        <View style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <Text style={[T.caption, { flex: 1 }]}>{line}</Text>
          {(cs.status === 'applied' || cs.status === 'manual') && cs.prev ? <TextAction muted size={13} arrow={false} onPress={() => void apply(cs.prev, 'Undo', 'undone')}>Undo</TextAction> : null}
        </View>
      ) : null}
      {cs.error ? <Text style={[T.caption, { marginTop: 8 }]}>{cs.error}</Text> : null}
      <OpenLink label="Open Training" onPress={() => router.push('/(v2)' as any)} />
    </View>
  );
}

/** Bench (lift progress) card: the chart draws in; forecast; Open → lift history.
 *  Empty state: "No sets yet" plus an inline logger (weight × reps, Log it →). */
export function BenchCard({ turn, patch, resolve }: CardProps) {
  const router = useRouter();
  const { fromKg, toKg, unit } = useUnits();
  const invalidate = useInvalidate();
  const d = turn.card?.data ?? {};
  const cs = turn.cardState ?? {};
  const u = unitLabel(unit);
  const series: number[] = (d.series ?? []).map((p: any) => fromKg(p.rm));
  const empty = !!d.empty || series.length === 0;
  const forecast = d.forecast ? { value: fromKg(d.forecast.value), label: String(d.forecast.week).replace(/^\d{4}-W/, 'wk ') } : null;
  const current = series.length ? series[series.length - 1] : (d.current1RMkg ? fromKg(d.current1RMkg) : null);
  const delta = d.deltaKg != null ? fromKg(d.deltaKg) : null;
  const [w, setW] = useState('');
  const [r, setR] = useState('');
  const [busy, setBusy] = useState(false);
  const lift: string = d.lift ?? 'Lift';
  const logSet = async () => {
    const weight = Number(w), reps = Number(r);
    if (!Number.isFinite(weight) || !Number.isFinite(reps) || reps <= 0) return;
    setBusy(true);
    try {
      await workoutsApi.logWorkout({ date: new Date().toISOString().slice(0, 10), title: lift, exercises: [{ name: lift, sets: 1, reps: String(reps), weightKg: weight > 0 ? toKg(weight) : null, bodyweight: weight <= 0 }] } as any);
      await invalidate.afterWorkout();
      patch({ logged: `${lift} ${weight} ${u} × ${reps}` });
      resolve(`Logged — ${lift} · ${weight} ${u} × ${reps}`);
      haptics.success();
    } catch (e: any) { Alert.alert('Couldn\'t log', e?.message ?? ''); }
    setBusy(false);
  };
  if (empty) {
    return (
      <View style={styles.card}>
        <Text style={T.eyebrow}>{lift} · estimated 1RM</Text>
        <Text style={[T.readSm, { marginTop: 8 }]}>No {lift.toLowerCase()} sets yet.</Text>
        {!cs.logged ? (
          <View style={{ marginTop: 14 }}>
            <Text style={T.caption}>Log one and the line starts.</Text>
            <View style={styles.logger}>
              <TextInput value={w} onChangeText={setW} placeholder={`weight, ${u}`} placeholderTextColor={v2.color.placeholder} keyboardType="decimal-pad" style={styles.loggerInput} accessibilityLabel="Weight" />
              <Text style={[T.row, { color: v2.color.placeholder }]}>×</Text>
              <TextInput value={r} onChangeText={setR} placeholder="reps" placeholderTextColor={v2.color.placeholder} keyboardType="number-pad" style={[styles.loggerInput, { flex: 0.6 }]} accessibilityLabel="Reps" />
              <TextAction primary size={15} onPress={() => void logSet()} loading={busy} disabled={!w || !r}>Log it</TextAction>
            </View>
          </View>
        ) : null}
        <OpenLink label="Open lift history" onPress={() => router.push({ pathname: '/(v2)/p/[key]', params: { key: `lift:${lift}` } } as any)} />
      </View>
    );
  }
  return (
    <View style={styles.card}>
      <Text style={T.eyebrow}>{lift} · estimated 1RM</Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 6 }}>
        <Text style={[T.hero, { fontSize: 44, lineHeight: 48, letterSpacing: -1.6 }]}>{current != null ? Math.round(current) : '—'}</Text>
        <Text style={[T.read, { color: v2.color.muted, marginLeft: 8 }]}>{u}</Text>
        {delta != null ? <Text style={[T.captionStrong, { marginLeft: 12 }]}>{delta >= 0 ? '+' : ''}{Math.round(delta)} over {d.weeks ?? series.length} wk</Text> : null}
      </View>
      {series.length > 1 ? <View style={{ marginTop: 14 }}><LineForecast series={series} forecast={forecast} width={300} height={120} unitLabel={u} /></View> : <Text style={[T.caption, { marginTop: 10 }]}>One session so far — a second draws the line.</Text>}
      <OpenLink label="Open lift history" onPress={() => router.push({ pathname: '/(v2)/p/[key]', params: { key: `lift:${lift}` } } as any)} />
    </View>
  );
}

/** Food card: totals so far, then how to log — Snap · Scan · Describe · Saved. */
export function FoodCard({ turn, ask }: CardProps) {
  const router = useRouter();
  const d = turn.card?.data ?? {};
  const t = d.totals ?? {};
  return (
    <View style={styles.card}>
      <Row name="So far today" sub={`${d.mealCount ?? 0} meal${d.mealCount === 1 ? '' : 's'}`} value={`${Math.round(t.calories ?? 0)} kcal`} />
      <View style={styles.macros}>
        {[['P', t.proteinG, v2.color.macro.protein], ['C', t.carbsG, v2.color.macro.carbs], ['F', t.fatG, v2.color.macro.fat]].map(([k, val, hue]) => (
          <Text key={String(k)} style={[T.captionStrong, T.num, { color: String(hue) }]}>{k} {Math.round(Number(val ?? 0))}</Text>
        ))}
      </View>
      <View style={{ marginTop: 8 }}>
        <Row name="Snap" sub="Photo of the plate" onPress={() => router.push({ pathname: '/(v2)/capture', params: { mode: 'photo' } } as any)} />
        <Row name="Scan" sub="Barcode" onPress={() => router.push({ pathname: '/(v2)/capture', params: { mode: 'barcode' } } as any)} />
        <Row name="Describe" sub="Tell Anakin what you ate" onPress={() => ask('Log this: ')} last />
      </View>
      <OpenLink label="Open Fuel" onPress={() => router.push('/(v2)' as any)} />
    </View>
  );
}

/** Proposal card: Apply → / Keep, resolved into an Adjusted receipt. */
export function ProposalCard({ turn, patch, resolve }: CardProps) {
  const p = turn.proposal;
  const cs = turn.cardState ?? {};
  const [busy, setBusy] = useState(false);
  if (!p) return null;
  const summary = p.summary || turn.card?.data?.summary || 'Proposed change';
  const rationale = p.rationale || turn.card?.data?.rationale;
  const apply = async () => {
    setBusy(true);
    try {
      const body = p.kind === 'workout_swap' ? { proposedWeek: p.proposedWeek, reason: p.summary } : { updatedProgram: p.updatedProgram, summary: p.summary, proposal: p };
      await v2Api.confirmProposal(body);
      patch({ status: 'applied' });
      resolve(`Adjusted — ${summary}`);
      haptics.success();
    } catch (e: any) { patch({ status: 'failed', error: e?.message ?? 'Could not apply' }); }
    setBusy(false);
  };
  if (turn.resolution) return null;
  return (
    <View style={styles.card}>
      <Receipt verb="Proposed" text={summary} animate={false} />
      {rationale ? <Text style={[T.caption, { marginTop: 8 }]}>{rationale}</Text> : null}
      {cs.status === 'failed' ? <Text style={[T.caption, { marginTop: 8 }]}>{cs.error}</Text> : null}
      <ActionPair primaryLabel={busy ? 'Applying' : 'Apply'} onPrimary={() => void apply()} onSecondary={() => { patch({ status: 'kept' }); resolve('Kept.'); }} />
    </View>
  );
}

export function TurnCard(props: CardProps) {
  const { turn } = props;
  if (turn.proposal && !turn.resolution && turn.card?.type !== 'week') return <Enter exit={false}><ProposalCard {...props} /></Enter>;
  switch (turn.card?.type) {
    case 'week': return <Enter exit={false}><WeekCard {...props} /></Enter>;
    case 'bench': return <Enter exit={false}><BenchCard {...props} /></Enter>;
    case 'food': return <Enter exit={false}><FoodCard {...props} /></Enter>;
    case 'proposal': return <Enter exit={false}><ProposalCard {...props} /></Enter>;
    default: return null;
  }
}

const styles = StyleSheet.create({
  card: { marginTop: 18, paddingTop: 14, borderTopWidth: 1, borderTopColor: v2.color.hairline },
  macros: { flexDirection: 'row', gap: 16, marginTop: 6 },
  logger: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10 },
  loggerInput: { flex: 1, ...T.row, fontFamily: v2.font.medium, borderBottomWidth: 1, borderBottomColor: v2.color.hairline, paddingVertical: 8, paddingHorizontal: 0 },
});
