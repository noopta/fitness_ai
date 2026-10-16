// A user's week, measured: what changed, what went well (with the numbers),
// and what to focus on next. One engine feeds both the "celebrate progress"
// chat notices and the Sunday "your week" email, so they never disagree.
//
// The core (buildWeekReport) is pure and unit-tested; loadWeekInput gathers
// one user's data. Rules, not a model: every number in a win is computed
// from their logs, and a win needs enough data to be true (e.g. a weight
// trend needs weigh-ins in both weeks).

import { PrismaClient } from '@prisma/client';
import { bestE1RMByLift, computeProteinTargetG, inferGoalDirection, type GoalDirection } from './progressService.js';
import { bodyWeightKg, displayWeight, normalizePreference, unitLabel, type UnitPreference } from './weightUnits.js';
import { resolveTargets, type Targets } from './nutritionTargets.js';
import { computeMicroTargets, type MicroTarget } from './microTargetsService.js';

const prisma = new PrismaClient();

// ── Types ────────────────────────────────────────────────────────────────────

export interface WeekInput {
  name: string | null;
  unit: UnitPreference;
  goal: GoalDirection;
  /** Inclusive local dates, YYYY-MM-DD: the 7 days being reviewed. */
  start: string;
  end: string;
  /** Workouts from the 12 weeks before `start` (strength baseline) and from the week. */
  workouts: Array<{ date: string; exercises: any[] }>;
  /** Meals from the week (date, macros, nutrients JSON). */
  meals: Array<{ date: string; calories: number; proteinG: number; nutrientsJson?: string | null }>;
  /** Weigh-ins from the 28 days up to `end`, plus the first ever. */
  weights: Array<{ date: string; kg: number }>;
  firstWeight: { date: string; kg: number } | null;
  targets: Targets | null;
  proteinTargetG: number | null;
  microTargets: MicroTarget[];
  streak: number;
}

export interface Win {
  /** Stable per achievement, so each is celebrated once. */
  key: string;
  kind: 'strength' | 'weight' | 'nutrition' | 'training';
  title: string;
  detail: string;
  /** What a share card would say. */
  share: { eyebrow: string; value: string; line: string };
}

