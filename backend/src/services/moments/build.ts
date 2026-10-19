// Progress moments — the pure half. Turns a log plus the user's history into
// a moment: a warm, specific congratulation and the data for the shareable
// cards (spec "Progress Moments", 19 Oct 2026). No DB, no clock: everything
// arrives as input, so the copy and the numbers are testable.
//
// Copy rules (spec): every claim comes from the user's numbers; no
// exclamation marks, no emoji; a cut moment never states a body weight.

import type { ClimbData, CutData, DayData, LineData, SessionData, ShareableData, ProgressMomentType, ShareUnit } from './types.js';
import { bestE1RMByLift } from '../progressService.js';

export type { ShareableData, ProgressMomentType };

export interface LoggedSet { weightKg?: number | null; reps: number }
export interface LoggedExercise { name: string; sets?: number; reps?: string | number; weightKg?: number | null; bodyweight?: boolean; setEntries?: LoggedSet[] | null }
export interface HistoryLog { id: string; date: string; exercises: LoggedExercise[] }

export interface BuiltMoment {
  type: ProgressMomentType;
  label: string;
  title: string;
  praise: string;
  why: string[];
  shareables: ShareableData[];
  /** Ranks same-day workout moments. */
  score: number;
}

const LB = 2.20462;
const DAY = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const t = (d: string) => Date.parse(`${d}T12:00:00Z`);
const addDays = (d: string, n: number) => new Date(t(d) + n * DAY).toISOString().slice(0, 10);
export const dayLabel = (d: string) => { const x = new Date(t(d)); return `${WD[x.getUTCDay()]} ${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]}`; };
const shortDate = (d: string) => { const x = new Date(t(d)); return `${MONTHS[x.getUTCMonth()]} ${x.getUTCDate()}`; };
const n0 = (n: number) => Math.round(n).toLocaleString('en-US');
const plural = (n: number, w: string) => `${n0(n)} ${w}${Math.round(n) === 1 ? '' : 's'}`;
const ORD = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh'];
const ordinal = (n: number) => ORD[n] ?? `${n}th`;

/** A kg load in the user's unit: whole pounds, or kilos to the half. */
export function inUnit(kg: number, unit: ShareUnit): number {
  return unit === 'lb' ? Math.round(kg * LB) : Math.round(kg * 2) / 2;
}
const lbsInUnit = (lbs: number, unit: ShareUnit) => inUnit(lbs / LB, unit);

function lowerRep(r: unknown): number {
  const m = String(r ?? '').match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}
/** Every set as { kg, reps } (uniform sets expanded). */
export function setsOf(e: LoggedExercise): { kg: number; reps: number }[] {
  if (Array.isArray(e.setEntries) && e.setEntries.length) return e.setEntries.map((s) => ({ kg: Number(s.weightKg) || 0, reps: Number(s.reps) || 0 }));
  const n = Math.max(1, Number(e.sets) || 1);
  return Array.from({ length: n }, () => ({ kg: Number(e.weightKg) || 0, reps: lowerRep(e.reps) }));
}
const epley = (kg: number, reps: number) => (reps <= 1 ? kg : kg * (1 + Math.min(reps, 10) / 30));
/** The set with the best estimated max (ties: heavier). */
export function topSet(e: LoggedExercise): { kg: number; reps: number } | null {
  let best: { kg: number; reps: number; e: number } | null = null;
  for (const s of setsOf(e)) {
    if (s.reps < 1) continue;
    const v = s.kg > 0 ? epley(s.kg, s.reps) : 0;
    if (!best || v > best.e || (v === best.e && s.reps > best.reps)) best = { ...s, e: v };
  }
  return best ? { kg: best.kg, reps: best.reps } : null;
}
export const volumeKg = (e: LoggedExercise) => setsOf(e).reduce((v, s) => v + s.kg * s.reps, 0);
const repsOf = (e: LoggedExercise) => setsOf(e).reduce((v, s) => v + s.reps, 0);

/** Least-squares slope, units per week. */
function weeklySlope(series: { date: string; e1rm: number }[]): number {
  if (series.length < 3) return 0;
  const xs = series.map((p) => (t(p.date) - t(series[0].date)) / (7 * DAY)), ys = series.map((p) => p.e1rm);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0), den = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  return den ? num / den : 0;
}

