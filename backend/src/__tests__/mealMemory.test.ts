// Same meal, same numbers: a photo of a meal the user already logged reuses
// that log's items when it's clearly the same meal (≥60% items, totals ±25%).

import { describe, it, expect } from 'vitest';
import { anchorToPastMeal, parsePastItems, sameFood, type PastMeal } from '../services/food/mealMemory.js';
import type { MealItem } from '../services/food/mealPhotoItems.js';

const item = (name: string, grams: number, calories: number, source: MealItem['source'] = 'usda'): MealItem =>
  ({ id: name, name, preparation: null, grams, visibility: 'full', calories, proteinG: 10, carbsG: 10, fatG: 5, per100g: null, source });

const breakfast: PastMeal = {
  id: 'm1', date: '2026-10-13', name: 'Bagel and eggs',
  items: parsePastItems(JSON.stringify([
    { name: 'Multigrain bagel (102 g)', nutrients: { calories: 255, proteinG: 10.4, carbsG: 49.8, fatG: 1.6 } },
    { name: 'Scrambled eggs (93 g)', nutrients: { calories: 139, proteinG: 9.3, carbsG: 1.5, fatG: 10.2 } },
    { name: 'Cooking oil (5 g)', nutrients: { calories: 43, proteinG: 0, carbsG: 0, fatG: 4.8 } },
  ])),
};

describe('reading past logs', () => {
  it('takes names, grams and macros from the stored items', () => {
    expect(breakfast.items[0]).toEqual({ name: 'Multigrain bagel', grams: 102, calories: 255, proteinG: 10.4, carbsG: 49.8, fatG: 1.6 });
    expect(parsePastItems('not json')).toEqual([]);
  });
  it('matches the same food under slightly different names', () => {
    expect(sameFood('Scrambled eggs', 'Eggs, scrambled')).toBe(true);
    expect(sameFood('Whole wheat bagel', 'Multigrain bagel')).toBe(true);
    expect(sameFood('Salmon fillet', 'Chicken breast')).toBe(false);
  });
});

describe('anchoring a new photo', () => {
  it('reuses the logged numbers when it is the same meal', () => {
    const r = anchorToPastMeal([item('Bagel, multigrain', 120, 300), item('Eggs scrambled', 80, 120), item('Cooking oil', 7, 60)], [breakfast]);
    expect(r.match).toEqual({ mealId: 'm1', date: '2026-10-13', name: 'Bagel and eggs', items: 3 });
    expect(r.items.map((i) => i.calories)).toEqual([255, 139, 43]);
    expect(r.items[0]).toMatchObject({ name: 'Multigrain bagel', grams: 102, id: 'Bagel, multigrain' });
  });
  it('keeps a fresh estimate when the portion clearly changed (beyond ±25%)', () => {
    const r = anchorToPastMeal([item('Multigrain bagel', 204, 510), item('Scrambled eggs', 186, 278), item('Cooking oil', 10, 86)], [breakfast]);
    expect(r.match).toBeNull();
    expect(r.items[0].calories).toBe(510);
  });
  it('needs most of the items to match', () => {
    const r = anchorToPastMeal([item('Multigrain bagel', 100, 250), item('Salmon fillet', 150, 300), item('Rice', 150, 190)], [breakfast]);
    expect(r.match).toBeNull();
  });
  it('keeps a new side at its own estimate, and never touches brand-priced items', () => {
    const r = anchorToPastMeal([item('Multigrain bagel', 110, 270), item('Scrambled eggs', 90, 135), item('Cooking oil', 5, 43), item('Orange juice', 240, 110), item('Starbucks latte', 350, 190, 'brand')], [breakfast]);
    expect(r.match?.items).toBe(3);
    expect(r.items.find((i) => i.name === 'Orange juice')?.calories).toBe(110);
    expect(r.items.find((i) => i.name === 'Starbucks latte')?.calories).toBe(190);
  });
});
