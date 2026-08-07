import { describe, it, expect } from 'vitest';
import { buildGapVector, scoreAgainstGap, gainTextFor } from '../engine/nutritionGap.js';
import { FOOD_SOURCES, recommendFoods } from '../engine/nutritionRecommendations.js';
import type { NutrientCoverage } from '../engine/nutritionProfileEngine.js';

// Build a coverage row the way nutritionProfileEngine would.
function cov(
  key: string,
  amount: number,
  target: number,
  opts: { ceiling?: boolean; label?: string; unit?: string } = {},
): NutrientCoverage {
  const pct = target > 0 ? Math.round(Math.min((amount / target) * 100, 150)) : 0;
  return {
    key,
    label: opts.label ?? key,
    unit: opts.unit ?? 'mg',
    amount,
    target,
    pct,
    status: pct >= 90 ? 'ok' : pct >= 50 ? 'warn' : 'low',
    ceiling: opts.ceiling ?? false,
  };
}

describe('buildGapVector', () => {
  it('excludes ceiling nutrients — overshooting sodium is never a gain', () => {
    const gap = buildGapVector([
      cov('ironMg', 2, 12),
      cov('sodiumMg', 100, 2300, { ceiling: true }),
    ]);
    expect(gap.has('ironMg')).toBe(true);
    expect(gap.has('sodiumMg')).toBe(false);
  });

  it('excludes nutrients already at or over target', () => {
    const gap = buildGapVector([cov('ironMg', 12, 12), cov('zincMg', 20, 11)]);
    expect(gap.size).toBe(0);
  });

  it('weights by deficit fraction, capped at 1', () => {
    const gap = buildGapVector([cov('ironMg', 0, 12), cov('zincMg', 5.5, 11)]);
    expect(gap.get('ironMg')!.weight).toBe(1);
    expect(gap.get('zincMg')!.weight).toBeCloseTo(0.5, 5);
  });
});

describe('scoreAgainstGap', () => {
  const gap = buildGapVector([cov('ironMg', 0, 10), cov('zincMg', 0, 10)]);

  it('caps a single nutrient contribution at the size of the hole', () => {
    // 3x the remaining gap must not score 3x — otherwise liver wins forever.
    const exact = scoreAgainstGap({ ironMg: 10 }, gap);
    const triple = scoreAgainstGap({ ironMg: 30 }, gap);
    expect(triple.score).toBe(exact.score);
  });

  it('rewards hitting several open holes over overshooting one', () => {
    const spread = scoreAgainstGap({ ironMg: 10, zincMg: 10 }, gap);
    const single = scoreAgainstGap({ ironMg: 100 }, gap);
    expect(spread.score).toBeGreaterThan(single.score);
  });

  it('ignores nutrients that are not in the gap', () => {
    expect(scoreAgainstGap({ vitaminCMg: 500 }, gap).score).toBe(0);
  });

  it('ignores non-finite and non-positive amounts', () => {
    expect(scoreAgainstGap({ ironMg: NaN }, gap).score).toBe(0);
    expect(scoreAgainstGap({ ironMg: -5 }, gap).score).toBe(0);
  });

  it('reports the single biggest contributor as `best`', () => {
    const { best } = scoreAgainstGap({ ironMg: 9, zincMg: 1 }, gap);
    expect(best?.key).toBe('ironMg');
    expect(best?.amount).toBe(9);
  });

  it('returns a null best when nothing matches', () => {
    expect(scoreAgainstGap({}, gap).best).toBeNull();
  });
});

describe('gainTextFor', () => {
  it('renders unit and lowercased label from the registry', () => {
    expect(gainTextFor('ironMg', 6.5)).toBe('+7 mg iron');
  });

  it('falls back to the key when the nutrient is not in the registry', () => {
    expect(gainTextFor('unobtainiumMg', 3)).toBe('+3  unobtainiummg');
  });
});

// ---------------------------------------------------------------------------
// Regression lock: the extraction must not have changed recommendFoods output.
// This reimplements the ORIGINAL inline algorithm and asserts the refactored
// version agrees on the real FOOD_SOURCES table across several gap shapes.
// ---------------------------------------------------------------------------
function legacyRecommend(coverage: NutrientCoverage[], limit = 6) {
  const gap = new Map<string, { remaining: number; deficit: number; label: string }>();
  for (const c of coverage) {
    if (c.ceiling) continue;
    const remaining = Math.max(0, c.target - c.amount);
    if (remaining <= 0) continue;
    gap.set(c.key, { remaining, deficit: Math.min(1, remaining / (c.target || 1)), label: c.label });
  }
  if (gap.size === 0) return [];

  const scored: { name: string; primaryNutrientKey: string; score: number }[] = [];
  for (const food of FOOD_SOURCES) {
    let score = 0;
    let best: { key: string; frac: number; amount: number } | null = null;
    for (const [key, amount] of Object.entries(food.provides)) {
      const g = gap.get(key);
      if (!g) continue;
      const frac = Math.min(1, amount / g.remaining);
      const contribution = frac * g.deficit;
      score += contribution;
      if (!best || contribution > best.frac) best = { key, frac: contribution, amount };
    }
    if (score <= 0 || !best) continue;
    scored.push({
      name: food.name,
      primaryNutrientKey: best.key,
      score: Math.round(score * 1000) / 1000,
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

describe('recommendFoods regression lock', () => {
  const fixtures: Record<string, NutrientCoverage[]> = {
    'iron only': [cov('ironMg', 1, 12)],
    'broad shortfall': [
      cov('ironMg', 3, 12),
      cov('magnesiumMg', 100, 400),
      cov('fiberG', 5, 30, { unit: 'g' }),
      cov('vitaminB12Mcg', 0.5, 2.4, { unit: 'mcg' }),
      cov('sodiumMg', 3000, 2300, { ceiling: true }),
    ],
    'protein plus micros': [
      cov('proteinG', 40, 150, { unit: 'g' }),
      cov('calciumMg', 200, 1000),
      cov('potassiumMg', 900, 3400),
    ],
    'nearly satisfied': [cov('ironMg', 11.8, 12), cov('zincMg', 10.9, 11)],
  };

  for (const [name, coverage] of Object.entries(fixtures)) {
    it(`matches the pre-refactor algorithm: ${name}`, () => {
      const next = recommendFoods(coverage, null, 6).map(r => ({
        name: r.name,
        primaryNutrientKey: r.primaryNutrientKey,
        score: r.score,
      }));
      expect(next).toEqual(legacyRecommend(coverage, 6));
    });
  }

  it('returns nothing when every gap is closed', () => {
    expect(recommendFoods([cov('ironMg', 99, 12)], null)).toEqual([]);
  });
});
