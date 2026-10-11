// Meal-photo analysis orchestration (POST /nutrition/analyze-photo).
//
// v2 (mealPhotoV2 flag): image-hash cache → itemised Vertex call → USDA
// pricing per item → totals = sum of items → legacy micronutrients via the
// existing enrichment → contract-8 response.
// Legacy (flag off): today's analyzeMealPhoto + enrichment, unchanged, plus
// the contract-8 fields with the whole meal as a single item.
//
// The heavy dependencies (Vertex client, enrichment) are passed in by the
// route so this module stays testable without the OpenAI/Vertex mocks.

import { randomUUID } from 'node:crypto';
import type { ParsedMealDetail, Micronutrients } from '../llmService.js';
import type { HybridEnrichmentMeta } from '../nutritionEnrichmentService.js';
import type { FoodRegion } from '../prompts/regionPrompts.js';
import type { ExistingItemRef, MealPhotoV2Raw } from './mealPhotoSchema.js';
import { LruCache, mealPhotoCacheKey, recordAddPhotoGrant, type AddPhotoGrant } from './mealPhotoCache.js';
import { mealLevelItem, resolveItems, sumItems, itemId, type ItemLookup, type MealItem } from './mealPhotoItems.js';

/** Bump when the v2 prompt or schema changes so cached answers aren't reused. */
export const MEAL_PHOTO_PROMPT_VERSION = 'mp2-2026-10b'; // b: gemini-3.8-flash + MEDIUM thinking
export const RESPONSE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface PhotoInput {
  base64: string;
  mimeType: string;
}

export interface MealPhotoRequest {
  userId: string;
  images: PhotoInput[];
  existingItems: ExistingItemRef[];
  region: FoodRegion;
  v2: boolean;
  /** The user's most-logged foods, as names (photo prompt hints). */
  userFoods?: string[];
  /** Grant consumed by a free add-photo call; its new items share it. */
  addPhotoGrant?: AddPhotoGrant | null;
}

type Enrich = (
  detail: ParsedMealDetail,
  opts: { region?: FoodRegion; usdaMicros?: { micros: Partial<Record<keyof Micronutrients, number>>; matched: number; total: number } },
) => Promise<{ detail: ParsedMealDetail; meta: HybridEnrichmentMeta }>;

export interface MealPhotoDeps {
  model: string;
  analyzeV2: (images: PhotoInput[], opts: { existingItems?: ExistingItemRef[]; region?: FoodRegion; userFoods?: string[] }) => Promise<MealPhotoV2Raw>;
  /** Items the photo shows a brand for → official numbers (scans, records, food databases, web). Null = keep the estimate. */
  resolveBranded?: (items: Array<{ brand: string; product: string; estimate: { calories: number; proteinG: number; carbsG: number; fatG: number } }>, userId: string) => Promise<Array<{ calories: number; proteinG: number; carbsG: number; fatG: number; site: string | null; url: string | null } | null>>;
  analyzeLegacy: (imageBase64: string, mimeType: string, region: FoodRegion) => Promise<ParsedMealDetail>;
  enrich: Enrich;
  lookup?: ItemLookup;
  now?: () => number;
  log?: (line: string) => void;
}

export type MealPhotoResponse = ParsedMealDetail & {
  source: 'photo';
  enrichment: HybridEnrichmentMeta;
  items: MealItem[];
  framingWarning: string | null;
  noFoodDetected: boolean;
  analysisId: string;
};

// Final v2 responses (minus analysisId) keyed by image hash. 200 entries of a
// few KB each; identical photo → identical answer for 24 h.
const responseCache = new LruCache<Omit<MealPhotoResponse, 'analysisId'>>(200, RESPONSE_CACHE_TTL_MS);

export function _resetMealPhotoCache(): void {
  responseCache.clear();
}

const ZERO_MICROS: Micronutrients = {
  fiberG: 0, sugarG: 0, sodiumMg: 0, saturatedFatG: 0, cholesterolMg: 0, vitaminAIU: 0,
  vitaminCMg: 0, vitaminDIU: 0, vitaminEMg: 0, vitaminB12Mcg: 0, folateMcg: 0, ironMg: 0,
  calciumMg: 0, magnesiumMg: 0, zincMg: 0, potassiumMg: 0, omega3G: 0, omega6G: 0,
  glycemicIndex: null, glycemicLoad: null, digestiveSpeed: null, biochemicalEffects: null,
};

/** Legacy-shaped meal detail built from the priced items (totals = sum). */
export function detailFromItems(raw: MealPhotoV2Raw, items: MealItem[]): ParsedMealDetail {
  const totals = sumItems(items);
  return {
    name: items.length ? raw.name : 'No food detected',
    ...totals,
    mealType: raw.mealType,
    confidence: raw.confidence,
    notes: raw.notes,
    ingredients: items.map((i) => i.name).slice(0, 20),
    tags: raw.tags,
    nutrients: { ...ZERO_MICROS },
    plants: raw.plants,
    fermentedFoods: raw.fermentedFoods,
    ultraProcessed: raw.ultraProcessed,
    nutrientMap: {},
  };
}

