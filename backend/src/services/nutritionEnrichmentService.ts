import type { ParsedMealDetail, Micronutrients } from './llmService.js';
import { estimateMicronutrientsOnly } from './llmService.js';
import type { FoodRegion } from './prompts/regionPrompts.js';
// Nutrient ids + extraction are shared with the meal-photo v2 USDA lookup.
import { NUTRIENT_IDS, extractNutrient } from './food/usdaLookup.js';

const USDA_API_KEY = process.env.USDA_API_KEY || '';
const USDA_SEARCH_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';

type UsdaFoodNutrients = {
  caloriesPer100g: number;
  nutrients: Micronutrients;
};

export interface HybridEnrichmentMeta {
  provider: 'hybrid_llm_usda';
  matchedIngredients: number;
  totalIngredients: number;
  usdaCoveragePct: number;
  usedFallback: boolean;
}

const zeroMicros = (): Micronutrients => ({
  fiberG: 0,
  sugarG: 0,
  sodiumMg: 0,
  saturatedFatG: 0,
  cholesterolMg: 0,
  vitaminAIU: 0,
  vitaminCMg: 0,
  vitaminDIU: 0,
  vitaminEMg: 0,
  vitaminB12Mcg: 0,
  folateMcg: 0,
  ironMg: 0,
  calciumMg: 0,
  magnesiumMg: 0,
  zincMg: 0,
  potassiumMg: 0,
  omega3G: 0,
  omega6G: 0,
  glycemicIndex: null,
  glycemicLoad: null,
  digestiveSpeed: null,
  biochemicalEffects: null,
});

function cleanNumber(v: unknown): number | null {
  if (typeof v !== 'number' || Number.isNaN(v) || !Number.isFinite(v)) return null;
  return v;
}

function safeRound(v: number, dp = 1): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

function toMicros(partial: Partial<Micronutrients> | null | undefined): Micronutrients {
  const base = zeroMicros();
  if (!partial) return base;
  for (const key of Object.keys(base) as Array<keyof Micronutrients>) {
    if (key === 'glycemicIndex') {
      const n = cleanNumber(partial.glycemicIndex);
      base.glycemicIndex = n === null ? null : safeRound(n, 0);
      continue;
    }
    if (key === 'glycemicLoad') {
      const n = cleanNumber(partial.glycemicLoad);
      base.glycemicLoad = n === null ? null : safeRound(n, 1);
      continue;
    }
    if (key === 'digestiveSpeed') {
      base.digestiveSpeed = partial.digestiveSpeed ?? null;
      continue;
    }
    if (key === 'biochemicalEffects') {
      base.biochemicalEffects = partial.biochemicalEffects ?? null;
      continue;
    }
    const n = cleanNumber(partial[key] as number | null | undefined);
    base[key] = n === null ? 0 : safeRound(n, 2);
  }
  return base;
}

function addMicros(a: Micronutrients, b: Micronutrients): Micronutrients {
  const out = zeroMicros();
  for (const key of Object.keys(out) as Array<keyof Micronutrients>) {
    if (key === 'glycemicIndex' || key === 'glycemicLoad') {
      out[key] = null;
      continue;
    }
    if (key === 'digestiveSpeed') { out.digestiveSpeed = null; continue; }
    if (key === 'biochemicalEffects') {
      // merge and deduplicate effects lists
      const combined = [...(a.biochemicalEffects ?? []), ...(b.biochemicalEffects ?? [])];
      out.biochemicalEffects = combined.length ? [...new Set(combined)] : null;
      continue;
    }
    out[key] = safeRound((a[key] as number) + (b[key] as number), 2);
  }
  return out;
}

