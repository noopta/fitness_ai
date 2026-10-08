// Fuel's targets (v2 handoff N-07, N-08). One place that says what the user's
// daily targets are — the program's nutrition plan, else targets they set
// with the four questions, else a calorie number they typed — or that there
// are none yet. Never a made-up default: with nothing set, Fuel shows what
// was eaten without a goal.

import { PrismaClient } from '@prisma/client';
import { runNutritionEngine } from '../engine/nutritionEngine.js';

const prisma = new PrismaClient();

export interface Targets { calories: number; proteinG: number | null; carbsG: number | null; fatG: number | null; fiberG: number | null; source: 'plan' | 'quick' | 'manual' }

const num = (v: unknown): number | null => { const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN; return Number.isFinite(n) && n > 0 ? Math.round(n) : null; };
const parse = (raw: unknown) => { if (raw && typeof raw === 'object') return raw as any; if (typeof raw !== 'string' || !raw) return null; try { return JSON.parse(raw); } catch { return null; } };

/** Fiber: 14 g per 1,000 kcal (the usual adequate-intake rule). */
export const fiberFor = (kcal: number) => Math.round((kcal / 1000) * 14);

export function resolveTargets(u: { savedProgram?: unknown; coachProfile?: unknown; dailyCalorieTarget?: number | null }): Targets | null {
  const program = parse(u.savedProgram);
  const plan = program?.nutritionPlan ?? program?.nutrition ?? null;
  const m = plan?.macros ?? plan;
  const planKcal = num(m?.calories ?? plan?.calories);
  if (planKcal) {
    return {
      calories: planKcal,
      proteinG: num(m?.proteinG ?? m?.protein_g ?? m?.protein),
      carbsG: num(m?.carbsG ?? m?.carbs_g ?? m?.carbs),
      fatG: num(m?.fatG ?? m?.fat_g ?? m?.fat),
      fiberG: num(m?.fiberG ?? m?.fiber_g ?? m?.fiber) ?? fiberFor(planKcal),
      source: 'plan',
    };
  }
  const quick = parse(u.coachProfile)?.nutritionTargets;
  const qKcal = num(quick?.calories);
  // A typed calorie target overrides the quick one's calories; its macros still stand.
  const manual = num(u.dailyCalorieTarget);
  if (qKcal) return { calories: manual ?? qKcal, proteinG: num(quick.proteinG), carbsG: num(quick.carbsG), fatG: num(quick.fatG), fiberG: num(quick.fiberG) ?? fiberFor(manual ?? qKcal), source: manual && manual !== qKcal ? 'manual' : 'quick' };
  if (manual) return { calories: manual, proteinG: null, carbsG: null, fatG: null, fiberG: fiberFor(manual), source: 'manual' };
  return null;
}

export interface QuickAnswers { sex: 'male' | 'female' | 'unknown'; ageYears: number; heightCm: number; weightKg: number; goal: 'lose' | 'maintain' | 'gain' | 'strength'; trainingDaysPerWeek: number }

const GOAL_WORDS: Record<QuickAnswers['goal'], string> = { lose: 'fat loss', maintain: 'maintenance', gain: 'muscle gain', strength: 'strength' };

/** Targets from the four questions, through the same engine the coach uses. */
export function quickTargets(a: QuickAnswers): Omit<Targets, 'source'> {
  const out = runNutritionEngine({
    user: { weightKg: a.weightKg, heightCm: a.heightCm, ageYears: a.ageYears, sex: a.sex, trainingAge: null, bodyCompTag: null, goal: GOAL_WORDS[a.goal], primaryLift: null, trainingDaysPerWeek: a.trainingDaysPerWeek } as any,
    dailyMacros: [], mealTimings: [], wellnessPoints: [],
  });
  const t = out.targets;
  return { calories: Math.round(t.calories), proteinG: Math.round(t.proteinG), carbsG: Math.round(t.carbsG), fatG: Math.round(t.fatG), fiberG: fiberFor(t.calories) };
}

// ─── Range summary (N-09) ───────────────────────────────────────────────────

export interface MealRow { date: string; mealType: string | null; calories: number; proteinG: number; carbsG: number; fatG: number; fiberG: number | null }
const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;

