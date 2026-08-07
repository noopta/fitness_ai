// Canonical "what's left in the day" read — the single source of truth for
// remaining macros AND micros.
//
// Before this existed the number was computed in three places that could
// disagree: the mobile Nutrition tab reduced macros client-side, the profile
// recommendation engine derived micro gaps server-side, and
// POST /nutrition/suggest-meals accepted `remaining` FROM THE REQUEST BODY —
// i.e. the server trusted numbers it should own. Everything that needs "what's
// left" now goes through remainingForDay().
//
// Split in two on purpose, mirroring the diagnostic/profile engines: the math
// is a pure function over already-loaded inputs (fully unit-testable, no
// Prisma), and a thin async loader does the I/O.

import { PrismaClient } from '@prisma/client';
import { NUTRIENTS, getNutrient } from '../engine/nutrientRegistry.js';
import {
  effectiveTarget,
  runNutritionProfileEngine,
  type NutrientCoverage,
} from '../engine/nutritionProfileEngine.js';
import { loadWindow, type NutritionWindow } from './nutritionWindow.js';
import { parseJsonObject } from './nutritionShared.js';

const prisma = new PrismaClient();

export type MacroKey = 'kcal' | 'proteinG' | 'carbsG' | 'fatG';

export const MACRO_KEYS: MacroKey[] = ['kcal', 'proteinG', 'carbsG', 'fatG'];

export const MACRO_LABELS: Record<MacroKey, string> = {
  kcal: 'Calories',
  proteinG: 'Protein',
  carbsG: 'Carbs',
  fatG: 'Fat',
};

export interface MacroRemaining {
  key: MacroKey;
  label: string;
  unit: 'kcal' | 'g';
  target: number;
  intake: number;
  /** Never negative — "how much is still owed", not the signed delta. */
  remaining: number;
  /** Signed: positive means over target. Kept separate so callers can say "over". */
  over: number;
  /** 0..1 fraction of target already eaten (uncapped so >1 is visible). */
  fillFrac: number;
  /** 0..1 shortfall. clamp01(1 - fillFrac). The ranker's weight input. */
  short: number;
}

export interface MicroRemaining {
  key: string;
  label: string;
  unit: string;
  intake: number;
  target: number;
  /** Floor nutrients: units still needed. Ceilings: 0 (use headroom instead). */
  remaining: number;
  /** Ceiling nutrients: units still affordable before breaching the cap. */
  headroom: number;
  /** 0..1 shortfall for floors; always 0 for ceilings. */
  short: number;
  ceiling: boolean;
  /** In the user's ranked focus list from their generated nutrition plan. */
  focus: boolean;
  /** Logged days in the trailing 7 that finished under target. 0..7. */
  daysBelowTarget7d: number;
}

export interface DayRemaining {
  date: string;
  /** False when the user has no generated program — macro targets are fallbacks. */
  hasPlan: boolean;
  mealsLogged: number;
  bodyweightKg: number | null;
  /** Workout kcal added back into the calorie target (0 when the setting is off). */
  workoutBurnKcal: number;
  macros: Record<MacroKey, MacroRemaining>;
  micros: MicroRemaining[];
}

// ---------------------------------------------------------------------------
// Pure core
// ---------------------------------------------------------------------------

export interface DayRemainingInput {
  date: string;
  /** Today's summed nutrient map, `calories` included (see sumNutrientMaps). */
  todayTotals: Record<string, number>;
  /** Per-day totals for the trailing 7 days, logged days only. */
  weekDayTotals: Record<string, number>[];
  bodyweightKg: number | null;
  mealsLogged: number;
  /** Parsed savedProgram.nutritionPlan.macros, or null when there's no program. */
  planMacros: PlanMacros | null;
  /** User.dailyCalorieTarget override. Wins over the plan's calorie figure. */
  dailyCalorieTarget?: number | null;
  /** Already-gated by subtractWorkoutBurnFromCalories; pass 0 when off. */
  workoutBurnKcal?: number;
  /** focus[] from the user's latest NutritionPlan micro targets. */
  focusKeys?: string[];
}

export interface PlanMacros {
  calories?: number | null;
  proteinG?: number | null;
  carbsG?: number | null;
  fatG?: number | null;
}

// Fallback macro targets for users with no generated program. Deliberately
// conservative: enough to make the ranker behave sanely, not a coaching claim.
// Protein leans on the registry's per-kg floor so it still scales with the user.
const FALLBACK_KCAL = 2000;
const FALLBACK_CARB_FRACTION = 0.45;
const FALLBACK_FAT_FRACTION = 0.28;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The saved program is written by an LLM and has drifted across versions, so
 * accept the aliases the mobile client already tolerates rather than reading
 * `proteinG` and silently getting a 0 target. `NutritionScreen.tsx` does the
 * same `proteinG ?? protein_g ?? protein` dance — this is the server-side twin.
 */
