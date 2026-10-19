// You → Watch & health data. Connect Apple Health (when this build has it),
// see today's recovery and where it comes from, sync, disconnect. Testers also
// get the simulator, which works without a watch or the native build.

import React from 'react';
import { View, Text, Alert, Platform } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PushedPage } from '../../shell/Page';
import { Row } from '../../primitives/Row';
import { T } from '../../theme';
import { apiFetch } from '../../../lib/api';
import { healthKit, connectAppleHealth, syncAppleHealth, lastAppleSync, forgetAppleSync, seedAppleHealth } from '../../../health/appleHealth';

const STATUS: Record<string, string> = {
  ready: 'Ready', normal: 'Normal', low: 'A bit low', strained: 'Strained', check_in: 'Check in on how you feel', unknown: 'Not enough data yet',
};
const SCENARIOS: [string, string][] = [
  ['normal', 'Steady block'], ['overreached', 'Overreached week'], ['illness', 'Getting ill'],
  ['poor_sleep', 'Poor sleep week'], ['deload', 'Deload'], ['travel', 'Travel'],
];
const ago = (t: number | string | null | undefined) => {
  if (!t) return 'never';
  const m = Math.round((Date.now() - new Date(t).getTime()) / 60_000);
  return m < 2 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

export function WatchPage() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['v2', 'wearables', 'status'], queryFn: () => apiFetch('/wearables/status') as Promise<any> });
  const recovery = useQuery({ queryKey: ['v2', 'wearables', 'recovery'], queryFn: () => apiFetch('/wearables/recovery') as Promise<any> });
  const [busy, setBusy] = React.useState<string | null>(null);
  const [lastSync, setLastSync] = React.useState<number | null>(null);
  React.useEffect(() => { void lastAppleSync().then(setLastSync); }, []);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['v2', 'wearables'] }), lastAppleSync().then(setLastSync)]);

  const conn = (p: string) => (status.data?.connections ?? []).find((c: any) => c.provider === p && c.status === 'connected');
  const apple = conn('apple_health');
  const sim = conn('simulator');
  const hkReady = Platform.OS === 'ios' && !!healthKit();

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try { await fn(); await refresh(); } catch (e: any) { Alert.alert('That didn’t work', e?.message ?? 'Try again.'); }
    setBusy(null);
  };
  const connect = () => run('connect', async () => { if (await connectAppleHealth()) await syncAppleHealth(60); });
  const syncNow = () => run('sync', () => syncAppleHealth());
  const disconnect = (provider: string, label: string) => Alert.alert(`Disconnect ${label}?`, 'Keep what was already synced, or delete it from Axiom too.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Keep data', onPress: () => void run('off', async () => { await apiFetch(`/wearables/${provider}/disconnect`, { method: 'POST', body: JSON.stringify({ deleteData: false }) }); if (provider === 'apple_health') await forgetAppleSync(); }) },
    { text: 'Delete data', style: 'destructive', onPress: () => void run('off', async () => { await apiFetch(`/wearables/${provider}/disconnect`, { method: 'POST', body: JSON.stringify({ deleteData: true }) }); if (provider === 'apple_health') await forgetAppleSync(); }) },
  ]);
  const simulate = (scenario: string) => run(`sim:${scenario}`, () => apiFetch('/wearables/simulate', { method: 'POST', body: JSON.stringify({ scenario, days: 60 }) }));

  const r = recovery.data;
  const lead = !status.data ? null
    : !status.data.days ? 'Connect a watch and Anakin reads your sleep, heart rate and recovery against your own baselines.'
    : `${status.data.days} days of watch data, latest ${status.data.latestDay}.`;

  return (
    <PushedPage back="You" title="Watch & health data" lead={lead} loading={status.isLoading}
      error={status.error ? 'Couldn’t load your watch data.' : null} onRetry={() => void status.refetch()}>
      {r && r.status !== 'unknown' ? (
        <View style={{ marginBottom: 24 }}>
          <Text style={[T.eyebrow, { marginBottom: 8 }]}>Recovery today</Text>
          <Row name={STATUS[r.status] ?? r.status} sub={(r.reasons ?? []).join(' · ') || 'In line with your baselines'} last />
        </View>
      ) : null}

      <Text style={[T.eyebrow, { marginBottom: 8 }]}>Sources</Text>
      {Platform.OS === 'ios' ? (
        apple ? (<>
          <Row name="Apple Health" sub={`Synced ${ago(lastSync ?? apple.lastSyncAt)}`} value={busy === 'sync' ? 'Syncing…' : 'Sync now'} onPress={hkReady ? () => void syncNow() : undefined} />
          <Row name="Disconnect Apple Health" sub="Also turn off access in the Health app → Sharing → Apps" onPress={() => disconnect('apple_health', 'Apple Health')} />
        </>) : hkReady ? (
          <Row name="Connect Apple Health" sub="Apple Watch, iPhone and apps that write to Health" value={busy === 'connect' ? 'Connecting…' : undefined} onPress={() => void connect()} />
        ) : (
          <Row name="Apple Health" sub="Needs the next app update from the App Store" />
        )
      ) : null}
      <Row name="Fitbit" sub="Coming soon" last />

      {status.data?.simulator ? (<>
        <Text style={[T.eyebrow, { marginTop: 32, marginBottom: 8 }]}>Simulator · testers only</Text>
        <Text style={[T.caption, { marginBottom: 8 }]}>Fills 60 days of made-up watch data, ending today, under its own source. Pick a scenario for the last week.</Text>
        {SCENARIOS.map(([key, label]) => (
          <Row key={key} name={label} value={busy === `sim:${key}` ? 'Filling…' : undefined} onPress={() => void simulate(key)} />
        ))}
        {sim ? <Row name="Remove simulated data" onPress={() => void run('off', () => apiFetch('/wearables/simulator/disconnect', { method: 'POST', body: JSON.stringify({ deleteData: true }) }))} last /> : null}
        {hkReady && __DEV__ ? <Row name="Seed Apple Health (dev)" sub="Writes 14 days of sample data into Health on this phone" onPress={() => void run('seed', async () => { await seedAppleHealth(14); await syncAppleHealth(14); })} last /> : null}
      </>) : null}
    </PushedPage>
  );
}
