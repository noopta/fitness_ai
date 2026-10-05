import { describe, it, expect } from 'vitest';
import {
  portionFrom, portionMacros, portionNutrients, portionTotals, portionMealNutrients, stepPortion, setPortionAmount,
  portionLabel, relevantMicros, mealSlotFor, type PortionSource,
} from '../src/portion';

const usda: PortionSource = {
  id: 'usda:1', name: 'Chicken breast, roasted', portion: { grams: 100 },
  macros: { calories: 165, proteinG: 31, carbsG: 0, fatG: 3.6 }, per100g: { calories: 165, proteinG: 31, carbsG: 0, fatG: 3.6 },
  nutrients: { ironMg: 1, vitaminB12Mcg: 0.3 },
};
const mine: PortionSource = {
  id: 'f1', name: 'Chicken wrap', portion: { grams: null },
  macros: { calories: 420, proteinG: 38, carbsG: 30, fatG: 14 }, per100g: null, nutrients: { ironMg: 3, fiberG: 6 },
};

describe('portions', () => {
  it('scales a weighed food from its per-100 g values', () => {
    const p = setPortionAmount(portionFrom(usda), '150');
    expect(p).toMatchObject({ unit: 'g', amount: 150 });
    expect(portionMacros(p)).toEqual({ calories: 248, proteinG: 46.5, carbsG: 0, fatG: 5.4 });
    expect(portionNutrients(p)).toEqual({ ironMg: 1.5, vitaminB12Mcg: 0.44999999999999996 });
  });

  it('scales a saved food by servings', () => {
    const p = stepPortion(portionFrom(mine), 1);
    expect(portionLabel(p)).toBe('1.5 servings');
    expect(portionMacros(p).calories).toBe(630);
  });

  it('steps grams by 10 under 100 and 25 above, never below one step', () => {
    let p = portionFrom(usda);
    expect(stepPortion(p, 1).amount).toBe(125);
    expect(stepPortion(p, -1).amount).toBe(90);
    p = setPortionAmount(p, '10');
    expect(stepPortion(stepPortion(p, -1), -1).amount).toBe(5);
    let s = portionFrom(mine);
    s = stepPortion(stepPortion(s, -1), -1);
    expect(s.amount).toBe(0.5);
  });

  it('ignores a typed zero or nonsense', () => {
    const p = portionFrom(usda);
    expect(setPortionAmount(p, '0')).toBe(p);
    expect(setPortionAmount(p, 'abc')).toBe(p);
  });

  it('totals a meal and sums its micronutrients', () => {
    const items = [setPortionAmount(portionFrom(usda), '200'), portionFrom(mine)];
    expect(portionTotals(items)).toEqual({ calories: 750, proteinG: 100, carbsG: 30, fatG: 21 });
    expect(portionMealNutrients(items)).toMatchObject({ ironMg: 5, fiberG: 6 });
  });
});

describe('relevantMicros', () => {
  const targets = [
    { key: 'ironMg', label: 'Iron', target: 18, direction: 'meet', focus: true },
    { key: 'fiberG', label: 'Fiber', target: 30, direction: 'meet' },
    { key: 'vitaminCMg', label: 'Vitamin C', target: 90, direction: 'meet' },
    { key: 'sodiumMg', label: 'Sodium', target: 2300, direction: 'limit' },
  ];
  it('puts the plan focus first, then what the meal covers most, skipping limits and zeros', () => {
    const r = relevantMicros({ ironMg: 3, fiberG: 12, sodiumMg: 900, vitaminCMg: 0 }, targets);
    expect(r).toEqual([{ key: 'ironMg', label: 'Iron', pct: 17, focus: true }, { key: 'fiberG', label: 'Fiber', pct: 40, focus: false }]);
  });
});

describe('mealSlotFor', () => {
  it('defaults the slot from the time of day', () => {
    expect(mealSlotFor(new Date(2026, 9, 5, 8))).toBe('breakfast');
    expect(mealSlotFor(new Date(2026, 9, 5, 12))).toBe('lunch');
    expect(mealSlotFor(new Date(2026, 9, 5, 19))).toBe('dinner');
    expect(mealSlotFor(new Date(2026, 9, 5, 23))).toBe('snack');
  });
});
