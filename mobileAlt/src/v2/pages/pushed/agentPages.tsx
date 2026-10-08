// Pages that chat cards open (`Open →`, spec §10): profile, notifications,
// recipes, saved foods, plan & usage. Detail template — title → Anakin's read
// → rows. Anything shown can also be changed by asking Anakin; tapping a
// profile row does exactly that.

import React, { useEffect, useState } from 'react';
import { View, Text, Platform, StyleSheet } from 'react-native';
import { Pressable } from '../../primitives/Pressable';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { PushedPage } from '../../shell/Page';
import { Row } from '../../primitives/Row';
import { v2, T } from '../../theme';
import { useAuth } from '../../../context/AuthContext';
import { useUnits } from '../../../context/UnitsContext';
import { useShellOptional } from '../../shell/ShellContext';
import { apiFetch, nutritionApi } from '../../../lib/api';
import { haptics } from '../../haptics';

type Settings = {
  prefs: Record<string, any>;
  notifications: Record<string, any>;
  consent: Record<string, boolean>;
  usage: { pro: boolean; food: { used: number; limit: number | null }; analyses: { used: number; limit: number | null }; messages: { used: number; limit: number | null } };
};
const SETTINGS_KEY = ['v2', 'settings'];

export function useSettings() {
  return useQuery<Settings>({ queryKey: SETTINGS_KEY, queryFn: () => apiFetch('/me/settings'), staleTime: 30_000 });
}

/** Leave the pushed stack and ask Anakin in the thread. */
function useAskAnakin() {
  const router = useRouter();
  const shell = useShellOptional();
  return (m: string) => {
    try { if (router.canDismiss()) router.dismissAll(); } catch { /* not in a stack */ }
    shell?.ask(m);
  };
}

/** Settings writes: optimistic, then the server's copy (same ops as chat, so they're in the change log). */
function useSaveSettings() {
  const qc = useQueryClient();
  return async (patch: Partial<Record<'prefs' | 'notifications' | 'consent', Record<string, unknown>>>) => {
    const prev = qc.getQueryData<Settings>(SETTINGS_KEY);
    if (prev) qc.setQueryData<Settings>(SETTINGS_KEY, {
      ...prev,
      prefs: { ...prev.prefs, ...(patch.prefs ?? {}) },
      notifications: { ...prev.notifications, ...(patch.notifications ?? {}) },
      consent: { ...prev.consent, ...(patch.consent ?? {}) } as Record<string, boolean>,
    });
    try {
      const next = await apiFetch('/me/settings', { method: 'PATCH', body: JSON.stringify(patch) });
      qc.setQueryData(SETTINGS_KEY, next);
    } catch (e) {
      if (prev) qc.setQueryData(SETTINGS_KEY, prev);
      throw e;
    }
  };
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  const x = useSharedValue(on ? 16 : 0);
  useEffect(() => { x.value = withTiming(on ? 16 : 0, { duration: 180 }); }, [on, x]);
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return (
    <Pressable onPress={() => { haptics.select(); onChange(!on); }} hitSlop={12} accessibilityRole="switch" accessibilityState={{ checked: on }} accessibilityLabel={label}
      style={[st.switch, { backgroundColor: on ? v2.color.ink : v2.color.hairline }]}>
      <Animated.View style={[st.knob, knob]} />
    </Pressable>
  );
}

