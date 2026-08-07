// Recommendation engine — ranks whole foods by how much a single realistic
// serving closes the day's biggest nutrient gaps. Deterministic: gap vector ×
// food-contribution table. The route layer adds a mechanism sentence (grounded
// in the registry chain) and the food's category tag; the "Add" action is a
// client-side deep-link into the Coach log (no server write).
//
// Foods are whole/protein-structure biased per the spec voice. The table is a
// STARTER set — add rows freely; ranking scales to any registry nutrient.

import { getNutrient } from './nutrientRegistry.js';
import { buildGapVector, gainTextFor, scoreAgainstGap } from './nutritionGap.js';
import type { NutrientCoverage } from './nutritionProfileEngine.js';
import type { Candidate as FinderCandidate } from './foodFinderRanker.js';

/**
 * Where a food can realistically be bought. Drives which nearby store the food
 * finder is willing to attach to a recommendation — "beef liver at the Whole
 * Foods 400 m away" is only honest if the store plausibly stocks it.
 *
 * We deliberately do NOT model aisle-level inventory. We have no live stock
 * feed, so the claim is "this kind of store carries this kind of food", never
 * "this item is on the shelf right now".
 */
export type RetailAvailability = 'any_grocer' | 'large_grocer' | 'specialty';

export interface RetailInfo {
  availability: RetailAvailability;
  typicalPriceUsd?: number;
  aisle?: string;
}

export interface FoodSource {
  name: string;
  category: string;                    // tag chip, e.g. "Whole protein"
  serving: string;                     // human amount, e.g. "3 whole eggs"
  kcal: number;                        // calories in that serving
  provides: Record<string, number>;    // nutrient key → amount in that serving
  retail: RetailInfo;
  aliases?: string[];                  // alternate names for store/menu matching
}

const ANY = (usd: number, aisle?: string): RetailInfo => ({ availability: 'any_grocer', typicalPriceUsd: usd, aisle });
const BIG = (usd: number, aisle?: string): RetailInfo => ({ availability: 'large_grocer', typicalPriceUsd: usd, aisle });
const SPEC = (usd: number, aisle?: string): RetailInfo => ({ availability: 'specialty', typicalPriceUsd: usd, aisle });

