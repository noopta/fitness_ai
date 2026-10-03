// You (index 4): name, body line, confidence; Anakin's strength read; then
// Strength profile → Body → Streak → What Anakin knows → Billing → Preferences.

import React from 'react';
import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../context/AuthContext';
import { useUnits } from '../../context/UnitsContext';
import { T } from '../theme';
import { TabPage, PageTitle, AnakinRead } from '../shell/Page';
import { Row } from '../primitives/Row';
import { Enter } from '../primitives/Enter';
import { useStrength, useStreak, useMemory } from '../data';

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

  return (
    <TabPage refreshing={strength.isFetching} onRefresh={() => { void strength.refetch(); void streak.refetch(); void memory.refetch(); }}>
      <PageTitle title={user?.name || 'You'} caption={[bodyLine, conf ? `${conf}% confidence` : null].filter(Boolean).join(' · ') || null} />
      {read ? <View style={{ marginTop: 22 }}><AnakinRead text={read} /></View> : null}
      <View style={{ marginTop: 34 }}>
        <Enter index={2} exit={false}><Row name="Strength profile" sub={total ? `${out} of ${total} ratios out of band` : 'Log sessions to unlock'} onPress={() => go('strength')} /></Enter>
        <Enter index={3} exit={false}><Row name="Body" value={kg ? `${fromKg(kg)} ${unit}` : undefined} arrow={!kg} onPress={() => go('body')} /></Enter>
        <Enter index={4} exit={false}><Row name="Streak" value={streakDays != null ? `${streakDays} days` : undefined} arrow onPress={() => go('streak')} /></Enter>
        <Enter index={5} exit={false}><Row name="What Anakin knows" sub={memory.data?.notes?.length ? `${memory.data.notes.length} things remembered` : 'Nothing noted yet'} onPress={() => go('memory')} /></Enter>
        <Enter index={6} exit={false}><Row name="Billing" value={user?.tier === 'pro' || user?.tier === 'enterprise' ? 'Pro' : 'Free'} onPress={() => go('billing')} /></Enter>
        <Enter index={7} exit={false}><Row name="Preferences" onPress={() => go('prefs')} last /></Enter>
      </View>
      <Text style={[T.caption, { marginTop: 20 }]}>Form analyses and sharing live under Training and after a session.</Text>
    </TabPage>
  );
}
