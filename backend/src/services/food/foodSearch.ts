// Food search (RN spec bug fixes, 5 Oct 2026 — 4a). One ranked list for the
// search-first logging page: the user's own foods first, then their recipes,
// then USDA. Pure — the route loads rows and calls USDA; this shapes them.

import type { UsdaCandidate } from './usdaLookup.js';

export type FoodScope = 'all' | 'mine' | 'recipes';

export interface Macros { calories: number; proteinG: number; carbsG: number; fatG: number }

export interface FoodResult {
  kind: 'mine' | 'recipe' | 'usda';
  id: string;
  name: string;
  /** "Yours · logged 6 times", "Your recipe", "USDA · per 100 g". */
  caption: string;
  /** kcal for the default portion. */
  kcal: number;
  /** The default portion: grams when the food scales by weight, else one serving. */
  portion: { grams: number | null; label: string };
  /** Macros for the default portion. */
  macros: Macros;
  /** Per-100 g macros when the food scales by weight (USDA). */
  per100g: Macros | null;
  /** Micronutrients for the default portion (keys as Micronutrients). */
  nutrients: Record<string, number> | null;
}

export interface SavedFoodRow { id: string; name: string; calories: number; proteinG: number; carbsG: number; fatG: number; nutrientsJson: string | null; useCount: number; updatedAt: Date }
export interface RecipeRow { id: string; name: string; calories: number; proteinG: number; carbsG: number; fatG: number; nutrientsJson: string | null; useCount: number; servings: number; updatedAt: Date }

const r1 = (n: number) => Math.round(n * 10) / 10;
const parse = (s: string | null): Record<string, number> | null => {
  if (!s) return null;
  try {
    const o = JSON.parse(s);
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(o ?? {})) { const n = Number(v); if (Number.isFinite(n)) out[k] = n; }
    return Object.keys(out).length ? out : null;
  } catch { return null; }
};
const macrosOf = (r: Macros): Macros => ({ calories: Math.round(r.calories), proteinG: r1(r.proteinG), carbsG: r1(r.carbsG), fatG: r1(r.fatG) });

/** "Chicken, broiler or fryers, breast, skinless, boneless, meat only, cooked, braised" → "Chicken breast, cooked". */
export function usdaName(description: string): string {
  const parts = description.split(',').map((p) => p.trim()).filter(Boolean);
  const skip = /^(broilers? or fryers?|meat only|skinless|boneless|raw|ns as to .*|nfs|includes .*|with added .*|without .*)$/i;
  const head = parts[0] ?? description;
  const cut = parts.slice(1).find((p) => !skip.test(p) && !/^(cooked|braised|roasted|grilled|boiled|baked|fried|steamed)$/i.test(p));
  // The last preparation word is the most specific ("cooked, roasted" → roasted).
  const prep = [...parts].reverse().find((p) => /^(raw|cooked|braised|roasted|grilled|boiled|baked|fried|steamed)$/i.test(p));
  const name = [head, cut].filter(Boolean).join(' ').toLowerCase();
  const out = `${name.charAt(0).toUpperCase()}${name.slice(1)}${prep ? `, ${prep.toLowerCase()}` : ''}`;
  return out.length > 60 ? `${out.slice(0, 59).trim()}…` : out;
}

export function mineResult(f: SavedFoodRow): FoodResult {
  return {
    kind: 'mine', id: f.id, name: f.name,
    caption: `Yours · logged ${f.useCount} ${f.useCount === 1 ? 'time' : 'times'}`,
    kcal: Math.round(f.calories), portion: { grams: null, label: '1 serving' },
    macros: macrosOf(f), per100g: null, nutrients: parse(f.nutrientsJson),
  };
}

export function recipeResult(r: RecipeRow): FoodResult {
  return {
    kind: 'recipe', id: r.id, name: r.name, caption: 'Your recipe',
    kcal: Math.round(r.calories), portion: { grams: null, label: '1 serving' },
    macros: macrosOf(r), per100g: null, nutrients: parse(r.nutrientsJson),
  };
}

/** USDA rows default to 100 g; the review sheet steps the grams. */
export function usdaResult(c: UsdaCandidate): FoodResult {
  const nutrients: Record<string, number> = {};
  for (const [k, v] of Object.entries(c.micros ?? {})) if (Number.isFinite(v) && v > 0) nutrients[k] = r1(v);
  return {
    kind: 'usda', id: `usda:${c.fdcId ?? c.description}`, name: usdaName(c.description), caption: 'USDA · per 100 g',
    kcal: Math.round(c.per100g.calories), portion: { grams: 100, label: '100 g' },
    macros: macrosOf(c.per100g), per100g: macrosOf(c.per100g), nutrients: Object.keys(nutrients).length ? nutrients : null,
  };
}

/**
 * The page's list. With a query: yours, then recipes, then USDA (minus any
 * that duplicate one of yours). Without one: recent foods and recipes.
 */
export function rankFoodResults(input: { q: string; scope: FoodScope; foods: SavedFoodRow[]; recipes: RecipeRow[]; usda: UsdaCandidate[] | null }): FoodResult[] {
  const q = input.q.trim().toLowerCase();
  const byUse = <T extends { useCount: number; updatedAt: Date }>(a: T, b: T) => b.useCount - a.useCount || b.updatedAt.getTime() - a.updatedAt.getTime();
  const byRecent = <T extends { updatedAt: Date }>(a: T, b: T) => b.updatedAt.getTime() - a.updatedAt.getTime();
  if (!q) {
    const foods = input.scope === 'recipes' ? [] : [...input.foods].sort(byRecent).slice(0, input.scope === 'mine' ? 20 : 8).map(mineResult);
    const recipes = input.scope === 'mine' ? [] : [...input.recipes].sort(byRecent).slice(0, input.scope === 'recipes' ? 20 : 4).map(recipeResult);
    return [...foods, ...recipes];
  }
  const match = (name: string) => name.toLowerCase().includes(q);
  const mine = input.scope === 'recipes' ? [] : input.foods.filter((f) => match(f.name)).sort(byUse).map(mineResult);
  const recipes = input.scope === 'mine' ? [] : input.recipes.filter((r) => match(r.name)).sort(byUse).map(recipeResult);
  const taken = new Set(mine.map((m) => m.name.toLowerCase()));
  const usda = input.scope === 'all' ? (input.usda ?? []).map(usdaResult).filter((u) => !taken.has(u.name.toLowerCase())).slice(0, 12) : [];
  return [...mine, ...recipes, ...usda];
}