/** Best estimated max per day for one lift, in the user's unit, over the window ending `until`. */
export function liftSeries(logs: HistoryLog[], key: string, keyFn: (n: string) => string, unit: ShareUnit, until: string, weeks = 16): { date: string; e1rm: number }[] {
  const from = addDays(until, -weeks * 7);
  const byDay = new Map<string, number>();
  for (const l of logs) {
    if (l.date < from || l.date > until) continue;
    const b = bestE1RMByLift(l.exercises as any, keyFn).get(key);
    if (!b) continue;
    const v = lbsInUnit(b.e1RMLbs, unit);
    if (v > (byDay.get(l.date) ?? 0)) byDay.set(l.date, v);
  }
  return [...byDay].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, e1rm]) => ({ date, e1rm }));
}

/**
 * Best-to-date: each point is the best estimated max so far. Day-to-day
 * estimates swing with rep ranges and light days; a climb is the envelope.
 */
export const bestToDate = (s: { date: string; e1rm: number }[]) => { let m = 0; return s.map((p) => ({ date: p.date, e1rm: (m = Math.max(m, p.e1rm)) })); };

const spanWeeks = (s: { date: string }[]) => (s.length < 2 ? 0 : Math.max(1, Math.round((t(s[s.length - 1].date) - t(s[0].date)) / (7 * DAY))));

export interface WorkoutInput {
  log: { id: string; date: string; title: string | null; duration: number | null; exercises: LoggedExercise[] };
  /** The user's other logs (any order). Logs after log.date are ignored. */
  history: HistoryLog[];
  keyFn: (name: string) => string;
  unit: ShareUnit;
  bodyweightKg: number | null;
  /** From detectStrengthPRs: most-improved first. */
  prs: { key: string; displayName: string; e1RMLbs: number; prevLbs: number; deltaLbs: number }[];
  today: string;
  /** A backfill batch: how many sessions came in with this one (this is the most recent). */
  batch?: number;
}

