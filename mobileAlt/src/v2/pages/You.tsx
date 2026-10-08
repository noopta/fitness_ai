// You (index 4): name, body line, confidence; Anakin's strength read; then
// Strength profile → Body → Streak → What Anakin knows → Billing → Preferences.

import React, { useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../context/AuthContext';
import { useUnits } from '../../context/UnitsContext';
import { T } from '../theme';
import { TabPage, PageTitle, AnakinRead } from '../shell/Page';
import { Row } from '../primitives/Row';
import { Enter } from '../primitives/Enter';
import { useStrength, useStreak, useMemory, useWorkouts } from '../data';
import { ShareWorkoutSheet, type WorkoutShare } from '../share/ShareWorkoutSheet';

/** "A", "A and B", "A, B and C". */
function listOf(xs: string[]): string {
  return xs.length <= 2 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

export function strengthRead(s: any): string | null {
  const ins: any[] = s?.athleteModel?.insights ?? [];
  const conf: number = s?.athleteModel?.confidence ?? 0;
  if (!s || s.totalLogs === 0) return 'Log a few sessions and I\'ll start reading your strength — ratios, stalls, what to fix.';
  if (conf < 0.3) return 'I\'m still reading you. Five more sessions across your main lifts and the picture firms up.';
  const stalls = ins.filter((i) => i.kind === 'stagnation');
  const imb = ins.filter((i) => i.kind === 'imbalance');
  if (stalls.length) {
    const lock = /lock is your ([a-z -]+)/i.exec(stalls[0].detail ?? '')?.[1]?.trim();
    const names = listOf(stalls.map((x) => String(x.title).replace(/ has stalled| is sliding backward/i, '').trim()));
    const n = stalls.length;
    return lock
      ? `${names} ${n === 1 ? 'stalled' : n === 2 ? 'both stalled' : 'all stalled'} on the same link — your ${lock}. That's the lock, not the lift.`
      : `${names} ${n > 1 ? 'have' : 'has'} stalled. Change the stimulus before adding weight.`;
  }
  if (imb.length) return `${imb[0].title}. ${imb[0].detail ?? ''}`.trim();
  if (ins.some((i) => i.kind === 'win')) return 'Nothing\'s holding you back. Balanced and progressing — keep the current stimulus.';
  return null;
}

export function YouPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { fromKg, unit } = useUnits();
  const strength = useStrength();
  const streak = useStreak();
  const memory = useMemory();
  const memoryCount = (memory.data?.notes?.length ?? 0) + (memory.data?.profile?.length ?? 0);
  const s: any = strength.data;
  const conf = Math.round(((s?.athleteModel?.confidence ?? 0) as number) * 100);
  const out = (s?.athleteModel?.ratios ?? []).filter((r: any) => r.status === 'high' || r.status === 'low').length;
  const total = (s?.athleteModel?.ratios ?? []).filter((r: any) => r.status !== 'no-data').length;
  const kg = (user as any)?.weightKg ?? s?.bodyWeightKg ?? null;
  const height = (user as any)?.heightCm ?? null;
  const bodyLine = [kg ? `${fromKg(kg)} ${unit}` : null, height ? `${height} cm` : null, (user as any)?.trainingAge ? `${(user as any).trainingAge} training` : null].filter(Boolean).join(' · ');
  const streakDays: number | null = streak.data?.currentStreak ?? null;
  const read = strengthRead(s);
  const go = (key: string) => router.push({ pathname: '/(v2)/p/[key]', params: { key } } as any);
  // S-04 from You: the last workout as a card.
  const workouts = useWorkouts();
  const [sharing, setSharing] = useState(false);
  const last = (Array.isArray(workouts.data) ? workouts.data : workouts.data?.workouts ?? [])[0] ?? null;
  const share = useMemo<WorkoutShare | null>(() => (last ? workoutShareFrom(last, fromKg, unit) : null), [last, fromKg, unit]);

  return (
    <TabPage refreshing={strength.isFetching} onRefresh={() => { void strength.refetch(); void streak.refetch(); void memory.refetch(); }}>
      <PageTitle title={user?.name || 'You'} caption={[bodyLine, conf ? `${conf}% confidence` : null].filter(Boolean).join(' · ') || null} />
      {read ? <View style={{ marginTop: 22 }}><AnakinRead text={read} /></View> : null}
      <View style={{ marginTop: 34 }}>
        <Enter index={2} exit={false}><Row name="Strength profile" sub={total ? `${out} of ${total} ratios out of band` : 'Log sessions to unlock'} onPress={() => go('strength')} /></Enter>
        <Enter index={3} exit={false}><Row name="Body" value={kg ? `${fromKg(kg)} ${unit}` : undefined} arrow={!kg} onPress={() => go('body')} /></Enter>
        <Enter index={4} exit={false}><Row name="Check in" sub="Sleep, energy, mood, stress — only what you tap" onPress={() => go('checkin')} /></Enter>
        <Enter index={4} exit={false}><Row name="Streak" value={streakDays != null ? `${streakDays} days` : undefined} arrow onPress={() => go('streak')} /></Enter>
        <Enter index={5} exit={false}><Row name="What Anakin knows" sub={memoryCount ? `${memoryCount} thing${memoryCount === 1 ? '' : 's'} known` : memory.isError ? 'Tap to retry' : 'Nothing noted yet'} onPress={() => go('memory')} /></Enter>
        <Enter index={6} exit={false}><Row name="Billing" value={user?.tier === 'pro' || user?.tier === 'enterprise' ? 'Pro' : 'Free'} onPress={() => go('billing')} /></Enter>
        <Enter index={7} exit={false}><Row name="Preferences" onPress={() => go('prefs')} /></Enter>
        <Enter index={8} exit={false}><Row name="Share" sub={last ? `Your last workout · ${last.title || 'Workout'}` : 'Log a workout to share it'} onPress={last ? () => setSharing(true) : undefined} /></Enter>
        <Enter index={8} exit={false}><Row name="Account" sub="Photo, name, region, delete account" onPress={() => go('account')} last /></Enter>
      </View>
      <ShareWorkoutSheet visible={sharing} onClose={() => setSharing(false)} workout={share} />
      <Text style={[T.caption, { marginTop: 20 }]}>Form analyses live under Training.</Text>
    </TabPage>
  );
}

/** A logged workout as a share card (top set by weight, sets, volume in the user's unit). */
function workoutShareFrom(w: any, fromKg: (kg: number) => number, unit: string): WorkoutShare {
  const ex: any[] = (() => { const e = typeof w.exercises === 'string' ? (() => { try { return JSON.parse(w.exercises); } catch { return []; } })() : w.exercises; return Array.isArray(e) ? e : []; })();
  let top: { kg: number; reps: string } | null = null; let sets = 0; let volKg = 0;
  for (const e of ex) {
    const s = Math.max(1, Number(e.sets) || 1); const reps = Number(String(e.reps ?? '').match(/\d+/)?.[0]) || 0; const kg = Number(e.weightKg) || 0;
    sets += s; volKg += s * reps * kg;
    if (kg && (!top || kg > top.kg)) top = { kg, reps: String(e.reps ?? '') };
  }
  return {
    title: w.title || 'Workout', durationMin: w.duration ?? null,
    exercises: ex.map((e) => ({ name: e.name, sets: Number(e.sets) || 1, reps: String(e.reps ?? ''), weightKg: e.weightKg ?? null })),
    top: top ? `${Math.round(fromKg(top.kg))} × ${top.reps}` : null, sets, volume: volKg ? `${Math.round(fromKg(volKg)).toLocaleString()} ${unit}` : null,
    date: new Date(`${String(w.date).slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }),
  };
}