export interface WeekReport {
  start: string;
  end: string;
  unit: 'kg' | 'lbs';
  goal: GoalDirection;
  training: { sessions: number; sets: number; gains: Array<{ lift: string; from: number; to: number }> };
  body: { avgKg: number | null; prevAvgKg: number | null; changeKg: number | null; sinceStartKg: number | null; daysSinceWeighIn: number | null; logs: number };
  nutrition: {
    loggedDays: number; avgKcal: number | null; kcalTarget: number | null; daysOnCalories: number;
    avgProtein: number | null; proteinTarget: number | null; proteinTargetIsSet: boolean; daysProteinHit: number;
    microsMet: string[];
    /** Each 'meet' nutrient: daily average over logged days vs its target. */
    micros: Array<{ key: string; label: string; unit: string; avg: number; target: number; pct: number }>;
  };
  wins: Win[];
  focus: string[];
  /** Two or three plain sentences on how the week went. */
  analysis: string[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const r0 = (x: number) => Math.round(x);
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const isoWeek = (d: string) => { const x = new Date(`${d}T12:00:00Z`); const day = (x.getUTCDay() + 6) % 7; x.setUTCDate(x.getUTCDate() - day + 3); const y = x.getUTCFullYear(); const w1 = new Date(Date.UTC(y, 0, 4)); return `${y}-W${String(1 + Math.round(((x.getTime() - w1.getTime()) / 86_400_000 - 3 + ((w1.getUTCDay() + 6) % 7)) / 7)).padStart(2, '0')}`; };
export const weekKey = isoWeek;

// ── The report ───────────────────────────────────────────────────────────────

/** The week's numbers, wins and focus. Pure. */
export function buildWeekReport(w: WeekInput): WeekReport {
  const unit = unitLabel(w.unit);
  const show = (kg: number, dp = 1) => displayWeight(kg, w.unit, dp);
  const inWeek = (d: string) => d >= w.start && d <= w.end;

  // Training: sessions, sets, and lifts whose best this week beat everything before it.
  const week = w.workouts.filter((x) => inWeek(x.date));
  const before = w.workouts.filter((x) => x.date < w.start);
  const sets = week.reduce((a, x) => a + (x.exercises ?? []).reduce((b: number, e: any) => b + (Array.isArray(e?.setEntries) && e.setEntries.length ? e.setEntries.length : Number(e?.sets) || 0), 0), 0);
  const bestThis = bestE1RMByLift(week.flatMap((x) => x.exercises ?? []));
  const bestBefore = bestE1RMByLift(before.flatMap((x) => x.exercises ?? []));
  const gains: Array<{ lift: string; from: number; to: number }> = [];
  for (const [key, cur] of bestThis) {
    const prev = bestBefore.get(key);
    if (!prev) continue; // a first entry isn't a gain
    if (cur.e1RMLbs >= prev.e1RMLbs * 1.025 && cur.e1RMLbs - prev.e1RMLbs >= 2.5) gains.push({ lift: cur.displayName, from: prev.e1RMLbs, to: cur.e1RMLbs });
  }
  gains.sort((a, b) => (b.to - b.from) / b.from - (a.to - a.from) / a.from);

  // Body: 7-day average vs the 7 days before, by date; total since the first weigh-in.
  const thisW = w.weights.filter((x) => inWeek(x.date)).map((x) => x.kg);
  const prevW = w.weights.filter((x) => x.date >= addDays(w.start, -7) && x.date < w.start).map((x) => x.kg);
  const avgKg = mean(thisW); const prevAvgKg = mean(prevW);
  const latest = [...w.weights].sort((a, b) => a.date.localeCompare(b.date)).pop() ?? null;
  const changeKg = thisW.length >= 2 && prevW.length >= 2 && avgKg != null && prevAvgKg != null ? avgKg - prevAvgKg : null;
  const sinceStartKg = latest && w.firstWeight && daysBetween(w.firstWeight.date, latest.date) >= 6 ? latest.kg - w.firstWeight.kg : null;
  const daysSinceWeighIn = latest ? daysBetween(latest.date, w.end) : null;

  // Nutrition: per-day totals for the days actually logged.
  const days = new Map<string, { kcal: number; p: number; micros: Record<string, number> }>();
  for (const m of w.meals.filter((x) => inWeek(x.date))) {
    const d = days.get(m.date) ?? { kcal: 0, p: 0, micros: {} };
    d.kcal += m.calories || 0; d.p += m.proteinG || 0;
    try { for (const [k, v] of Object.entries(JSON.parse(m.nutrientsJson ?? '{}'))) if (Number.isFinite(Number(v))) d.micros[k] = (d.micros[k] ?? 0) + Number(v); } catch { /* skip */ }
    days.set(m.date, d);
  }
  const logged = [...days.values()].filter((d) => d.kcal >= 400); // a 150 kcal day is a partial log, not a day of eating
  const kcalTarget = w.targets?.calories ?? null;
  const proteinTarget = w.targets?.proteinG ?? w.proteinTargetG;
  const daysOnCalories = kcalTarget ? logged.filter((d) => Math.abs(d.kcal - kcalTarget) <= kcalTarget * 0.1).length : 0;
  const daysProteinHit = proteinTarget ? logged.filter((d) => d.p >= proteinTarget * 0.9).length : 0;
  const microsMet = logged.length >= 3
    ? w.microTargets.filter((t) => t.direction === 'meet').filter((t) => logged.filter((d) => (d.micros[t.key] ?? 0) >= t.target).length >= Math.max(3, Math.ceil(logged.length * 0.7))).map((t) => t.label)
    : [];
  const micros = logged.length >= 2
    ? w.microTargets.filter((t) => t.direction === 'meet' && t.target > 0).map((t) => {
      const avg = mean(logged.map((d) => d.micros[t.key] ?? 0))!;
      return { key: t.key, label: t.label, unit: t.unit, avg: Math.round(avg * 10) / 10, target: t.target, pct: Math.round((avg / t.target) * 100) };
    }).filter((m) => m.avg > 0)
    : [];
  const nutrition = {
    micros,
    loggedDays: logged.length, avgKcal: logged.length ? r0(mean(logged.map((d) => d.kcal))!) : null, kcalTarget, daysOnCalories,
    avgProtein: logged.length ? r0(mean(logged.map((d) => d.p))!) : null, proteinTarget, proteinTargetIsSet: w.targets?.proteinG != null, daysProteinHit, microsMet,
  };

  // ── Wins ──
  const wins: Win[] = [];
  const wk = isoWeek(w.end);
  const towardGoal = (kg: number) => (w.goal === 'lose' ? kg < 0 : w.goal === 'gain' ? kg > 0 : false);
  if (changeKg != null && towardGoal(changeKg) && Math.abs(changeKg) >= 0.2) {
    const v = show(Math.abs(changeKg));
    wins.push({ key: `weight-week:${wk}`, kind: 'weight', title: `${w.goal === 'lose' ? 'Down' : 'Up'} ${v} ${unit} this week`, detail: `Your 7-day average went from ${show(prevAvgKg!)} to ${show(avgKg!)} ${unit}.`, share: { eyebrow: 'This week', value: `${w.goal === 'lose' ? '−' : '+'}${v} ${unit}`, line: '7-day average' } });
  }
  if (sinceStartKg != null && towardGoal(sinceStartKg)) {
    // Early milestones count: the first 3 lb is when people decide whether this works.
    const steps = unit === 'kg' ? [1.5, 2.5, 4, 5, 7.5, 10, 12.5, 15, 20, 25] : [3, 5, 8, 10, 15, 20, 25, 30, 40, 50];
    const moved = Math.abs(show(sinceStartKg, 1));
    const reached = [...steps].reverse().find((x) => moved >= x) ?? 0;
    const actual = Math.floor(moved * 2) / 2; // to the half: 3.5, not the milestone's 3
    if (reached) wins.push({ key: `weight-total:${reached}`, kind: 'weight', title: `${w.goal === 'lose' ? 'Down' : 'Up'} ${actual} ${unit} since you started`, detail: `${show(w.firstWeight!.kg)} → ${show(latest!.kg)} ${unit} since ${fmtDay(w.firstWeight!.date)}.`, share: { eyebrow: 'Since day one', value: `${w.goal === 'lose' ? '−' : '+'}${actual} ${unit}`, line: w.goal === 'lose' ? 'and counting' : 'of new size' } });
  }
  for (const g of gains.slice(0, 3)) {
    const to = r0(displayWeight(g.to / 2.20462, w.unit, 0)); const from = r0(displayWeight(g.from / 2.20462, w.unit, 0));
    wins.push({ key: `e1rm:${g.lift.toLowerCase()}:${to}`, kind: 'strength', title: `New best on ${g.lift}`, detail: `Estimated max ${from} → ${to} ${unit} (+${r0(((g.to - g.from) / g.from) * 100)}%).`, share: { eyebrow: g.lift, value: `${to} ${unit}`, line: 'new estimated max' } });
  }
  if (nutrition.loggedDays >= 6) wins.push({ key: `logged:${wk}`, kind: 'nutrition', title: `Logged food ${nutrition.loggedDays} of 7 days`, detail: 'That consistency is what makes every other number here trustworthy.', share: { eyebrow: 'This week', value: `${nutrition.loggedDays}/7`, line: 'days logged' } });
  if (kcalTarget && daysOnCalories >= 5) wins.push({ key: `calories:${wk}`, kind: 'nutrition', title: `On your calorie target ${daysOnCalories} of 7 days`, detail: `Averaged ${nutrition.avgKcal} kcal against ${kcalTarget}.`, share: { eyebrow: 'This week', value: `${daysOnCalories}/7`, line: 'days on target' } });
  if (proteinTarget && daysProteinHit >= 5) wins.push({ key: `protein:${wk}`, kind: 'nutrition', title: `Hit protein ${daysProteinHit} of 7 days`, detail: `Averaged ${nutrition.avgProtein} g against ${proteinTarget} g.`, share: { eyebrow: 'This week', value: `${daysProteinHit}/7`, line: 'protein days' } });
  if (microsMet.length >= 2) wins.push({ key: `micros:${wk}`, kind: 'nutrition', title: `Met ${microsMet.length} micronutrient targets most days`, detail: `${microsMet.slice(0, 4).join(', ')}${microsMet.length > 4 ? '…' : ''}.`, share: { eyebrow: 'This week', value: String(microsMet.length), line: 'nutrient targets met' } });
  if (week.length >= 4) wins.push({ key: `sessions:${wk}`, kind: 'training', title: `${week.length} workouts this week`, detail: `${plural(sets, 'set')} in total.`, share: { eyebrow: 'This week', value: String(week.length), line: 'workouts' } });

  // ── Focus for next week (at most two, most useful first) ──
  const focus: string[] = [];
  if (daysSinceWeighIn == null || daysSinceWeighIn >= 5) focus.push(daysSinceWeighIn == null ? 'Weigh in 3 mornings this week, before breakfast — a few numbers will show how well this is working.' : `Weigh in 3 mornings this week, before breakfast — it's been ${daysSinceWeighIn} days, and a few fresh numbers will show how well this is working.`);
  if (proteinTarget && nutrition.loggedDays >= 3 && daysProteinHit < 4) focus.push(`Protein: aim for ${proteinTarget} g on 5 days — you averaged ${nutrition.avgProtein} g, so you're ${nutrition.avgProtein != null && nutrition.avgProtein >= proteinTarget * 0.8 ? 'most of the way there' : 'on your way'}. ${w.goal === 'lose' ? 'It’s what protects your muscle while the fat comes off.' : 'It’s what builds and repairs muscle after training.'}${nutrition.proteinTargetIsSet ? '' : ' (Our suggested target for your goal — Anakin can set it.)'}`);
  if (nutrition.loggedDays < 4) focus.push('Log food on at least 5 days — even rough logs make the numbers useful.');
  if (week.length <= 1) focus.push('Get 3 workouts in — consistency first, intensity second.');
  if (kcalTarget && w.goal === 'lose' && nutrition.avgKcal != null && nutrition.avgKcal > kcalTarget * 1.1) focus.push(`Calories averaged ${nutrition.avgKcal} against ${kcalTarget}: plan your highest-calorie meal ahead on 3 days.`);
  if (!focus.length) focus.push(gains.length ? 'Keep the loads moving: repeat this week and add a rep or a little weight where the last set felt easy.' : 'Keep the same rhythm — and nudge one lift up by a small step.');

  // ── Analysis ──
  const analysis: string[] = [];
  if (changeKg != null && avgKg) {
    const pctWk = (Math.abs(changeKg) / avgKg) * 100;
    const pace = w.goal !== 'lose' ? '' : pctWk > 1 ? ' That’s faster than the usual 0.5–1% a week — some is water, and it will slow.' : pctWk >= 0.25 ? ' A sustainable pace for losing fat while keeping muscle.' : '';
    analysis.push(Math.abs(changeKg) < 0.2 ? `Weight held steady this week (7-day average ${show(avgKg)} ${unit}); day-to-day water swings hide a lot, so the two-week trend matters more.` : `Your 7-day average moved ${changeKg < 0 ? 'down' : 'up'} ${show(Math.abs(changeKg))} ${unit}, to ${show(avgKg)} ${unit}.${pace}`);
  } else if (sinceStartKg != null) {
    analysis.push(`You're ${show(Math.abs(sinceStartKg))} ${unit} ${sinceStartKg < 0 ? 'down' : 'up'} since your first weigh-in — a couple of weigh-ins next week will show the weekly trend too.`);
  }
  if (nutrition.loggedDays) analysis.push(`You ate about ${nutrition.avgKcal} kcal a day${kcalTarget ? ` against your ${kcalTarget} target` : ''}${nutrition.avgProtein != null ? `, with ${nutrition.avgProtein} g protein` : ''} across ${plural(nutrition.loggedDays, 'logged day')}.`);
  if (week.length) analysis.push(`You trained ${plural(week.length, 'time')}${gains.length ? `, and ${gains.length === 1 ? 'one lift hit' : `${gains.length} lifts hit`} a new best` : ''}.`);

  return {
    start: w.start, end: w.end, unit, goal: w.goal,
    training: { sessions: week.length, sets, gains },
    body: { avgKg, prevAvgKg, changeKg, sinceStartKg, daysSinceWeighIn, logs: thisW.length },
    nutrition, wins, focus: focus.slice(0, 2), analysis,
  };
}

// ── Loading one user's week ──────────────────────────────────────────────────

export function localDate(tz: string | null | undefined, now = new Date()): string {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); }
  catch { return now.toISOString().slice(0, 10); }
}

