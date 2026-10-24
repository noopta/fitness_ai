// Apple Health → Axiom. Reads daily summaries and workouts on the phone and
// sends them to /api/wearables/apple/sync; the server keeps one row per day
// per source, so re-sending a day is harmless (and needed: the Watch syncs
// late, so every sync re-sends the last few days).
//
// The native module only exists in binaries built with
// @kingstinct/react-native-healthkit. It is required lazily and every entry
// point checks availability, so this file is safe in an OTA to an older
// binary — the feature reports "unavailable" there instead of crashing.

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch } from '../lib/api';

type HK = typeof import('@kingstinct/react-native-healthkit');
let hk: HK | null | undefined;
/** The HealthKit module, or null when this binary or device doesn't have it. */
export function healthKit(): HK | null {
  if (hk !== undefined) return hk;
  hk = null;
  if (Platform.OS !== 'ios') return hk;
  try {
    // The JS ships by OTA before the native module does: build 171 (runtime
    // 3.2.0) has no HealthKit, and requiring it there throws inside Metro's
    // module guard, which reports to Sentry even though we catch it
    // (REACT-NATIVE-G). Ask the Nitro registry first.
    const { NitroModules } = require('react-native-nitro-modules');
    if (!NitroModules?.hasHybridObject?.('CoreModule')) return hk;
    const mod: HK = require('@kingstinct/react-native-healthkit');
    hk = mod.isHealthDataAvailable() ? mod : null;
  } catch {
    hk = null;
  }
  return hk;
}

const Q = {
  steps: 'HKQuantityTypeIdentifierStepCount',
  active: 'HKQuantityTypeIdentifierActiveEnergyBurned',
  rhr: 'HKQuantityTypeIdentifierRestingHeartRate',
  hrv: 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN',
  vo2: 'HKQuantityTypeIdentifierVO2Max',
  resp: 'HKQuantityTypeIdentifierRespiratoryRate',
  hr: 'HKQuantityTypeIdentifierHeartRate',
} as const;
const SLEEP = 'HKCategoryTypeIdentifierSleepAnalysis';
const WORKOUT = 'HKWorkoutTypeIdentifier';
export const READ_TYPES = [...Object.values(Q), SLEEP, WORKOUT] as const;
/** Only the dev seed writes; released builds never ask to write. */
const SEED_TYPES = [Q.rhr, Q.hrv, Q.steps, Q.active, SLEEP, WORKOUT] as const;

const LAST_SYNC = 'appleHealth.lastSyncAt';
const RESEND_DAYS = 3;

const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const daysAgo = (n: number) => { const d = startOfDay(new Date()); d.setDate(d.getDate() - n); return d; };

/** Ask for read access. Resolves true when the sheet was shown/answered (Apple never says what was granted). */
export async function connectAppleHealth(): Promise<boolean> {
  const mod = healthKit();
  if (!mod) return false;
  await mod.requestAuthorization({ toRead: READ_TYPES as any });
  return true;
}

type Day = Record<string, any> & { date: string };

/** One statistics collection, per local day, into days[date][key]. */
async function perDay(mod: HK, id: string, stat: 'cumulativeSum' | 'discreteAverage' | 'mostRecent', unit: string, from: Date, to: Date, key: string, days: Map<string, Day>) {
  try {
    const rows = await mod.queryStatisticsCollectionForQuantity(id as any, [stat], startOfDay(from), { day: 1 }, { filter: { date: { startDate: from, endDate: to } }, unit } as any);
    for (const r of rows) {
      const q = stat === 'cumulativeSum' ? r.sumQuantity : stat === 'discreteAverage' ? r.averageQuantity : r.mostRecentQuantity;
      if (!r.startDate || q?.quantity == null) continue;
      const date = localDate(new Date(r.startDate));
      const d = days.get(date) ?? { date };
      d[key] = q.quantity;
      days.set(date, d);
    }
  } catch {
    // A type the user didn't grant, or the device doesn't record, just stays empty.
  }
}

/** Sleep per night, credited to the morning they woke; the source with the most sleep wins. */
async function sleepNights(mod: HK, from: Date, to: Date, days: Map<string, Day>) {
  let samples: readonly any[] = [];
  try { samples = await mod.queryCategorySamples(SLEEP as any, { limit: -1, filter: { date: { startDate: from, endDate: to } } } as any); } catch { return; }
  const nights = new Map<string, Map<string, { deep: number; rem: number; core: number; awake: number; start: Date; end: Date }>>();
  for (const s of samples) {
    const start = new Date(s.startDate), end = new Date(s.endDate);
    const mins = (end.getTime() - start.getTime()) / 60_000;
    if (!(mins > 0) || s.value === 0) continue; // 0 = in bed, not asleep
    const date = localDate(end);
    const source = s.sourceRevision?.source?.bundleIdentifier ?? s.sourceRevision?.source?.name ?? '?';
    const bySource = nights.get(date) ?? new Map();
    const n = bySource.get(source) ?? { deep: 0, rem: 0, core: 0, awake: 0, start, end };
    if (s.value === 4) n.deep += mins; else if (s.value === 5) n.rem += mins; else if (s.value === 2) n.awake += mins; else n.core += mins; // 1 unspecified, 3 core
    if (start < n.start) n.start = start;
    if (end > n.end) n.end = end;
    bySource.set(source, n);
    nights.set(date, bySource);
  }
  for (const [date, bySource] of nights) {
    const best = [...bySource.values()].sort((a, b) => (b.deep + b.rem + b.core) - (a.deep + a.rem + a.core))[0];
    const asleep = best.deep + best.rem + best.core;
    if (asleep <= 0) continue;
    const d = days.get(date) ?? { date };
    d.sleep = { minutes: Math.round(asleep), deep: Math.round(best.deep), rem: Math.round(best.rem), core: Math.round(best.core), awake: Math.round(best.awake), start: best.start.toISOString(), end: best.end.toISOString() };
    days.set(date, d);
  }
}