function scaleMicros(m: Micronutrients, factor: number): Micronutrients {
  const out = zeroMicros();
  for (const key of Object.keys(out) as Array<keyof Micronutrients>) {
    if (key === 'glycemicIndex') { out.glycemicIndex = m.glycemicIndex; continue; }
    if (key === 'glycemicLoad') {
      out.glycemicLoad = m.glycemicLoad != null ? safeRound(m.glycemicLoad * factor, 1) : null;
      continue;
    }
    if (key === 'digestiveSpeed') { out.digestiveSpeed = m.digestiveSpeed; continue; }
    if (key === 'biochemicalEffects') { out.biochemicalEffects = m.biochemicalEffects; continue; }
    out[key] = safeRound((m[key] as number) * factor, 2);
  }
  return out;
}

function blendMicros(llm: Micronutrients, usda: Micronutrients, usdaWeight: number): Micronutrients {
  const out = zeroMicros();
  for (const key of Object.keys(out) as Array<keyof Micronutrients>) {
    if (key === 'glycemicIndex') { out.glycemicIndex = llm.glycemicIndex; continue; }
    if (key === 'glycemicLoad') { out.glycemicLoad = llm.glycemicLoad; continue; }
    if (key === 'digestiveSpeed') { out.digestiveSpeed = llm.digestiveSpeed; continue; }
    if (key === 'biochemicalEffects') { out.biochemicalEffects = llm.biochemicalEffects; continue; }
    const llmVal = llm[key] as number;
    const usdaVal = usda[key] as number;
    out[key] = safeRound((usdaVal * usdaWeight) + (llmVal * (1 - usdaWeight)), 2);
  }
  return out;
}

