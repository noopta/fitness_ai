// Nutrition the trainer can coach (handoff gap #7, MVP): daily macro targets
// the trainer sets, and a weekly compliance rollup read from what the client
// actually logged. Day totals are the client's MealEntry rows (the app's meal
// log), plus legacy NutritionLog day totals for days with no meal entries.

import { audit } from './drafts.js';
import { prisma } from './db.js';
import type { NutritionSummary, NutritionTargets } from './types.js';

const DAY_MS = 86_400_000;

export class NutritionError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'NutritionError';
    this.status = status;
  }
}

const LIMITS = { calories: [800, 7000], proteinG: [20, 450], carbsG: [0, 900], fatG: [10, 350] } as const;

export async function setTargets(practiceId: string, trainerId: string, clientId: string, body: Record<string, unknown>): Promise<NutritionTargets> {
  const data: Record<string, number | null> = {};
  for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
    const v = body[k];
    if (v === undefined) continue;
    if (v === null || v === '') { data[k] = null; continue; }
    const n = Number(v);
    if (!Number.isFinite(n) || n < lo || n > hi) throw new NutritionError(`${k} must be between ${lo} and ${hi}`, 400);
    data[k] = Math.round(n);
  }
  const row = await prisma.ptNutritionTarget.upsert({
    where: { practiceId_clientId: { practiceId, clientId } },
    update: { ...data, setById: trainerId },
    create: { practiceId, clientId, ...data, setById: trainerId },
  });
  await audit({ practiceId, trainerId, clientId, action: 'nutrition_targets_set', itemType: 'nutrition', itemId: row.id, meta: data });
  return { calories: row.calories, proteinG: row.proteinG, carbsG: row.carbsG, fatG: row.fatG };
}

export interface DayTotal { date: string; calories: number; proteinG: number; carbsG: number; fatG: number }

/** Day totals for one client over the trailing `days`, oldest first. Days with nothing logged are absent. */
export async function dayTotals(clientId: string, since: string): Promise<DayTotal[]> {
  if (clientId.startsWith('prospect:')) return [];
  const [meals, legacy] = await Promise.all([
    prisma.mealEntry.findMany({ where: { userId: clientId, date: { gte: since } }, select: { date: true, calories: true, proteinG: true, carbsG: true, fatG: true } }),
    prisma.nutritionLog.findMany({ where: { userId: clientId, date: { gte: since } }, select: { date: true, calories: true, proteinG: true, carbsG: true, fatG: true } }),
  ]);
  const by = new Map<string, DayTotal>();
  const add = (r: { date: string; calories: number; proteinG: number; carbsG: number; fatG: number }) => {
    const d = by.get(r.date) ?? { date: r.date, calories: 0, proteinG: 0, carbsG: 0, fatG: 0 };
    d.calories += r.calories || 0; d.proteinG += r.proteinG || 0; d.carbsG += r.carbsG || 0; d.fatG += r.fatG || 0;
    by.set(r.date, d);
  };
  meals.forEach(add);
  const mealDays = new Set(meals.map((m) => m.date));
  legacy.filter((l) => !mealDays.has(l.date)).forEach(add);
  return [...by.values()].sort((a, b) => a.date.localeCompare(b.date));
}

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);

/**
 * The weekly rollup a trainer reads: how many days were logged, the averages,
 * and how many logged days hit each target (calories within ±10%, protein at
 * 90% or more). Pure — exported for tests.
 */
export function rollup(days: DayTotal[], targets: NutritionTargets | null, windowDays: number) {
  const hitCalories = targets?.calories ? days.filter((d) => Math.abs(d.calories - targets.calories!) <= targets.calories! * 0.1).length : null;
  const hitProtein = targets?.proteinG ? days.filter((d) => d.proteinG >= targets.proteinG! * 0.9).length : null;
  return {
    windowDays,
    daysLogged: days.length,
    avgCalories: avg(days.map((d) => d.calories)),
    avgProteinG: avg(days.map((d) => d.proteinG)),
    avgCarbsG: avg(days.map((d) => d.carbsG)),
    avgFatG: avg(days.map((d) => d.fatG)),
    caloriesOnTarget: hitCalories,
    proteinOnTarget: hitProtein,
  };
}

