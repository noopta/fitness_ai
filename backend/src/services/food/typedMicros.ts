// Typed meals get USDA micronutrients (Oct 2026). Before this, a typed or chat
// meal's micros were the model's own recall ("homemade noodles with chicken"
// got whatever it remembered), and a meal logged with the user's own macros
// got none at all — every micro saved as 0.
//
// The parser now lists the generic foods in the meal with a USDA-style name,
// grams and the calories it counted for each. Each food is matched against
// USDA's lab datasets (Foundation, SR Legacy, FNDDS — never Branded) with the
// same plausibility gate meal photos use (kcal per 100 g within 0.4–2.5× of
// the model's), and contributes
//
//     USDA nutrient per kcal × the calories counted for that food
//
// so micros always agree with the calories we log, and a wrong gram guess
// can't inflate them (the 9 Oct McDouble problem: grams guessed from a
// calorie share turned 840 mg of sodium into 2,461). Foods with no confident
// match — and branded items, which get their label's micros afterwards — keep
// the model's estimate for their share of the meal's calories.
//
// Sodium keeps the larger of the two: added salt has no calories, so the
// calorie share can't see it, and it's a limit — over beats under.

import { lookupUsdaFood, MICRO_KEYS, type MicroKey, type UsdaCandidate } from './usdaLookup.js';

export interface TypedFood {
  name: string;
  usdaQuery: string;
  preparation: string | null;
  grams: number;
  calories: number;
}

export interface UsdaFoodMicros {
  micros: Record<MicroKey, number>;
  /** Calories of the foods that matched USDA. */
  matchedKcal: number;
  matched: number;
  total: number;
  /** Which USDA entry each matched food used, for the receipt ("egg noodles → Noodles, egg, cooked"). */
  sources: { food: string; usda: string }[];
}

export const TYPED_USDA_MICROS = () => process.env.TYPED_USDA_MICROS !== '0';

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Pure: clean the parser's `foods` list (drop anything without grams and calories). */
export function coerceTypedFoods(raw: unknown): TypedFood[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((f: any) => ({
    name: String(f?.name ?? '').trim().slice(0, 80),
    usdaQuery: String(f?.usdaQuery ?? f?.name ?? '').trim().slice(0, 80),
    preparation: typeof f?.preparation === 'string' && f.preparation.trim() ? f.preparation.trim().slice(0, 30) : null,
    grams: Number(f?.grams),
    calories: Number(f?.calories),
  })).filter((f) => f.usdaQuery && f.grams > 0 && f.grams <= 2000 && f.calories > 0 && f.calories <= 3000).slice(0, 15);
}

export type FoodLookup = (query: string, preparation: string | null, modelPer100Kcal: number | null) => Promise<UsdaCandidate | null>;

/** Match each food to USDA (in parallel) and sum its micros by calorie density. */
export async function usdaFoodMicros(foods: TypedFood[], lookup: FoodLookup = (q, p, k) => lookupUsdaFood(q, p, k)): Promise<UsdaFoodMicros> {
  const micros = Object.fromEntries(MICRO_KEYS.map((k) => [k, 0])) as Record<MicroKey, number>;
  const matches = await Promise.all(foods.map((f) => lookup(f.usdaQuery, f.preparation, (f.calories * 100) / f.grams).catch(() => null)));
  let matchedKcal = 0;
  const sources: UsdaFoodMicros['sources'] = [];
  matches.forEach((m, i) => {
    if (!m || !(m.per100g.calories > 0)) return;
    const f = foods[i];
    for (const k of MICRO_KEYS) micros[k] += ((m.micros[k] ?? 0) / m.per100g.calories) * f.calories;
    matchedKcal += f.calories;
    sources.push({ food: f.name, usda: m.description });
  });
  return { micros, matchedKcal, matched: sources.length, total: foods.length, sources };
}

/**
 * Pure: the meal's micros — USDA for the matched foods' calories, the model's
 * estimate scaled to the rest. `model` is the whole-meal estimate.
 */
export function blendTypedMicros(model: Partial<Record<MicroKey, number>>, mealKcal: number, usda: UsdaFoodMicros): Record<MicroKey, number> {
  const share = mealKcal > 0 ? Math.min(1, usda.matchedKcal / mealKcal) : 0;
  const out = {} as Record<MicroKey, number>;
  for (const k of MICRO_KEYS) {
    const m = Number(model[k]) || 0;
    const v = usda.micros[k] + m * (1 - share);
    out[k] = r2(k === 'sodiumMg' ? Math.max(v, m) : v);
  }
  return out;
}

/** Pure: scale micros to a different calorie count (the user's own macros for the same meal). */
export function scaleMicros<T extends Partial<Record<string, number>>>(micros: T, fromKcal: number, toKcal: number): T {
  if (!(fromKcal > 0) || !(toKcal >= 0)) return micros;
  const f = toKcal / fromKcal;
  return Object.fromEntries(Object.entries(micros).map(([k, v]) => [k, typeof v === 'number' ? r2(v * f) : v])) as T;
}

/** Pure: write the micro keys into the open nutrient map (what the micros page reads). */
export function withMicrosInMap(map: Record<string, number> | undefined, micros: Record<MicroKey, number>): Record<string, number> {
  const out: Record<string, number> = { ...(map ?? {}) };
  for (const k of MICRO_KEYS) {
    if (micros[k] > 0) out[k] = micros[k];
    else delete out[k];
  }
  return out;
}
