import { describe, it, expect, vi } from 'vitest';
import {
  mealLevelItem,
  modelItem,
  reconcileAtwater,
  resolveItems,
  sumItems,
  usdaItem,
} from '../services/food/mealPhotoItems.js';
import type { RawPhotoItem } from '../services/food/mealPhotoSchema.js';
import type { UsdaCandidate } from '../services/food/usdaLookup.js';

const raw = (o: Partial<RawPhotoItem>): RawPhotoItem => ({
  name: 'Item', usdaQuery: 'item', preparation: null, grams: 100, visibility: 'full',
  calories: 100, proteinG: 5, carbsG: 15, fatG: 2.2, ...o,
});

const usda = (kcal: number, p: number, c: number, f: number, potassium = 0): UsdaCandidate => ({
  fdcId: 1, description: 'x', dataType: 'SR Legacy',
  per100g: { calories: kcal, proteinG: p, carbsG: c, fatG: f },
  micros: { potassiumMg: potassium } as any,
});

describe('reconcileAtwater (4/4/9)', () => {
  it('keeps calories within 15% of 4P+4C+9F', () => {
    // 4*10 + 4*20 + 9*5 = 165; 180 is +9%.
    expect(reconcileAtwater({ calories: 180, proteinG: 10, carbsG: 20, fatG: 5 })).toEqual({ calories: 180, reconciled: false });
  });
  it('trusts macros when calories are >15% off', () => {
    expect(reconcileAtwater({ calories: 400, proteinG: 10, carbsG: 20, fatG: 5 })).toEqual({ calories: 165, reconciled: true });
    expect(reconcileAtwater({ calories: 100, proteinG: 10, carbsG: 20, fatG: 5 })).toEqual({ calories: 165, reconciled: true });
  });
  it('leaves calories alone when there are no macros', () => {
    expect(reconcileAtwater({ calories: 120, proteinG: 0, carbsG: 0, fatG: 0 })).toEqual({ calories: 120, reconciled: false });
  });
});

describe('modelItem / usdaItem', () => {
  it('model item derives per100g from grams', () => {
    const it = modelItem(raw({ grams: 200, calories: 200, proteinG: 10, carbsG: 30, fatG: 4.4 }), 'p-0');
    expect(it.source).toBe('model');
    expect(it.per100g).toEqual({ calories: 100, proteinG: 5, carbsG: 15, fatG: 2.2 });
  });
  it('model item without grams has per100g null and reconciles calories', () => {
    const it = modelItem(raw({ grams: null, calories: 900, proteinG: 10, carbsG: 20, fatG: 5 }), 'p-0');
    expect(it.per100g).toBeNull();
    expect(it.grams).toBeNull();
    expect(it.calories).toBe(165);
  });
  it('usda item = grams × per100g', () => {
    const it = usdaItem(raw({ name: 'Rice' }), 'p-1', 180, usda(130, 2.7, 28.2, 0.3));
    expect(it).toMatchObject({ source: 'usda', grams: 180, calories: 234, proteinG: 4.9, carbsG: 50.8, fatG: 0.5 });
    expect(it.per100g).toEqual({ calories: 130, proteinG: 2.7, carbsG: 28.2, fatG: 0.3 });
  });
});

describe('sumItems', () => {
  it('totals are the sum of items', () => {
    expect(sumItems([
      { calories: 100, proteinG: 1.25, carbsG: 2, fatG: 3 },
      { calories: 50.4, proteinG: 1.25, carbsG: 0, fatG: 0.1 },
    ])).toEqual({ calories: 150, proteinG: 2.5, carbsG: 2, fatG: 3.1 });
    expect(sumItems([])).toEqual({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0 });
  });
});

describe('resolveItems', () => {
  it('prices matched items from USDA, falls back per item, skips lookup without grams', async () => {
    const lookup = vi.fn(async (q: string) => (q === 'rice' ? usda(130, 2.7, 28, 0.3, 35) : null));
    const injected = await resolveItems([
      raw({ name: 'Rice', usdaQuery: 'rice', grams: 200, calories: 250, proteinG: 5, carbsG: 55, fatG: 1 }),
      raw({ name: 'Mystery sauce', usdaQuery: 'mystery sauce', grams: 30 }),
      raw({ name: 'Oil', usdaQuery: 'oil', grams: null, calories: 90, proteinG: 0, carbsG: 0, fatG: 10 }),
    ], 'abcdef0123', lookup);
    expect(lookup).toHaveBeenCalledTimes(2);
    // model per-100g kcal is passed as the plausibility hint: 250 kcal / 200 g.
    expect(lookup.mock.calls[0]).toEqual(['rice', null, 125]);
    const [rice, sauce, oil] = injected.items;
    expect(rice).toMatchObject({ id: 'abcdef0123-0', source: 'usda', calories: 260 });
    expect(sauce).toMatchObject({ id: 'abcdef0123-1', source: 'model' });
    expect(oil).toMatchObject({ id: 'abcdef0123-2', source: 'model', per100g: null });
    expect(injected.usdaHits).toBe(1);
    expect(injected.usdaMicros).toMatchObject({ matched: 1, total: 3 });
    expect(injected.usdaMicros.micros.potassiumMg).toBe(70);
  });

  it('a throwing lookup degrades that item to the model numbers', async () => {
    const out = await resolveItems([raw({ name: 'Egg' })], 'abcdef0123', async () => { throw new Error('boom'); });
    expect(out.items[0].source).toBe('model');
    expect(out.usdaHits).toBe(0);
  });

  it('is deterministic for the same inputs', async () => {
    const lookup = async () => usda(130, 2.7, 28, 0.3);
    const a = await resolveItems([raw({ grams: 150 })], 'abcdef0123', lookup);
    const b = await resolveItems([raw({ grams: 150 })], 'abcdef0123', lookup);
    expect(a).toEqual(b);
  });
});

describe('mealLevelItem', () => {
  it('builds the flag-off single item', () => {
    expect(mealLevelItem('Bowl', { calories: 500.4, proteinG: 30.04, carbsG: 50, fatG: 20 }, 'x-0')).toEqual({
      id: 'x-0', name: 'Bowl', preparation: null, grams: null, visibility: 'full',
      calories: 500, proteinG: 30, carbsG: 50, fatG: 20, per100g: null, source: 'model',
    });
  });
});