export function buildWorkoutMoment(i: WorkoutInput): BuiltMoment {
  const { log, unit } = i;
  const name = (log.title || '').trim() || 'Workout';
  const all = [...i.history.filter((h) => h.id !== log.id && h.date <= log.date), { id: log.id, date: log.date, exercises: log.exercises }];
  const u = unit;
  const isBackfill = log.date < addDays(i.today, -2);
  const when = log.date === i.today ? 'today' : log.date === addDays(i.today, -1) ? 'yesterday' : dayLabel(log.date);

  // ── The session (3g) ──
  const weighted = log.exercises.map((e) => ({ e, vol: volumeKg(e), reps: repsOf(e), top: topSet(e) }));
  const totalKg = weighted.reduce((s, x) => s + x.vol, 0);
  const byReps = totalKg <= 0;
  const denom = byReps ? Math.max(1, weighted.reduce((s, x) => s + x.reps, 0)) : totalKg;
  const prNames = new Set(i.prs.map((p) => p.displayName.toLowerCase()));
  const lifts = weighted
    .map((x) => ({
      name: x.e.name,
      top: x.top ? (x.top.kg > 0 ? `${inUnit(x.top.kg, u)}×${x.top.reps}` : `${x.top.reps} reps`) : '—',
      share: (byReps ? x.reps : x.vol) / denom,
      isPR: prNames.has(x.e.name.trim().toLowerCase()),
    }))
    .sort((a, b) => b.share - a.share);
  const volume = byReps ? Math.round(denom) : inUnit(totalKg, u);
  const session: SessionData = { name, minutes: log.duration || null, unit: u, volume, ...(byReps ? { volumeUnit: 'reps' } : {}), lifts };

  // Training days in the 7 days ending on the log's date (a warm-up and the session after it are one day).
  const weekStart = addDays(log.date, -6);
  const weekCount = new Set(all.filter((h) => h.date >= weekStart && h.date <= log.date).map((h) => h.date)).size;
  const prevDate = all.filter((h) => h.id !== log.id && h.date < log.date).map((h) => h.date).sort().pop() ?? null;
  const gapDays = prevDate ? Math.round((t(log.date) - t(prevDate)) / DAY) : null;

  const moved = byReps ? `${plural(volume, 'rep')}` : `${n0(volume)} ${u} moved`;
  const shape = `${moved} across ${plural(log.exercises.length, 'lift')}${log.duration ? ` in ${log.duration} minutes` : ''}`;
  const rhythm = weekCount >= 3 ? `That's ${weekCount} training days out of the last seven — this is what consistency looks like.`
    : weekCount === 2 ? 'Second training day this week. The rhythm is building.'
    : gapDays == null ? 'Your first one logged — everything from here gets measured against it.'
    : gapDays >= 10 ? 'Good to have you back under the bar.'
    : 'One more in the bank.';
  const backfillLine = isBackfill ? `Logged for ${dayLabel(log.date)} — filling in your history keeps your trends honest.` : '';
  const batchLine = i.batch && i.batch > 1 ? `${plural(i.batch - 1, 'more session')} filled in alongside it.` : '';

  // ── A PR (3a / 3e / 2f) ──
  const pr = i.prs[0];
  if (pr) {
    const ex = log.exercises.find((e) => i.keyFn(e.name) === pr.key) ?? log.exercises.find((e) => e.name.trim().toLowerCase() === pr.displayName.toLowerCase());
    const top = ex ? topSet(ex) : null;
    const series = bestToDate(liftSeries(all, pr.key, i.keyFn, u, log.date));
    // Today's point is the PR itself (same Epley as detectStrengthPRs); it closes the series.
    const today_ = series.find((p) => p.date === log.date);
    const now = today_?.e1rm ?? lbsInUnit(pr.e1RMLbs, u);
    if (!today_) series.push({ date: log.date, e1rm: now });
    const weeks = Math.max(1, spanWeeks(series));
    const first = series[0].e1rm;
    const gained = series.length > 1 ? now - first : lbsInUnit(pr.deltaLbs, u);
    // Previous best weight at these reps or more, before this log.
    let prevW = 0;
    if (top) for (const h of all) {
      if (h.id === log.id) continue;
      for (const e of h.exercises) if (i.keyFn(e.name) === pr.key) for (const s of setsOf(e)) if (s.reps >= top.reps && s.kg > prevW) prevW = s.kg;
    }
    const topW = top ? inUnit(top.kg, u) : 0;
    const delta = top && prevW > 0 && topW > inUnit(prevW, u) ? topW - inUnit(prevW, u) : null;
    const step = u === 'lb' ? 25 : 10;
    const goalV = Math.ceil((now + 1) / step) * step;
    const slope = weeklySlope(series);
    const weeksToGoal = slope > 0.2 && (goalV - now) / slope <= 26 ? Math.max(1, Math.ceil((goalV - now) / slope)) : null;
    const repMax = top && top.kg > 0 ? `${topW}×${top.reps}` : `${now}`;
    const climb: ClimbData = {
      lift: pr.displayName, unit: u, repMax, delta, series,
      goal: { value: goalV, label: `Next · ${goalV}` }, events: [],
      stats: { gained, bw: i.bodyweightKg ? Math.round((now / inUnit(i.bodyweightKg, u)) * 10) / 10 : null, weeksToGoal, weeks },
    };
    const shareables: ShareableData[] = [{ kind: '3a', data: climb }, { kind: '3e', data: climb }, { kind: '3g', data: session }];
    if (series.length >= 3) shareables.push({ kind: '2f', data: lineFrom(pr.displayName, u, series) });
    const others = i.prs.slice(1).map((p) => p.displayName);
    const liftLc = pr.displayName.toLowerCase();
    const praise = [
      backfillLine,
      series.length > 2 && gained > 0
        ? `That's the strongest you've ever been on ${liftLc} — your estimated max is ${now} ${u}, up ${n0(gained)} over ${plural(weeks, 'week')}. The work is showing up on the bar.`
        : `That's the strongest you've ever been on ${liftLc}: an estimated max of ${now} ${u}, ${n0(lbsInUnit(pr.deltaLbs, u))} past your old best. The work is showing up on the bar.`,
      batchLine,
    ].filter(Boolean).join(' ');
    const why = [
      top && top.kg > 0 ? `Best set: ${topW} × ${top.reps}${delta ? `, ${n0(delta)} ${u} more than you'd done for ${top.reps}+ reps before` : ''}.` : '',
      `Estimated max ${now} ${u} (Epley, from your top set), up from ${lbsInUnit(pr.prevLbs, u)}.`,
      others.length ? `Also a best ${when}: ${others.join(', ')}.` : '',
      `${shape[0].toUpperCase()}${shape.slice(1)}.`,
    ].filter(Boolean);
    return {
      type: 'pr', label: `New PR · ${pr.displayName}`, title: `${repMax.replace('×', ' × ')}. A new best.`,
      praise, why, shareables, score: 1e7 * i.prs.length + totalKg,
    };
  }

  // ── A session (3g, plus 2f when its main lift has a climbing line) ──
  const shareables: ShareableData[] = [{ kind: '3g', data: session }];
  const main = weighted.filter((x) => x.vol > 0).sort((a, b) => b.vol - a.vol)[0];
  if (main) {
    const key = i.keyFn(main.e.name);
    const series = bestToDate(liftSeries(all, key, i.keyFn, u, log.date));
    if (series.length >= 4 && series[series.length - 1].e1rm > series[0].e1rm) shareables.push({ kind: '2f', data: lineFrom(main.e.name, u, series) });
  }
  const praise = [
    backfillLine,
    `${shape[0].toUpperCase()}${shape.slice(1)}. ${rhythm}`,
    batchLine,
  ].filter(Boolean).join(' ');
  const topLift = lifts[0];
  const why = [
    topLift && topLift.top !== '—' ? `Most of the work: ${topLift.name}, top set ${topLift.top.replace('×', ' × ')}.` : '',
    `${plural(weekCount, 'training day')} in the seven days to ${dayLabel(log.date)}.`,
    gapDays != null && gapDays >= 10 ? `First session in ${gapDays} days.` : '',
  ].filter(Boolean);
  return {
    type: 'session', label: `Session · ${when === 'today' || when === 'yesterday' ? when[0].toUpperCase() + when.slice(1) : when}`,
    title: `${name}, logged.`, praise, why, shareables, score: totalKg,
  };
}