export const FOOD_SOURCES: FoodSource[] = [
  // --- Animal protein -----------------------------------------------------
  { name: 'Whole eggs', category: 'Whole protein', serving: '3 large', kcal: 216, retail: ANY(1.2, 'Dairy'), provides: { proteinG: 18, fatG: 15, cholineMg: 440, vitaminDIU: 120, vitaminB12Mcg: 1.4, leucineG: 1.5 } },
  { name: 'Beef liver', category: 'Organ meat', serving: '100 g', kcal: 175, retail: SPEC(3, 'Butcher'), provides: { proteinG: 20, fatG: 5, cholineMg: 330, ironMg: 6.5, vitaminB12Mcg: 59, folateMcg: 260, zincMg: 4, vitaminAIU: 16000 } },
  { name: 'Wild salmon', category: 'Fatty fish', serving: '150 g', kcal: 273, retail: BIG(11, 'Seafood'), provides: { proteinG: 34, fatG: 14, omega3G: 2.3, vitaminDIU: 600, vitaminB12Mcg: 4.8, cholineMg: 140 } },
  { name: 'Sardines', category: 'Fatty fish', serving: '1 tin (90 g)', kcal: 191, retail: ANY(2.5, 'Canned fish'), provides: { proteinG: 22, fatG: 11, omega3G: 1.4, calciumMg: 350, vitaminDIU: 180, vitaminB12Mcg: 8 } },
  { name: 'Canned tuna (in water)', category: 'Lean protein', serving: '1 tin (142 g)', kcal: 130, retail: ANY(2, 'Canned fish'), provides: { proteinG: 30, fatG: 1, vitaminB12Mcg: 2.5, vitaminDIU: 60 } },
  { name: 'Mackerel', category: 'Fatty fish', serving: '100 g', kcal: 205, retail: BIG(6, 'Seafood'), provides: { proteinG: 19, fatG: 14, omega3G: 2.6, vitaminB12Mcg: 19, vitaminDIU: 360 } },
  { name: 'Herring', category: 'Fatty fish', serving: '100 g', kcal: 158, retail: BIG(5, 'Seafood'), provides: { proteinG: 18, fatG: 9, omega3G: 1.7, vitaminDIU: 210, vitaminB12Mcg: 13 } },
  { name: 'Cod fillet', category: 'Lean protein', serving: '150 g', kcal: 140, retail: BIG(9, 'Seafood'), provides: { proteinG: 31, fatG: 1, vitaminB12Mcg: 1.6, iodineMcg: 170 } },
  { name: 'Shrimp', category: 'Shellfish', serving: '150 g', kcal: 150, retail: BIG(8, 'Seafood'), provides: { proteinG: 29, fatG: 2, vitaminB12Mcg: 2.2, zincMg: 2.2 } },
  { name: 'Oysters', category: 'Shellfish', serving: '6 medium', kcal: 57, retail: SPEC(12, 'Seafood'), provides: { proteinG: 6, zincMg: 32, vitaminB12Mcg: 16, ironMg: 5, cholineMg: 130 } },
  { name: 'Mussels', category: 'Shellfish', serving: '100 g', kcal: 172, retail: BIG(5, 'Seafood'), provides: { proteinG: 24, ironMg: 6.7, vitaminB12Mcg: 24, omega3G: 0.8, folateMcg: 76 } },
  { name: 'Chicken breast', category: 'Lean protein', serving: '150 g', kcal: 248, retail: ANY(5, 'Meat'), provides: { proteinG: 46, fatG: 5, leucineG: 3.4, zincMg: 1.5, cholineMg: 120 } },
  { name: 'Rotisserie chicken', category: 'Lean protein', serving: '150 g', kcal: 250, retail: ANY(4, 'Deli'), aliases: ['roast chicken'], provides: { proteinG: 38, fatG: 10, zincMg: 2, cholineMg: 110, sodiumMg: 500 } },
  { name: 'Turkey breast', category: 'Lean protein', serving: '150 g', kcal: 230, retail: ANY(6, 'Meat'), provides: { proteinG: 45, fatG: 4, tryptophanG: 0.5, zincMg: 2.4, vitaminB12Mcg: 1.5 } },
  { name: 'Lean ground beef (90/10)', category: 'Red meat', serving: '150 g', kcal: 250, retail: ANY(6, 'Meat'), provides: { proteinG: 38, fatG: 11, ironMg: 3.2, zincMg: 8, vitaminB12Mcg: 3.5, saturatedFatG: 4.5 } },
  { name: 'Pork tenderloin', category: 'Lean protein', serving: '150 g', kcal: 210, retail: ANY(6, 'Meat'), provides: { proteinG: 39, fatG: 5, zincMg: 3, vitaminB12Mcg: 0.9 } },

  // --- Dairy + fermented --------------------------------------------------
  { name: 'Greek yogurt', category: 'Dairy', serving: '200 g', kcal: 130, retail: ANY(2, 'Dairy'), provides: { proteinG: 20, calciumMg: 230, leucineG: 2, tryptophanG: 0.25 } },
  { name: 'Skyr', category: 'Dairy', serving: '170 g', kcal: 100, retail: BIG(2.5, 'Dairy'), aliases: ['icelandic yogurt'], provides: { proteinG: 18, calciumMg: 190, leucineG: 1.8 } },
  { name: 'Cottage cheese', category: 'Dairy', serving: '150 g', kcal: 145, retail: ANY(2, 'Dairy'), provides: { proteinG: 17, calciumMg: 125, tryptophanG: 0.2, leucineG: 1.7, sodiumMg: 550 } },
  { name: 'Kefir', category: 'Fermented dairy', serving: '250 ml', kcal: 160, retail: BIG(3, 'Dairy'), provides: { proteinG: 9, calciumMg: 300, vitaminB12Mcg: 1.1, tryptophanG: 0.1 } },
  { name: 'Cheddar cheese', category: 'Dairy', serving: '30 g', kcal: 120, retail: ANY(1.5, 'Dairy'), provides: { proteinG: 7, fatG: 10, calciumMg: 200, saturatedFatG: 6, sodiumMg: 180 } },
  { name: 'Whole milk', category: 'Dairy', serving: '250 ml', kcal: 149, retail: ANY(1, 'Dairy'), provides: { proteinG: 8, fatG: 8, calciumMg: 300, vitaminDIU: 120, vitaminB12Mcg: 1.2, saturatedFatG: 4.6 } },
  { name: 'Fortified soy milk', category: 'Plant dairy', serving: '250 ml', kcal: 90, retail: ANY(1.2, 'Dairy'), aliases: ['soymilk'], provides: { proteinG: 7, calciumMg: 300, vitaminDIU: 100, vitaminB12Mcg: 1.2 } },
  { name: 'Sauerkraut', category: 'Fermented veg', serving: '1 cup', kcal: 27, retail: ANY(2, 'Condiments'), provides: { fiberG: 4, vitaminCMg: 21, sodiumMg: 940 } },
  { name: 'Kimchi', category: 'Fermented veg', serving: '1 cup', kcal: 23, retail: BIG(3, 'International'), provides: { fiberG: 2.4, vitaminCMg: 21, vitaminAIU: 1000, sodiumMg: 750 } },

  // --- Plant protein ------------------------------------------------------
  { name: 'Lentils', category: 'Legume', serving: '1 cup cooked', kcal: 230, retail: ANY(1, 'Dry goods'), provides: { proteinG: 18, carbsG: 40, fiberG: 15, folateMcg: 358, ironMg: 6.6, magnesiumMg: 71, potassiumMg: 730 } },
  { name: 'Black beans', category: 'Legume', serving: '1 cup cooked', kcal: 227, retail: ANY(1, 'Canned goods'), provides: { proteinG: 15, carbsG: 41, fiberG: 15, folateMcg: 256, magnesiumMg: 120, potassiumMg: 610 } },
  { name: 'Chickpeas', category: 'Legume', serving: '1 cup cooked', kcal: 269, retail: ANY(1, 'Canned goods'), aliases: ['garbanzo beans'], provides: { proteinG: 15, carbsG: 45, fiberG: 12.5, folateMcg: 282, ironMg: 4.7, magnesiumMg: 79 } },
  { name: 'White beans', category: 'Legume', serving: '1 cup cooked', kcal: 249, retail: ANY(1, 'Canned goods'), aliases: ['cannellini'], provides: { proteinG: 17, carbsG: 45, fiberG: 11, ironMg: 6.6, calciumMg: 161, magnesiumMg: 113, potassiumMg: 1000 } },
  { name: 'Edamame', category: 'Legume', serving: '1 cup', kcal: 188, retail: BIG(3, 'Frozen'), provides: { proteinG: 18, carbsG: 14, fiberG: 8, folateMcg: 480, magnesiumMg: 100, ironMg: 3.5 } },
  { name: 'Firm tofu', category: 'Plant protein', serving: '150 g', kcal: 175, retail: BIG(2.5, 'Refrigerated'), provides: { proteinG: 17, fatG: 10, calciumMg: 350, ironMg: 2.7, magnesiumMg: 55 } },
  { name: 'Tempeh', category: 'Plant protein', serving: '100 g', kcal: 192, retail: BIG(3.5, 'Refrigerated'), provides: { proteinG: 19, fatG: 11, fiberG: 7, magnesiumMg: 81, ironMg: 2.7 } },
  { name: 'Whey protein', category: 'Supplement', serving: '1 scoop (30 g)', kcal: 120, retail: BIG(1.5, 'Supplements'), aliases: ['protein powder'], provides: { proteinG: 24, leucineG: 2.7, calciumMg: 120 } },
  { name: 'Hummus', category: 'Legume', serving: '100 g', kcal: 166, retail: ANY(3, 'Refrigerated'), provides: { proteinG: 8, fatG: 10, fiberG: 6, folateMcg: 83, ironMg: 2.4, sodiumMg: 380 } },
  { name: 'Peanut butter', category: 'Nut butter', serving: '2 tbsp', kcal: 190, retail: ANY(0.6, 'Spreads'), provides: { proteinG: 8, fatG: 16, fiberG: 2, magnesiumMg: 54, vitaminEMg: 2.9 } },

  // --- Nuts + seeds -------------------------------------------------------
  { name: 'Pumpkin seeds', category: 'Seed', serving: '30 g', kcal: 170, retail: BIG(1.5, 'Nuts'), provides: { proteinG: 9, fatG: 14, magnesiumMg: 156, zincMg: 2.2, ironMg: 2.5 } },
  { name: 'Almonds', category: 'Nut', serving: '30 g', kcal: 173, retail: ANY(1.2, 'Nuts'), provides: { proteinG: 6, fatG: 15, magnesiumMg: 80, vitaminEMg: 7.3, fiberG: 3.5, calciumMg: 76 } },
  { name: 'Walnuts', category: 'Nut', serving: '30 g', kcal: 185, retail: ANY(1.8, 'Nuts'), provides: { proteinG: 4, fatG: 18, omega3G: 2.5, magnesiumMg: 45 } },
  { name: 'Brazil nuts', category: 'Nut', serving: '3 nuts', kcal: 99, retail: BIG(1, 'Nuts'), provides: { fatG: 10, magnesiumMg: 32, vitaminEMg: 2, seleniumMcg: 290 } },
  { name: 'Chia seeds', category: 'Seed', serving: '2 tbsp', kcal: 138, retail: BIG(1, 'Baking'), provides: { proteinG: 5, fatG: 9, omega3G: 5, fiberG: 10, calciumMg: 180, magnesiumMg: 95 } },
  { name: 'Ground flaxseed', category: 'Seed', serving: '2 tbsp', kcal: 110, retail: BIG(0.8, 'Baking'), provides: { proteinG: 4, fatG: 8.5, omega3G: 3.2, fiberG: 5, magnesiumMg: 80 } },
  { name: 'Sunflower seeds', category: 'Seed', serving: '30 g', kcal: 165, retail: ANY(1, 'Nuts'), provides: { proteinG: 6, fatG: 14, vitaminEMg: 10, magnesiumMg: 98, seleniumMcg: 15 } },

  // --- Vegetables ---------------------------------------------------------
  { name: 'Spinach', category: 'Leafy green', serving: '2 cups cooked', kcal: 82, retail: ANY(3, 'Produce'), provides: { proteinG: 10, folateMcg: 260, ironMg: 6, magnesiumMg: 157, potassiumMg: 840, vitaminCMg: 18, vitaminKMcg: 1800, vitaminAIU: 22000 } },
  { name: 'Kale', category: 'Leafy green', serving: '2 cups cooked', kcal: 72, retail: ANY(3, 'Produce'), provides: { proteinG: 5, fiberG: 5, calciumMg: 180, vitaminCMg: 106, vitaminKMcg: 1000, vitaminAIU: 17000 } },
  { name: 'Broccoli', category: 'Veg', serving: '2 cups cooked', kcal: 110, retail: ANY(2.5, 'Produce'), provides: { proteinG: 7, fiberG: 10, vitaminCMg: 200, folateMcg: 340, potassiumMg: 900, vitaminKMcg: 440 } },
  { name: 'Red bell pepper', category: 'Veg', serving: '1 large', kcal: 51, retail: ANY(1.5, 'Produce'), provides: { fiberG: 3, vitaminCMg: 190, vitaminAIU: 5700, folateMcg: 70 } },
  { name: 'Sweet potato', category: 'Starchy veg', serving: '1 medium', kcal: 103, retail: ANY(1, 'Produce'), provides: { carbsG: 24, potassiumMg: 540, fiberG: 4, vitaminAIU: 18000, vitaminCMg: 22 } },
  { name: 'Baked potato', category: 'Starchy veg', serving: '1 medium with skin', kcal: 161, retail: ANY(0.8, 'Produce'), provides: { carbsG: 37, potassiumMg: 926, fiberG: 4, vitaminCMg: 17, magnesiumMg: 48 } },
  { name: 'Pumpkin (cooked)', category: 'Veg', serving: '1 cup', kcal: 49, retail: ANY(2, 'Produce'), provides: { potassiumMg: 560, vitaminAIU: 12000, fiberG: 2.7 } },
  { name: 'Beets', category: 'Veg', serving: '1 cup cooked', kcal: 75, retail: ANY(2, 'Produce'), provides: { carbsG: 17, fiberG: 3.4, folateMcg: 136, potassiumMg: 519 } },
  { name: 'UV-exposed mushrooms', category: 'Veg', serving: '100 g', kcal: 22, retail: SPEC(3, 'Produce'), aliases: ['vitamin d mushrooms'], provides: { proteinG: 3, vitaminDIU: 400, seleniumMcg: 9 } },

  // --- Fruit --------------------------------------------------------------
  { name: 'Avocado', category: 'Fruit', serving: '1 medium', kcal: 240, retail: ANY(1.5, 'Produce'), provides: { fatG: 22, fiberG: 10, potassiumMg: 690, folateMcg: 120, magnesiumMg: 58, vitaminEMg: 4 } },
  { name: 'Banana', category: 'Fruit', serving: '1 medium', kcal: 105, retail: ANY(0.3, 'Produce'), provides: { carbsG: 27, potassiumMg: 422, fiberG: 3, vitaminB6Mg: 0.4, magnesiumMg: 32 } },
  { name: 'Orange', category: 'Fruit', serving: '1 medium', kcal: 62, retail: ANY(0.8, 'Produce'), provides: { carbsG: 15, vitaminCMg: 70, folateMcg: 40, fiberG: 3, potassiumMg: 237 } },
  { name: 'Kiwi', category: 'Fruit', serving: '2 medium', kcal: 84, retail: ANY(1.4, 'Produce'), provides: { carbsG: 20, vitaminCMg: 128, fiberG: 4, potassiumMg: 430, vitaminKMcg: 70 } },
  { name: 'Strawberries', category: 'Fruit', serving: '1 cup', kcal: 49, retail: ANY(3, 'Produce'), provides: { carbsG: 12, vitaminCMg: 89, fiberG: 3, folateMcg: 36 } },

  // --- Grains -------------------------------------------------------------
  { name: 'Rolled oats', category: 'Whole grain', serving: '60 g dry', kcal: 228, retail: ANY(0.5, 'Cereal'), provides: { proteinG: 8, carbsG: 40, fiberG: 6, magnesiumMg: 80, ironMg: 2.3, zincMg: 1.8 } },
  { name: 'Quinoa', category: 'Whole grain', serving: '1 cup cooked', kcal: 222, retail: ANY(1.5, 'Dry goods'), provides: { proteinG: 8, carbsG: 39, fiberG: 5, magnesiumMg: 118, folateMcg: 78, ironMg: 2.8 } },
  { name: 'Brown rice', category: 'Whole grain', serving: '1 cup cooked', kcal: 218, retail: ANY(0.6, 'Dry goods'), provides: { proteinG: 5, carbsG: 46, fiberG: 4, magnesiumMg: 79, seleniumMcg: 19 } },
  { name: 'Whole grain bread', category: 'Whole grain', serving: '2 slices', kcal: 160, retail: ANY(1, 'Bakery'), provides: { proteinG: 8, carbsG: 28, fiberG: 6, ironMg: 2, magnesiumMg: 50, sodiumMg: 300 } },

  // --- Targeted fixes -----------------------------------------------------
  { name: 'Nutritional yeast', category: 'Fortified', serving: '2 tbsp', kcal: 60, retail: BIG(1, 'Health foods'), aliases: ['nooch'], provides: { proteinG: 8, fiberG: 4, vitaminB12Mcg: 17.6, folateMcg: 240, zincMg: 3 } },
  { name: 'Dark chocolate (85%)', category: 'Treat', serving: '30 g', kcal: 170, retail: ANY(2, 'Snacks'), provides: { fatG: 13, magnesiumMg: 65, ironMg: 3.4, fiberG: 3, saturatedFatG: 8 } },
];

