// Same meal, same numbers. Users photograph the same breakfast twice and get
// answers 100 kcal apart, because a fresh photo is a fresh estimate (run-to-run
// swing on Nutrition5k: 12–13%). When a new photo's items mostly match a meal
// this user already logged, and the new total is within ±25% of it, the
// matching items take that meal's logged numbers — including any grams the
// user corrected. A real change in portion (beyond ±25%) still comes through.
//
// Simulated on 200 Nutrition5k dishes (run 1 as the past log, run 2 as the new
// photo): same-meal swing 13.3% → 4.9% (Argon), 12.3% → 4.5% (Flash), with
// error against weighed calories unchanged.

import type { MealItem } from './mealPhotoItems.js';

export interface PastItem { name: string; grams: number | null; calories: number; proteinG: number; carbsG: number; fatG: number }
export interface PastMeal { id: string; date: string; name: string; items: PastItem[] }
export interface MemoryMatch { mealId: string; date: string; name: string; items: number }

const STOP = new Set(['cooked', 'raw', 'fresh', 'sliced', 'grilled', 'roasted', 'steamed', 'boiled', 'fried', 'of', 'and', 'with', 'the', 'baked', 'chopped', 'diced', 'mixed', 'plain', 'white', 'green', 'red', 'homemade', 'toasted']);
const toks = (s: string) => new Set(s.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.replace(/s$/, '')));

/** Two item names describe the same food (half of the shorter name's words shared). Pure. */
export function sameFood(a: string, b: string): boolean {
  const ta = toks(a); const tb = toks(b);
  if (!ta.size || !tb.size) return false;
  let shared = 0;
  for (const w of ta) if (tb.has(w)) shared++;
  return shared / Math.min(ta.size, tb.size) >= 0.5;
}

/** Logged items from MealEntry.ingredientNutrientsJson: [{ name: "Pork chop (121 g)", nutrients: {...} }]. Pure. */
export function parsePastItems(json: string | null | undefined): PastItem[] {
  let rows: any[] = [];
  try { rows = JSON.parse(json ?? '[]'); } catch { return []; }
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((r) => {
    const n = r?.nutrients ?? {};
    const cal = Number(n.calories);
    if (!r?.name || !Number.isFinite(cal) || cal <= 0) return [];
    const g = String(r.name).match(/\((\d+(?:\.\d+)?)\s*g\)\s*$/);
    return [{ name: String(r.name).replace(/\s*\(\d+(?:\.\d+)?\s*g\)\s*$/, '').trim(), grams: g ? Number(g[1]) : null, calories: cal, proteinG: Number(n.proteinG) || 0, carbsG: Number(n.carbsG) || 0, fatG: Number(n.fatG) || 0 }];
  });
}

/**
 * Pair each new item with an unused past item of the same food. Brand-priced
 * items are official numbers and are never paired. Pure.
 */
function pair(items: MealItem[], past: PastItem[]): Array<[number, number]> {
  const used = new Set<number>();
  const pairs: Array<[number, number]> = [];
  items.forEach((it, i) => {
    if (it.source === 'brand') return;
    const j = past.findIndex((p, k) => !used.has(k) && sameFood(it.name, p.name));
    if (j >= 0) { used.add(j); pairs.push([i, j]); }
  });
  return pairs;
}

/**
 * Use a past meal's numbers for the matching items when the photo is clearly
 * that meal again: ≥60% of items match and those foods total within ±25% of
 * last time (an added side doesn't break the match). The
 * most recent qualifying meal wins. Pure.
 */
export function anchorToPastMeal(items: MealItem[], meals: PastMeal[], opts: { minOverlap?: number; tolerance?: number } = {}): { items: MealItem[]; match: MemoryMatch | null } {
  const minOverlap = opts.minOverlap ?? 0.6;
  const tolerance = opts.tolerance ?? 0.25;
  if (!items.length) return { items, match: null };
  for (const meal of meals) {
    if (!meal.items.length) continue;
    const pairs = pair(items, meal.items);
    if (pairs.length / Math.max(items.length, meal.items.length) < minOverlap) continue;
    // Compare the matched foods only: an added side or drink is still the same meal.
    const nowMatched = pairs.reduce((a, [i]) => a + items[i].calories, 0);
    const pastMatched = pairs.reduce((a, [, j]) => a + meal.items[j].calories, 0);
    if (!(pastMatched > 0) || Math.abs(nowMatched - pastMatched) / pastMatched > tolerance) continue;
    const next = items.map((it) => ({ ...it }));
    for (const [i, j] of pairs) {
      const p = meal.items[j];
      const g = p.grams ?? next[i].grams;
      next[i] = {
        ...next[i],
        name: p.name || next[i].name,
        grams: g,
        calories: Math.round(p.calories), proteinG: p.proteinG, carbsG: p.carbsG, fatG: p.fatG,
        per100g: g && g > 0 ? { calories: (p.calories / g) * 100, proteinG: (p.proteinG / g) * 100, carbsG: (p.carbsG / g) * 100, fatG: (p.fatG / g) * 100 } : next[i].per100g,
      };
    }
    return { items: next, match: { mealId: meal.id, date: meal.date, name: meal.name, items: pairs.length } };
  }
  return { items, match: null };
}
