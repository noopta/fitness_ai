// Recovery from watch data, against the user's own baselines.
//
// Rules make the claim, the model only words it: every status comes with the
// numbers that produced it, and with too little data the answer is "unknown",
// never a guess. Thresholds are deliberately plain so a user (or a coach) can
// check them:
//   HRV      vs the median of the previous 28 days (same method only — Apple
//            reports SDNN, Fitbit RMSSD), needs 7+ nights
//   RHR      vs the median of the previous 28 days, needs 7+ days
//   Sleep    last night, and the last 3 nights, vs the median of the 4 weeks
//            before the last 7 (so a bad week can't become its own baseline),
//            needs 5+ nights
//   Load     sets in the last 7 days vs the weekly average of the 28 before

import { PrismaClient } from '@prisma/client';
import { todayForTz } from '../localDate.js';

const prisma = new PrismaClient();

export interface DayRow {
  date: string; provider: string;
  restingHr: number | null; hrvMs: number | null; hrvMethod: string | null;
  sleepMinutes: number | null; steps: number | null; activeKcal: number | null;
  wristTempDeltaC?: number | null;
}

export type RecoveryStatus = 'ready' | 'normal' | 'low' | 'strained' | 'check_in' | 'unknown';

export interface Recovery {
  date: string;
  status: RecoveryStatus;
  /** One line per signal, with the numbers ("HRV 41 ms, 22% under your 28-day 53 ms"). */
  reasons: string[];
  hrv: { today: number; baseline: number; pct: number; method: string } | null;
  restingHr: { today: number; baseline: number; delta: number } | null;
  sleep: { lastNight: number; baseline: number; delta: number; recentAvg: number | null } | null;
  load: { acuteSets: number; chronicWeeklySets: number; ratio: number } | null;
  steps: number | null;
  activeKcal: number | null;
  /** 0–1: how much of the picture we actually have. */
  confidence: number;
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const r1 = (n: number) => Math.round(n * 10) / 10;
const pct = (n: number) => `${Math.round(Math.abs(n) * 100)}%`;
const hm = (min: number) => `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, '0')}`;
function shift(d: string, days: number) { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + days); return t.toISOString().slice(0, 10); }

/**
 * One row per day when several sources overlap: the one with the most fields.
 * Phone and cloud sources for the same watch would otherwise double-count.
 */
export function pickDays(rows: DayRow[]): Map<string, DayRow> {
  const filled = (r: DayRow) => [r.restingHr, r.hrvMs, r.sleepMinutes, r.steps, r.activeKcal].filter((v) => v != null).length;
  const out = new Map<string, DayRow>();
  for (const r of rows) { const cur = out.get(r.date); if (!cur || filled(r) > filled(cur)) out.set(r.date, r); }
  return out;
}

/** Sets in a logged workout's exercises JSON. */
export function setsIn(exercisesJson: string): number {
  try {
    const exs = JSON.parse(exercisesJson);
    return Array.isArray(exs) ? exs.reduce((n: number, e: any) => n + (Array.isArray(e?.setEntries) && e.setEntries.length ? e.setEntries.length : Number(e?.sets) || 0), 0) : 0;
  } catch { return 0; }
}