/**
 * The whole-food table as ranker candidates.
 *
 * These are the "ingredient" half of the food finder — curated, USDA-derived
 * figures, so they carry the highest confidence tier and act as the accuracy
 * anchor against LLM-estimated restaurant dishes. Store attachment happens
 * later (Phase 2); `retail` rides along in `meta` so the caller can decide
 * which nearby store is plausible.
 *
 * Type-only import of Candidate keeps this module free of a runtime cycle.
 */
export function foodSourceCandidates(sources: FoodSource[] = FOOD_SOURCES): FinderCandidate[] {
  return sources.map(food => ({
    id: `ingredient:${food.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name: food.name,
    kind: 'ingredient' as const,
    kcal: food.kcal,
    provides: food.provides,
    confidence: 'usda' as const,
    meta: {
      serving: food.serving,
      category: food.category,
      retail: food.retail,
      aliases: food.aliases ?? [],
    },
  }));
}

export interface FoodRecommendation {
  name: string;
  category: string;
  serving: string;
  // The single most-relevant nutrient this food closes, for the "+380 mg
  // choline" gain line.
  primaryNutrientKey: string;
  primaryNutrientLabel: string;
  primaryGainText: string;   // e.g. "+440 mg choline"
  score: number;             // gap-closing score, higher = better
  provides: Record<string, number>;
}

// Rank foods by how much they close the current FLOOR gaps. A food's score is
// the sum over its nutrients of (fraction of the remaining gap it fills) ×
// (how deficient that nutrient is), so it favours foods that hit the biggest
// holes. Ceiling nutrients (sodium…) never count as a "gain".
export function recommendFoods(
  coverage: NutrientCoverage[],
  bodyweightKg: number | null | undefined,
  limit = 6,
): FoodRecommendation[] {
  // Gap vector + per-food scoring both live in nutritionGap.ts now, shared with
  // the nearby food finder so the two surfaces can never rank differently.
  const gap = buildGapVector(coverage);
  if (gap.size === 0) return [];

  const scored: FoodRecommendation[] = [];
  for (const food of FOOD_SOURCES) {
    const { score, best } = scoreAgainstGap(food.provides, gap);
    if (score <= 0 || !best) continue;
    const def = getNutrient(best.key);
    scored.push({
      name: food.name,
      category: food.category,
      serving: food.serving,
      primaryNutrientKey: best.key,
      primaryNutrientLabel: def?.label ?? best.key,
      primaryGainText: gainTextFor(best.key, best.amount),
      score: Math.round(score * 1000) / 1000,
      provides: food.provides,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
