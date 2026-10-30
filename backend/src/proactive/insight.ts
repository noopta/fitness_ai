// Training × nutrition insight (design D3) — the thing only Axiom has both
// sides of: meals logged the day before, sets logged the day after.
//
// Limits, by design: only a short approved list of pairs is tested (no
// open-ended scans — three matching days happen by chance if you look at
// enough pairs); the gate is ≥ 3 low days and ≥ 3 other days out of ≥ 8,
// with a gap bigger than the normal rep-to-rep spread; silent during an
// active weight cut; Apply sets today's carb target for one day only.

import { PrismaClient } from '@prisma/client';
import { defineOp } from '../agent/ops.js';
import { parseBlob, mergeBlobKeys } from '../agent/profile/coachProfile.js';
import { historyFromRows } from '../services/trainingSummary.js';
import { addDays } from './threads.js';

const prisma = new PrismaClient();

export interface ApprovedPair { id: 'carbs_prev_day_reps'; lifts: RegExp; lowCarbG: number; label: string }
export const APPROVED_PAIRS: ApprovedPair[] = [
  { id: 'carbs_prev_day_reps', lifts: /\b(squat|deadlift|bench)\b/i, lowCarbG: 150, label: 'carbs the day before' },
];

export interface LiftDay { date: string; reps: number; carbsPrevDay: number | null }

export interface CarbsRepsInsight {
  pair: 'carbs_prev_day_reps';
  lift: string;
  lowDays: number;
  otherDays: number;
  lowAvgReps: number;
  otherAvgReps: number;
  /** Reps lost on low-carb days (negative). */
  gap: number;
  spread: number;
  bars: { date: string; carbs: number; low: boolean }[];
  headline: string;
  caption: string;
  proposal: { carbsG: number; text: string };
}

export const MIN_DAYS = 8;
export const MIN_EACH = 3;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const stdev = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };

/** Pure. Null = say nothing. */
export function carbsRepsInsight(lift: string, days: LiftDay[], opts: { lowCarbG?: number; cutting?: boolean; carbTargetG?: number | null } = {}): CarbsRepsInsight | null {
  if (opts.cutting) return null;
  const low = opts.lowCarbG ?? 150;
  const usable = days.filter((d) => d.carbsPrevDay != null && d.reps > 0).sort((a, b) => a.date.localeCompare(b.date)).slice(-12);
  if (usable.length < MIN_DAYS) return null;
  const lows = usable.filter((d) => (d.carbsPrevDay as number) < low), others = usable.filter((d) => (d.carbsPrevDay as number) >= low);
  if (lows.length < MIN_EACH || others.length < MIN_EACH) return null;
  const lowAvg = mean(lows.map((d) => d.reps)), otherAvg = mean(others.map((d) => d.reps));
  const gap = lowAvg - otherAvg;
  const spread = Math.max(1, stdev(others.map((d) => d.reps)));
  if (-gap <= spread) return null;
  const perSet = Math.round(gap / 4 * 10) / 10; // the lifts tested are 3–5 working sets; show it per set
  const carbsG = Math.max(low + 50, Math.round(((opts.carbTargetG ?? 250) + 50) / 10) * 10);
  return {
    pair: 'carbs_prev_day_reps', lift, lowDays: lows.length, otherDays: others.length,
    lowAvgReps: Math.round(lowAvg * 10) / 10, otherAvgReps: Math.round(otherAvg * 10) / 10, gap: Math.round(gap * 10) / 10, spread: Math.round(spread * 10) / 10,
    bars: usable.map((d) => ({ date: d.date, carbs: Math.round(d.carbsPrevDay as number), low: (d.carbsPrevDay as number) < low })),
    headline: `Your ${lift.toLowerCase()} reps dropped after each of the ${lows.length} days you ate under ${low} g of carbs.`,
    caption: `${usable.length} ${lift.toLowerCase()} days is a small sample — this fits, it doesn't prove it.`,
    proposal: { carbsG, text: `${carbsG} g carbs today · rice at dinner covers ${Math.min(120, Math.max(60, Math.round((carbsG - low) * 0.9 / 10) * 10))} g` },
  };
}