export function normalizePlanMacros(raw: unknown): PlanMacros | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const num = (...keys: string[]): number | null => {
    for (const k of keys) {
      const v = m[k];
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
    }
    return null;
  };
  const macros: PlanMacros = {
    calories: num('calories', 'kcal', 'calorieTarget'),
    proteinG: num('proteinG', 'protein_g', 'protein'),
    carbsG: num('carbsG', 'carbs_g', 'carbs', 'carbohydratesG'),
    fatG: num('fatG', 'fat_g', 'fat'),
  };
  const anyPresent = MACRO_KEYS.some(k => macros[k === 'kcal' ? 'calories' : k] != null);
  return anyPresent ? macros : null;
}

/** Pull savedProgram (a JSON string on User) down to its macros block. */
export function planMacrosFromSavedProgram(savedProgram: string | null): PlanMacros | null {
  if (!savedProgram) return null;
  try {
    const program = JSON.parse(savedProgram);
    return normalizePlanMacros(program?.nutritionPlan?.macros);
  } catch {
    return null;
  }
}

function macroRemaining(
  key: MacroKey,
  target: number,
  intake: number,
): MacroRemaining {
  const safeTarget = target > 0 ? target : 0;
  const fillFrac = safeTarget > 0 ? intake / safeTarget : 0;
  return {
    key,
    label: MACRO_LABELS[key],
    unit: key === 'kcal' ? 'kcal' : 'g',
    target: Math.round(safeTarget),
    intake: Math.round(intake),
    remaining: Math.max(0, Math.round(safeTarget - intake)),
    over: Math.round(intake - safeTarget),
    fillFrac: round1(fillFrac * 100) / 100,
    // No target means no claim to make — a 0 target must not read as "100%
    // short", which would let the ranker chase a number nobody set.
    short: safeTarget > 0 ? clamp01(1 - fillFrac) : 0,
  };
}

/**
 * Resolve macro targets. Precedence, highest first:
 *   1. User.dailyCalorieTarget (an explicit user override) — calories only
 *   2. The saved program's nutritionPlan.macros — the coached numbers
 *   3. Conservative fallbacks
 * Workout burn is added to the calorie target when the caller passes it, which
 * mirrors what the Nutrition tab shows.
 */
export function resolveMacroTargets(input: DayRemainingInput): Record<MacroKey, number> {
  const plan = input.planMacros;
  const bw = input.bodyweightKg;

  const kcalBase =
    (typeof input.dailyCalorieTarget === 'number' && input.dailyCalorieTarget > 0
      ? input.dailyCalorieTarget
      : null) ??
    (plan?.calories && plan.calories > 0 ? plan.calories : null) ??
    FALLBACK_KCAL;

  const kcal = kcalBase + (input.workoutBurnKcal ?? 0);

  // Protein: the plan's number is the user's actual coached target, so it wins
  // over the registry's max(130, 1.6×kg). The registry is the fallback only.
  const proteinDef = getNutrient('proteinG');
  const proteinFallback = proteinDef ? effectiveTarget(proteinDef, bw) : 130;
  const proteinG = plan?.proteinG && plan.proteinG > 0 ? plan.proteinG : proteinFallback;

  const carbsG =
    plan?.carbsG && plan.carbsG > 0
      ? plan.carbsG
      : Math.round((kcal * FALLBACK_CARB_FRACTION) / 4);
  const fatG =
    plan?.fatG && plan.fatG > 0
      ? plan.fatG
      : Math.round((kcal * FALLBACK_FAT_FRACTION) / 9);

  return { kcal, proteinG, carbsG, fatG };
}

/**
 * Count, per floor nutrient, how many LOGGED days in the window finished under
 * target. This is what separates "short on iron today" from "short on iron all
 * week" — the ranker weights the latter far more heavily, because a one-day dip
 * is noise and a seven-day pattern is a real deficit.
 */
export function countDaysBelowTarget(
  weekDayTotals: Record<string, number>[],
  bodyweightKg: number | null,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const def of NUTRIENTS) {
    if (def.drives.some(d => d.direction === 'ceiling')) continue;
    const target = effectiveTarget(def, bodyweightKg);
    if (target <= 0) continue;
    counts[def.key] = weekDayTotals.filter(day => (day[def.key] ?? 0) < target).length;
  }
  return counts;
}