async function workouts(mod: HK, from: Date, to: Date) {
  let ws: readonly any[] = [];
  try { ws = await mod.queryWorkoutSamples({ limit: -1, filter: { date: { startDate: from, endDate: to } } } as any); } catch { return []; }
  const out = [];
  for (const w of ws) {
    let avgHr: number | undefined, maxHr: number | undefined;
    try {
      const hr = await w.getStatistic(Q.hr, 'count/min');
      avgHr = hr?.averageQuantity?.quantity; maxHr = hr?.maximumQuantity?.quantity;
    } catch { /* no heart rate for this workout */ }
    out.push({
      id: w.uuid,
      start: new Date(w.startDate).toISOString(),
      end: new Date(w.endDate).toISOString(),
      activityType: (mod as any).WorkoutActivityType?.[w.workoutActivityType] ?? String(w.workoutActivityType),
      activeKcal: w.totalEnergyBurned?.unit === 'kcal' ? w.totalEnergyBurned.quantity : w.totalEnergyBurned?.quantity != null ? w.totalEnergyBurned.quantity / 4.184 : undefined,
      distanceM: w.totalDistance?.unit === 'm' ? w.totalDistance.quantity : undefined,
      avgHr, maxHr,
      sourceName: w.sourceRevision?.source?.name,
    });
  }
  return out;
}

/** Read the last `days` days and send them up. Returns what the server stored, or null when Apple Health isn't available. */
export async function syncAppleHealth(daysBack?: number): Promise<{ days: number; workouts: number } | null> {
  const mod = healthKit();
  if (!mod) return null;
  const last = Number(await AsyncStorage.getItem(LAST_SYNC).catch(() => null)) || 0;
  const n = daysBack ?? (last ? Math.min(90, Math.ceil((Date.now() - last) / 86_400_000) + RESEND_DAYS) : 60);
  const from = daysAgo(n - 1), to = new Date();
  const days = new Map<string, Day>();
  await perDay(mod, Q.steps, 'cumulativeSum', 'count', from, to, 'steps', days);
  await perDay(mod, Q.active, 'cumulativeSum', 'kcal', from, to, 'activeKcal', days);
  await perDay(mod, Q.rhr, 'discreteAverage', 'count/min', from, to, 'restingHr', days);
  await perDay(mod, Q.hrv, 'discreteAverage', 'ms', from, to, 'hrvMs', days);
  await perDay(mod, Q.resp, 'discreteAverage', 'count/min', from, to, 'respiratoryRate', days);
  await perDay(mod, Q.vo2, 'mostRecent', 'ml/kg*min', from, to, 'vo2max', days);
  await sleepNights(mod, from, to, days);
  for (const d of days.values()) if (d.hrvMs != null) d.hrvMethod = 'sdnn';
  const ws = await workouts(mod, from, to);
  const list = [...days.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  let stored = { days: 0, workouts: 0 };
  // Batches keep each request small on a slow connection.
  for (let i = 0; i < Math.max(list.length, 1); i += 45) {
    const r: any = await apiFetch('/wearables/apple/sync', { method: 'POST', body: JSON.stringify({ days: list.slice(i, i + 45), workouts: i === 0 ? ws : [] }) });
    stored = { days: stored.days + (r?.days ?? 0), workouts: stored.workouts + (r?.workouts ?? 0) };
  }
  await AsyncStorage.setItem(LAST_SYNC, String(Date.now())).catch(() => {});
  return stored;
}

export async function lastAppleSync(): Promise<number | null> {
  return Number(await AsyncStorage.getItem(LAST_SYNC).catch(() => null)) || null;
}
export async function forgetAppleSync() { await AsyncStorage.removeItem(LAST_SYNC).catch(() => {}); }

/**
 * Dev only: write two weeks of plausible watch data into Apple Health on this
 * phone, so the real read path can be exercised without a Watch. Asks for
 * write access to just these types.
 */
export async function seedAppleHealth(days = 14): Promise<boolean> {
  const mod = healthKit();
  if (!mod) return false;
  await mod.requestAuthorization({ toShare: SEED_TYPES as any, toRead: READ_TYPES as any });
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  for (let i = days; i >= 1; i--) {
    const day = daysAgo(i);
    const at = (h: number, m = 0) => { const d = new Date(day); d.setHours(h, m, 0, 0); return d; };
    await mod.saveQuantitySample(Q.rhr as any, 'count/min' as any, Math.round(rnd(52, 60)), at(7), at(7, 1));
    await mod.saveQuantitySample(Q.hrv as any, 'ms' as any, Math.round(rnd(40, 65)), at(4), at(4, 1));
    // Sleep: last night's stages, ending this morning.
    const bed = new Date(day); bed.setDate(bed.getDate() - 1); bed.setHours(23, Math.round(rnd(0, 40)), 0, 0);
    let t = bed;
    for (const [value, mins] of [[3, 120], [4, 60], [5, 50], [3, 90], [5, 60], [2, 10], [3, 40]] as const) {
      const end = new Date(t.getTime() + mins * rnd(0.8, 1.2) * 60_000);
      await mod.saveCategorySample(SLEEP as any, value as any, t, end);
      t = end;
    }
    if ([1, 3, 5].includes(day.getDay())) {
      const s = at(18), e = at(19, Math.round(rnd(0, 15)));
      await mod.saveWorkoutSample(50 as any, [], s, e, { energyBurned: Math.round(rnd(280, 420)) });
    }
  }
  return true;
}
