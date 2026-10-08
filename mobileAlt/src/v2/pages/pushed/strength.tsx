// Strength, native (handoff T-11 – T-13).
//
// Strength profile (T-11): a tier explainer in place of a bare label — the
//   squat + bench + deadlift total as a bodyweight multiple, on a ladder — and
//   every lift logged instead of six. Tap a lift for T-12.
// Lift (T-12): the e1RM trend over a range, forecast dashed, the best recent
//   sets, and Log a set — a one-set logger that prefills the last set.
// Movement patterns (T-13): the radar is the overview; rows under it, sorted
//   by gap, open to the exercises that filled each pattern.

import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { inRange, patternsHeadline } from '@axiom/agent-ui-core';
import { v2, T } from '../../theme';
import { PushedPage } from '../../shell/Page';
import { Row, Eyebrow } from '../../primitives/Row';
import { Pressable } from '../../primitives/Pressable';
import { TextAction } from '../../primitives/TextAction';
import { Sheet } from '../../primitives/Sheet';
import { LineForecast, Radar } from '../../charts';
import { useStrength, useInvalidate } from '../../data';
import { useShellOptional } from '../../shell/ShellContext';
import { useUnits } from '../../../context/UnitsContext';
import { workoutsApi, apiFetch } from '../../../lib/api';
import { todayStr } from '../../../lib/localDate';
import { haptics } from '../../haptics';

const C = v2.color;
const TIER_LABEL: Record<string, string> = { novice: 'Novice', intermediate: 'Intermediate', advanced: 'Advanced', elite: 'Elite', untested: 'Not yet tested' };
const fmtDay = (d?: string) => { if (!d) return ''; const x = new Date(`${String(d).slice(0, 10)}T12:00:00`); return Number.isNaN(x.getTime()) ? String(d) : x.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }); };
const push = (router: ReturnType<typeof useRouter>, key: string, params: Record<string, string> = {}) => router.push({ pathname: '/(v2)/p/[key]', params: { key, ...params } } as any);

// ─── T-11 Strength profile ───────────────────────────────────────────────────

export function StrengthProfilePage() {
  const router = useRouter();
  const s = useStrength();
  const { fromKg, unit } = useUnits();
  const [all, setAll] = useState(false);
  const d: any = s.data;
  const ladder = d?.tierLadder as { ratio: number | null; tier: string; rungs: { tier: string; multiple: number }[]; missing: string[] } | undefined;
  const lifts: any[] = [...(d?.lifts ?? [])].filter((l) => (l.current1RMkg ?? 0) > 0).sort((a, b) => b.current1RMkg - a.current1RMkg);
  const shown = all ? lifts : lifts.slice(0, 3);
  const patterns: any[] = d?.athleteModel?.patternCoverage ?? [];
  const thin = patterns.filter((p) => p.status === 'neglected').length;
  return (
    <PushedPage back="You" meta={d ? 'Updated today' : null} eyebrow="Strength profile" title={ladder?.ratio != null ? `${ladder.ratio}× bodyweight` : 'Strength profile'}
      lead={ladder?.ratio != null ? `${TIER_LABEL[ladder.tier]}. Your squat, bench and deadlift total against your bodyweight.` : ladder?.missing?.length ? `Log ${ladder.missing.join(', ').toLowerCase()} and I can place you on the ladder.` : null}
      loading={s.isLoading} error={s.isError ? 'Couldn’t load your strength profile.' : null} onRetry={() => void s.refetch()}
      visual={ladder ? <TierLadder ladder={ladder} /> : null}>
      <Eyebrow>Lifts · {lifts.length}</Eyebrow>
      <View style={{ marginTop: 6 }}>
        {shown.map((l, i) => <Row key={l.canonicalName} name={l.canonicalName} sub={`${l.sessionCount} session${l.sessionCount === 1 ? '' : 's'}`} value={`${Math.round(fromKg(l.current1RMkg))}`} arrow last={i === shown.length - 1 && (all || lifts.length <= 3)}
          onPress={() => push(router, `lift:${l.canonicalName}`)} />)}
        {!all && lifts.length > 3 ? <Row name={`+ ${lifts.length - 3} more`} muted arrow last onPress={() => { haptics.select(); setAll(true); }} /> : null}
      </View>
      <Eyebrow style={{ marginTop: 28 }}>Balance</Eyebrow>
      <View style={{ marginTop: 6 }}>
        <Row name="Movement patterns" sub={patterns.length ? (thin ? `${thin} missing in the last 4 weeks` : 'All covered') : 'Log more to see coverage'} arrow onPress={() => push(router, 'patterns')} />
        <Row name="Ratios" sub="Lifts against each other" arrow last onPress={() => push(router, 'ratios')} />
      </View>
      <Text style={[T.caption, { marginTop: 14 }]}>Estimated 1RM in {unit}. Tiers are rough standards for adults, not a verdict.</Text>
    </PushedPage>
  );
}