/** One user's week ending `end` (their local date, inclusive). */
export async function loadWeekInput(userId: string, end: string): Promise<WeekInput | null> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, unitPreference: true, coachGoal: true, savedProgram: true, coachProfile: true, dailyCalorieTarget: true, weightKg: true, currentStreak: true } });
  if (!u) return null;
  const start = addDays(end, -6);
  const [workouts, meals, weights, first] = await Promise.all([
    prisma.workoutLog.findMany({ where: { userId, date: { gte: addDays(start, -84), lte: end } }, select: { date: true, exercises: true } }),
    prisma.mealEntry.findMany({ where: { userId, date: { gte: start, lte: end } }, select: { date: true, calories: true, proteinG: true, nutrientsJson: true } }),
    prisma.bodyWeightLog.findMany({ where: { userId, date: { gte: addDays(end, -27), lte: end } }, select: { date: true, weightKg: true, weightLbs: true } }),
    prisma.bodyWeightLog.findFirst({ where: { userId }, orderBy: { date: 'asc' }, select: { date: true, weightKg: true, weightLbs: true } }),
  ]);
  const kgRow = (r: any) => { const kg = bodyWeightKg(r); return kg != null ? { date: String(r.date).slice(0, 10), kg } : null; };
  const targets = resolveTargets(u as any);
  let microTargets: MicroTarget[] = [];
  try {
    const { latestNutritionPlan } = await import('./nutritionPlanService.js');
    const plan: any = await latestNutritionPlan(userId).catch(() => null);
    microTargets = plan?.targets?.targets?.length ? plan.targets.targets : computeMicroTargets({} as any).targets;
  } catch { microTargets = computeMicroTargets({} as any).targets; }
  return {
    name: u.name, unit: normalizePreference(u.unitPreference), goal: inferGoalDirection(u.coachGoal), start, end,
    workouts: workouts.map((x) => { let ex: any[] = []; try { ex = JSON.parse(x.exercises ?? '[]'); } catch { /* skip */ } return { date: String(x.date).slice(0, 10), exercises: ex }; }),
    meals: meals.map((m) => ({ date: m.date, calories: m.calories, proteinG: m.proteinG, nutrientsJson: m.nutrientsJson })),
    weights: weights.map(kgRow).filter((x): x is { date: string; kg: number } => !!x),
    firstWeight: first ? kgRow(first) : null,
    targets, proteinTargetG: computeProteinTargetG(u.weightKg, u.coachGoal),
    microTargets, streak: u.currentStreak ?? 0,
  };
}
