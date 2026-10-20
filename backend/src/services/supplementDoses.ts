// Supplement doses → micronutrients, deterministically (Oct 2026).
//
// "Magnesium bisglycinate 200 mg and zinc 15 mg" was logged from chat with
// explicit numbers (0 kcal), which skipped the nutrient estimate entirely —
// every micronutrient saved as 0. A supplement's label IS its nutrition data,
// so it's read here by rule, not estimated: the nutrient, the dose, the unit
// (mg / mcg / µg / IU / g, with the IU conversions for A, D and E), and a count
// ("2 softgels of vitamin D 1000 IU" = 2000 IU). Applied to every meal before
// it's saved (mealLogService), whatever path it came from.
//
// Doses are taken as stated: supplement labels give the elemental amount
// ("Magnesium (as bisglycinate) 200 mg").

type Unit = 'mg' | 'mcg' | 'IU' | 'g';
interface Def { key: string; unit: Unit; names: RegExp }

/** Nutrient keys match the meal schema / nutrient registry; extras go to the open nutrient map. */
const DEFS: Def[] = [
  { key: 'vitaminDIU', unit: 'IU', names: /\b(?:vit(?:amin)?\.?\s*d\s*3?|cholecalciferol|d3)\b/i },
  { key: 'vitaminCMg', unit: 'mg', names: /\b(?:vit(?:amin)?\.?\s*c|ascorbic acid|ascorbate)\b/i },
  { key: 'vitaminAIU', unit: 'IU', names: /\b(?:vit(?:amin)?\.?\s*a|retinol|retinyl palmitate)\b/i },
  { key: 'vitaminEMg', unit: 'mg', names: /\b(?:vit(?:amin)?\.?\s*e|tocopherol)\b/i },
  { key: 'vitaminKMcg', unit: 'mcg', names: /\b(?:vit(?:amin)?\.?\s*k\s*2?|k2|mk-?7|menaquinone|phylloquinone)\b/i },
  { key: 'vitaminB12Mcg', unit: 'mcg', names: /\b(?:vit(?:amin)?\.?\s*b\s*-?12|b-?12|methylcobalamin|cyanocobalamin)\b/i },
  { key: 'vitaminB6Mg', unit: 'mg', names: /\b(?:vit(?:amin)?\.?\s*b\s*-?6|b-?6|pyridoxine|p-?5-?p)\b/i },
  { key: 'folateMcg', unit: 'mcg', names: /\b(?:folate|folic acid|methylfolate|5-?mthf)\b/i },
  { key: 'thiaminMg', unit: 'mg', names: /\b(?:thiamin(?:e)?|vit(?:amin)?\.?\s*b\s*-?1)\b(?!\d)/i },
  { key: 'riboflavinMg', unit: 'mg', names: /\b(?:riboflavin|vit(?:amin)?\.?\s*b\s*-?2)\b/i },
  { key: 'niacinMg', unit: 'mg', names: /\b(?:niacin(?:amide)?|vit(?:amin)?\.?\s*b\s*-?3)\b/i },
  { key: 'biotinMcg', unit: 'mcg', names: /\b(?:biotin|vit(?:amin)?\.?\s*b\s*-?7)\b/i },
  { key: 'magnesiumMg', unit: 'mg', names: /\bmagnesium\b|\bmag\s+(?:glycinate|citrate|oxide)\b/i },
  { key: 'zincMg', unit: 'mg', names: /\bzinc\b/i },
  { key: 'ironMg', unit: 'mg', names: /\b(?:iron|ferrous \w+)\b/i },
  { key: 'calciumMg', unit: 'mg', names: /\bcalcium\b/i },
  { key: 'potassiumMg', unit: 'mg', names: /\bpotassium\b/i },
  { key: 'sodiumMg', unit: 'mg', names: /\bsodium\b/i },
  { key: 'seleniumMcg', unit: 'mcg', names: /\bselenium\b/i },
  { key: 'iodineMcg', unit: 'mcg', names: /\b(?:iodine|potassium iodide)\b/i },
  { key: 'copperMg', unit: 'mg', names: /\bcopper\b/i },
  { key: 'manganeseMg', unit: 'mg', names: /\bmanganese\b/i },
  { key: 'chromiumMcg', unit: 'mcg', names: /\bchromium\b/i },
  { key: 'cholineMg', unit: 'mg', names: /\bcholine\b/i },
  { key: 'omega3G', unit: 'g', names: /\b(?:omega[\s-]?3s?|epa\s*(?:\+|and|&)\s*dha|fish oil|krill oil|algae oil)\b/i },
];

const DOSE = /(\d+(?:[.,]\d+)?)\s*(mg|mcg|µg|ug|iu|i\.u\.|g)\b/gi;
const COUNT = /\b(\d{1,2})\s*(?:x\s*)?(?:caps?|capsules?|tabs?|tablets?|softgels?|pills?|gummies|gummy|drops?|scoops?)\b/i;

/** Convert a stated dose to the nutrient's unit (null when it can't be converted honestly). */
function convert(def: Def, amount: number, unit: string): number | null {
  const u = unit.toLowerCase().replace(/\./g, '').replace('µg', 'mcg').replace('ug', 'mcg');
  if (def.unit === 'IU') {
    if (u === 'iu') return amount;
    if (def.key === 'vitaminDIU' && u === 'mcg') return amount * 40;        // 1 mcg D3 = 40 IU
    if (def.key === 'vitaminDIU' && u === 'mg') return amount * 40_000;
    if (def.key === 'vitaminAIU' && u === 'mcg') return amount * 3.33;     // retinol: 1 mcg = 3.33 IU
    return null;
  }
  if (def.key === 'vitaminEMg' && u === 'iu') return amount * 0.67;        // natural d-alpha-tocopherol
  // Grams are food weights ("calcium-rich yogurt 200 g"), not doses — except oils.
  if (u === 'g' && def.key !== 'omega3G') return null;
  const toMg = u === 'g' ? amount * 1000 : u === 'mg' ? amount : u === 'mcg' ? amount / 1000 : null;
  if (toMg == null) return null;
  if (def.unit === 'mg') return toMg;
  if (def.unit === 'mcg') return toMg * 1000;
  return toMg / 1000; // g
}