function TierLadder({ ladder }: { ladder: { ratio: number | null; tier: string; rungs: { tier: string; multiple: number }[] } }) {
  const rungs = [...ladder.rungs].reverse(); // elite at the top
  return (
    <View>
      <Text style={T.eyebrow}>Tier</Text>
      <View style={{ marginTop: 8 }}>
        {rungs.map((r) => {
          const me = r.tier === ladder.tier;
          return (
            <View key={r.tier} style={[styles.rung, me && styles.rungMe]}>
              <Text style={[T.row, { flex: 1, color: me ? C.ink : C.muted, fontFamily: me ? v2.font.semibold : v2.font.regular }]}>{TIER_LABEL[r.tier]}</Text>
              {me && ladder.ratio != null ? <Text style={[T.captionStrong, { color: C.crimson, marginRight: 12 }]}>You · {ladder.ratio}×</Text> : null}
              <Text style={[T.caption, T.num]}>{r.multiple}×{r.tier === 'elite' ? ' +' : ''}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ─── T-12 Lift: trend and log a set ──────────────────────────────────────────

const RANGES = [{ label: '4 wk', weeks: 4 }, { label: '12 wk', weeks: 12 }, { label: '1 yr', weeks: 52 }, { label: 'All', weeks: 0 }];
export function LiftTrendPage({ name }: { name: string }) {
  const router = useRouter();
  const s = useStrength();
  const { fromKg, unit } = useUnits();
  const [range, setRange] = useState(1);
  const [logging, setLogging] = useState(false);
  const lifts: any[] = s.data?.lifts ?? [];
  const l = lifts.find((x) => x.canonicalName === name) ?? lifts.find((x) => String(x.canonicalName).toLowerCase().includes(name.toLowerCase()));
  const hist = useQuery({ queryKey: ['v2', 'liftHist', name.toLowerCase()], queryFn: () => apiFetch(`/workouts/exercise/${encodeURIComponent(l?.canonicalName ?? name)}/last?limit=12`) as Promise<any>, staleTime: 60_000, enabled: !s.isLoading });
  const pts = inRange<{ week: string; rm: number }>(l?.weekSeries ?? [], RANGES[range].weeks);
  const series = pts.map((p) => fromKg(p.rm));
  const fc = l?.forecast ? { value: Math.round(fromKg(l.forecast.value)), label: String(l.forecast.week).replace(/^\d{4}-W/, 'wk ') } : null;
  const delta = series.length > 1 ? Math.round(series[series.length - 1] - series[0]) : 0;
  const exposures: any[] = hist.data?.exposures ?? [];
  const best = [...exposures].filter((e) => e.top).sort((a, b) => (b.e1rmKg ?? 0) - (a.e1rmKg ?? 0)).slice(0, 3);
  const last = exposures[0]?.top ?? null;
  return (
    <PushedPage back="Strength" meta={RANGES[range].label} eyebrow={`${l?.canonicalName ?? name} · estimated 1RM`} title={l?.canonicalName ?? name}
      hero={l ? { value: String(Math.round(fromKg(l.current1RMkg))), unit, delta: series.length > 1 ? `${delta >= 0 ? '+' : ''}${delta}` : undefined } : null}
      loading={s.isLoading} cta={{ label: 'Log a set', onPress: () => { haptics.select(); setLogging(true); } }}
      foot={[{ label: 'Analyze', onPress: () => router.push({ pathname: '/(v2)/p/[key]', params: { key: 'analyze', lift: l?.canonicalName ?? name, back: l?.canonicalName ?? name } } as any) }]}
      visual={series.length > 1 ? <LineForecast series={series} forecast={RANGES[range].weeks === 0 || RANGES[range].weeks >= 12 ? fc : null} width={330} unitLabel={unit} /> : <Text style={T.bodyMuted}>Log this lift in two different weeks to see a trend.</Text>}>
      <View style={styles.toggle}>
        {RANGES.map((r, i) => (
          <Pressable key={r.label} onPress={() => { haptics.select(); setRange(i); }} hitSlop={8} accessibilityRole="button" accessibilityState={{ selected: range === i }}>
            <Text style={[styles.toggleText, range === i && styles.toggleOn]}>{r.label}</Text>
          </Pressable>
        ))}
      </View>
      {best.length ? (
        <>
          <Eyebrow style={{ marginTop: 24 }}>Best sets</Eyebrow>
          <View style={{ marginTop: 6 }}>
            {best.map((e, i) => <Row key={`${e.date}${i}`} name={`${e.top.weightKg ? Math.round(fromKg(e.top.weightKg)) : 'BW'} × ${e.top.reps}`} sub={fmtDay(e.date)} value={e.top.rpe ? `RPE ${e.top.rpe}` : undefined} last={i === best.length - 1} />)}
          </View>
        </>
      ) : null}
      <LogSetSheet visible={logging} onClose={() => setLogging(false)} name={l?.canonicalName ?? name} last={last} />
    </PushedPage>
  );
}

/** One set, prefilled from the last one. Logged as today's entry for this lift. */
function LogSetSheet({ visible, onClose, name, last }: { visible: boolean; onClose: () => void; name: string; last: { weightKg: number | null; reps: number } | null }) {
  const { fromKg, toKg, unit } = useUnits();
  const invalidate = useInvalidate();
  const [w, setW] = useState('');
  const [r, setR] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  React.useEffect(() => {
    if (!visible) return;
    setW(last?.weightKg ? String(Math.round(fromKg(last.weightKg))) : ''); setR(last?.reps ? String(last.reps) : ''); setError(null);
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    const reps = parseInt(r, 10); const weight = parseFloat(w);
    if (!Number.isFinite(reps) || reps <= 0) { setError('How many reps?'); return; }
    setBusy(true); setError(null);
    try {
      const kg = Number.isFinite(weight) && weight > 0 ? toKg(weight) : null;
      await workoutsApi.logWorkout({ date: todayStr(), title: name, exercises: [{ name, sets: 1, reps: String(reps), weightKg: kg, bodyweight: !kg, setEntries: [{ weightKg: kg, reps, rpe: null }] }] } as any);
      await invalidate.afterWorkout();
      haptics.success();
      onClose();
    } catch (e: any) { setError(e?.message ?? 'Couldn’t log it.'); }
    setBusy(false);
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={`Log a set · ${name}`} sub={last ? `Last time ${last.weightKg ? Math.round(fromKg(last.weightKg)) : 'BW'} × ${last.reps}` : 'Today'}>
      <View style={styles.setRow}>
        <View style={{ flex: 1 }}>
          <TextInput value={w} onChangeText={setW} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={C.placeholder} style={styles.setInput} accessibilityLabel={`Weight in ${unit}`} />
          <Text style={T.caption}>{unit}</Text>
        </View>
        <Text style={[T.read, { color: C.muted }]}>×</Text>
        <View style={{ flex: 1 }}>
          <TextInput value={r} onChangeText={setR} keyboardType="number-pad" placeholder="0" placeholderTextColor={C.placeholder} style={styles.setInput} accessibilityLabel="Reps" />
          <Text style={T.caption}>reps</Text>
        </View>
      </View>
      {error ? <Text style={[T.caption, { color: C.crimson, marginTop: 10 }]}>{error}</Text> : null}
      <View style={{ flexDirection: 'row', gap: 28, marginTop: 22, alignItems: 'center' }}>
        <TextAction primary onPress={() => void save()} loading={busy}>Log it</TextAction>
        <TextAction muted arrow={false} size={15} onPress={onClose}>Cancel</TextAction>
      </View>
    </Sheet>
  );
}

// ─── T-13 Movement patterns ──────────────────────────────────────────────────

const SHORT: Record<string, string> = { 'horizontal-push': 'H push', 'incline-push': 'Incline', 'vertical-push': 'V push', 'horizontal-pull': 'H pull', 'vertical-pull': 'V pull', squat: 'Squat', hinge: 'Hinge', lunge: 'Lunge' };
export function PatternsPage() {
  const router = useRouter();
  const shell = useShellOptional();
  const s = useStrength();
  const [open, setOpen] = useState<string | null>(null);
  const list: any[] = useMemo(() => [...(s.data?.athleteModel?.patternCoverage ?? [])].sort((a, b) => a.trailingSets - b.trailingSets), [s.data]);
  const max = Math.max(12, ...list.map((p) => p.trailingSets));
  const axes = list.length >= 3 ? [...list].sort((a, b) => Object.keys(SHORT).indexOf(a.pattern) - Object.keys(SHORT).indexOf(b.pattern)).map((p) => ({ t: SHORT[p.pattern] ?? p.label, v: String(p.trailingSets), r: Math.max(0.06, p.trailingSets / max), hot: p.status !== 'covered' })) : [];
  const missing = list.filter((p) => p.status === 'neglected').map((p) => p.label.toLowerCase());
  const ask = (m: string) => { shell?.ask(m); router.replace('/(v2)' as any); };
  return (
    <PushedPage back="Strength" meta="4 weeks" title={patternsHeadline(list)} loading={s.isLoading}
      visual={axes.length ? <Radar axes={axes} band={[0.5, 1]} size={330} /> : null}
      cta={missing.length ? { label: 'Fix it', onPress: () => ask(`Add ${missing.join(' and ')} work to my training.`) } : null}
      foot={[{ label: 'Ask why', onPress: () => ask('Why do movement patterns matter for my training?') }]}>
      {list.map((p, i) => (
        <View key={p.pattern}>
          <Row name={p.label} sub={p.status === 'neglected' ? 'Missing' : p.status === 'light' ? 'Light' : undefined} value={`${p.trailingSets} sets ${open === p.pattern ? '↑' : '↓'}`} emphasis={p.status === 'neglected'}
            last={i === list.length - 1 && open !== p.pattern} onPress={() => { haptics.select(); setOpen((o) => (o === p.pattern ? null : p.pattern)); }} />
          {open === p.pattern ? (
            <View style={styles.drill}>
              {(p.exercises ?? []).map((e: any) => <Row key={e.name} name={e.name} value={`${e.sets} sets`} onPress={() => push(router, `lift:${e.name}`)} />)}
              {!(p.exercises ?? []).length ? <Text style={[T.caption, { paddingVertical: 10 }]}>Nothing logged here in the last 4 weeks.</Text> : null}
            </View>
          ) : null}
        </View>
      ))}
      <Text style={[T.caption, { marginTop: 14 }]}>Hard sets in the last 4 weeks, sorted by gap.</Text>
    </PushedPage>
  );
}

const styles = StyleSheet.create({
  rung: { flexDirection: 'row', alignItems: 'center', height: 40, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.hairline, paddingHorizontal: 2 },
  rungMe: { borderLeftWidth: 2, borderLeftColor: C.crimson, paddingLeft: 10 },
  toggle: { flexDirection: 'row', gap: 20, marginTop: -8 },
  toggleText: { fontFamily: v2.font.medium, fontSize: 14, color: C.muted, paddingBottom: 3 },
  toggleOn: { color: C.ink, borderBottomWidth: 1.5, borderBottomColor: C.ink },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 8 },
  setInput: { fontFamily: v2.font.semibold, fontSize: 32, color: C.ink, borderBottomWidth: 1, borderBottomColor: C.ink, paddingVertical: 4 },
  drill: { paddingLeft: 16, borderLeftWidth: 2, borderLeftColor: C.surface, marginBottom: 6 },
});