/** One line a trainer can act on, from the rollup. Never advice; just what the log says. */
export function complianceLine(r: ReturnType<typeof rollup>, targets: NutritionTargets | null): string {
  if (r.daysLogged === 0) return `No food logged in the last ${r.windowDays} days.`;
  const parts = [`Logged ${r.daysLogged} of ${r.windowDays} days`];
  if (targets?.proteinG && r.proteinOnTarget != null) parts.push(`protein on target ${r.proteinOnTarget} of ${r.daysLogged}`);
  if (targets?.calories && r.caloriesOnTarget != null) parts.push(`calories within 10% on ${r.caloriesOnTarget}`);
  if (!targets?.calories && !targets?.proteinG && r.avgCalories != null) parts.push(`averaging ${r.avgCalories} kcal and ${r.avgProteinG} g protein`);
  return `${parts.join(', ')}.`;
}

/**
 * Patterns across the last four weeks worth a coaching conversation (gap #7,
 * V2). Each is a plain observation from the log; nothing is inferred about why.
 * Pure — exported for tests.
 */
export function nutritionPatterns(days: DayTotal[], targets: NutritionTargets | null): string[] {
  const out: string[] = [];
  if (days.length < 4) return out;
  if (targets?.proteinG) {
    const low = days.filter((d) => d.proteinG < targets.proteinG! * 0.8).length;
    if (low >= Math.ceil(days.length * 0.6)) out.push(`Protein under 80% of target on ${low} of ${days.length} logged days`);
  }
  if (targets?.calories) {
    const over = days.filter((d) => d.calories > targets.calories! * 1.1).length;
    const under = days.filter((d) => d.calories < targets.calories! * 0.8).length;
    if (over >= Math.ceil(days.length * 0.6)) out.push(`Calories more than 10% over target on ${over} of ${days.length} logged days`);
    if (under >= Math.ceil(days.length * 0.6)) out.push(`Calories well under target on ${under} of ${days.length} logged days`);
  }
  const weekend = days.filter((d) => [0, 6].includes(new Date(`${d.date}T12:00:00Z`).getUTCDay()));
  const weekday = days.filter((d) => ![0, 6].includes(new Date(`${d.date}T12:00:00Z`).getUTCDay()));
  if (weekend.length >= 2 && weekday.length >= 3) {
    const we = weekend.reduce((s, d) => s + d.calories, 0) / weekend.length;
    const wd = weekday.reduce((s, d) => s + d.calories, 0) / weekday.length;
    if (wd > 0 && we > wd * 1.25) out.push(`Weekends average ${Math.round(((we - wd) / wd) * 100)}% more calories than weekdays`);
  }
  return out;
}

export async function nutritionSummary(practiceId: string, clientId: string, now: Date = new Date()): Promise<NutritionSummary> {
  const since28 = new Date(now.getTime() - 27 * DAY_MS).toISOString().slice(0, 10);
  const since7 = new Date(now.getTime() - 6 * DAY_MS).toISOString().slice(0, 10);
  const [row, user, days] = await Promise.all([
    prisma.ptNutritionTarget.findUnique({ where: { practiceId_clientId: { practiceId, clientId } } }),
    clientId.startsWith('prospect:') ? null : prisma.user.findUnique({ where: { id: clientId }, select: { dailyCalorieTarget: true } }),
    dayTotals(clientId, since28),
  ]);
  const targets: NutritionTargets | null = row ? { calories: row.calories, proteinG: row.proteinG, carbsG: row.carbsG, fatG: row.fatG } : null;
  const week = rollup(days.filter((d) => d.date >= since7), targets, 7);
  return {
    targets,
    appCalorieTarget: user?.dailyCalorieTarget ?? null,
    week,
    month: rollup(days, targets, 28),
    line: complianceLine(week, targets),
    patterns: nutritionPatterns(days, targets),
    days: days.map((d) => ({ ...d, calories: Math.round(d.calories), proteinG: Math.round(d.proteinG), carbsG: Math.round(d.carbsG), fatG: Math.round(d.fatG) })),
  };
}

/** A link client logs food in their portal; it is an ordinary meal entry on their account. */
export async function logMealFromPortal(clientId: string, body: Record<string, unknown>, now: Date = new Date()) {
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
  if (!name) throw new NutritionError('Say what you ate', 400);
  const num = (v: unknown, max: number) => {
    if (v === undefined || v === null || v === '') return 0;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > max) throw new NutritionError('Numbers must be zero or more', 400);
    return n;
  };
  const date = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : now.toISOString().slice(0, 10);
  const mealType = ['breakfast', 'lunch', 'dinner', 'snack', 'meal'].includes(body.mealType as string) ? (body.mealType as string) : 'meal';
  await prisma.mealEntry.create({
    data: { userId: clientId, date, name, mealType, source: 'pt_portal', calories: num(body.calories, 5000), proteinG: num(body.proteinG, 400), carbsG: num(body.carbsG, 800), fatG: num(body.fatG, 300) },
  });
}