export interface DoseHit { key: string; amount: number; unit: Unit; text: string }

/**
 * Pure: every "<nutrient> <dose>" or "<dose> <nutrient>" in the text, in the
 * nutrient's own unit, multiplied by a stated count of capsules/tablets.
 * A dose binds to the nearest nutrient name within the same clause.
 */
export function parseSupplementDoses(text: string): DoseHit[] {
  const out = new Map<string, DoseHit>();
  // Clauses: "and" / "with" / "plus", commas and semicolons separate items ("EPA+DHA" stays one).
  for (const clause of String(text ?? '').split(/[,;\n]|\band\b|\bwith\b|\bplus\b/i)) {
    const doses = [...clause.matchAll(DOSE)];
    if (!doses.length) continue;
    const count = Number(clause.match(COUNT)?.[1] ?? 1) || 1;
    for (const def of DEFS) {
      const nm = clause.match(def.names);
      if (!nm || nm.index == null) continue;
      // Fish oil without EPA/DHA amounts: about 30% of the oil is omega-3.
      const fishOil = def.key === 'omega3G' && /fish oil|krill oil/i.test(nm[0]);
      // The dose nearest the name (after it first, then before), and close to it.
      const end = nm.index + nm[0].length;
      const near = (x: RegExpMatchArray) => (x.index! >= end ? x.index! - end : nm.index! - (x.index! + x[0].length)) <= 30;
      const after = doses.filter((d) => (d.index ?? 0) >= end && near(d)).sort((a, b) => a.index! - b.index!)[0];
      const before = doses.filter((d) => (d.index ?? 0) < nm.index! && near(d)).sort((a, b) => b.index! - a.index!)[0];
      const d = after ?? before;
      if (!d) continue;
      const amount = Number(d[1].replace(',', '.'));
      let v = convert(def, amount, d[2]);
      if (v == null || !(v > 0)) continue;
      if (fishOil && def.unit === 'g' && /fish oil|krill oil/i.test(clause) && !/epa|dha/i.test(clause)) v *= 0.3;
      v *= count;
      const prev = out.get(def.key);
      out.set(def.key, { key: def.key, amount: Math.round(((prev?.amount ?? 0) + v) * 100) / 100, unit: def.unit, text: clause.trim() });
    }
  }
  return [...out.values()];
}

/** Does this read like a supplement (so a zero-nutrient save would be wrong)? */
export const looksLikeSupplement = (text: string) =>
  /\b(supplement|vitamin|multivitamin|capsule|softgel|tablet|pill|gummy|gummies|fish oil|omega[\s-]?3|magnesium|zinc|iron|calcium|potassium|electrolyte|b-?12|d3|creatine)\b/i.test(text)
  && parseSupplementDoses(text).length > 0;

/**
 * Add the doses to a meal's nutrients. The estimate may already include a
 * supplement it was told about ("…and vitamin C supplement" came back with
 * 1,523 mg); a value at or above the dose is taken as including it, a value
 * below it can't, so the dose is added on top.
 */
export function applySupplementDoses<T extends Record<string, any>>(nutrients: T, nutrientMap: Record<string, number>, text: string): { nutrients: T; nutrientMap: Record<string, number>; added: DoseHit[] } {
  const hits = parseSupplementDoses(text);
  if (!hits.length) return { nutrients, nutrientMap, added: [] };
  const n: Record<string, any> = { ...nutrients };
  const map = { ...nutrientMap };
  const added: DoseHit[] = [];
  for (const h of hits) {
    const have = Math.max(Number(n[h.key]) || 0, Number(map[h.key]) || 0);
    if (have >= h.amount) continue;
    const v = Math.round((have + h.amount) * 100) / 100;
    if (h.key in n) n[h.key] = v;
    map[h.key] = v;
    added.push(h);
  }
  return { nutrients: n as T, nutrientMap: map, added };
}

/** Tolerable upper intake levels (adults, NIH ODS; supplemental for magnesium) — for the "over the safe limit" flags. */
export const UPPER_LIMITS: Record<string, { ul: number; unit: string; note?: string }> = {
  vitaminCMg: { ul: 2000, unit: 'mg' },
  vitaminDIU: { ul: 4000, unit: 'IU' },
  vitaminAIU: { ul: 10000, unit: 'IU', note: 'preformed vitamin A (retinol)' },
  vitaminEMg: { ul: 1000, unit: 'mg' },
  vitaminB6Mg: { ul: 100, unit: 'mg' },
  niacinMg: { ul: 35, unit: 'mg', note: 'from supplements' },
  folateMcg: { ul: 1000, unit: 'mcg', note: 'folic acid from supplements' },
  zincMg: { ul: 40, unit: 'mg' },
  ironMg: { ul: 45, unit: 'mg' },
  calciumMg: { ul: 2500, unit: 'mg' },
  magnesiumMg: { ul: 350, unit: 'mg', note: 'from supplements (food magnesium has no limit)' },
  seleniumMcg: { ul: 400, unit: 'mcg' },
  iodineMcg: { ul: 1100, unit: 'mcg' },
  copperMg: { ul: 10, unit: 'mg' },
  manganeseMg: { ul: 11, unit: 'mg' },
  sodiumMg: { ul: 2300, unit: 'mg', note: 'chronic-disease risk reduction level' },
};