function SwitchRow({ name, sub, on, onChange, last }: { name: string; sub?: string; on: boolean; onChange: (v: boolean) => void; last?: boolean }) {
  return (
    <View style={[st.row, last && st.last]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={T.row}>{name}</Text>
        {sub ? <Text style={[T.caption, { marginTop: 2 }]}>{sub}</Text> : null}
      </View>
      <Switch on={on} onChange={onChange} label={name} />
    </View>
  );
}

const hourLabel = (h: number) => `${((h + 11) % 12) + 1} ${h < 12 ? 'am' : 'pm'}`;
const Section = ({ children }: { children: string }) => <Text style={[T.eyebrow, { marginTop: 32, marginBottom: 8 }]}>{children}</Text>;

// ─── Profile ─────────────────────────────────────────────────────────────────

export function ProfilePage() {
  const { user } = useAuth();
  const { fromKg, unit } = useUnits();
  const ask = useAskAnakin();
  const u: any = user ?? {};
  const w = (kg?: number | null) => (kg ? `${Math.round(fromKg(kg) * 10) / 10} ${unit === 'kg' ? 'kg' : 'lb'}` : '—');
  const h = (cm?: number | null) => {
    if (!cm) return '—';
    if (unit === 'kg') return `${Math.round(cm)} cm`;
    const inches = Math.round(cm / 2.54);
    return `${Math.floor(inches / 12)}′ ${inches % 12}″`;
  };
  const rows: { name: string; value: string; say: string }[] = [
    { name: 'Name', value: u.name || '—', say: 'Change my name' },
    { name: 'Username', value: u.username ? `@${u.username}` : '—', say: 'Change my username' },
    { name: 'Height', value: h(u.heightCm), say: 'Update my height' },
    { name: 'Weight', value: w(u.weightKg), say: 'Update my body weight' },
    { name: 'Goal weight', value: w(u.goalWeightKg), say: 'Set my goal weight' },
    { name: 'Goal', value: u.coachGoal || '—', say: 'Change my training goal' },
    { name: 'Training age', value: u.trainingAge || '—', say: 'Update how long I’ve been training' },
    { name: 'Equipment', value: u.equipment || '—', say: 'Change the equipment I have' },
    { name: 'Injuries and limits', value: u.constraintsText ? 'On file' : 'None', say: 'Update my injuries' },
  ];
  return (
    <PushedPage back="You" title="Your profile" lead="Everything Anakin plans around. Tap a line to change it — or just tell him in chat.">
      {rows.map((r, i) => <Row key={r.name} name={r.name} value={r.value} onPress={() => ask(r.say)} last={i === rows.length - 1} />)}
    </PushedPage>
  );
}

// ─── Notifications ───────────────────────────────────────────────────────────

const CATEGORIES: [string, string, string?][] = [
  ['workoutReminders', 'Workout reminders', 'The night before a session'],
  ['weeklySummary', 'Weekly summary', 'Sunday, your week in numbers'],
  ['milestones', 'Milestones and PRs'],
  ['social', 'Friends and messages'],
  ['groupCheckins', 'Group check-ins'],
  ['partnerSessions', 'Partner sessions'],
  ['programUpdates', 'Program updates'],
  ['nudges', 'Nudges when I’m away', 'Streak at risk, “haven’t seen you”'],
];

export function NotificationsPage() {
  const q = useSettings();
  const save = useSaveSettings();
  const [err, setErr] = useState<string | null>(null);
  const [iosPicker, setIosPicker] = useState<Date | null>(null);
  const n = q.data?.notifications ?? {};
  const set = (k: string, v: unknown) => { setErr(null); void save({ notifications: { [k]: v } }).catch((e) => setErr(e?.message ?? 'Couldn’t save that.')); };
  const hour = Number(n.reminderHour ?? 20);
  const pickHour = () => {
    const d = new Date(); d.setHours(hour, 0, 0, 0);
    if (Platform.OS === 'android') DateTimePickerAndroid.open({ value: d, mode: 'time', onChange: (e, v) => { if (e.type === 'set' && v) set('reminderHour', v.getHours()); } });
    else setIosPicker(d);
  };
  return (
    <PushedPage back="You" title="Notifications" lead="Anakin only pings you when it matters. Turn off anything that doesn’t." loading={q.isLoading} error={q.isError ? 'Couldn’t load your settings.' : null} onRetry={() => void q.refetch()}>
      {q.data ? (
        <>
          <Row name="Reminder time" sub="Your local time" value={hourLabel(hour)} onPress={pickHour} />
          {iosPicker ? (
            <View style={{ alignItems: 'flex-end', paddingVertical: 8, gap: 8 }}>
              <DateTimePicker value={iosPicker} mode="time" display="compact" minuteInterval={30} onChange={(_e, v) => v && setIosPicker(v)} />
              <View style={{ flexDirection: 'row', gap: 20 }}>
                <Pressable onPress={() => setIosPicker(null)} hitSlop={10}><Text style={T.captionStrong}>Cancel</Text></Pressable>
                <Pressable onPress={() => { const v = iosPicker; setIosPicker(null); set('reminderHour', v.getHours()); }} hitSlop={10}><Text style={[T.captionStrong, { color: v2.color.crimson }]}>Save</Text></Pressable>
              </View>
            </View>
          ) : null}
          {CATEGORIES.map(([k, name, sub]) => <SwitchRow key={k} name={name} sub={sub} on={n[k] !== false} onChange={(v) => set(k, v)} />)}
          <Section>Email</Section>
          <SwitchRow name="Weekly summary email" on={!!n.weeklyEmail} onChange={(v) => set('weeklyEmail', v)} />
          <SwitchRow name="Blog and update emails" on={n.marketingEmails !== false} onChange={(v) => set('marketingEmails', v)} last />
          {err ? <Text style={[T.caption, { marginTop: 12 }]}>{err}</Text> : null}
        </>
      ) : null}
    </PushedPage>
  );
}

// ─── Privacy: what Anakin may use (PRF-11) ───────────────────────────────────

const CONSENT: [string, string, string][] = [
  ['logs', 'Training logs', 'Every set you’ve logged'],
  ['nutrition', 'Food logs', 'Meals, for the nutrition target'],
  ['health', 'Health notes', 'Injuries and pain you tell him'],
  ['research', 'Web research', 'Studies and expert transcripts'],
];

export function ConsentRows() {
  const q = useSettings();
  const save = useSaveSettings();
  const [err, setErr] = useState<string | null>(null);
  const c = q.data?.consent ?? {};
  if (!q.data) return null;
  return (
    <>
      {CONSENT.map(([k, name, sub], i) => (
        <SwitchRow key={k} name={name} sub={sub} on={c[k] !== false} last={i === CONSENT.length - 1}
          onChange={(v) => { setErr(null); void save({ consent: { [k]: v } }).catch((e) => setErr(e?.message ?? 'Couldn’t save that.')); }} />
      ))}
      {err ? <Text style={[T.caption, { marginTop: 12 }]}>{err}</Text> : null}
    </>
  );
}

// ─── Recipes / Saved foods ───────────────────────────────────────────────────

// ─── Plan & usage ────────────────────────────────────────────────────────────

export function PlanPage() {
  const router = useRouter();
  const q = useSettings();
  const u = q.data?.usage;
  const line = (m?: { used: number; limit: number | null }) => (!m ? '—' : m.limit == null ? 'Unlimited' : `${m.used} of ${m.limit}`);
  return (
    <PushedPage back="You" title={u?.pro ? 'Pro' : 'Free'} lead={u?.pro ? 'Anakin, unlimited.' : 'Diagnosis is free. Pro is the coach that runs the plan with you.'}
      loading={q.isLoading} error={q.isError ? 'Couldn’t load your plan.' : null} onRetry={() => void q.refetch()}
      cta={u && !u.pro ? { label: 'Go Pro', onPress: () => router.push({ pathname: '/(v2)/paywall', params: { gate: '1' } } as any) } : null}
      foot={u?.pro ? [{ label: 'Manage subscription', onPress: () => router.push({ pathname: '/(v2)/p/[key]', params: { key: 'billing' } } as any) }] : undefined}>
      <Section>Today</Section>
      <Row name="AI food logs" sub="Photo, describe, scan" value={line(u?.food)} />
      <Row name="Lift analyses" value={line(u?.analyses)} />
      <Row name="Messages to Anakin" value={line(u?.messages)} last />
      <Text style={[T.caption, { marginTop: 10 }]}>Resets at midnight.</Text>
    </PushedPage>
  );
}

const st = StyleSheet.create({
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: v2.color.hairline },
  last: { borderBottomWidth: 1, borderBottomColor: v2.color.hairline },
  switch: { width: 40, height: 24, borderRadius: 12, padding: 3, justifyContent: 'center' },
  knob: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 1, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
});
