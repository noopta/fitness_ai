// Analyze (handoff T-14). From Analyze in the Training header and any lift
// page. Both analyses run natively in v2 — Check my form (T-16) and Find
// what's holding a lift back (T-15) — and are filed in Archive. A paused
// diagnostic shows Continue →.

import React from 'react';
import { Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { T } from '../../theme';
import { PushedPage } from '../../shell/Page';
import { Row } from '../../primitives/Row';
import { useTrainingOverview } from '../../data';
import { useAuth } from '../../../context/AuthContext';
import { apiFetch } from '../../../lib/api';
import { haptics } from '../../haptics';

const liftName = (k?: string) => String(k ?? 'Lift').split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

/** The newest diagnostic left part-way through in the last two weeks, if any. */
export function usePausedDiagnostic() {
  return useQuery({
    queryKey: ['v2', 'diagnostics', 'paused'],
    staleTime: 60_000, retry: 0,
    queryFn: async () => {
      const r: any = await apiFetch('/lift-diagnostics');
      const rows: any[] = r?.diagnostics ?? [];
      const cutoff = Date.now() - 14 * 86_400_000;
      return rows.find((d) => d.flow === 'conversation' && d.status === 'in_progress' && new Date(d.updatedAt).getTime() > cutoff) ?? null;
    },
  });
}

export function AnalyzePage({ params }: { params: Record<string, string> }) {
  const router = useRouter();
  const { user } = useAuth();
  const overview = useTrainingOverview();
  const paused = usePausedDiagnostic();
  const pro = user?.tier === 'pro' || user?.tier === 'enterprise';
  const past = (overview.data?.archive.items ?? []).filter((i) => i.kind === 'diagnostic').length;
  const lift = params.lift ? { lift: params.lift } : {};
  return (
    <PushedPage back={params.back || 'Training'} title="What should I look at?">
      {paused.data ? (
        <Row name={`Continue · ${liftName(paused.data.lift)}`} sub="Your diagnostic, where you left it" arrow emphasis
          onPress={() => { haptics.select(); router.push({ pathname: '/(v2)/diagnose', params: { sessionId: paused.data.id } } as any); }} />
      ) : null}
      <Row name="Check my form" sub="Film one lift · about 2 min" arrow onPress={() => { haptics.select(); router.push({ pathname: '/(v2)/formcheck', params: lift } as any); }} />
      <Row name="Find what’s holding a lift back" sub="10 questions · about 4 min" arrow onPress={() => { haptics.select(); router.push({ pathname: '/(v2)/diagnose', params: lift } as any); }} />
      <Row name="Past analyses" value={past ? String(past) : undefined} arrow last onPress={() => router.push({ pathname: '/(v2)/p/[key]', params: { key: 'diag' } } as any)} />
      {!pro ? <Text style={[T.caption, { marginTop: 18 }]}>Free plan: 1 of each a day. Pro: unlimited.</Text> : null}
    </PushedPage>
  );
}
