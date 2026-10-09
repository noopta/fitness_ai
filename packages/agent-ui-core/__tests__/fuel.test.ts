import { describe, it, expect } from 'vitest';
import { targetLines, dayTotals, momentFor, perServing, ingredientFrom, rangeBars, lookupReceipt } from '../src/fuel';

const T = { calories: 2600, proteinG: 180, carbsG: 300, fatG: 80, fiberG: 36, source: 'plan' };

describe('targetLines', () => {
  it('adds a workout’s burn as its own line when the user counts it', () => {
    expect(targetLines(T, { kcal: 420.4, label: 'Pull', addToTarget: true })).toEqual({ base: 2600, burn: 420, burnLabel: 'Workout · Pull', today: 3020 });
  });
  it('leaves the burn out when the toggle is off or there was none', () => {
    expect(targetLines(T, { kcal: 420, label: 'Pull', addToTarget: false })).toEqual({ base: 2600, burn: 0, burnLabel: null, today: 2600 });
    expect(targetLines(T, null)?.today).toBe(2600);
  });
  it('is null without targets — no invented 2,400', () => {
    expect(targetLines(null, { kcal: 300, label: null, addToTarget: true })).toBeNull();
  });
});

describe('dayTotals', () => {
  it('sums meals and reads fiber from nutrients', () => {
    expect(dayTotals([{ calories: 500, proteinG: 30, carbsG: 50, fatG: 10, nutrients: { fiberG: 6 } }, { calories: '300', proteinG: 20, carbsG: 0, fatG: 5 }]))
      .toEqual({ kcal: 800, proteinG: 50, carbsG: 50, fatG: 15, fiberG: 6 });
  });
});

describe('momentFor', () => {
  const tot = (p: number, f = 0) => ({ kcal: 2000, proteinG: p, carbsG: 0, fatG: 0, fiberG: f });
  it('marks protein hit once per day', () => {
    expect(momentFor(tot(182), T, '2026-10-08')).toMatchObject({ key: '2026-10-08:protein', line: 'Protein hit — 182 of 180 g' });
  });
  it('falls back to fiber, and nothing short of a goal', () => {
    expect(momentFor(tot(100, 40), T, 'd')?.key).toBe('d:fiber');
    expect(momentFor(tot(100, 10), T, 'd')).toBeNull();
    expect(momentFor(tot(300), null, 'd')).toBeNull();
  });
});

describe('recipe builder', () => {
  it('divides the whole recipe by servings', () => {
    const items = [{ name: 'Turkey', quantity: '900 g', calories: 1800, proteinG: 200, carbsG: 0, fatG: 90 }, { name: 'Beans', quantity: '2 cans', calories: 780, proteinG: 16, carbsG: 228, fatG: 0 }];
    expect(perServing(items, 6)).toEqual({ calories: 430, proteinG: 36, carbsG: 38, fatG: 15 });
    expect(perServing(items, 0).calories).toBe(2580);
    expect(perServing(items, 0.25).calories).toBe(5160);
  });
  it('scales a searched food by portions', () => {
    expect(ingredientFrom({ name: 'Rice', portion: { label: '1 cup' }, macros: { calories: 205, proteinG: 4.3, carbsG: 45, fatG: 0.4 } }, 2))
      .toEqual({ name: 'Rice', quantity: '2 × 1 cup', calories: 410, proteinG: 8.6, carbsG: 90, fatG: 0.8 });
  });
});

describe('rangeBars', () => {
  it('groups 30 days into weekly averages over logged days', () => {
    const days = Array.from({ length: 30 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, kcal: i < 7 ? 2000 : 0, logged: i < 7 }));
    const b = rangeBars(days, '30d');
    expect(b).toHaveLength(5);
    expect(b[0]).toEqual({ label: 'W1', value: 2000 });
    expect(b[1].value).toBe(0);
  });
  it('labels each day for a week', () => {
    expect(rangeBars([{ date: '2026-10-08', kcal: 1900, logged: true }], '7d')).toEqual([{ label: 'T', value: 1900 }]);
  });
});

describe('lookupReceipt', () => {
  it('names the source when published values were used', () => {
    expect(lookupReceipt({ lookups: [{ brand: 'Starbucks', status: 'found', sourceDomain: 'starbucks.ca' }] }, 'Latte'))
      .toEqual({ verb: 'Searched', found: true, text: 'Starbucks — from starbucks.ca' });
  });
  it('says a checked brand stayed an estimate', () => {
    expect(lookupReceipt({ lookups: [{ brand: 'Osmow’s', status: 'estimated', sourceDomain: null }] }, 'Box').text).toBe('Osmow’s — not published, estimated');
  });
  it('never claims a search for plain food', () => {
    expect(lookupReceipt({ name: 'Eggs' }, 'Eggs and toast')).toEqual({ verb: 'Computed', found: false, text: 'Eggs and toast — estimated' });
  });
});
