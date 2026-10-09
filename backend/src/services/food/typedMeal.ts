// One pipeline for typed food, wherever it's typed (chat, describe, voice):
//
//   1. parse        — the model's estimate, incl. micronutrients
//   2. enrich       — fill in micros the model left out (no USDA ingredient
//                     blend: guessing grams from calorie shares inflated them)
//   3. look up      — branded items: published macros AND label micros
//
// Order matters: enrichment runs before lookups so a label's own numbers are
// never blended away afterwards. Chat used to skip step 2 entirely, so the
// same meal had thinner micronutrients when logged in chat.

import { parseMealMacros, withBrandedLookups, type ParseMealOptions, type ParsedMealDetail } from '../llmService.js';
import { enrichMealDetailHybrid, type HybridEnrichmentMeta } from '../nutritionEnrichmentService.js';
import { TEXT_LOOKUP_ENABLED } from './brandedLookup.js';
import type { FoodRegion } from '../prompts/regionPrompts.js';

/** Steps 1–2: the enriched estimate, with branded items and questions still attached. */
export async function estimateTypedMeal(description: string, region: FoodRegion, opts: ParseMealOptions = {}): Promise<{ detail: ParsedMealDetail; meta: HybridEnrichmentMeta }> {
  const parsed = await parseMealMacros(description, region, { ...opts, lookup: false });
  // Fill in missing micros, but don't blend per-ingredient USDA guesses — they
  // inflated sodium/fibre/calcium several-fold. Branded items get real label
  // micros in step 3 instead.
  return enrichMealDetailHybrid(parsed, { region, blendIngredients: false });
}

/** Steps 1–3. `lookup: false` stops after enrichment (the describe screens run step 3 as a job). */
export async function parseTypedMeal(description: string, region: FoodRegion, opts: ParseMealOptions = {}): Promise<{ detail: ParsedMealDetail; meta: HybridEnrichmentMeta }> {
  const { detail, meta } = await estimateTypedMeal(description, region, opts);
  if (opts.lookup === false || !TEXT_LOOKUP_ENABLED() || !detail.brandedItems?.length) return { detail, meta };
  return { detail: await withBrandedLookups(detail, opts), meta };
}