/** The pure part: recovery for `date` from day rows and logged sets per date. */
export function computeRecovery(date: string, rows: DayRow[], setsByDate: Map<string, number> = new Map()): Recovery {
  const days = pickDays(rows);
  const today = days.get(date) ?? null;
  const prior = (n: number) => Array.from({ length: n }, (_, i) => days.get(shift(date, -(i + 1)))).filter((r): r is DayRow => !!r);
  const p28 = prior(28), p14 = prior(14);
  // Nights 8–35 days back: the user's usual sleep, unaffected by the week in question.
  const usualNights = Array.from({ length: 28 }, (_, i) => days.get(shift(date, -(i + 8)))).filter((r): r is DayRow => !!r && r.sleepMinutes != null);
  const reasons: string[] = [];

  let hrv: Recovery['hrv'] = null;
  if (today?.hrvMs != null) {
    const method = today.hrvMethod ?? 'sdnn';
    const base = p28.filter((r) => r.hrvMs != null && (r.hrvMethod ?? 'sdnn') === method).map((r) => r.hrvMs!);
    if (base.length >= 7) { const b = median(base); hrv = { today: r1(today.hrvMs), baseline: r1(b), pct: (today.hrvMs - b) / b, method }; }
  }
  let restingHr: Recovery['restingHr'] = null;
  if (today?.restingHr != null) {
    const base = p28.filter((r) => r.restingHr != null).map((r) => r.restingHr!);
    if (base.length >= 7) { const b = median(base); restingHr = { today: r1(today.restingHr), baseline: r1(b), delta: r1(today.restingHr - b) }; }
  }
  let sleep: Recovery['sleep'] = null;
  if (today?.sleepMinutes != null) {
    const base = usualNights.length >= 5 ? usualNights.map((r) => r.sleepMinutes!) : p14.filter((r) => r.sleepMinutes != null).map((r) => r.sleepMinutes!);
    if (base.length >= 5) {
      const b = median(base);
      const recent = [today, ...prior(2)].filter((r) => r.sleepMinutes != null).map((r) => r.sleepMinutes!);
      sleep = { lastNight: today.sleepMinutes, baseline: Math.round(b), delta: Math.round(today.sleepMinutes - b), recentAvg: recent.length === 3 ? Math.round(mean(recent)) : null };
    }
  }
  let load: Recovery['load'] = null;
  const acute = Array.from({ length: 7 }, (_, i) => setsByDate.get(shift(date, -i)) ?? 0).reduce((a, b) => a + b, 0);
  const chronic = Array.from({ length: 28 }, (_, i) => setsByDate.get(shift(date, -(i + 7))) ?? 0).reduce((a, b) => a + b, 0) / 4;
  if (chronic > 0) load = { acuteSets: acute, chronicWeeklySets: r1(chronic), ratio: r1(acute / chronic) };

  // Signals — each one a sentence with its numbers.
  let strong = 0, weak = 0;
  if (hrv) {
    if (hrv.pct <= -0.25) { strong++; reasons.push(`HRV ${hrv.today} ms, ${pct(hrv.pct)} under your 28-day ${hrv.baseline} ms`); }
    else if (hrv.pct <= -0.15) { weak++; reasons.push(`HRV ${hrv.today} ms, ${pct(hrv.pct)} under your 28-day ${hrv.baseline} ms`); }
    else if (hrv.pct >= 0.05) reasons.push(`HRV ${hrv.today} ms, ${pct(hrv.pct)} over your 28-day ${hrv.baseline} ms`);
  }
  if (restingHr) {
    if (restingHr.delta >= 7) { strong++; reasons.push(`Resting HR ${restingHr.today}, ${restingHr.delta} over your usual ${restingHr.baseline}`); }
    else if (restingHr.delta >= 4) { weak++; reasons.push(`Resting HR ${restingHr.today}, ${restingHr.delta} over your usual ${restingHr.baseline}`); }
  }
  if (sleep) {
    const recentShort = sleep.recentAvg != null && sleep.recentAvg <= sleep.baseline - 45;
    if (sleep.lastNight < 360 || sleep.delta <= -60) { weak++; reasons.push(`Slept ${hm(sleep.lastNight)}, ${hm(Math.abs(sleep.delta))} under your usual ${hm(sleep.baseline)}`); }
    else if (recentShort) { weak++; reasons.push(`Last 3 nights averaged ${hm(sleep.recentAvg!)}, ${hm(sleep.baseline - sleep.recentAvg!)} under your usual ${hm(sleep.baseline)}`); }
    else if (sleep.delta >= 30) reasons.push(`Slept ${hm(sleep.lastNight)}, ${hm(sleep.delta)} over your usual ${hm(sleep.baseline)}`);
  }
  if (load && load.ratio >= 1.5) { weak++; reasons.push(`${load.acuteSets} sets this week, ${load.ratio}× your usual ${load.chronicWeeklySets}`); }

  // Illness pattern: resting HR well up and HRV well down together (plus a
  // warm wrist when the watch reports it) — a nudge to check in, not a diagnosis.
  const sick = !!(restingHr && hrv && restingHr.delta >= 6 && hrv.pct <= -0.2) && (today?.wristTempDeltaC == null || today.wristTempDeltaC >= 0.3 || restingHr.delta >= 8);

  const have = [hrv, restingHr, sleep].filter(Boolean).length;
  const confidence = r1(have / 3);
  let status: RecoveryStatus;
  if (!have) status = 'unknown';
  else if (sick) status = 'check_in';
  else if (strong || weak >= 2) status = 'strained';
  else if (weak) status = 'low';
  else if (hrv && hrv.pct >= 0.05 && (!restingHr || restingHr.delta <= 0) && (!sleep || sleep.delta >= -30)) status = 'ready';
  else status = 'normal';

  return { date, status, reasons, hrv, restingHr, sleep, load, steps: today?.steps ?? null, activeKcal: today?.activeKcal ?? null, confidence };
}

/** Recovery for a user's day (their today by default), read from the database. */
export async function recoveryFor(userId: string, date?: string): Promise<Recovery> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } });
  const d = date ?? todayForTz(u?.timezone);
  const from = shift(d, -40);
  const [rows, logs] = await Promise.all([
    prisma.wearableDay.findMany({ where: { userId, date: { gte: from, lte: d } } }),
    prisma.workoutLog.findMany({ where: { userId, date: { gte: from, lte: d } }, select: { date: true, exercises: true } }),
  ]);
  const setsByDate = new Map<string, number>();
  for (const l of logs) setsByDate.set(l.date, (setsByDate.get(l.date) ?? 0) + setsIn(l.exercises));
  return computeRecovery(d, rows as DayRow[], setsByDate);
}

/** Daily rows for a window, one per date (best source), oldest first. */
export async function watchDays(userId: string, days = 14, until?: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } });
  const to = until ?? todayForTz(u?.timezone);
  const rows = await prisma.wearableDay.findMany({ where: { userId, date: { gte: shift(to, -(days - 1)), lte: to } }, orderBy: { date: 'asc' } });
  return [...pickDays(rows as DayRow[]).values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}
