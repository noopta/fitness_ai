// Recommendation engine — ranks whole foods by how much a single realistic
// serving closes the day's biggest nutrient gaps. Deterministic: gap vector ×
// food-contribution table. The route layer adds a mechanism sentence (grounded
// in the registry chain) and the food's category tag; the "Add" action is a
// client-side deep-link into the Coach log (no server write).
//
// Foods are whole/protein-structure biased per the spec voice. The table is a
// STARTER set — add rows freely; ranking scales to any registry nutrient.

import { NUTRIENTS, getNutrient } from './nutrientRegistry.js';
import type { NutrientCoverage } from './nutritionProfileEngine.js';

export interface FoodSource {
  name: string;
  category: string;                    // tag chip, e.g. "Whole protein"
  serving: string;                     // human amount, e.g. "3 whole eggs"
  provides: Record<string, number>;    // nutrient key → amount in that serving
}

export const FOOD_SOURCES: FoodSource[] = [
  { name: 'Whole eggs', category: 'Whole protein', serving: '3 large', provides: { proteinG: 18, cholineMg: 440, vitaminDIU: 120, vitaminB12Mcg: 1.4, leucineG: 1.5 } },
  { name: 'Beef liver', category: 'Organ meat', serving: '100 g', provides: { proteinG: 20, cholineMg: 330, ironMg: 6.5, vitaminB12Mcg: 59, folateMcg: 260, zincMg: 4 } },
  { name: 'Wild salmon', category: 'Fatty fish', serving: '150 g', provides: { proteinG: 34, omega3G: 2.3, vitaminDIU: 600, vitaminB12Mcg: 4.8, cholineMg: 140 } },
  { name: 'Sardines', category: 'Fatty fish', serving: '1 tin (90 g)', provides: { proteinG: 22, omega3G: 1.4, calciumMg: 350, vitaminDIU: 180, vitaminB12Mcg: 8 } },
  { name: 'Greek yogurt', category: 'Dairy', serving: '200 g', provides: { proteinG: 20, calciumMg: 230, leucineG: 2, tryptophanG: 0.25 } },
  { name: 'Chicken breast', category: 'Lean protein', serving: '150 g', provides: { proteinG: 46, leucineG: 3.4, zincMg: 1.5, cholineMg: 120 } },
  { name: 'Lentils', category: 'Legume', serving: '1 cup cooked', provides: { proteinG: 18, fiberG: 15, folateMcg: 358, ironMg: 6.6, magnesiumMg: 71, potassiumMg: 730 } },
  { name: 'Black beans', category: 'Legume', serving: '1 cup cooked', provides: { proteinG: 15, fiberG: 15, folateMcg: 256, magnesiumMg: 120, potassiumMg: 610 } },
  { name: 'Spinach', category: 'Leafy green', serving: '2 cups cooked', provides: { folateMcg: 260, ironMg: 6, magnesiumMg: 157, potassiumMg: 840, vitaminCMg: 18 } },
  { name: 'Pumpkin seeds', category: 'Seed', serving: '30 g', provides: { magnesiumMg: 156, zincMg: 2.2, ironMg: 2.5, proteinG: 9 } },
  { name: 'Almonds', category: 'Nut', serving: '30 g', provides: { magnesiumMg: 80, vitaminEMg: 7.3, fiberG: 3.5, proteinG: 6 } },
  { name: 'Oysters', category: 'Shellfish', serving: '6 medium', provides: { zincMg: 32, vitaminB12Mcg: 16, ironMg: 5, cholineMg: 130 } },
  { name: 'Sweet potato', category: 'Starchy veg', serving: '1 medium', provides: { potassiumMg: 540, fiberG: 4, vitaminAIU: 18000 } },
  { name: 'Chia seeds', category: 'Seed', serving: '2 tbsp', provides: { omega3G: 5, fiberG: 10, calciumMg: 180, magnesiumMg: 95 } },
  { name: 'Cottage cheese', category: 'Dairy', serving: '150 g', provides: { proteinG: 17, calciumMg: 125, tryptophanG: 0.2, leucineG: 1.7 } },
  { name: 'Pumpkin (cooked)', category: 'Veg', serving: '1 cup', provides: { potassiumMg: 560, vitaminAIU: 12000, fiberG: 2.7 } },
  { name: 'Turkey breast', category: 'Lean protein', serving: '150 g', provides: { proteinG: 45, tryptophanG: 0.5, zincMg: 2.4, vitaminB12Mcg: 1.5 } },
  { name: 'Kefir', category: 'Fermented dairy', serving: '250 ml', provides: { proteinG: 9, calciumMg: 300, vitaminB12Mcg: 1.1, tryptophanG: 0.1 } },
  { name: 'Edamame', category: 'Legume', serving: '1 cup', provides: { proteinG: 18, fiberG: 8, folateMcg: 480, magnesiumMg: 100, ironMg: 3.5 } },
  { name: 'Brazil nuts', category: 'Nut', serving: '3 nuts', provides: { magnesiumMg: 32, vitaminEMg: 2 } },
];

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
  // Build remaining-gap (in nutrient units) and deficiency weight per key.
  const gap = new Map<string, { remaining: number; deficit: number; label: string }>();
  for (const cov of coverage) {
    if (cov.ceiling) continue;
    const remaining = Math.max(0, cov.target - cov.amount);
    if (remaining <= 0) continue;
    // deficit weight: how far below target, 0..1 (bigger = more urgent)
    const deficit = Math.min(1, remaining / (cov.target || 1));
    gap.set(cov.key, { remaining, deficit, label: cov.label });
  }
  if (gap.size === 0) return [];

  const scored: FoodRecommendation[] = [];
  for (const food of FOOD_SOURCES) {
    let score = 0;
    let best: { key: string; frac: number; amount: number } | null = null;
    for (const [key, amount] of Object.entries(food.provides)) {
      const g = gap.get(key);
      if (!g) continue;
      const frac = Math.min(1, amount / g.remaining); // how much of the hole it fills
      const contribution = frac * g.deficit;
      score += contribution;
      if (!best || contribution > best.frac) best = { key, frac: contribution, amount };
    }
    if (score <= 0 || !best) continue;
    const def = getNutrient(best.key);
    const unit = def?.unit ?? '';
    scored.push({
      name: food.name,
      category: food.category,
      serving: food.serving,
      primaryNutrientKey: best.key,
      primaryNutrientLabel: def?.label ?? best.key,
      primaryGainText: `+${Math.round(best.amount)} ${unit} ${(def?.label ?? best.key).toLowerCase()}`,
      score: Math.round(score * 1000) / 1000,
      provides: food.provides,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
