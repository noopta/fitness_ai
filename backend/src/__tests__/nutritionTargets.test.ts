import { describe, it, expect } from 'vitest';
import { resolveTargets, quickTargets, fiberFor } from '../services/nutritionTargets.js';

describe('resolveTargets', () => {
  it('has no target when nothing is set — never a made-up default', () => {
    expect(resolveTargets({ savedProgram: null, coachProfile: null, dailyCalorieTarget: null })).toBeNull();
    expect(resolveTargets({ savedProgram: JSON.stringify({ phases: [] }), coachProfile: '{}' })).toBeNull();
  });
  it('reads the program’s nutrition plan first, fiber derived when missing', () => {
    const t = resolveTargets({ savedProgram: JSON.stringify({ nutritionPlan: { macros: { calories: 2600, proteinG: 180, carbsG: 300, fatG: 80 } } }), dailyCalorieTarget: 2000 });
    expect(t).toEqual({ calories: 2600, proteinG: 180, carbsG: 300, fatG: 80, fiberG: 36, source: 'plan' });
  });
  it('uses the quick targets, with a typed calorie number on top', () => {
    const cp = JSON.stringify({ nutritionTargets: { calories: 2500, proteinG: 170, carbsG: 280, fatG: 75, fiberG: 35 } });
    expect(resolveTargets({ coachProfile: cp })).toMatchObject({ calories: 2500, proteinG: 170, source: 'quick' });
    expect(resolveTargets({ coachProfile: cp, dailyCalorieTarget: 2300 })).toMatchObject({ calories: 2300, proteinG: 170, source: 'manual' });
  });
  it('a typed calorie number alone is calories only', () => {
    expect(resolveTargets({ dailyCalorieTarget: 2100 })).toEqual({ calories: 2100, proteinG: null, carbsG: null, fatG: null, fiberG: 29, source: 'manual' });
  });
});

describe('quickTargets', () => {
  it('gives a deficit for fat loss and more for gain, with real macros', () => {
    const base = { sex: 'male' as const, ageYears: 30, heightCm: 180, weightKg: 80, trainingDaysPerWeek: 4 };
    const lose = quickTargets({ ...base, goal: 'lose' });
    const keep = quickTargets({ ...base, goal: 'maintain' });
    const gain = quickTargets({ ...base, goal: 'gain' });
    expect(lose.calories).toBeLessThan(keep.calories);
    expect(gain.calories).toBeGreaterThan(keep.calories);
    expect(lose.proteinG).toBeGreaterThan(140);
    expect(keep.fiberG).toBe(fiberFor(keep.calories));
  });
});

import { summarizeRange } from '../services/nutritionTargets.js';
describe('summarizeRange', () => {
  const rows = [
    { date: '2026-10-06', mealType: 'breakfast', calories: 500, proteinG: 30, carbsG: 60, fatG: 15, fiberG: 8 },
    { date: '2026-10-06', mealType: 'dinner', calories: 900, proteinG: 60, carbsG: 90, fatG: 30, fiberG: null },
    { date: '2026-10-08', mealType: 'Lunch', calories: 700, proteinG: 50, carbsG: 70, fatG: 20, fiberG: 10 },
    { date: '2026-10-01', mealType: 'lunch', calories: 9999, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 },
  ];
  it('fills every day, averages over logged days only, and splits by meal', () => {
    const s = summarizeRange(rows, '2026-10-02', '2026-10-08');
    expect(s.days).toHaveLength(7);
    expect(s.loggedDays).toBe(2);
    expect(s.avg).toEqual({ kcal: 1050, proteinG: 70, carbsG: 110, fatG: 33, fiberG: 9 });
    expect(s.byMeal.find((m) => m.mealType === 'lunch')).toEqual({ mealType: 'lunch', avgKcal: 350, pct: 33 });
    expect(s.days.find((d) => d.date === '2026-10-07')).toMatchObject({ logged: false, kcal: 0 });
  });
  it('has no averages with nothing logged', () => {
    expect(summarizeRange([], '2026-10-08', '2026-10-08').avg).toBeNull();
  });
});
