import { describe, it, expect } from 'vitest';
import { rankFoodResults, usdaName, mineResult, recipeResult, usdaResult } from '../services/food/foodSearch.js';

const d = (s: string) => new Date(s);
const food = (id: string, name: string, useCount: number, updatedAt = '2026-10-01') => ({ id, name, calories: 420, proteinG: 38, carbsG: 30, fatG: 14, nutrientsJson: JSON.stringify({ ironMg: 3, fiberG: 6 }), useCount, updatedAt: d(updatedAt) });
const recipe = (id: string, name: string, useCount = 1, updatedAt = '2026-10-02') => ({ id, name, calories: 610, proteinG: 45, carbsG: 60, fatG: 18, nutrientsJson: null, useCount, servings: 4, updatedAt: d(updatedAt) });
const usda = (fdcId: number, description: string, kcal = 165) => ({
  fdcId, description, dataType: 'SR Legacy', per100g: { calories: kcal, proteinG: 31, carbsG: 0, fatG: 3.6 },
  micros: { ironMg: 1, fiberG: 0 } as any,
});

describe('rankFoodResults', () => {
  it('puts yours first (most logged), then recipes, then USDA', () => {
    const r = rankFoodResults({
      q: 'chicken', scope: 'all',
      foods: [food('f1', 'Chicken rice bowl', 2), food('f2', 'Chicken wrap', 6), food('f3', 'Oats', 9)],
      recipes: [recipe('r1', 'Chicken curry'), recipe('r2', 'Lentil soup')],
      usda: [usda(1, 'Chicken, broiler or fryers, breast, skinless, boneless, meat only, cooked, roasted')],
    });
    expect(r.map((x) => [x.kind, x.name])).toEqual([
      ['mine', 'Chicken wrap'], ['mine', 'Chicken rice bowl'], ['recipe', 'Chicken curry'], ['usda', 'Chicken breast, roasted'],
    ]);
    expect(r[0].caption).toBe('Yours · logged 6 times');
    expect(r[2].caption).toBe('Your recipe');
    expect(r[3]).toMatchObject({ caption: 'USDA · per 100 g', kcal: 165, portion: { grams: 100 } });
  });

  it('matches recipes case-insensitively and drops USDA rows that duplicate yours', () => {
    const r = rankFoodResults({ q: 'OATS', scope: 'all', foods: [food('f', 'Oats', 1)], recipes: [recipe('r', 'overnight oats')], usda: [usda(2, 'Oats')] });
    expect(r.map((x) => x.kind)).toEqual(['mine', 'recipe']);
  });

  it('narrows to a scope', () => {
    const args = { q: 'chicken', foods: [food('f', 'Chicken wrap', 1)], recipes: [recipe('r', 'Chicken curry')], usda: [usda(1, 'Chicken, roasted')] };
    expect(rankFoodResults({ ...args, scope: 'mine' }).map((x) => x.kind)).toEqual(['mine']);
    expect(rankFoodResults({ ...args, scope: 'recipes' }).map((x) => x.kind)).toEqual(['recipe']);
  });

  it('shows recent foods and recipes before typing', () => {
    const r = rankFoodResults({ q: '', scope: 'all', foods: [food('old', 'Old', 50, '2026-09-01'), food('new', 'New', 1, '2026-10-04')], recipes: [recipe('r', 'Soup')], usda: null });
    expect(r.map((x) => x.id)).toEqual(['new', 'old', 'r']);
  });

  it('survives USDA being unavailable', () => {
    expect(rankFoodResults({ q: 'egg', scope: 'all', foods: [], recipes: [], usda: null })).toEqual([]);
  });
});

describe('result shapes', () => {
  it('carries macros and nutrients for the default portion', () => {
    expect(mineResult(food('f', 'Wrap', 1))).toMatchObject({ portion: { grams: null, label: '1 serving' }, macros: { calories: 420, proteinG: 38 }, per100g: null, nutrients: { ironMg: 3, fiberG: 6 } });
    expect(recipeResult(recipe('r', 'Curry')).nutrients).toBeNull();
    const u = usdaResult(usda(7, 'Egg, whole, cooked, hard-boiled', 155));
    expect(u).toMatchObject({ id: 'usda:7', per100g: { calories: 155 }, nutrients: { ironMg: 1 } });
  });
  it('shortens USDA descriptions', () => {
    expect(usdaName('Rice, white, long-grain, regular, enriched, cooked')).toBe('Rice white, cooked');
    expect(usdaName('Bananas, raw')).toBe('Bananas, raw');
  });
});
