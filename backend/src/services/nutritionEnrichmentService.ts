import type { ParsedMealDetail, Micronutrients } from './llmService.js';

const USDA_API_KEY = process.env.USDA_API_KEY || '';
const USDA_SEARCH_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';

type UsdaFoodNutrients = {
  caloriesPer100g: number;
  nutrients: Micronutrients;
};

const NUTRIENT_IDS = {
  calories: [1008],
  fiberG: [1079],
  sugarG: [2000, 1063],
  sodiumMg: [1093],
  saturatedFatG: [1258],
  cholesterolMg: [1253],
  vitaminAIU: [1104],
  vitaminCMg: [1162],
  vitaminDIU: [1114, 1110],
  vitaminEMg: [1109],
  vitaminB12Mcg: [1178],
  folateMcg: [1177],
  ironMg: [1089],
  calciumMg: [1087],
  magnesiumMg: [1090],
  zincMg: [1095],
  potassiumMg: [1092],
  omega3G: [1270, 1271, 1272, 1273],
  omega6G: [1316, 1317, 1318],
} as const;

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

function extractNutrient(food: any, ids: readonly number[]): number {
  const nutrients = Array.isArray(food?.foodNutrients) ? food.foodNutrients : [];
  let sum = 0;
  for (const n of nutrients) {
    const nutrientId = n?.nutrientId;
    const value = n?.value;
    if (!ids.includes(nutrientId)) continue;
    if (typeof value !== 'number' || Number.isNaN(value)) continue;
    sum += value;
  }
  return sum;
}

async function fetchUsdaFoodNutrients(query: string): Promise<UsdaFoodNutrients | null> {
  if (!USDA_API_KEY) return null;
  const q = query.trim();
  if (!q) return null;

  const body = {
    query: q,
    pageSize: 1,
    dataType: ['Foundation', 'Survey (FNDDS)', 'Branded', 'SR Legacy'],
  };

  try {
    const resp = await fetch(`${USDA_SEARCH_URL}?api_key=${encodeURIComponent(USDA_API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) return null;
    const json: any = await resp.json();
    const food = json?.foods?.[0];
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
export async function enrichMealDetailHybrid(
  detail: ParsedMealDetail,
): Promise<{ detail: ParsedMealDetail; meta: HybridEnrichmentMeta }> {
  const llmMicros = toMicros(detail.nutrients);
  const ingredients = (detail.ingredients || []).map(i => i.trim()).filter(Boolean).slice(0, 10);
  if (!USDA_API_KEY || ingredients.length === 0) {
    return {
      detail: { ...detail, nutrients: llmMicros },
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
    detail: { ...detail, nutrients: blended },
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

