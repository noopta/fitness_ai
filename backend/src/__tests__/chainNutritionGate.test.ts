// One rule for every chain item (21 Oct 2026): 543 of 10,402 imported items had
// calories with no macros or macros that couldn't make their calories.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { nutritionProblem, isAlcoholic } from '../services/food/chainNutritionGate.js';
import { sound } from '../services/food/chainMenus.js';

describe('nutritionProblem', () => {
  it('passes sound numbers, including near-zero drinks', () => {
    expect(nutritionProblem({ calories: 1010, proteinG: 57, carbsG: 50, fatG: 65 })).toBeNull();
    expect(nutritionProblem({ calories: 5, proteinG: 1, carbsG: 0, fatG: 0 })).toBeNull();
  });
  it('refuses missing, calories-only and impossible macros', () => {
    expect(nutritionProblem({ calories: 1010, proteinG: null, carbsG: 50, fatG: 65 })).toBe('incomplete');
    expect(nutritionProblem({ calories: 1010, proteinG: 0, carbsG: 0, fatG: 0 })).toBe('calories_only');
    expect(nutritionProblem({ calories: 380, proteinG: 0, carbsG: 0, fatG: 18 }, 'Waffle')).toBe('macros_mismatch');
    expect(nutritionProblem({ calories: 840, proteinG: 16.8, carbsG: 112.5, fatG: 437 }, 'Taters')).toBe('macros_mismatch');
  });
  it('lets alcohol carry calories the macros don’t count — never the other way', () => {
    expect(isAlcoholic('Strawberry Margarita')).toBe(true);
    expect(nutritionProblem({ calories: 340, proteinG: 3, carbsG: 43, fatG: 0 }, 'Strawberry Margarita')).toBeNull();
    expect(nutritionProblem({ calories: 100, proteinG: 3, carbsG: 43, fatG: 10 }, 'Strawberry Margarita')).toBe('macros_mismatch');
    expect(isAlcoholic('Caesar Salad')).toBe(false);
  });
});

describe('the menu loader withholds unsound sizes', () => {
  it('drops a calories-only size and an item left with none', () => {
    const m: any = { chain: 'x', country: 'CA', defaultSize: 'regular', items: [
      { id: 'a', name: 'Good', sizes: [{ size: 'regular', calories: 710, proteinG: 33, carbsG: 50, fatG: 43 }] },
      { id: 'b', name: '10 Tenders', sizes: [{ size: 'regular', calories: 1140, proteinG: 0, carbsG: 0, fatG: 0 }] },
    ] };
    expect(sound(m).items.map((i: any) => i.id)).toEqual(['a']);
  });
  it('the importer uses the same rule (writeMenu.mjs mirrors this file)', () => {
    const src = readFileSync('scripts/chains/writeMenu.mjs', 'utf8');
    expect(src).toMatch(/k > 50 && atwater === 0\) return 'calories_only'/);
    expect(src).toMatch(/Math\.abs\(atwater - k\) \/ k > 0\.25 && Math\.abs\(atwater - k\) > 40/);
  });
});
