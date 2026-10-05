// USDA FoodData Central lookup for meal-photo v2: per-100 g macros for one
// item description, so item calories = grams × a fixed database profile
// instead of whatever the vision model guesses on this particular retake.
//
// Lab-grade datasets only (Foundation, SR Legacy, Survey/FNDDS). Branded is
// deliberately excluded: a generic "banana" top-matching banana chips at
// ~520 kcal/100 g is exactly the drift this module exists to remove (see the
// two-pass note in nutritionEnrichmentService). When nothing matches well the
// caller falls back to the model's own per-item numbers — a weak USDA match is
// worse than no match.
//
// Light on imports on purpose (no llmService) so it is cheap to unit test.

import { LruCache } from './mealPhotoCache.js';

const USDA_SEARCH_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';
export const USDA_TIMEOUT_MS = 2500;

/** FDC nutrient ids. Energy has three ids depending on dataset. */
export const NUTRIENT_IDS = {
  // 1008 = Energy (kcal, SR Legacy / FNDDS); 2047/2048 = Atwater energy, which
  // is all most Foundation foods carry.
  calories: [1008],
  caloriesAtwater: [2047, 2048],
  proteinG: [1003],
  fatG: [1004],
  carbsG: [1005],
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

export const MICRO_KEYS = [
  'fiberG', 'sugarG', 'sodiumMg', 'saturatedFatG', 'cholesterolMg', 'vitaminAIU', 'vitaminCMg',
  'vitaminDIU', 'vitaminEMg', 'vitaminB12Mcg', 'folateMcg', 'ironMg', 'calciumMg', 'magnesiumMg',
  'zincMg', 'potassiumMg', 'omega3G', 'omega6G',
] as const;
export type MicroKey = typeof MICRO_KEYS[number];

/** Sum of the matching nutrient values on an FDC search hit (0 if absent). */
export function extractNutrient(food: any, ids: readonly number[]): number {
  const nutrients = Array.isArray(food?.foodNutrients) ? food.foodNutrients : [];
  let sum = 0;
  for (const n of nutrients) {
    if (!ids.includes(n?.nutrientId)) continue;
    // Defensive: energy must be kcal; never sum a kJ row into it.
    if (typeof n?.unitName === 'string' && n.unitName.toUpperCase() === 'KJ') continue;
    if (typeof n?.value !== 'number' || !Number.isFinite(n.value)) continue;
    sum += n.value;
  }
  return sum;
}

export interface Per100g {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export interface UsdaCandidate {
  fdcId: number | null;
  description: string;
  dataType: string;
  per100g: Per100g;
  micros: Record<MicroKey, number>;
}

/** Parse one FDC search hit into a per-100 g profile, or null if unusable. */
export function parseUsdaFood(food: any): UsdaCandidate | null {
  const description = typeof food?.description === 'string' ? food.description : '';
  if (!description) return null;
  const proteinG = extractNutrient(food, NUTRIENT_IDS.proteinG);
  const carbsG = extractNutrient(food, NUTRIENT_IDS.carbsG);
  const fatG = extractNutrient(food, NUTRIENT_IDS.fatG);
  let calories = extractNutrient(food, NUTRIENT_IDS.calories);
  if (!calories) {
    // Foundation rows may carry both Atwater variants; take one, not the sum.
    const nutrients = Array.isArray(food?.foodNutrients) ? food.foodNutrients : [];
    const atwater = nutrients.find((n: any) => NUTRIENT_IDS.caloriesAtwater.includes(n?.nutrientId) && Number.isFinite(n?.value));
    calories = atwater ? Number(atwater.value) : 4 * proteinG + 4 * carbsG + 9 * fatG;
  }
  // Water, black coffee etc. are legitimately ~0 kcal, but an all-zero profile
  // is far more often a missing-nutrient record; treat it as unusable.
  if (!(calories > 0) && !(proteinG + carbsG + fatG > 0)) return null;
  const micros = {} as Record<MicroKey, number>;
  for (const k of MICRO_KEYS) micros[k] = extractNutrient(food, NUTRIENT_IDS[k]);
  return {
    fdcId: Number.isFinite(food?.fdcId) ? Number(food.fdcId) : null,
    description,
    dataType: typeof food?.dataType === 'string' ? food.dataType : '',
    per100g: { calories, proteinG, carbsG, fatG },
    micros,
  };
}

// ── Matching ─────────────────────────────────────────────────────────────────

const STOP = new Set(['with', 'and', 'or', 'of', 'the', 'a', 'an', 'in', 'on', 'ns', 'nfs', 'as', 'to', 'from', 'made', 'type', 'other']);

/** Lowercase, strip accents/punctuation, collapse whitespace. Also the cache key. */
export function foldQuery(q: string): string {
  return q
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function singular(t: string): string {
  if (t.length > 4 && t.endsWith('ies')) return t.slice(0, -3) + 'y';
  if (t.length > 4 && /(ches|shes|oes)$/.test(t)) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}

export function tokens(q: string): string[] {
  return foldQuery(q).split(' ').filter((t) => t && !STOP.has(t)).map(singular);
}

const RAW_PREP = new Set(['raw', 'fresh', 'uncooked']);

/**
 * Match quality 0..1+ for a candidate against the item's query.
 *  - recall (share of query words the description contains) dominates;
 *  - precision (share of description words that were asked for) breaks ties
 *    toward the plain entry over "chicken breast, breaded, fried, with skin";
 *  - small nudges for the preparation word and the dataset that suits it
 *    (FNDDS for cooked/prepared dishes, Foundation/SR Legacy for raw foods).
 * Returns -1 when the description lacks the head word (first query word):
 * "egg, fried" must not land on "Rice, fried" just because "fried" matched.
 */
export function scoreUsdaMatch(query: string, preparation: string | null, cand: Pick<UsdaCandidate, 'description' | 'dataType'>): number {
  const q = tokens(query);
  const d = new Set(tokens(cand.description));
  if (!q.length || !d.size) return -1;
  if (!d.has(q[0])) return -1;
  const hit = q.filter((t) => d.has(t)).length;
  const recall = hit / q.length;
  const precision = hit / d.size;
  let score = recall * 0.75 + precision * 0.25;
  const prep = preparation ? singular(foldQuery(preparation)) : null;
  const isRaw = !prep || RAW_PREP.has(prep);
  if (prep && !isRaw && d.has(prep)) score += 0.05;
  if (cand.dataType === 'Survey (FNDDS)' && !isRaw) score += 0.04;
  if ((cand.dataType === 'Foundation' || cand.dataType === 'SR Legacy') && isRaw) score += 0.04;
  return score;
}

export const MIN_MATCH_RECALL_SCORE = 0.6;

/**
 * Pick the best acceptable candidate, or null for a weak match.
 * `modelPer100Kcal` (the model's own kcal per 100 g, when it gave grams) is a
 * plausibility gate: a USDA profile 2.5× denser or sparser than what the
 * model saw is almost always the wrong food (dried vs fresh, chips vs fruit).
 */
export function pickBestMatch(
  query: string,
  preparation: string | null,
  candidates: UsdaCandidate[],
  modelPer100Kcal: number | null,
): UsdaCandidate | null {
  let best: UsdaCandidate | null = null;
  let bestScore = -Infinity;
  for (const c of candidates) {
    const s = scoreUsdaMatch(query, preparation, c);
    if (s < MIN_MATCH_RECALL_SCORE) continue;
    if (modelPer100Kcal && modelPer100Kcal > 0 && c.per100g.calories > 0) {
      const ratio = c.per100g.calories / modelPer100Kcal;
      if (ratio > 2.5 || ratio < 0.4) continue;
    }
    if (s > bestScore) { best = c; bestScore = s; }
  }
  return best;
}

// ── Fetch + cache ────────────────────────────────────────────────────────────

// Candidate lists keyed by folded query. Scoring runs per call (it depends on
// preparation and the model's kcal), so the cache holds the raw shortlist.
// A week is fine: FDC lab datasets change a few times a year.
const candidateCache = new LruCache<UsdaCandidate[]>(1000, 7 * 24 * 60 * 60 * 1000);

export function _resetUsdaCache(): void {
  candidateCache.clear();
}

export interface UsdaLookupDeps {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Search FDC for one query. Returns the parsed shortlist, [] for no results,
 * or null when the lookup could not run (no key, timeout, HTTP error) — null
 * results are not cached so a transient failure doesn't stick.
 */
export async function searchUsdaCandidates(query: string, deps: UsdaLookupDeps = {}): Promise<UsdaCandidate[] | null> {
  const apiKey = deps.apiKey ?? process.env.USDA_API_KEY ?? '';
  const key = foldQuery(query);
  if (!apiKey || !key) return null;
  const cached = candidateCache.get(key);
  if (cached) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? USDA_TIMEOUT_MS);
  try {
    const resp = await (deps.fetchImpl ?? fetch)(`${USDA_SEARCH_URL}?api_key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: query.trim(), pageSize: 10, dataType: ['Foundation', 'SR Legacy', 'Survey (FNDDS)'] }),
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    const json: any = await resp.json();
    const list = (Array.isArray(json?.foods) ? json.foods : [])
      .map(parseUsdaFood)
      .filter((c: UsdaCandidate | null): c is UsdaCandidate => !!c);
    candidateCache.set(key, list);
    return list;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Search + pick in one step. null = weak match or lookup unavailable. */
export async function lookupUsdaFood(
  query: string,
  preparation: string | null,
  modelPer100Kcal: number | null,
  deps: UsdaLookupDeps = {},
): Promise<UsdaCandidate | null> {
  const cands = await searchUsdaCandidates(query, deps);
  if (!cands?.length) return null;
  return pickBestMatch(query, preparation, cands, modelPer100Kcal);
}
