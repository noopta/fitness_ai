// Meal-photo item list (contract 8) — the pure logic both review screens share
// (classic SnapSheet and v2 capture). No React here.
//
// Rules for editing an item, in order:
//   • per100g known            → grams edit rescales EXACTLY from per100g.
//   • per100g null, grams known → grams edit scales proportionally.
//   • grams null, per100g known → the user may enter grams (from per100g).
//   • neither                  → edit kcal directly; macros follow in proportion.
import type { MealPhotoItem } from '../../../lib/api';

export interface ReviewItem {
  id: string;
  name: string;
  preparation: string | null;
  grams: number | null;
  visibility: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  per100g: { calories: number; proteinG: number; carbsG: number; fatG: number } | null;
  source: string;
}

export interface Totals { calories: number; proteinG: number; carbsG: number; fatG: number }

let seq = 0;
const localId = () => `local-${Date.now().toString(36)}-${(seq++).toString(36)}`;
const num = (v: any): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const numOrNull = (v: any): number | null => { const n = Number(v); return v == null || !Number.isFinite(n) ? null : n; };
const r1 = (n: number) => Math.round(n * 10) / 10;

function per100(v: any): ReviewItem['per100g'] {
  if (!v || typeof v !== 'object') return null;
  const c = Number(v.calories);
  if (!Number.isFinite(c)) return null;
  return { calories: c, proteinG: num(v.proteinG), carbsG: num(v.carbsG), fatG: num(v.fatG) };
}

/** Normalise one server item (tolerant of older / partial shapes). */
export function toReviewItem(x: any, fallbackName = 'Item'): ReviewItem {
  return {
    id: typeof x?.id === 'string' && x.id ? x.id : localId(),
    name: String(x?.name ?? fallbackName).trim() || fallbackName,
    preparation: typeof x?.preparation === 'string' ? x.preparation : null,
    grams: numOrNull(x?.grams ?? x?.portionG),
    visibility: typeof x?.visibility === 'string' ? x.visibility : 'full',
    calories: Math.round(num(x?.calories)),
    proteinG: r1(num(x?.proteinG)),
    carbsG: r1(num(x?.carbsG)),
    fatG: r1(num(x?.fatG)),
    per100g: per100(x?.per100g),
    source: typeof x?.source === 'string' ? x.source : 'model',
  };
}

/** Items from an analyze-photo response; falls back to one meal-level item. */
export function itemsFromPhoto(res: any): ReviewItem[] {
  const meal = res?.meal ?? res;
  const list: any[] = Array.isArray(meal?.items) ? meal.items : Array.isArray(meal?.foods) ? meal.foods : [];
  if (list.length) return list.map((x) => toReviewItem(x));
  if (meal && (meal.name || meal.calories)) return [toReviewItem({ ...meal, id: undefined }, 'Meal')];
  return [];
}

/** Items from a parse-meal (text) response — usually one meal-level item. */
export function itemsFromParse(res: any, typed: string): ReviewItem[] {
  const meal = res?.meal ?? res;
  if (Array.isArray(meal?.items) && meal.items.length) return meal.items.map((x: any) => toReviewItem(x, typed));
  return [toReviewItem({ ...meal, id: undefined, name: meal?.name || typed }, typed)];
}

/** Which field a tap edits for this item. */
export function editMode(it: ReviewItem): 'grams' | 'kcal' {
  return it.per100g || (it.grams != null && it.grams > 0) ? 'grams' : 'kcal';
}

export function rescaleGrams(it: ReviewItem, grams: number): ReviewItem {
  const g = Math.max(0, grams);
  if (it.per100g) {
    const f = g / 100;
    return {
      ...it, grams: g,
      calories: Math.round(it.per100g.calories * f),
      proteinG: r1(it.per100g.proteinG * f), carbsG: r1(it.per100g.carbsG * f), fatG: r1(it.per100g.fatG * f),
    };
  }
  if (it.grams != null && it.grams > 0) {
    const f = g / it.grams;
    return {
      ...it, grams: g,
      calories: Math.round(it.calories * f),
      proteinG: r1(it.proteinG * f), carbsG: r1(it.carbsG * f), fatG: r1(it.fatG * f),
    };
  }
  return it;
}

export function setKcal(it: ReviewItem, kcal: number): ReviewItem {
  const k = Math.max(0, Math.round(kcal));
  if (it.calories > 0) {
    const f = k / it.calories;
    return { ...it, calories: k, proteinG: r1(it.proteinG * f), carbsG: r1(it.carbsG * f), fatG: r1(it.fatG * f) };
  }
  return { ...it, calories: k };
}

/** Apply a typed edit value using the item's edit mode. Invalid input → unchanged. */
export function applyEdit(it: ReviewItem, raw: string): ReviewItem {
  const n = parseFloat(String(raw).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return it;
  return editMode(it) === 'grams' ? rescaleGrams(it, n) : setKcal(it, n);
}

export function totalsOf(items: ReviewItem[]): Totals {
  const t = items.reduce(
    (a, i) => ({ calories: a.calories + i.calories, proteinG: a.proteinG + i.proteinG, carbsG: a.carbsG + i.carbsG, fatG: a.fatG + i.fatG }),
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );
  return { calories: Math.round(t.calories), proteinG: Math.round(t.proteinG), carbsG: Math.round(t.carbsG), fatG: Math.round(t.fatG) };
}

/** Append new items, skipping ids already on the list. */
export function mergeItems(current: ReviewItem[], incoming: ReviewItem[]): ReviewItem[] {
  const ids = new Set(current.map((i) => i.id));
  return [...current, ...incoming.filter((i) => !ids.has(i.id))];
}

export function mealNameFrom(items: ReviewItem[]): string {
  const names = items.map((i) => i.name).filter(Boolean);
  if (!names.length) return 'Meal';
  const s = names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3}` : '');
  return s.slice(0, 200);
}

/** The list as contract-8 items, for `existingItems` on "+ Add photo". */
export function toMealPhotoItems(items: ReviewItem[]): MealPhotoItem[] {
  return items.map((i) => ({ ...i }));
}

export function itemSubtitle(it: ReviewItem): string {
  const parts: string[] = [];
  if (it.grams != null) parts.push(`${Math.round(it.grams)} g`);
  if (it.preparation) parts.push(it.preparation);
  if (it.visibility === 'inferred') parts.push('assumed');
  else if (it.visibility === 'partial') parts.push('partly visible');
  return parts.join(' · ');
}

/**
 * The itemised breakdown as meal-log fields the backend schema already
 * stores: `ingredients` (names with grams) and `ingredientNutrients` (each
 * item's macros — rendered as chips on the meal breakdown). `items` rides
 * along for servers that persist it; today's schema strips it harmlessly.
 */
export function itemLogFields(items: ReviewItem[]): {
  ingredients: string[];
  ingredientNutrients: Array<{ name: string; nutrients: Record<string, number> }>;
  items: ReviewItem[];
} {
  const label = (i: ReviewItem) => (i.grams != null ? `${i.name} (${Math.round(i.grams)} g)` : i.name).slice(0, 120);
  return {
    ingredients: items.slice(0, 30).map(label),
    ingredientNutrients: items.slice(0, 40).map((i) => ({
      name: label(i),
      nutrients: { calories: i.calories, proteinG: i.proteinG, carbsG: i.carbsG, fatG: i.fatG },
    })),
    items,
  };
}
