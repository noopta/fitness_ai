// Meal-photo v2: turn the model's item list into priced MealItems.
//
// Per item: USDA per-100 g profile × grams when there's a confident match,
// otherwise the model's own numbers (Atwater-reconciled). Meal totals are the
// sum of items — never a number the model wrote.

import type { RawPhotoItem } from './mealPhotoSchema.js';
import { lookupUsdaFood, MICRO_KEYS, type MicroKey, type Per100g, type UsdaCandidate } from './usdaLookup.js';

export interface MealItem {
  id: string;
  name: string;
  preparation: string | null;
  grams: number | null;
  visibility: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  per100g: Per100g | null;
  source: 'usda' | 'model';
}

export interface MealTotals {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Allowed disagreement between stated kcal and 4P+4C+9F before macros win. */
export const ATWATER_TOLERANCE = 0.15;

/**
 * 4/4/9 sanity check for model-sourced numbers. Vision models get the macro
 * split roughly right more often than they add it up right, so when the
 * stated calories are more than 15% off the Atwater sum, trust the macros.
 * All-zero macros leave the calories alone (nothing better to go on).
 */
export function reconcileAtwater(m: MealTotals): { calories: number; reconciled: boolean } {
  const atwater = 4 * m.proteinG + 4 * m.carbsG + 9 * m.fatG;
  if (!(atwater > 0)) return { calories: m.calories, reconciled: false };
  if (Math.abs(m.calories - atwater) / atwater > ATWATER_TOLERANCE) {
    return { calories: atwater, reconciled: true };
  }
  return { calories: m.calories, reconciled: false };
}

export function itemId(prefix: string, index: number): string {
  return `${prefix}-${index}`;
}

/** Model-sourced item: reconciled numbers, per-100 g only when grams are known. */
export function modelItem(raw: RawPhotoItem, id: string): MealItem {
  const { calories } = reconcileAtwater(raw);
  const g = raw.grams;
  const per = (v: number) => (g ? r1((v * 100) / g) : 0);
  return {
    id,
    name: raw.name,
    preparation: raw.preparation,
    grams: g != null ? r0(g) : null,
    visibility: raw.visibility,
    calories: r0(calories),
    proteinG: r1(raw.proteinG),
    carbsG: r1(raw.carbsG),
    fatG: r1(raw.fatG),
    per100g: g ? { calories: per(calories), proteinG: per(raw.proteinG), carbsG: per(raw.carbsG), fatG: per(raw.fatG) } : null,
    source: 'model',
  };
}

/** USDA-sourced item: grams × per-100 g. */
export function usdaItem(raw: RawPhotoItem, id: string, grams: number, match: UsdaCandidate): MealItem {
  const f = grams / 100;
  const p = match.per100g;
  return {
    id,
    name: raw.name,
    preparation: raw.preparation,
    grams: r0(grams),
    visibility: raw.visibility,
    calories: r0(p.calories * f),
    proteinG: r1(p.proteinG * f),
    carbsG: r1(p.carbsG * f),
    fatG: r1(p.fatG * f),
    per100g: { calories: r1(p.calories), proteinG: r1(p.proteinG), carbsG: r1(p.carbsG), fatG: r1(p.fatG) },
    source: 'usda',
  };
}

export function sumItems(items: Array<Pick<MealItem, 'calories' | 'proteinG' | 'carbsG' | 'fatG'>>): MealTotals {
  const t = items.reduce(
    (acc, it) => ({
      calories: acc.calories + it.calories,
      proteinG: acc.proteinG + it.proteinG,
      carbsG: acc.carbsG + it.carbsG,
      fatG: acc.fatG + it.fatG,
    }),
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );
  return { calories: r0(t.calories), proteinG: r1(t.proteinG), carbsG: r1(t.carbsG), fatG: r1(t.fatG) };
}

export interface ResolvedItems {
  items: MealItem[];
  usdaHits: number;
  /** Summed USDA micros of the matched items, for the legacy `nutrients` blend. */
  usdaMicros: { micros: Record<MicroKey, number>; matched: number; total: number };
}

export type ItemLookup = (query: string, preparation: string | null, modelPer100Kcal: number | null) => Promise<UsdaCandidate | null>;

/**
 * Price every item, lookups in parallel. Items without grams skip USDA (a
 * per-100 g profile can't be applied to an unknown weight). Any lookup
 * failure degrades that one item to the model's numbers.
 */
export async function resolveItems(
  raw: RawPhotoItem[],
  idPrefix: string,
  lookup: ItemLookup = (q, p, k) => lookupUsdaFood(q, p, k),
): Promise<ResolvedItems> {
  const matches = await Promise.all(
    raw.map(async (it) => {
      if (!it.grams) return null;
      const modelPer100 = it.calories > 0 ? (reconcileAtwater(it).calories * 100) / it.grams : null;
      try {
        return await lookup(it.usdaQuery, it.preparation, modelPer100);
      } catch {
        return null;
      }
    }),
  );

  const micros = {} as Record<MicroKey, number>;
  for (const k of MICRO_KEYS) micros[k] = 0;
  let usdaHits = 0;

  const items = raw.map((it, i) => {
    const id = itemId(idPrefix, i);
    const m = matches[i];
    if (m && it.grams) {
      usdaHits += 1;
      const f = it.grams / 100;
      for (const k of MICRO_KEYS) micros[k] += (m.micros[k] ?? 0) * f;
      return usdaItem(it, id, it.grams, m);
    }
    return modelItem(it, id);
  });

  return { items, usdaHits, usdaMicros: { micros, matched: usdaHits, total: raw.length } };
}

/** Flag-off shim: the whole legacy meal as one item, so v2 clients render. */
export function mealLevelItem(name: string, totals: MealTotals, id: string): MealItem {
  return {
    id,
    name,
    preparation: null,
    grams: null,
    visibility: 'full',
    calories: r0(totals.calories),
    proteinG: r1(totals.proteinG),
    carbsG: r1(totals.carbsG),
    fatG: r1(totals.fatG),
    per100g: null,
    source: 'model',
  };
}