/**
 * A logo, cup or wrapper in the photo → the brand's own numbers instead of a
 * USDA guess for a generic food (a Big Mac is not "hamburger, double").
 * Items keep their order, so raw[i] ↔ items[i]. Failures keep the estimate.
 */
export async function applyBrandedItems(raw: MealPhotoV2Raw, items: MealItem[], userId: string, deps: Pick<MealPhotoDeps, 'resolveBranded'>): Promise<number> {
  if (!deps.resolveBranded) return 0;
  const idx = raw.items.map((r, i) => (r.brand ? i : -1)).filter((i) => i >= 0 && items[i]);
  if (!idx.length) return 0;
  const answers = await deps.resolveBranded(idx.map((i) => ({ brand: raw.items[i].brand!, product: raw.items[i].name, estimate: { calories: items[i].calories, proteinG: items[i].proteinG, carbsG: items[i].carbsG, fatG: items[i].fatG } })), userId).catch(() => []);
  let n = 0;
  idx.forEach((i, k) => {
    const a = answers[k];
    if (!a) return;
    Object.assign(items[i], { calories: Math.round(a.calories), proteinG: a.proteinG, carbsG: a.carbsG, fatG: a.fatG, source: 'brand' as const, per100g: null, lookupSource: { site: a.site, url: a.url } });
    n++;
  });
  return n;
}

export async function runMealPhotoAnalysis(req: MealPhotoRequest, deps: MealPhotoDeps): Promise<MealPhotoResponse> {
  const now = deps.now ?? Date.now;
  const started = now();
  const analysisId = randomUUID();
  // The user's food hints change the answer, so they're part of the cache key.
  const hints = (req.userFoods ?? []).join('|');
  const version = req.v2 ? `${MEAL_PHOTO_PROMPT_VERSION}|${deps.model}${hints ? `|h:${hints}` : ''}` : 'legacy';
  const key = mealPhotoCacheKey(req.images, req.existingItems, req.region, version);
  // Item ids are `${prefix}-${i}`: deterministic per photo, so a cache hit
  // returns the same ids, and the prefix doubles as the add-photo grant id.
  const prefix = key.slice(0, 10);

  let response: MealPhotoResponse;
  let cacheHit = false;
  let usdaHits = 0;

  if (!req.v2) {
    const img = req.images[0];
    const parsed = await deps.analyzeLegacy(img.base64, img.mimeType, req.region);
    const { detail, meta } = await deps.enrich(parsed, { region: req.region });
    response = {
      ...detail,
      source: 'photo',
      enrichment: meta,
      items: [mealLevelItem(detail.name, detail, itemId(prefix, 0))],
      framingWarning: null,
      noFoodDetected: false,
      analysisId,
    };
  } else {
    const cached = responseCache.get(key, now());
    if (cached) {
      cacheHit = true;
      usdaHits = cached.items.filter((i) => i.source === 'usda').length;
      response = { ...cached, analysisId };
    } else {
      const raw = await deps.analyzeV2(req.images, { existingItems: req.existingItems, region: req.region, userFoods: req.userFoods });
      const resolved = await resolveItems(raw.items, prefix, deps.lookup);
      await applyBrandedItems(raw, resolved.items, req.userId, deps);
      usdaHits = resolved.usdaHits;
      const base = detailFromItems(raw, resolved.items);
      const { detail, meta } = await deps.enrich(base, { region: req.region, usdaMicros: resolved.usdaMicros });
      const body: Omit<MealPhotoResponse, 'analysisId'> = {
        ...detail,
        // Enrichment never touches macros today; pin them to the item sum
        // anyway so "totals = sum of items" can't silently break.
        ...sumItems(resolved.items),
        source: 'photo',
        enrichment: meta,
        items: resolved.items,
        framingWarning: raw.framingWarning,
        noFoodDetected: raw.noFoodDetected,
      };
      responseCache.set(key, body, now());
      response = { ...body, analysisId };
    }
    recordAddPhotoGrant(req.userId, prefix, req.addPhotoGrant ?? null, now());
  }

  (deps.log ?? ((l: string) => console.log('[meal-photo]', l)))(JSON.stringify({
    analysisId,
    userId: req.userId,
    model: deps.model,
    flag: req.v2 ? 'v2' : 'legacy',
    images: req.images.length,
    itemCount: response.items.length,
    usdaHits,
    cacheHit,
    latencyMs: now() - started,
    existingItems: req.existingItems.length,
    framingWarning: !!response.framingWarning,
    noFood: response.noFoodDetected,
  }));

  return response;
}
