// Portion calibration: food types and per-type weight corrections.

import { describe, it, expect } from 'vitest';
import { foodGroup, calibrateItem, PORTION_FACTORS } from '../services/food/portionCalibration.js';

describe('foodGroup', () => {
  it('sorts items into food types by name and USDA query', () => {
    expect(foodGroup('Grilled chicken breast')).toBe('protein');
    expect(foodGroup('Steamed white rice', 'rice, white, cooked')).toBe('grain');
    expect(foodGroup('Olive oil drizzle')).toBe('fat_sauce');
    expect(foodGroup('Caesar dressing')).toBe('fat_sauce');
    expect(foodGroup('Broccoli florets')).toBe('vegetable');
    expect(foodGroup('Melon cubes', 'melons, honeydew, raw')).toBe('fruit');
    expect(foodGroup('Cheddar cheese')).toBe('dairy');
    expect(foodGroup('Chocolate chip cookie')).toBe('sweet');
    expect(foodGroup('Mystery item')).toBe('other');
  });
});

describe('calibrateItem', () => {
  const chicken = { name: 'Grilled chicken', grams: 200, calories: 330, proteinG: 62, carbsG: 0, fatG: 7, source: 'usda' };
  it('scales grams and macros by the food type factor', () => {
    const f = PORTION_FACTORS.protein;
    expect(f).toBeLessThan(1);
    expect(calibrateItem(chicken, 'chicken breast, grilled')).toMatchObject({ grams: Math.round(200 * f), calories: Math.round(330 * f) });
  });
  it('leaves brand-priced items and factor-1 types alone', () => {
    expect(calibrateItem({ ...chicken, source: 'brand' }, null)).toEqual({ ...chicken, source: 'brand' });
    const kale = { name: 'Kale salad', grams: 80, calories: 40, proteinG: 2, carbsG: 7, fatG: 1, source: 'usda' };
    expect(calibrateItem(kale, null)).toBe(kale);
  });
  it('keeps every factor in a safe band', () => {
    for (const v of Object.values(PORTION_FACTORS)) { expect(v).toBeGreaterThanOrEqual(0.6); expect(v).toBeLessThanOrEqual(1.6); }
  });
});
