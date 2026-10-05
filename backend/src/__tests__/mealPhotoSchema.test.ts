import { describe, it, expect } from 'vitest';
import {
  buildMealPhotoV2Prompt,
  coerceExistingItems,
  coerceMealPhotoV2Response,
  coercePreparation,
  coerceRawItem,
  coerceVisibility,
  MEAL_PHOTO_V2_SCHEMA,
} from '../services/food/mealPhotoSchema.js';

describe('buildMealPhotoV2Prompt', () => {
  it('enumerates the commonly-missed item classes and forbids meal totals', () => {
    const p = buildMealPhotoV2Prompt({ imageCount: 1 });
    expect(p).toMatch(/partially hidden/i);
    expect(p).toMatch(/side bowls/i);
    expect(p).toMatch(/dressings and condiments/i);
    expect(p).toMatch(/cooking oil/i);
    expect(p).toMatch(/SKIP water, black coffee\/tea, and diet soda/);
    expect(p).toMatch(/DO NOT write meal totals/);
    expect(p).toMatch(/framingWarning/);
    expect(p).not.toMatch(/ALREADY LOGGED/);
  });

  it('asks to de-duplicate across multiple photos', () => {
    const p = buildMealPhotoV2Prompt({ imageCount: 3 });
    expect(p).toMatch(/3 photos of ONE meal/);
    expect(p).toMatch(/appears ONCE/);
  });

  it('lists existing items and asks only for new ones', () => {
    const p = buildMealPhotoV2Prompt({
      imageCount: 1,
      existingItems: [{ id: 'a', name: 'White rice', grams: 180.4 }, { id: null, name: 'Chicken curry', grams: null }],
    });
    expect(p).toMatch(/ALREADY LOGGED/);
    expect(p).toContain('- White rice (~180 g)');
    expect(p).toContain('- Chicken curry\n');
    expect(p).toMatch(/Return ONLY items that are NOT in that list/);
  });

  it('appends the regional block for West African regions only', () => {
    expect(buildMealPhotoV2Prompt({ imageCount: 1, region: 'global' }))
      .toBe(buildMealPhotoV2Prompt({ imageCount: 1 }));
    expect(buildMealPhotoV2Prompt({ imageCount: 1, region: 'ng' }).length)
      .toBeGreaterThan(buildMealPhotoV2Prompt({ imageCount: 1 }).length);
  });
});

describe('MEAL_PHOTO_V2_SCHEMA', () => {
  it('puts items first and has no meal-total fields', () => {
    const s = MEAL_PHOTO_V2_SCHEMA as any;
    expect(s.propertyOrdering[0]).toBe('items');
    for (const k of ['calories', 'proteinG', 'carbsG', 'fatG', 'nutrients']) expect(s.properties[k]).toBeUndefined();
    const item = s.properties.items.items;
    expect(item.properties.grams.nullable).toBe(true);
    expect(item.properties.usdaQuery.type).toBe('STRING');
    expect(s.properties.framingWarning.nullable).toBe(true);
  });
});

describe('descriptive coercion never rejects', () => {
  it('coerceVisibility maps synonyms, keeps plausible labels, defaults garbage', () => {
    expect(coerceVisibility('Partial')).toBe('partial');
    expect(coerceVisibility('hidden')).toBe('inferred');
    expect(coerceVisibility('cut off')).toBe('partial');
    expect(coerceVisibility('mostly visible')).toBe('mostly visible');
    expect(coerceVisibility(42)).toBe('full');
    expect(coerceVisibility('!!!')).toBe('full');
  });

  it('coercePreparation trims and nulls empties', () => {
    expect(coercePreparation(' Fried ')).toBe('fried');
    expect(coercePreparation('none')).toBeNull();
    expect(coercePreparation(7)).toBeNull();
  });

  it('coerceRawItem clamps numbers, nulls bad grams, defaults usdaQuery to name', () => {
    const it = coerceRawItem({ name: 'Egg', grams: '-5', calories: 'abc', proteinG: 6, fatG: 9999 });
    expect(it).toMatchObject({ name: 'Egg', usdaQuery: 'Egg', grams: null, calories: 0, proteinG: 6, fatG: 500 });
    expect(coerceRawItem({ grams: 10 })).toBeNull();
  });
});

describe('coerceMealPhotoV2Response', () => {
  it('coerces a full response', () => {
    const r = coerceMealPhotoV2Response({
      items: [{ name: 'Rice', usdaQuery: 'rice, white, cooked', grams: 180, visibility: 'full', calories: 230, proteinG: 4, carbsG: 50, fatG: 0.5 }, { nope: 1 }],
      framingWarning: 'A bowl is cut off on the left',
      noFoodDetected: false,
      mealType: 'lunch',
      name: 'Rice bowl',
      confidence: 'weird',
      plants: ['Rice'],
    });
    expect(r.items).toHaveLength(1);
    expect(r.framingWarning).toBe('A bowl is cut off on the left');
    expect(r.confidence).toBe('medium');
    expect(r.plants).toEqual(['rice']);
    expect(r.noFoodDetected).toBe(false);
  });

  it('treats an empty item list as no food and a "null" string as no warning', () => {
    const r = coerceMealPhotoV2Response({ items: [], framingWarning: 'null', mealType: 'brunch' });
    expect(r.noFoodDetected).toBe(true);
    expect(r.framingWarning).toBeNull();
    expect(r.mealType).toBe('meal');
    expect(r.name).toBe('Meal');
  });
});

describe('coerceExistingItems', () => {
  it('keeps name/id/grams and drops nameless entries without throwing', () => {
    const out = coerceExistingItems([
      { id: 'abc', name: 'Rice', grams: 150, visibility: 'something-new', source: 'usda' },
      { name: '' }, null, 'x', { name: 'Egg', grams: 'n/a' },
    ]);
    expect(out).toEqual([{ id: 'abc', name: 'Rice', grams: 150 }, { id: null, name: 'Egg', grams: null }]);
    expect(coerceExistingItems('nope')).toEqual([]);
  });
});
