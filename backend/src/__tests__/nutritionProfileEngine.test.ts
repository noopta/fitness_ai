// Nutrition Profile engine — body-system scoring, coverage, open-vector
// handling, per-kg targets, ceiling nutrients, recommendations ranking.

import { describe, it, expect } from 'vitest';
import {
  runNutritionProfileEngine, sumNutrientMaps, effectiveTarget,
} from '../engine/nutritionProfileEngine.js';
import { recommendFoods } from '../engine/nutritionRecommendations.js';
import { getNutrient, NUTRIENTS } from '../engine/nutrientRegistry.js';

describe('sumNutrientMaps', () => {
  it('sums open maps across meals and injects calories', () => {
    const totals = sumNutrientMaps(
      [{ proteinG: 30, cholineMg: 200 }, { proteinG: 20, ironMg: 4 }, null],
      [500, 400],
    );
    expect(totals.proteinG).toBe(50);
    expect(totals.cholineMg).toBe(200);
    expect(totals.ironMg).toBe(4);
    expect(totals.calories).toBe(900);
  });
});

describe('effectiveTarget', () => {
  it('applies the per-kg floor when bodyweight is known', () => {
    const protein = getNutrient('proteinG')!;
    // perKgTarget 1.6 × 90kg = 144 > base 130
    expect(effectiveTarget(protein, 90)).toBe(144);
    // small athlete: base floor wins
    expect(effectiveTarget(protein, 60)).toBe(130);
    // no bodyweight → base
    expect(effectiveTarget(protein, null)).toBe(130);
  });
});

describe('runNutritionProfileEngine', () => {
  it('scores systems, coverage and a profile score from open totals', () => {
    const out = runNutritionProfileEngine({
      totals: { calories: 2000, proteinG: 140, cholineMg: 550, omega3G: 1.6, ironMg: 12, magnesiumMg: 400 },
      bodyweightKg: 80,
      mealsLogged: 3,
    });
    expect(out.kcalLogged).toBe(2000);
    expect(out.systems).toHaveLength(5);
    // Recovery should score well — protein + omega3 near target
    const recovery = out.systems.find(s => s.id === 'recovery')!;
    expect(recovery.score).toBeGreaterThan(40);
    expect(recovery.chips.length).toBeGreaterThan(0);
    expect(out.profileScore).toBeGreaterThanOrEqual(0);
    expect(out.profileScore).toBeLessThanOrEqual(100);
    // coverage sorted worst-first
    expect(out.coverage[0].pct).toBeLessThanOrEqual(out.coverage[out.coverage.length - 1].pct);
  });

  it('flags a nutrient-poor day as low across systems', () => {
    const out = runNutritionProfileEngine({
      totals: { calories: 1200, proteinG: 30 },
      bodyweightKg: 80,
      mealsLogged: 1,
    });
    const cognition = out.systems.find(s => s.id === 'cognition')!;
    expect(cognition.status).toBe('low'); // no choline/b12/iron logged
    expect(out.microCoveragePct).toBeLessThan(40);
  });

  it('treats ceiling nutrients (sodium) as a cap, not a floor', () => {
    const low = runNutritionProfileEngine({ totals: { sodiumMg: 1500, calories: 1000 }, mealsLogged: 1 });
    const high = runNutritionProfileEngine({ totals: { sodiumMg: 5000, calories: 1000 }, mealsLogged: 1 });
    const covLow = low.coverage.find(c => c.key === 'sodiumMg')!;
    const covHigh = high.coverage.find(c => c.key === 'sodiumMg')!;
    expect(covLow.ceiling).toBe(true);
    expect(covLow.status).toBe('ok');   // under target = good
    expect(covHigh.status).toBe('low'); // way over = bad
    // sodium must not count toward coverage %
    expect(low.coverage.filter(c => c.ceiling).every(c => c.ceiling)).toBe(true);
  });

  it('surfaces logged nutrients with no registry row as extras', () => {
    const out = runNutritionProfileEngine({
      totals: { calories: 800, proteinG: 20, lycopeneMg: 12, seleniumMcg: 40 },
      mealsLogged: 1,
    });
    const keys = out.extras.map(e => e.key);
    expect(keys).toContain('lycopeneMg');
    expect(keys).toContain('seleniumMcg');
    // extras are sorted by amount desc
    expect(out.extras[0].amount).toBeGreaterThanOrEqual(out.extras[out.extras.length - 1].amount);
  });

  it('is not hard-limited to any nutrient count (registry-driven)', () => {
    // every registry nutrient appears in coverage
    const out = runNutritionProfileEngine({ totals: { calories: 1000 }, mealsLogged: 1 });
    expect(out.coverage).toHaveLength(NUTRIENTS.length);
  });
});

describe('recommendFoods', () => {
  it('ranks foods that close the biggest gaps first, with a quantified gain', () => {
    const out = runNutritionProfileEngine({
      totals: { calories: 1500, proteinG: 40 }, // big choline/iron/omega3 gaps
      bodyweightKg: 80,
      mealsLogged: 2,
    });
    const recs = recommendFoods(out.coverage, 80, 6);
    expect(recs.length).toBeGreaterThan(0);
    expect(recs[0].primaryGainText).toMatch(/^\+\d+ /);
    // scores are descending
    for (let i = 1; i < recs.length; i++) expect(recs[i - 1].score).toBeGreaterThanOrEqual(recs[i].score);
  });

  it('returns nothing when every floor target is already met', () => {
    const bigTotals: Record<string, number> = { calories: 2500 };
    for (const n of NUTRIENTS) if (!n.drives.some(d => d.direction === 'ceiling')) bigTotals[n.key] = n.target * 3;
    const out = runNutritionProfileEngine({ totals: bigTotals, bodyweightKg: 80, mealsLogged: 4 });
    expect(recommendFoods(out.coverage, 80)).toHaveLength(0);
  });
});
