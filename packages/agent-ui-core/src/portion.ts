// Portions for the food review sheet (RN spec bug fixes, 5 Oct 2026 — 4b).
// The user steps or types a portion; macros and micronutrients are computed
// from it and are never edited directly. Pure — no React.

/** The fields of a food-search row (GET /nutrition/food-search) a portion needs. */
export interface PortionSource {
  id: string;
  name: string;
  portion: { grams: number | null };
  macros: PortionMacros;
  per100g: PortionMacros | null;
  nutrients: Record<string, number> | null;
}

export interface PortionMacros { calories: number; proteinG: number; carbsG: number; fatG: number }

export interface Portioned {
  key: string;
  name: string;
  /** 'g' when the food scales by weight (USDA), else servings. */
  unit: 'g' | 'serving';
  /** The amount the base values are for: 100 g, or 1 serving. */
  baseAmount: number;
  amount: number;
  base: PortionMacros;
  baseNutrients: Record<string, number> | null;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function portionFrom(r: PortionSource): Portioned {
  const byWeight = r.portion.grams != null && !!r.per100g;
  return {
    key: r.id, name: r.name,
    unit: byWeight ? 'g' : 'serving',
    baseAmount: byWeight ? 100 : 1,
    amount: byWeight ? (r.portion.grams as number) : 1,
    base: byWeight ? r.per100g! : r.macros,
    baseNutrients: byWeight && r.nutrients && r.portion.grams ? scaleRecord(r.nutrients, 100 / r.portion.grams) : r.nutrients,
  };
}

function scaleRecord(rec: Record<string, number>, f: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(rec)) out[k] = v * f;
  return out;
}

export const portionFactor = (p: Portioned) => (p.baseAmount > 0 ? p.amount / p.baseAmount : 0);

export function portionMacros(p: Portioned): PortionMacros {
  const f = portionFactor(p);
  return { calories: Math.round(p.base.calories * f), proteinG: r1(p.base.proteinG * f), carbsG: r1(p.base.carbsG * f), fatG: r1(p.base.fatG * f) };
}

export function portionNutrients(p: Portioned): Record<string, number> | null {
  return p.baseNutrients ? scaleRecord(p.baseNutrients, portionFactor(p)) : null;
}

export function portionTotals(items: Portioned[]): PortionMacros {
  const t = items.map(portionMacros).reduce((a, m) => ({ calories: a.calories + m.calories, proteinG: a.proteinG + m.proteinG, carbsG: a.carbsG + m.carbsG, fatG: a.fatG + m.fatG }), { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 });
  return { calories: Math.round(t.calories), proteinG: Math.round(t.proteinG), carbsG: Math.round(t.carbsG), fatG: Math.round(t.fatG) };
}

export function portionMealNutrients(items: Portioned[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) for (const [k, v] of Object.entries(portionNutrients(it) ?? {})) out[k] = (out[k] ?? 0) + v;
  return out;
}

/** −/+ : grams by 10 under 100 g and 25 above; servings by a half. Never below one step. */
export function stepPortion(p: Portioned, dir: 1 | -1): Portioned {
  if (p.unit === 'serving') return { ...p, amount: Math.max(0.5, r1(p.amount + 0.5 * dir)) };
  const s = p.amount < 100 || (dir < 0 && p.amount <= 100) ? 10 : 25;
  const next = Math.round((p.amount + s * dir) / 5) * 5;
  return { ...p, amount: Math.max(5, next) };
}

/** Typed value; invalid or zero leaves the portion as it was. */
export function setPortionAmount(p: Portioned, raw: string): Portioned {
  const n = parseFloat(String(raw).replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return p;
  return { ...p, amount: p.unit === 'g' ? Math.min(5000, Math.round(n)) : Math.min(20, r1(n)) };
}

export function portionLabel(p: Portioned): string {
  if (p.unit === 'g') return `${Math.round(p.amount)} g`;
  return p.amount === 1 ? '1 serving' : `${p.amount} servings`;
}

/** The meal's "Of today's targets" rows: the plan's focus nutrients first, then what this meal covers most. */
export function relevantMicros(
  meal: Record<string, number>,
  targets: { key: string; label: string; target: number; direction: string; focus?: boolean }[],
  n = 5,
): { key: string; label: string; pct: number; focus: boolean }[] {
  return targets
    .filter((t) => t.direction !== 'limit' && t.target > 0 && (meal[t.key] ?? 0) > 0)
    .map((t) => ({ key: t.key, label: t.label, pct: Math.round(((meal[t.key] ?? 0) / t.target) * 100), focus: !!t.focus }))
    .sort((a, b) => Number(b.focus) - Number(a.focus) || b.pct - a.pct)
    .slice(0, n);
}

/** "breakfast" before 10, "lunch" before 15, "dinner" before 21, then "snack". */
export function mealSlotFor(d = new Date()): 'breakfast' | 'lunch' | 'dinner' | 'snack' {
  const h = d.getHours();
  return h < 10 ? 'breakfast' : h < 15 ? 'lunch' : h < 21 ? 'dinner' : 'snack';
}
