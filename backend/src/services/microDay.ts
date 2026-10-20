// A day's micronutrients, all of them (Oct 2026): Fuel's "Gaps" page only
// listed what was under 100%. This is the full read — every vitamin and
// mineral logged or targeted, % of target, what came from supplements vs food,
// the top sources, and anything over the tolerable upper limit.
//
// Targets: the Nutrition Profile engine's (personalised, registry nutrients)
// first; adult reference intakes (NIH ODS RDA/AI) for nutrients outside the
// registry. Upper limits: supplementDoses.UPPER_LIMITS.

import { mealRowToNutrientMap, type WindowMealRow } from './nutritionWindow.js';
import { parseSupplementDoses, UPPER_LIMITS } from './supplementDoses.js';
import type { NutrientCoverage } from '../engine/nutritionProfileEngine.js';

/** Adult reference intakes for nutrients the registry doesn't target (NIH ODS; the higher of the sex values). */
const EXTRA_TARGETS: Record<string, { label: string; unit: string; target: number }> = {
  vitaminAIU: { label: 'Vitamin A', unit: 'IU', target: 3000 },
  vitaminEMg: { label: 'Vitamin E', unit: 'mg', target: 15 },
  vitaminKMcg: { label: 'Vitamin K', unit: 'mcg', target: 120 },
  vitaminB6Mg: { label: 'Vitamin B6', unit: 'mg', target: 1.3 },
  thiaminMg: { label: 'Thiamin (B1)', unit: 'mg', target: 1.2 },
  riboflavinMg: { label: 'Riboflavin (B2)', unit: 'mg', target: 1.3 },
  niacinMg: { label: 'Niacin (B3)', unit: 'mg', target: 16 },
  biotinMcg: { label: 'Biotin (B7)', unit: 'mcg', target: 30 },
  seleniumMcg: { label: 'Selenium', unit: 'mcg', target: 55 },
  iodineMcg: { label: 'Iodine', unit: 'mcg', target: 150 },
  copperMg: { label: 'Copper', unit: 'mg', target: 0.9 },
  manganeseMg: { label: 'Manganese', unit: 'mg', target: 2.3 },
  chromiumMcg: { label: 'Chromium', unit: 'mcg', target: 35 },
};

const GROUP: Record<string, 'Vitamins' | 'Minerals' | 'Other' | 'Limits'> = {
  vitaminAIU: 'Vitamins', vitaminCMg: 'Vitamins', vitaminDIU: 'Vitamins', vitaminEMg: 'Vitamins', vitaminKMcg: 'Vitamins',
  vitaminB6Mg: 'Vitamins', vitaminB12Mcg: 'Vitamins', folateMcg: 'Vitamins', thiaminMg: 'Vitamins', riboflavinMg: 'Vitamins',
  niacinMg: 'Vitamins', biotinMcg: 'Vitamins', cholineMg: 'Vitamins',
  ironMg: 'Minerals', magnesiumMg: 'Minerals', zincMg: 'Minerals', calciumMg: 'Minerals', potassiumMg: 'Minerals',
  seleniumMcg: 'Minerals', iodineMcg: 'Minerals', copperMg: 'Minerals', manganeseMg: 'Minerals', chromiumMcg: 'Minerals',
  omega3G: 'Other', fiberG: 'Other', leucineG: 'Other', tryptophanG: 'Other',
  sodiumMg: 'Limits', addedSugarG: 'Limits', saturatedFatG: 'Limits',
};
const SKIP = new Set(['proteinG', 'carbsG', 'fatG', 'calories', 'sugarG', 'cholesterolMg', 'omega6G', 'glycemicIndex', 'glycemicLoad']);

export interface MicroRow {
  key: string; label: string; unit: string;
  amount: number; target: number; pct: number;
  /** Over-target is the bad direction (sodium, added sugar, saturated fat). */
  ceiling: boolean;
  fromSupplements: number;
  sources: { name: string; amount: number; supplement: boolean }[];
  /** Tolerable upper intake level, when one applies, and whether today is over it. */
  ul: number | null; overUl: boolean; ulNote?: string;
  /** A registry nutrient: GET /nutrition-profile/nutrient/:key has its 7-day page. */
  hasDetail: boolean;
}
export interface MicroDay { mealsLogged: number; groups: { title: string; rows: MicroRow[] }[]; overUl: MicroRow[]; supplements: string[] }

const round = (v: number) => (v >= 100 ? Math.round(v) : v >= 10 ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100);

/** Pure: the day's rows from its meals and the engine's coverage. */
export function buildMicroDay(meals: (WindowMealRow & { name: string })[], coverage: NutrientCoverage[]): MicroDay {
  const totals = new Map<string, number>();
  const supp = new Map<string, number>();
  const sources = new Map<string, { name: string; amount: number; supplement: boolean }[]>();
  const supplements: string[] = [];
  for (const m of meals) {
    const map = mealRowToNutrientMap(m);
    const isSupp = parseSupplementDoses(m.name).length > 0 || /\b(supplement|capsule|softgel|tablet|multivitamin|gumm(y|ies))\b/i.test(m.name);
    if (isSupp) supplements.push(m.name);
    for (const [k, v] of Object.entries(map)) {
      if (SKIP.has(k) || typeof v !== 'number' || !(v > 0)) continue;
      totals.set(k, (totals.get(k) ?? 0) + v);
      if (isSupp) supp.set(k, (supp.get(k) ?? 0) + v);
      const list = sources.get(k) ?? [];
      list.push({ name: m.name, amount: round(v), supplement: isSupp });
      sources.set(k, list);
    }
  }
  const rows: MicroRow[] = [];
  const seen = new Set<string>();
  const row = (key: string, label: string, unit: string, target: number, ceiling: boolean, hasDetail = false): MicroRow => {
    const amount = round(totals.get(key) ?? 0);
    const fromSupplements = round(supp.get(key) ?? 0);
    const lim = UPPER_LIMITS[key];
    // Magnesium's limit is for supplements only; food magnesium has none.
    const ulBasis = key === 'magnesiumMg' ? fromSupplements : amount;
    return {
      key, label, unit, amount, target: round(target), pct: target > 0 ? Math.round((amount / target) * 100) : 0, ceiling, fromSupplements,
      sources: (sources.get(key) ?? []).sort((a, b) => b.amount - a.amount).slice(0, 4),
      ul: lim?.ul ?? null, overUl: !!lim && ulBasis > lim.ul, ...(lim?.note ? { ulNote: lim.note } : {}), hasDetail,
    };
  };
  for (const c of coverage) {
    if (SKIP.has(c.key) || c.key === 'proteinG') continue;
    seen.add(c.key);
    rows.push(row(c.key, c.label, c.unit, c.target, c.ceiling, true));
  }
  for (const [key, t] of Object.entries(EXTRA_TARGETS)) {
    if (seen.has(key) || !totals.has(key)) continue;
    seen.add(key);
    rows.push(row(key, t.label, t.unit, t.target, false));
  }
  const order = ['Vitamins', 'Minerals', 'Other', 'Limits'] as const;
  const groups = order.map((title) => ({
    title,
    rows: rows.filter((r) => (GROUP[r.key] ?? 'Other') === title)
      // Worst first: the furthest under target (or over, for limits).
      .sort((a, b) => (a.ceiling ? b.pct - a.pct : a.pct - b.pct)),
  })).filter((g) => g.rows.length);
  return { mealsLogged: meals.length, groups, overUl: rows.filter((r) => r.overUl), supplements };
}