function lineFrom(lift: string, unit: ShareUnit, series: { date: string; e1rm: number }[]): LineData {
  return { lift, unit, series, now: series[series.length - 1].e1rm, start: { label: shortDate(series[0].date), value: series[0].e1rm }, weeks: Math.max(1, spanWeeks(series)) };
}

// ── Nutrition: protein goal hit (3b / 3f) ───────────────────────────────────

export interface MealIn { name: string; mealType: string | null; proteinG: number; carbsG: number; fatG: number; calories: number; createdAt?: Date | string }
export interface DayIn {
  date: string;
  meals: MealIn[];
  targets: { calories: number; proteinG: number; carbsG: number | null; fatG: number | null };
  /** Protein per day for the Monday–Sunday week containing `date` (missing days = 0). */
  weekProtein: Record<string, number>;
}

const SLOT_NAMES: Record<string, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };

/** Monday of the week containing d. */
export const mondayOf = (d: string) => addDays(d, -((new Date(t(d)).getUTCDay() + 6) % 7));

export function buildNutritionMoment(i: DayIn): BuiltMoment | null {
  const p = i.targets.proteinG;
  const total = Math.round(i.meals.reduce((s, m) => s + (m.proteinG || 0), 0));
  if (!p || total < p) return null;
  // Meals by slot, in the order they were eaten.
  const slots: { name: string; g: number }[] = [];
  for (const m of i.meals) {
    const k = String(m.mealType ?? '').toLowerCase();
    const label = SLOT_NAMES[k] ?? (m.name.length > 12 ? `${m.name.slice(0, 11)}…` : m.name);
    const hit = slots.find((s) => s.name === label);
    if (hit) hit.g += m.proteinG || 0; else slots.push({ name: label, g: m.proteinG || 0 });
  }
  slots.forEach((s) => (s.g = Math.round(s.g)));
  const mon = mondayOf(i.date);
  const week = Array.from({ length: 7 }, (_, k) => (k === (t(i.date) - t(mon)) / DAY ? total : i.weekProtein[addDays(mon, k)] ?? 0) >= p);
  const todayIndex = Math.round((t(i.date) - t(mon)) / DAY);
  const hits = week.filter(Boolean).length;
  const sum = (k: 'calories' | 'carbsG' | 'fatG') => Math.round(i.meals.reduce((s, m) => s + (m[k] || 0), 0));
  const cal = sum('calories'), carbs = sum('carbsG'), fat = sum('fatG');
  const day: DayData = {
    date: i.date, protein: { total, target: Math.round(p), meals: slots },
    calories: { n: cal, target: Math.round(i.targets.calories || cal) },
    carbs: { n: carbs, target: Math.round(i.targets.carbsG ?? carbs) },
    fat: { n: fat, target: Math.round(i.targets.fatG ?? fat) },
    week, todayIndex,
  };
  const biggest = [...slots].sort((a, b) => b.g - a.g)[0];
  return {
    type: 'nutrition', label: 'Goal hit · Protein', title: `${total} g of protein. Goal hit.`,
    praise: hits > 1
      ? `That's ${ordinal(hits)} day on target this week. Protein at this level is what holds on to muscle and helps you recover between sessions — you're making it a habit.`
      : `You hit your protein target. That's what holds on to muscle and helps you recover between sessions — a good day's work in the kitchen.`,
    why: [
      `${total} g against your ${Math.round(p)} g target.`,
      biggest ? `Biggest contributor: ${biggest.name} (${biggest.g} g).` : '',
      `${hits} of ${todayIndex + 1} ${todayIndex ? 'days' : 'day'} on target so far this week.`,
    ].filter(Boolean),
    shareables: [{ kind: '3b', data: day }, { kind: '3f', data: day }],
    score: total,
  };
}