/** Daily totals for every day in [start, end], averages over the days that were logged, and each meal slot's share. Pure. */
export function summarizeRange(rows: MealRow[], start: string, end: string) {
  const days: { date: string; logged: boolean; kcal: number; proteinG: number; carbsG: number; fatG: number; fiberG: number }[] = [];
  for (let d = new Date(`${start}T12:00:00Z`); d.toISOString().slice(0, 10) <= end && days.length < 366; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push({ date: d.toISOString().slice(0, 10), logged: false, kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 });
  }
  const at = new Map(days.map((x) => [x.date, x]));
  const slot = new Map<string, number>();
  for (const r of rows) {
    const day = at.get(r.date);
    if (!day) continue;
    day.logged = true;
    day.kcal += r.calories || 0; day.proteinG += r.proteinG || 0; day.carbsG += r.carbsG || 0; day.fatG += r.fatG || 0; day.fiberG += r.fiberG || 0;
    const k = (SLOTS as readonly string[]).includes(String(r.mealType).toLowerCase()) ? String(r.mealType).toLowerCase() : 'snack';
    slot.set(k, (slot.get(k) ?? 0) + (r.calories || 0));
  }
  const logged = days.filter((x) => x.logged);
  const n = Math.max(1, logged.length);
  const avg = (k: 'kcal' | 'proteinG' | 'carbsG' | 'fatG' | 'fiberG') => Math.round(logged.reduce((s, x) => s + x[k], 0) / n);
  const totalKcal = [...slot.values()].reduce((a, b) => a + b, 0);
  for (const x of days) { x.kcal = Math.round(x.kcal); x.proteinG = Math.round(x.proteinG); x.carbsG = Math.round(x.carbsG); x.fatG = Math.round(x.fatG); x.fiberG = Math.round(x.fiberG); }
  return {
    days,
    loggedDays: logged.length,
    avg: logged.length ? { kcal: avg('kcal'), proteinG: avg('proteinG'), carbsG: avg('carbsG'), fatG: avg('fatG'), fiberG: avg('fiberG') } : null,
    byMeal: SLOTS.map((k) => ({ mealType: k, avgKcal: Math.round((slot.get(k) ?? 0) / n), pct: totalKcal ? Math.round(((slot.get(k) ?? 0) / totalKcal) * 100) : 0 })),
  };
}

// ─── The user's own targets (no program nutrition plan) ─────────────────────

export interface TargetEdit { calories?: number; proteinG?: number; carbsG?: number; fatG?: number; fiberG?: number }

/**
 * Save targets for someone with no program nutrition plan (freestyle, or a
 * program without one) in coachProfile.nutritionTargets, with calories
 * mirrored to dailyCalorieTarget for the screens that read that. A calorie
 * change never waits on a program again.
 */
export async function setOwnTargets(userId: string, edit: TargetEdit, extra: Record<string, unknown> = {}) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { coachProfile: true, savedProgram: true, dailyCalorieTarget: true } });
  let blob: any = {};
  try { blob = u?.coachProfile ? JSON.parse(u.coachProfile) : {}; } catch { blob = {}; }
  // Start from what they see now, so changing one number keeps the others.
  const seen = resolveTargets(u ?? {});
  const clean = Object.fromEntries(Object.entries(edit).filter(([, v]) => typeof v === 'number' && Number.isFinite(v) && v >= 0).map(([k, v]) => [k, Math.round(v as number)]));
  // userSet: the user chose these, so a newly generated program keeps them (saveProgramForUser).
  const next: any = { ...(seen ? { calories: seen.calories, proteinG: seen.proteinG, carbsG: seen.carbsG, fatG: seen.fatG, fiberG: seen.fiberG } : {}), ...(blob.nutritionTargets ?? {}), ...clean, ...extra, userSet: true, setAt: new Date().toISOString() };
  if (!(Number(next.calories) > 0)) { const e: any = new Error('Set your calories first.'); e.status = 400; throw e; }
  if (clean.calories != null && clean.fiberG == null && extra.fiberG == null) next.fiberG = fiberFor(next.calories);
  blob.nutritionTargets = next;
  await prisma.user.update({ where: { id: userId }, data: { coachProfile: JSON.stringify(blob), dailyCalorieTarget: Math.round(next.calories) } });
  return { calories: next.calories, proteinG: next.proteinG ?? null, carbsG: next.carbsG ?? null, fatG: next.fatG ?? null, fiberG: next.fiberG ?? null };
}

/** Targets the user chose themselves (chat, Fuel, the four questions), or null. A new program keeps these. */
export function userSetTargets(coachProfile: unknown): { calories: number; proteinG?: number; carbsG?: number; fatG?: number } | null {
  const t = parse(coachProfile)?.nutritionTargets;
  return t?.userSet && num(t.calories) ? { calories: num(t.calories)!, ...(num(t.proteinG) ? { proteinG: num(t.proteinG)! } : {}), ...(num(t.carbsG) ? { carbsG: num(t.carbsG)! } : {}), ...(num(t.fatG) ? { fatG: num(t.fatG)! } : {}) } : null;
}

/** Record targets the user just chose on a program plan, so a later program keeps them. */
export async function rememberUserTargets(userId: string, macros: Record<string, number>) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { coachProfile: true } });
  const blob: any = parse(u?.coachProfile) ?? {};
  blob.nutritionTargets = { ...(blob.nutritionTargets ?? {}), ...macros, userSet: true, setAt: new Date().toISOString() };
  await prisma.user.update({ where: { id: userId }, data: { coachProfile: JSON.stringify(blob) } });
}
