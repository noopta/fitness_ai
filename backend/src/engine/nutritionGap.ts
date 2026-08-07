// The gap-scoring primitive, extracted so every "what should they eat" surface
// scores candidates the same way.
//
// This is the loop that used to live inline in recommendFoods(): build a vector
// of {how much of nutrient k is still owed, how urgently}, then score a food by
// how much of that vector one realistic serving closes. recommendFoods() still
// calls it and must keep producing byte-identical output; the nearby food
// finder calls it with a different weighting (macro/micro blend) and layers
// calorie fit, distance, and ceiling penalties on top.
//
// Deliberately knows nothing about foods, restaurants, or Prisma — it takes a
// `provides` map and returns a number.

import { getNutrient } from './nutrientRegistry.js';
import type { NutrientCoverage } from './nutritionProfileEngine.js';

export interface GapEntry {
  key: string;
  label: string;
  /** Units of this nutrient still owed. Always > 0 — satisfied keys are absent. */
  remaining: number;
  /**
   * How much a unit of gap-closing here is worth, 0..1+. The legacy caller uses
   * the deficit fraction; the finder substitutes a macro/micro blended weight.
   */
  weight: number;
}

export type GapVector = Map<string, GapEntry>;

export interface GapScore {
  score: number;
  /** The single nutrient this candidate closes most, for the "+440 mg choline" line. */
  best: { key: string; amount: number; contribution: number } | null;
}

/**
 * Build the floor-nutrient gap vector from profile coverage.
 *
 * Ceiling nutrients (sodium, added sugar) are excluded: overshooting them is
 * never a "gain". The finder handles them separately as a penalty, which is the
 * behaviour this function deliberately does NOT have — changing it here would
 * alter recommendFoods() output.
 */
export function buildGapVector(coverage: NutrientCoverage[]): GapVector {
  const gap: GapVector = new Map();
  for (const cov of coverage) {
    if (cov.ceiling) continue;
    const remaining = Math.max(0, cov.target - cov.amount);
    if (remaining <= 0) continue;
    // Deficit weight: how far below target, 0..1 (bigger = more urgent).
    const weight = Math.min(1, remaining / (cov.target || 1));
    gap.set(cov.key, { key: cov.key, label: cov.label, remaining, weight });
  }
  return gap;
}

/**
 * Score one candidate's nutrient contribution against a gap vector.
 *
 * Per nutrient: (fraction of the remaining gap this serving fills, capped at 1)
 * × (that nutrient's weight). Summed across nutrients, so foods that hit several
 * open holes beat foods that overshoot one.
 *
 * The cap matters — without it a serving providing 10× the remaining iron would
 * score 10× as well as one that exactly closes it, and liver would win forever.
 */
export function scoreAgainstGap(
  provides: Record<string, number>,
  gap: GapVector,
): GapScore {
  let score = 0;
  let best: GapScore['best'] = null;

  for (const [key, amount] of Object.entries(provides)) {
    const g = gap.get(key);
    if (!g || !Number.isFinite(amount) || amount <= 0) continue;
    const frac = Math.min(1, amount / g.remaining);
    const contribution = frac * g.weight;
    score += contribution;
    if (!best || contribution > best.contribution) best = { key, amount, contribution };
  }

  return { score, best };
}

/** "+440 mg choline" — the human gain line for a candidate's top nutrient. */
export function gainTextFor(key: string, amount: number, fallbackLabel?: string): string {
  const def = getNutrient(key);
  const unit = def?.unit ?? '';
  const label = def?.label ?? fallbackLabel ?? key;
  return `+${Math.round(amount)} ${unit} ${label.toLowerCase()}`;
}
