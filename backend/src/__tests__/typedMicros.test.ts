import { describe, it, expect } from 'vitest';
import { coerceTypedFoods, usdaFoodMicros, blendTypedMicros, scaleMicros, withMicrosInMap, type FoodLookup } from '../services/food/typedMicros.js';
import { MICRO_KEYS } from '../services/food/usdaLookup.js';

const zero = () => Object.fromEntries(MICRO_KEYS.map((k) => [k, 0])) as any;
// USDA-like profiles per 100 g.
const NOODLES = { fdcId: 1, description: 'Noodles, egg, cooked', dataType: 'SR Legacy', per100g: { calories: 138, proteinG: 4.5, carbsG: 25, fatG: 2 }, micros: { ...zero(), ironMg: 1.5, folateMcg: 30, sodiumMg: 5, magnesiumMg: 20 } };
const CHICKEN = { fdcId: 2, description: 'Chicken, breast, roasted', dataType: 'SR Legacy', per100g: { calories: 165, proteinG: 31, carbsG: 0, fatG: 3.6 }, micros: { ...zero(), zincMg: 1, vitaminB12Mcg: 0.3, sodiumMg: 74, potassiumMg: 256 } };
const lookup: FoodLookup = async (q) => (/noodle/.test(q) ? NOODLES : /chicken/.test(q) ? CHICKEN : null) as any;

describe('typed-meal USDA micros', () => {
  it('coerces the parser list and drops foods without grams or calories', () => {
    const f = coerceTypedFoods([{ name: 'egg noodles', usdaQuery: 'noodles egg cooked', grams: 200, calories: 276 }, { name: 'salt', usdaQuery: 'salt', grams: 2, calories: 0 }, { name: 'x' }]);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ usdaQuery: 'noodles egg cooked', grams: 200, calories: 276, preparation: null });
  });

  it('micros follow the calories counted for each food (density × kcal), not a gram guess', async () => {
    const u = await usdaFoodMicros([{ name: 'egg noodles', usdaQuery: 'noodles egg cooked', preparation: 'cooked', grams: 200, calories: 276 }, { name: 'chicken', usdaQuery: 'chicken breast roasted', preparation: 'roasted', grams: 120, calories: 198 }, { name: 'mystery sauce', usdaQuery: 'house sauce', preparation: null, grams: 30, calories: 90 }], lookup);
    expect(u.matched).toBe(2);
    expect(u.matchedKcal).toBe(474);
    expect(u.micros.ironMg).toBeCloseTo((1.5 / 138) * 276, 2); // = 3.0 mg, same as 200 g × 1.5/100
    expect(u.micros.zincMg).toBeCloseTo((1 / 165) * 198, 2);
    expect(u.sources.map((s) => s.usda)).toEqual(['Noodles, egg, cooked', 'Chicken, breast, roasted']);
  });

  it('the model covers the unmatched share; sodium never drops below the model (salt has no calories)', async () => {
    const u = await usdaFoodMicros([{ name: 'egg noodles', usdaQuery: 'noodles egg cooked', preparation: 'cooked', grams: 200, calories: 276 }], lookup);
    const model = { ...zero(), ironMg: 4, vitaminCMg: 20, sodiumMg: 1400 };
    const out = blendTypedMicros(model, 552, u); // noodles are half the meal
    expect(out.ironMg).toBeCloseTo(3 + 4 * 0.5, 1);
    expect(out.vitaminCMg).toBeCloseTo(10, 1);
    expect(out.sodiumMg).toBe(1400);
  });

  it('the user’s own calories scale the micros', () => {
    expect(scaleMicros({ ironMg: 4, zincMg: 2 }, 600, 450)).toEqual({ ironMg: 3, zincMg: 1.5 });
    expect(scaleMicros({ ironMg: 4 }, 0, 450)).toEqual({ ironMg: 4 });
  });

  it('writes micros into the open map and clears ones USDA says are zero', () => {
    const m = withMicrosInMap({ cholineMg: 90, vitaminCMg: 12, proteinG: 30 }, { ...zero(), ironMg: 3 });
    expect(m).toEqual({ cholineMg: 90, proteinG: 30, ironMg: 3 });
  });
});

describe('withUsdaMicros (pipeline step)', () => {
  it('keeps the estimate when nothing matches, and records the source when it does', async () => {
    const { withUsdaMicros } = await import('../services/food/typedMeal.js');
    const base: any = { name: 'Noodles', calories: 552, proteinG: 30, carbsG: 60, fatG: 18, nutrients: { ...zero(), ironMg: 4, sodiumMg: 900 }, nutrientMap: { ironMg: 4 }, ingredients: [], tags: [], plants: [], fermentedFoods: [], ultraProcessed: false };
    const none = await withUsdaMicros({ ...base, foods: [{ name: 'house sauce', usdaQuery: 'house sauce', preparation: null, grams: 30, calories: 90 }] }, lookup);
    expect(none.nutrients.ironMg).toBe(4);
    expect(none.microSource).toBeUndefined();
    const hit = await withUsdaMicros({ ...base, foods: [{ name: 'egg noodles', usdaQuery: 'noodles egg cooked', preparation: 'cooked', grams: 200, calories: 276 }] }, lookup);
    expect(hit.nutrients.ironMg).toBeCloseTo(5, 1);
    expect(hit.nutrientMap.ironMg).toBeCloseTo(5, 1);
    expect(hit.microSource).toMatchObject({ usdaShare: 0.5, matched: 1, total: 1 });
  });
});
