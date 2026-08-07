// Nutrition window loader — the shared date-range read behind every ranged
// Nutrition Profile surface (Today / 7d / 30d) and the day-by-day trend.
//
// Before this existed, the profile routes each did their own single-day
// findMany and the trend route did its own ranged one, with two textually
// divergent copies of the meal→nutrient-map fallback. Everything now goes
// through loadWindow() so the two surfaces can never disagree about window
// bounds or about what "logged" means.
//
// The central rule: the engine's targets are DAILY (nutritionProfileEngine's
// effectiveTarget), so a multi-day window is AVERAGED across its logged days,
// never summed. See averageNutrientMaps for why.

import { PrismaClient } from '@prisma/client';
import { NUTRIENTS, getNutrient } from '../engine/nutrientRegistry.js';
import { averageNutrientMaps, effectiveTarget, sumNutrientMaps } from '../engine/nutritionProfileEngine.js';
import { parseJsonObject } from './nutritionShared.js';

const prisma = new PrismaClient();

export type ProfileRange = 'today' | '7d' | '30d';

// Days per range. `today` is a 1-day window so every caller can use one path.
const RANGE_DAYS: Record<ProfileRange, number> = { today: 1, '7d': 7, '30d': 30 };

// A logged day under this many kcal is counted as "lightly logged" — a black
// coffee is a real MealEntry row but it is not a day's eating. It still counts
// as logged (so our day count matches the trend chart's) and still averages in;
// partialDays just lets the client caption the dilution honestly.
export const PARTIAL_DAY_KCAL_FLOOR = 400;

// Anything unrecognized falls back to `today` rather than 400 — this is a
// read-only screen and old clients don't send the param at all.
export function parseRange(raw: unknown): ProfileRange {
  return raw === '7d' || raw === '30d' || raw === 'today' ? raw : 'today';
}
export function daysForRange(range: ProfileRange): number { return RANGE_DAYS[range]; }

// Date-string arithmetic anchored at UTC noon so no offset/DST shift can roll
// the calendar day over. (Same helpers the profile route has always used.)
export function addDaysStr(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
export function dateRange(startStr: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => addDaysStr(startStr, i));
}

// The columns the window path actually reads. Deliberately narrower than the
// day path's select — ingredientsJson/ingredientNutrientsJson are large blobs
// that only the single-day `meals` list needs.
const WINDOW_SELECT = {
  date: true, calories: true,
  proteinG: true, carbsG: true, fatG: true,
  nutrientMapJson: true, nutrientsJson: true,
} as const;

export type WindowMealRow = {
  date: string;
  calories: number;
  proteinG?: number | null;
  carbsG?: number | null;
  fatG?: number | null;
  nutrientMapJson?: string | null;
  nutrientsJson?: string | null;
};

// One meal row → its open nutrient map. Pre-migration entries have no
// nutrientMapJson, so synthesize from macros + the legacy structured micros;
// otherwise historical days would profile as empty (spec §7 "resolving").
export function mealRowToNutrientMap(m: WindowMealRow): Record<string, number> {
  const open = parseJsonObject<Record<string, number>>(m.nutrientMapJson);
  if (open && Object.keys(open).length > 0) return open;

  const micros = parseJsonObject<Record<string, number>>(m.nutrientsJson) ?? {};
  const synth: Record<string, number> = {};
  if (m.proteinG) synth.proteinG = m.proteinG;
  if (m.carbsG) synth.carbsG = m.carbsG;
  if (m.fatG) synth.fatG = m.fatG;
  for (const [k, v] of Object.entries(micros)) if (typeof v === 'number' && v) synth[k] = v;
  return synth;
}

export function groupMealsByDate<T extends { date: string }>(rows: T[]): Map<string, T[]> {
  const byDate = new Map<string, T[]>();
  for (const row of rows) {
    const arr = byDate.get(row.date) ?? [];
    arr.push(row);
    byDate.set(row.date, arr);
  }
  return byDate;
}

export interface WindowDay {
  date: string;
  logged: boolean;
  mealCount: number;
  kcal: number;
}

export interface NutritionWindow {
  range: ProfileRange;
  windowDays: number;
  startDate: string;
  endDate: string;
  bodyweightKg: number | null;
  /** Per-day summed totals, logged days only. */
  dayTotals: Map<string, Record<string, number>>;
  /** Mean daily intake across logged days — what the engine gets fed. */
  avgTotals: Record<string, number>;
  loggedDays: number;
  partialDays: number;
  mealCount: number;
  /** Per ceiling nutrient, how many logged days went over its daily target. */
  daysOverCeiling: Record<string, number>;
  days: WindowDay[];
}