/** Pure: per lift-day, the working reps of the lift and the carbs logged the day before. */
export function liftDays(lift: RegExp, workouts: { date: string; exercises: any[] }[], carbsByDate: Map<string, number>): { lift: string; days: LiftDay[] } | null {
  let name: string | null = null;
  const byDate = new Map<string, number>();
  for (const w of workouts) for (const ex of w.exercises) {
    if (!lift.test(String(ex.name ?? ''))) continue;
    name = name ?? String(ex.name);
    const sets: any[] = Array.isArray(ex.setEntries) && ex.setEntries.length ? ex.setEntries : [];
    const reps = sets.length ? sets.reduce((a, s) => a + (Number(s.reps) || 0), 0) : (Number(ex.sets) || 0) * (parseInt(String(ex.reps ?? ''), 10) || 0);
    if (reps > 0) byDate.set(w.date, (byDate.get(w.date) ?? 0) + reps);
  }
  if (!name) return null;
  const days = [...byDate.entries()].map(([date, reps]) => ({ date, reps, carbsPrevDay: carbsByDate.has(addDays(date, -1)) ? carbsByDate.get(addDays(date, -1))! : null }));
  return { lift: name, days };
}

/** Load and compute for a user. `tomorrowLift` narrows to the lift on tomorrow's (or today's) session when known. */
export async function fuelInsight(userId: string, today: string, opts: { cutting: boolean; carbTargetG: number | null; sessionLifts?: string[] }): Promise<CarbsRepsInsight | null> {
  const since = addDays(today, -90);
  const [logs, meals] = await Promise.all([
    prisma.workoutLog.findMany({ where: { userId, date: { gte: since } }, orderBy: { date: 'asc' }, select: { id: true, date: true, title: true, exercises: true } }),
    prisma.mealEntry.findMany({ where: { userId, date: { gte: addDays(since, -1) } }, select: { date: true, carbsG: true } }),
  ]);
  const carbs = new Map<string, number>();
  for (const m of meals) carbs.set(m.date, (carbs.get(m.date) ?? 0) + (m.carbsG ?? 0));
  const h = historyFromRows(logs);
  for (const pair of APPROVED_PAIRS) {
    const lifts = opts.sessionLifts?.length ? opts.sessionLifts.filter((l) => pair.lifts.test(l)) : null;
    if (lifts && !lifts.length) continue;
    const ld = liftDays(lifts?.length ? new RegExp(lifts.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i') : pair.lifts, h.workouts, carbs);
    if (!ld) continue;
    const r = carbsRepsInsight(ld.lift, ld.days, { lowCarbG: pair.lowCarbG, cutting: opts.cutting, carbTargetG: opts.carbTargetG });
    if (r) return r;
  }
  return null;
}

/** Today's one-day carb target, if the user applied one (read by the day-targets route). */
export function carbDayOverride(coachProfile: string | null | undefined, date: string): number | null {
  const o = parseBlob(coachProfile).carbDay;
  return o && o.date === date && Number.isFinite(Number(o.carbsG)) ? Number(o.carbsG) : null;
}

defineOp({
  name: 'proactive.carb_day',
  run: async (userId, args) => {
    const date = String(args.date ?? new Date().toISOString().slice(0, 10));
    const carbsG = Math.round(Number(args.carbsG));
    if (!Number.isFinite(carbsG) || carbsG < 50 || carbsG > 800) throw new Error('That carb target doesn’t look right.');
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { coachProfile: true } });
    const prev = parseBlob(u?.coachProfile).carbDay ?? null;
    await mergeBlobKeys(userId, { carbDay: { date, carbsG } });
    return { inverse: { op: 'proactive.carb_day_restore', args: { prev } }, summary: `Carbs today · ${carbsG} g (one day)` };
  },
});
defineOp({
  name: 'proactive.carb_day_restore',
  run: async (userId, args) => { await mergeBlobKeys(userId, { carbDay: (args.prev as any) ?? null }); return { inverse: null, summary: 'Carb target restored' }; },
});