export function computeDayRemaining(input: DayRemainingInput): DayRemaining {
  const targets = resolveMacroTargets(input);
  const totals = input.todayTotals;

  const macros = {
    kcal: macroRemaining('kcal', targets.kcal, totals.calories ?? 0),
    proteinG: macroRemaining('proteinG', targets.proteinG, totals.proteinG ?? 0),
    carbsG: macroRemaining('carbsG', targets.carbsG, totals.carbsG ?? 0),
    fatG: macroRemaining('fatG', targets.fatG, totals.fatG ?? 0),
  } satisfies Record<MacroKey, MacroRemaining>;

  // Reuse the profile engine for coverage so the per-nutrient targets, ceiling
  // detection, and per-kg scaling can never drift from the Nutrition Profile
  // screens. We only add the remaining/short/focus/persistence fields on top.
  const { coverage } = runNutritionProfileEngine({
    totals,
    bodyweightKg: input.bodyweightKg,
  });

  const belowCounts = countDaysBelowTarget(input.weekDayTotals, input.bodyweightKg);
  const focusSet = new Set(input.focusKeys ?? []);

  const micros: MicroRemaining[] = coverage.map((cov: NutrientCoverage) => {
    const remaining = cov.ceiling ? 0 : Math.max(0, cov.target - cov.amount);
    const headroom = cov.ceiling ? Math.max(0, cov.target - cov.amount) : 0;
    const short = cov.ceiling || cov.target <= 0 ? 0 : clamp01(1 - cov.amount / cov.target);
    return {
      key: cov.key,
      label: cov.label,
      unit: cov.unit,
      intake: cov.amount,
      target: cov.target,
      remaining: round1(remaining),
      headroom: round1(headroom),
      short: Math.round(short * 1000) / 1000,
      ceiling: cov.ceiling,
      focus: focusSet.has(cov.key),
      daysBelowTarget7d: belowCounts[cov.key] ?? 0,
    };
  });

  return {
    date: input.date,
    hasPlan: input.planMacros != null,
    mealsLogged: input.mealsLogged,
    bodyweightKg: input.bodyweightKg,
    workoutBurnKcal: input.workoutBurnKcal ?? 0,
    macros,
    micros,
  };
}

// ---------------------------------------------------------------------------
// Async loader
// ---------------------------------------------------------------------------

/**
 * The user's ranked focus nutrients from their latest generated plan.
 *
 * Read straight off the row rather than via nutritionPlanService.latestNutritionPlan:
 * that module pulls in chatClient and ragService, both of which construct OpenAI
 * clients at import time and throw without a key. Importing it here would make
 * every consumer of this file — including the pure ranker's tests — heavy to
 * test. Same reasoning that produced nutritionShared.ts.
 */
async function focusKeysFor(userId: string): Promise<string[]> {
  const row = await prisma.nutritionPlan.findFirst({
    where: { userId },
    orderBy: { generatedAt: 'desc' },
    select: { microTargetsJson: true },
  });
  if (!row) return [];
  const parsed = parseJsonObject<{ focus?: unknown }>(row.microTargetsJson);
  const focus = parsed?.focus;
  return Array.isArray(focus) ? focus.filter((k): k is string => typeof k === 'string') : [];
}

/** Logged workout burn for the day. Returns 0 unless the user opted in. */
async function workoutBurnFor(
  userId: string,
  date: string,
  enabled: boolean,
): Promise<number> {
  if (!enabled) return 0;
  const logs = await prisma.workoutLog.findMany({
    where: { userId, date },
    select: { caloriesBurnedKcal: true },
  });
  return logs.reduce((sum, l) => sum + (l.caloriesBurnedKcal ?? 0), 0);
}

/**
 * Load everything the day-gap needs and compute it.
 *
 * Two windows are read: `today` for intake and `7d` for the persistence signal.
 * The today window is passed through so callers that already hold it (the
 * profile route does) can avoid the duplicate query.
 */
export async function remainingForDay(
  userId: string,
  date: string,
  opts: { todayWindow?: NutritionWindow } = {},
): Promise<DayRemaining> {
  const [user, todayWindow, weekWindow] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        savedProgram: true,
        dailyCalorieTarget: true,
        subtractWorkoutBurnFromCalories: true,
      },
    }),
    opts.todayWindow ?? loadWindow(userId, date, 'today'),
    loadWindow(userId, date, '7d'),
  ]);

  // Both best-effort — a user with no generated nutrition plan still gets
  // macro-led recommendations, just without focus weighting.
  const [focusKeys, workoutBurnKcal] = await Promise.all([
    focusKeysFor(userId).catch(() => [] as string[]),
    workoutBurnFor(userId, date, user?.subtractWorkoutBurnFromCalories ?? false),
  ]);

  return computeDayRemaining({
    date,
    todayTotals: todayWindow.dayTotals.get(date) ?? {},
    weekDayTotals: [...weekWindow.dayTotals.values()],
    bodyweightKg: todayWindow.bodyweightKg,
    mealsLogged: todayWindow.mealCount,
    planMacros: planMacrosFromSavedProgram(user?.savedProgram ?? null),
    dailyCalorieTarget: user?.dailyCalorieTarget ?? null,
    workoutBurnKcal,
    focusKeys,
  });
}