const CEILING_KEYS = NUTRIENTS
  .filter(n => n.drives.some(d => d.direction === 'ceiling'))
  .map(n => n.key);

// Load a window ending at `endDate` (inclusive), `days` long, in ONE query.
//
// `preloadedRows` lets the today path hand over the rows it already fetched for
// the meals list — the wide per-meal select is a superset of ours, so re-querying
// would just double the work on the hottest path.
export async function loadWindow(
  userId: string,
  endDate: string,
  range: ProfileRange,
  preloadedRows?: WindowMealRow[],
): Promise<NutritionWindow> {
  const windowDays = daysForRange(range);
  const startDate = addDaysStr(endDate, -(windowDays - 1));

  const [user, meals] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { weightKg: true } }),
    preloadedRows ?? prisma.mealEntry.findMany({
      where: { userId, date: { gte: startDate, lte: endDate } },
      select: WINDOW_SELECT,
      orderBy: { date: 'asc' },
    }),
  ]);
  const bodyweightKg = user?.weightKg ?? null;

  // For a single-day window the query has already constrained every row to
  // `endDate`, so attribute them directly rather than re-deriving the day from
  // the column — same result, one less thing that can disagree with the where
  // clause. Multi-day windows genuinely need the per-row date to group.
  const rows = meals as unknown as WindowMealRow[];
  const byDate = windowDays === 1
    ? new Map(rows.length > 0 ? [[endDate, rows]] : [])
    : groupMealsByDate(rows);

  const dayTotals = new Map<string, Record<string, number>>();
  const days: WindowDay[] = [];
  const daysOverCeiling: Record<string, number> = {};
  for (const key of CEILING_KEYS) daysOverCeiling[key] = 0;

  // Walk the FULL calendar window, not just dates that happen to have meals —
  // unlogged days have to stay visible as gaps rather than collapsing out.
  for (const date of dateRange(startDate, windowDays)) {
    const dayMeals = byDate.get(date);
    if (!dayMeals || dayMeals.length === 0) {
      days.push({ date, logged: false, mealCount: 0, kcal: 0 });
      continue;
    }
    const totals = sumNutrientMaps(
      dayMeals.map(mealRowToNutrientMap),
      dayMeals.map(m => m.calories),
    );
    dayTotals.set(date, totals);
    days.push({
      date,
      logged: true,
      mealCount: dayMeals.length,
      kcal: Math.round(totals.calories ?? 0),
    });

    // Ceiling nutrients are exposure, not a mean: averaging 4600 mg sodium
    // against a 0 mg day reads as a clean pass. Count the spikes per day here
    // so the detail screens can surface them alongside the average.
    for (const key of CEILING_KEYS) {
      const def = getNutrient(key);
      if (!def) continue;
      if ((totals[key] ?? 0) > effectiveTarget(def, bodyweightKg)) daysOverCeiling[key] += 1;
    }
  }

  const loggedDayTotals = [...dayTotals.values()];
  const partialDays = days.filter(d => d.logged && d.kcal < PARTIAL_DAY_KCAL_FLOOR).length;

  return {
    range,
    windowDays,
    startDate,
    endDate,
    bodyweightKg,
    dayTotals,
    avgTotals: averageNutrientMaps(loggedDayTotals),
    loggedDays: loggedDayTotals.length,
    partialDays,
    mealCount: meals.length,
    daysOverCeiling,
    days,
  };
}

// Human phrase for the period, used in narration prompts, deterministic
// fallback copy, and the server-built effect summary. Never says "today"
// unless the range really is today.
export function periodLabelFor(range: ProfileRange, loggedDays: number): string {
  if (range === 'today') return 'today';
  const span = range === '7d' ? 'last 7 days' : 'last 30 days';
  return `an average day across ${loggedDays} logged day${loggedDays === 1 ? '' : 's'} in the ${span}`;
}

// Short form for sentences that need to end cleanly ("… scored 62 of 100 on a
// typical day."). The long form above is for the narration DATA block.
export function periodSuffixFor(range: ProfileRange): string {
  return range === 'today' ? 'today' : 'on a typical day';
}
