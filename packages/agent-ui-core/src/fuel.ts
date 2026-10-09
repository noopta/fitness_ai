// Fuel outside chat (design handoff Wave 3: N-05, N-07 – N-10). The numbers
// those screens show — today's target with a workout's burn as its own line,
// the goal-hit moment, a recipe's totals per serving — kept pure and tested.

export interface DayTargets { calories: number; proteinG: number | null; carbsG: number | null; fatG: number | null; fiberG: number | null; source: string }
export interface Burn { kcal: number; label: string | null; addToTarget: boolean }
export interface Totals { kcal: number; proteinG: number; carbsG: number; fatG: number; fiberG: number }

/**
 * Today's calorie target (N-07): the base, plus the workout's burn as its own
 * line when the user counts it (the Account toggle), so the bigger number
 * explains itself. No targets → null; Fuel then shows intake without a goal (N-08).
 */
export function targetLines(t: DayTargets | null, burn: Burn | null): { base: number; burn: number; burnLabel: string | null; today: number } | null {
  if (!t) return null;
  const b = burn && burn.addToTarget && burn.kcal > 0 ? Math.round(burn.kcal) : 0;
  return { base: Math.round(t.calories), burn: b, burnLabel: b ? (burn!.label ? `Workout · ${burn!.label}` : 'Workout') : null, today: Math.round(t.calories) + b };
}

/** Sum a day's meals. Fiber sits in each meal's nutrients. */
export function dayTotals(meals: any[]): Totals {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
  return meals.reduce<Totals>((a, m) => ({
    kcal: a.kcal + n(m.calories), proteinG: a.proteinG + n(m.proteinG), carbsG: a.carbsG + n(m.carbsG), fatG: a.fatG + n(m.fatG),
    fiberG: a.fiberG + n(m.nutrients?.fiberG ?? m.fiberG),
  }), { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 });
}

export interface Moment { key: string; line: string; eyebrow: string; value: string; of: string }

/**
 * A goal hit (N-10): protein first (the one that matters most), then fiber.
 * `key` is per day and goal, so the line shows once. Null when nothing's hit.
 * Calories aren't a "hit" — reaching them isn't an achievement.
 */
export function momentFor(t: Totals, targets: DayTargets | null, date: string): Moment | null {
  if (!targets) return null;
  if (targets.proteinG && t.proteinG >= targets.proteinG) {
    return { key: `${date}:protein`, line: `Protein hit — ${Math.round(t.proteinG)} of ${targets.proteinG} g`, eyebrow: 'Protein', value: `${Math.round(t.proteinG)} g`, of: `of ${targets.proteinG} g` };
  }
  if (targets.fiberG && t.fiberG >= targets.fiberG) {
    return { key: `${date}:fiber`, line: `Fiber hit — ${Math.round(t.fiberG)} of ${targets.fiberG} g`, eyebrow: 'Fiber', value: `${Math.round(t.fiberG)} g`, of: `of ${targets.fiberG} g` };
  }
  return null;
}

// ─── N-05 Recipe builder ─────────────────────────────────────────────────────

export interface Ingredient { name: string; quantity: string; calories: number; proteinG: number; carbsG: number; fatG: number }

/** Per-serving totals, live as ingredients and servings change. No servings yet counts as 1; below ½ counts as ½ (the server's floor). */
export function perServing(items: Ingredient[], servings: number): { calories: number; proteinG: number; carbsG: number; fatG: number } {
  const s = Math.max(0.5, servings || 1);
  const sum = (k: keyof Omit<Ingredient, 'name' | 'quantity'>) => items.reduce((a, i) => a + (Number(i[k]) || 0), 0);
  return { calories: Math.round(sum('calories') / s), proteinG: Math.round(sum('proteinG') / s), carbsG: Math.round(sum('carbsG') / s), fatG: Math.round(sum('fatG') / s) };
}

/** A searched food at `qty` portions as an ingredient (its whole contribution to the recipe). */
export function ingredientFrom(food: { name: string; portion?: { label?: string | null } | null; macros: { calories: number; proteinG: number; carbsG: number; fatG: number } }, qty: number): Ingredient {
  const q = Math.max(0.25, qty || 1);
  const r = (v: number) => Math.round(v * q * 10) / 10;
  const label = food.portion?.label ? `${q === 1 ? '' : `${q} × `}${food.portion.label}` : `${q} serving${q === 1 ? '' : 's'}`;
  return { name: food.name, quantity: label, calories: r(food.macros.calories), proteinG: r(food.macros.proteinG), carbsG: r(food.macros.carbsG), fatG: r(food.macros.fatG) };
}

// ─── N-09 Nutrition profile ──────────────────────────────────────────────────

/** Bars for a range: the last 7 days of a 30-day window would hide the month, so 30 days groups into weeks. */
export function rangeBars(days: { date: string; kcal: number; logged: boolean }[], range: 'today' | '7d' | '30d'): { label: string; value: number }[] {
  const L = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  if (range === '30d') {
    const out: { label: string; value: number }[] = [];
    for (let i = 0; i < days.length; i += 7) {
      const wk = days.slice(i, i + 7).filter((d) => d.logged);
      out.push({ label: `W${out.length + 1}`, value: wk.length ? Math.round(wk.reduce((a, d) => a + d.kcal, 0) / wk.length) : 0 });
    }
    return out;
  }
  return days.map((d) => ({ label: L[new Date(`${d.date}T12:00:00`).getDay()], value: d.logged ? d.kcal : 0 }));
}

/** One branded item the server checked on the web while parsing typed food. */
export interface FoodLookup { brand: string; status: 'found' | 'estimated'; sourceDomain: string | null }

/**
 * The receipt line for typed food, saying honestly where the numbers came
 * from: published values ("Starbucks — from starbucks.ca"), a brand that
 * isn't published ("— not published, estimated"), or a plain estimate.
 */
export function lookupReceipt(parsed: any, name: string | null): { verb: 'Searched' | 'Checked' | 'Computed'; text: string; found: boolean } {
  const lookups: FoodLookup[] = Array.isArray(parsed?.lookups) ? parsed.lookups : [];
  const uniq = (xs: string[]) => xs.filter((x, i) => xs.indexOf(x) === i);
  const found = lookups.filter((l) => l.status === 'found');
  if (found.length) {
    return { verb: 'Searched', found: true, text: `${uniq(found.map((l) => l.brand)).join(', ')} — from ${uniq(found.map((l) => l.sourceDomain ?? l.brand)).join(', ')}` };
  }
  if (lookups.length) return { verb: 'Checked', found: false, text: `${uniq(lookups.map((l) => l.brand)).join(', ')} — not published, estimated` };
  return { verb: 'Computed', found: false, text: name ? `${name} — estimated` : 'Estimated' };
}