async function fetchUsdaFoodNutrients(query: string): Promise<UsdaFoodNutrients | null> {
  if (!USDA_API_KEY) return null;
  const q = query.trim();
  if (!q) return null;

  // Two-pass search: lab-grade datasets first (Foundation/FNDDS/SR Legacy),
  // Branded only as a fallback. With a mixed single-hit query, "banana"
  // top-matched a BRANDED product (banana chips, ~440 kcal/100g), which both
  // poisoned the per-100g profile and shrank the kcal-derived portion —
  // observed live as 84mg potassium for a whole banana.
  const search = async (dataType: string[]): Promise<any | null> => {
    const resp = await fetch(`${USDA_SEARCH_URL}?api_key=${encodeURIComponent(USDA_API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q, pageSize: 1, dataType }),
    });
    if (!resp.ok) return null;
    const json: any = await resp.json();
    return json?.foods?.[0] ?? null;
  };

  try {
    const food =
      (await search(['Foundation', 'Survey (FNDDS)', 'SR Legacy'])) ??
      (await search(['Branded']));
    if (!food) return null;

    const caloriesPer100g = extractNutrient(food, NUTRIENT_IDS.calories) || 0;
    const micros = toMicros({
      fiberG: extractNutrient(food, NUTRIENT_IDS.fiberG),
      sugarG: extractNutrient(food, NUTRIENT_IDS.sugarG),
      sodiumMg: extractNutrient(food, NUTRIENT_IDS.sodiumMg),
      saturatedFatG: extractNutrient(food, NUTRIENT_IDS.saturatedFatG),
      cholesterolMg: extractNutrient(food, NUTRIENT_IDS.cholesterolMg),
      vitaminAIU: extractNutrient(food, NUTRIENT_IDS.vitaminAIU),
      vitaminCMg: extractNutrient(food, NUTRIENT_IDS.vitaminCMg),
      vitaminDIU: extractNutrient(food, NUTRIENT_IDS.vitaminDIU),
      vitaminEMg: extractNutrient(food, NUTRIENT_IDS.vitaminEMg),
      vitaminB12Mcg: extractNutrient(food, NUTRIENT_IDS.vitaminB12Mcg),
      folateMcg: extractNutrient(food, NUTRIENT_IDS.folateMcg),
      ironMg: extractNutrient(food, NUTRIENT_IDS.ironMg),
      calciumMg: extractNutrient(food, NUTRIENT_IDS.calciumMg),
      magnesiumMg: extractNutrient(food, NUTRIENT_IDS.magnesiumMg),
      zincMg: extractNutrient(food, NUTRIENT_IDS.zincMg),
      potassiumMg: extractNutrient(food, NUTRIENT_IDS.potassiumMg),
      omega3G: extractNutrient(food, NUTRIENT_IDS.omega3G),
      omega6G: extractNutrient(food, NUTRIENT_IDS.omega6G),
    });

    return { caloriesPer100g, nutrients: micros };
  } catch {
    return null;
  }
}

function inferIngredientCalories(totalCalories: number, idx: number, count: number): number {
  if (count <= 1) return totalCalories;
  const minShare = 0.15;
  const maxShare = 0.45;
  const taper = (count - idx) / ((count * (count + 1)) / 2);
  const share = Math.min(maxShare, Math.max(minShare, taper * count));
  return totalCalories * share;
}

/**
 * Hybrid mode:
 * - LLM provides meal decomposition + baseline micros.
 * - USDA, when available, enriches ingredient micronutrients and blends the result.
 */
// Overlay the (possibly USDA-blended) structured micros back onto the open
// nutrientMap so shared keys reflect the correction, while nutrients that only
// live in the open channel (choline, leucine, …) are preserved untouched.
function mergeMicrosIntoMap(map: Record<string, number> | undefined, micros: Micronutrients): Record<string, number> {
  const out: Record<string, number> = { ...(map ?? {}) };
  for (const [key, value] of Object.entries(micros)) {
    if (typeof value === 'number' && Number.isFinite(value) && value !== 0) out[key] = safeRound(value, 2);
  }
  return out;
}

// A parse "has micros" when at least 3 of the additive keys are nonzero —
// one lone sodium figure isn't a usable micro profile.
function hasUsableMicros(n: Micronutrients | undefined | null): boolean {
  if (!n) return false;
  const keys: Array<keyof Micronutrients> = [
    'fiberG', 'sodiumMg', 'vitaminAIU', 'vitaminCMg', 'vitaminDIU', 'vitaminB12Mcg',
    'folateMcg', 'ironMg', 'calciumMg', 'magnesiumMg', 'zincMg', 'potassiumMg',
  ];
  return keys.filter((k) => Number(n[k]) > 0).length >= 3;
}

const LOW_DENSITY_KCAL_PER_100G = 80;

export async function enrichMealDetailHybrid(
  detail: ParsedMealDetail,
  // Additive and defaulted, so every existing caller keeps its exact behaviour.
  // Only used for the micro backfill today; Wave 2 will also use it to order
  // the composition sources (local West African table before USDA).
  //
  // `usdaMicros`: meal-photo v2 has already matched each item to a USDA food
  // with a real gram weight, so it passes the summed micros of the matched
  // items and the ingredient search loop (sequential, and guessing grams from
  // a calorie share) is skipped. Same coverage-weighted blend either way.
  opts: {
    region?: FoodRegion;
    usdaMicros?: { micros: Partial<Record<keyof Micronutrients, number>>; matched: number; total: number };
    /**
     * Blend USDA micros for each listed ingredient, with grams guessed from a
     * calorie share. Default on for existing callers. Typed meals turn it off:
     * on 9 Oct 2026 it moved a McDouble from 950 → 2,461 mg sodium and 1 → 25 g
     * fibre against a label of 840 mg / 2 g — the model alone was closer.
     */
    blendIngredients?: boolean;
  } = {},
): Promise<{ detail: ParsedMealDetail; meta: HybridEnrichmentMeta }> {
  const region = opts.region ?? 'global';
  // Backfill net (gut-health feature): the primary parse intermittently
  // omits/zeroes the nutrients object. With no USDA key configured this
  // used to pass straight through as an all-zero micro profile — the
  // "sometimes no micronutrients" bug. One focused re-ask fixes it.
  //
  // This is also the weakest point for West African food: USDA has no coverage,
  // so the re-ask is pure model recall. Handing it the regional block (palm oil
  // dominates vitamin A, local greens dominate iron/folate) is the cheapest
  // accuracy win available.
  if (!hasUsableMicros(detail.nutrients) && (detail.calories ?? 0) > 0) {
    const backfilled = await estimateMicronutrientsOnly(
      detail.name, detail.ingredients ?? [], detail.calories, region,
    );
    if (backfilled && hasUsableMicros(backfilled)) {
      detail = { ...detail, nutrients: backfilled };
    }
  }
  const llmMicros = toMicros(detail.nutrients);
  if (opts.usdaMicros) {
    const { matched, total } = opts.usdaMicros;
    const coverage = total > 0 ? matched / total : 0;
    const usdaWeight = Math.min(0.8, Math.max(0, coverage));
    const blended = matched > 0
      ? blendMicros(llmMicros, toMicros(opts.usdaMicros.micros as Partial<Micronutrients>), usdaWeight)
      : llmMicros;
    return {
      detail: { ...detail, nutrients: blended, nutrientMap: mergeMicrosIntoMap(detail.nutrientMap, blended) },
      meta: {
        provider: 'hybrid_llm_usda',
        matchedIngredients: matched,
        totalIngredients: total,
        usdaCoveragePct: safeRound(coverage * 100, 0),
        usedFallback: matched === 0,
      },
    };
  }
  const ingredients = (detail.ingredients || []).map(i => i.trim()).filter(Boolean).slice(0, 10);
  if (!USDA_API_KEY || ingredients.length === 0 || opts.blendIngredients === false) {
    return {
      detail: { ...detail, nutrients: llmMicros, nutrientMap: mergeMicrosIntoMap(detail.nutrientMap, llmMicros) },
      meta: {
        provider: 'hybrid_llm_usda',
        matchedIngredients: 0,
        totalIngredients: ingredients.length,
        usdaCoveragePct: 0,
        usedFallback: true,
      },
    };
  }

  let usdaMicros = zeroMicros();
  let matched = 0;

  for (let i = 0; i < ingredients.length; i++) {
    const ingredient = ingredients[i];
    const found = await fetchUsdaFoodNutrients(ingredient);
    if (!found || found.caloriesPer100g <= 0) continue;
    // Grams are guessed from a calorie share, which only works for foods
    // with real calorie density. For salt, pickles, mustard, "flavors" (a few
    // kcal per 100 g) the same share becomes hundreds of grams, and their
    // sodium swamped the meal (9 Oct 2026: 7,764 mg sodium for one McDouble,
    // 12,365 mg for a protein bar). Those ingredients keep the model's numbers.
    if (found.caloriesPer100g < LOW_DENSITY_KCAL_PER_100G) continue;

    matched += 1;
    const totalCalories = detail.calories > 0 ? detail.calories : 450;
    const kcalForIngredient = inferIngredientCalories(totalCalories, i, ingredients.length);
    const grams = Math.min(500, Math.max(12, (kcalForIngredient / found.caloriesPer100g) * 100));
    const scaled = scaleMicros(found.nutrients, grams / 100);
    usdaMicros = addMicros(usdaMicros, scaled);
  }

  const coverage = ingredients.length > 0 ? matched / ingredients.length : 0;
  const usdaWeight = Math.min(0.8, Math.max(0, coverage));
  const blended = matched > 0 ? blendMicros(llmMicros, usdaMicros, usdaWeight) : llmMicros;

  return {
    detail: { ...detail, nutrients: blended, nutrientMap: mergeMicrosIntoMap(detail.nutrientMap, blended) },
    meta: {
      provider: 'hybrid_llm_usda',
      matchedIngredients: matched,
      totalIngredients: ingredients.length,
      usdaCoveragePct: safeRound(coverage * 100, 0),
      usedFallback: matched === 0,
    },
  };
}

export function normalizeMicronutrients(input: Partial<Micronutrients> | null | undefined): Micronutrients {
  return toMicros(input);
}