// ── A cut: fat down, strength kept (3d) ─────────────────────────────────────

export interface CutIn {
  unit: ShareUnit;
  /** Weigh-ins (kg), any order, covering the cut so far. */
  weighIns: { date: string; kg: number }[];
  /** Lifts with their best estimated max (user unit) at the start and now. */
  lifts: { name: string; start: number; now: number }[];
  today: string;
}

const avg7 = (w: { date: string; kg: number }[], end: string) => {
  const xs = w.filter((x) => x.date <= end && x.date > addDays(end, -7)).map((x) => x.kg);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
};

export function buildCutMoment(i: CutIn): BuiltMoment | null {
  const w = [...i.weighIns].sort((a, b) => (a.date < b.date ? -1 : 1));
  if (w.length < 6) return null;
  const start = w[0].date, last = w[w.length - 1].date;
  const weeks = Math.floor((t(last) - t(start)) / (7 * DAY)) + 1;
  if (weeks < 4) return null;
  const base = avg7(w, addDays(start, 6))!;
  const series: { week: number; delta: number }[] = [];
  for (let k = 1; k <= weeks; k++) {
    const a = avg7(w, k === 1 ? addDays(start, 6) : addDays(start, k * 7 - 1));
    if (a != null) series.push({ week: k, delta: Math.round(inUnitRaw(a - base, i.unit) * 10) / 10 });
  }
  series[0] = { week: 1, delta: 0 };
  const change = series[series.length - 1].delta;
  if (change > -(i.unit === 'lb' ? 1 : 0.5)) return null;
  const bwUnit = inUnitRaw(base, i.unit);
  const safe = { min: Math.round(bwUnit * 0.005 * 10) / 10, max: Math.round(bwUnit * 0.01 * 10) / 10 };
  const rate = -change / Math.max(1, weeks - 1);
  const lifts = i.lifts.slice(0, 3);
  const held = lifts.length > 0 && lifts.every((l) => l.now >= l.start * 0.97);
  const data: CutData = { unit: i.unit, weeks, change, since: shortDate(start), series, safe, lifts };
  const inRange = rate >= safe.min * 0.9 && rate <= safe.max * 1.1;
  return {
    type: 'cut', label: `Cut · ${weeks} weeks in`, title: `${String(change).replace('-', '−')} ${i.unit}, ${weeks} weeks in.`,
    praise: [
      `Your 7-day average is down ${Math.abs(change)} ${i.unit} since ${shortDate(start)}${inRange ? ', right inside the safe range' : ''}.`,
      held ? 'And your lifts have held — the weight coming off is fat, not muscle. That is a cut done properly.' : lifts.length ? 'Your lifts have mostly held. Keep protein high and the bar heavy.' : 'Steady and patient — keep going.',
    ].join(' '),
    why: [
      `About ${Math.round(rate * 10) / 10} ${i.unit} a week; the safe range for you is ${safe.min}–${safe.max}.`,
      ...lifts.map((l) => `${l.name}: ${l.start} → ${l.now}.`),
    ],
    shareables: [{ kind: '3d', data }],
    score: Math.abs(change),
  };
}
const inUnitRaw = (kg: number, unit: ShareUnit) => (unit === 'lb' ? kg * LB : kg);
