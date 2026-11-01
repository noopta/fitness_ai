// Your foods by barcode: what's remembered from a scan, and what the next scan and chat get back.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  process.env.OPENAI_API_KEY ||= 'test-key';
  return {
    savedFood: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    mealEntry: { create: vi.fn() },
    user: { findUnique: vi.fn() },
  };
});
vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) { Object.assign(this, mocks); }) }));
vi.mock('../services/activityService.js', () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock('../services/nutritionShared.js', async (orig) => ({ ...(await orig() as object), updateNutritionStreakInBackground: vi.fn() }));
vi.mock('../services/moments/index.js', () => ({ momentForNutrition: vi.fn(async () => null) }));
vi.mock('../services/productEvents.js', () => ({ track: vi.fn() }));

import { basisJsonFrom, portionFromBasis, yourFoodFields, yourFoodProduct } from '../services/food/yourFoods.js';
import { createMealEntry, mealEntrySchema } from '../services/mealLogService.js';

const product = { name: 'Greek yogurt', brand: 'Oikos', per100g: { calories: 93.3, proteinG: 13.3, carbsG: 6, fatG: 1.7, calciumMg: 133, ironMg: null }, servingSize: '1 container (150 g)', servingQuantityG: 150, source: 'openfoodfacts' };
const base = { date: '2026-10-29', name: 'Greek yogurt · Oikos', mealType: 'snack' as const, calories: 159, proteinG: 22.7, carbsG: 10.2, fatG: 2.8, source: 'barcode' };

beforeEach(() => {
  for (const m of Object.values(mocks.savedFood)) m.mockReset();
  mocks.mealEntry.create.mockReset();
  mocks.mealEntry.create.mockImplementation(async ({ data }: any) => ({ id: 'm1', ...data }));
});

describe('basisJsonFrom', () => {
  it('keeps the label, not what it was told about last time', () => {
    const kept = JSON.parse(basisJsonFrom({ ...product, yourFood: { lastGrams: 170 }, hack: 'x' })!);
    expect(kept.per100g.calories).toBe(93.3);
    expect(kept).not.toHaveProperty('yourFood');
    expect(kept).not.toHaveProperty('hack');
  });
  it('a re-log from Your foods keeps the real origin', () => {
    expect(JSON.parse(basisJsonFrom({ ...product, source: 'your_foods', originalSource: 'community' })!).source).toBe('community');
  });
  it('has nothing to keep without per-100 g values, and refuses an oversized answer', () => {
    expect(basisJsonFrom({ name: 'x' })).toBeNull();
    expect(basisJsonFrom(null)).toBeNull();
    expect(basisJsonFrom({ ...product, name: 'x'.repeat(9000) })).toBeNull();
  });
});

describe('yourFoodFields', () => {
  const now = new Date('2026-10-29T12:00:00Z');
  it('needs a barcode and a real amount', () => {
    expect(yourFoodFields({ portion: { grams: 170, unit: 'g', unitLabel: 'g' } }, now)).toBeNull();
    expect(yourFoodFields({ barcode: '123456' }, now)).toBeNull();
    expect(yourFoodFields({ barcode: '123456', portion: { grams: 0, unit: 'g', unitLabel: 'g' } }, now)).toBeNull();
  });
  it('without a label it updates the amount and leaves the stored label alone', () => {
    expect(yourFoodFields({ barcode: '123456', portion: { grams: 200, unit: 'g', unitLabel: 'g' } }, now)).toEqual({ barcode: '123456', lastGrams: 200, lastLoggedAt: now });
  });
});

describe('yourFoodProduct', () => {
  const row = { name: 'Greek yogurt · Oikos', basisJson: basisJsonFrom(product), lastGrams: 170, lastLoggedAt: new Date('2026-10-27T12:00:00Z') };
  it('answers like any lookup, plus the last amount', () => {
    expect(yourFoodProduct(row, '123456')).toMatchObject({
      code: '123456', name: 'Greek yogurt', servingQuantityG: 150, source: 'your_foods', originalSource: 'openfoodfacts',
      yourFood: { lastGrams: 170, lastLoggedAt: '2026-10-27T12:00:00.000Z' },
    });
  });
  it('falls through on a row with no usable label, so the normal lookup runs', () => {
    expect(yourFoodProduct({ ...row, basisJson: null }, '1')).toBeNull();
    expect(yourFoodProduct({ ...row, basisJson: 'not json' }, '1')).toBeNull();
    expect(yourFoodProduct({ ...row, basisJson: '{"name":"x"}' }, '1')).toBeNull();
  });
});

describe('portionFromBasis', () => {
  it('scales macros and micros from the label', () => {
    expect(portionFromBasis(basisJsonFrom(product), 200)).toEqual({ calories: 187, proteinG: 26.6, carbsG: 12, fatG: 3.4, nutrients: { calciumMg: 266 } });
  });
  it('is null with no label or no amount', () => {
    expect(portionFromBasis(null, 200)).toBeNull();
    expect(portionFromBasis(basisJsonFrom(product), 0)).toBeNull();
  });
});

describe('mealEntrySchema extras', () => {
  it('a bad barcode, portion or basis is dropped and never refuses the meal', () => {
    const d = mealEntrySchema.parse({ ...base, barcode: 'abc', portion: { grams: 'lots' }, foodBasis: 'nope' });
    expect(d.barcode).toBeUndefined();
    expect(d.portion).toBeUndefined();
    expect(d.foodBasis).toBeUndefined();
    expect(d.calories).toBe(159);
  });
});

describe('logging a scanned food', () => {
  const scan = { ...base, barcode: '064420051124', portion: { grams: 170, unit: 'g', unitLabel: 'g' }, foodBasis: product };

  it('stores the portion on the meal and creates the saved food with its label', async () => {
    mocks.savedFood.findFirst.mockResolvedValue(null);
    mocks.savedFood.findUnique.mockResolvedValue(null);
    await createMealEntry('u', scan);
    expect(JSON.parse(mocks.mealEntry.create.mock.calls[0][0].data.portionJson)).toEqual({ grams: 170, unit: 'g', unitLabel: 'g', barcode: '064420051124' });
    const saved = mocks.savedFood.create.mock.calls[0][0].data;
    expect(saved).toMatchObject({ barcode: '064420051124', lastGrams: 170, useCount: 1 });
    expect(JSON.parse(saved.basisJson).servingQuantityG).toBe(150);
    expect(saved.lastLoggedAt).toBeInstanceOf(Date);
  });

  it('finds the food by barcode first, even when its name changed', async () => {
    mocks.savedFood.findFirst.mockResolvedValue({ id: 'f1' });
    await createMealEntry('u', { ...scan, name: 'Renamed yogurt', portion: { grams: 200, unit: 'oz', unitLabel: 'oz' } });
    expect(mocks.savedFood.findFirst).toHaveBeenCalledWith({ where: { userId: 'u', barcode: '064420051124' } });
    expect(mocks.savedFood.findUnique).not.toHaveBeenCalled();
    expect(mocks.savedFood.update.mock.calls[0][0]).toMatchObject({ where: { id: 'f1' }, data: { lastGrams: 200 } });
  });

  it('adopts a saved food of the same name that had no barcode', async () => {
    mocks.savedFood.findFirst.mockResolvedValue(null);
    mocks.savedFood.findUnique.mockResolvedValue({ id: 'f2' });
    await createMealEntry('u', scan);
    expect(mocks.savedFood.update.mock.calls[0][0]).toMatchObject({ where: { id: 'f2' }, data: { barcode: '064420051124', lastGrams: 170 } });
  });

  it('an ordinary meal touches none of it', async () => {
    mocks.savedFood.findUnique.mockResolvedValue(null);
    await createMealEntry('u', { ...base, source: 'manual' });
    expect(mocks.savedFood.findFirst).not.toHaveBeenCalled();
    expect(mocks.mealEntry.create.mock.calls[0][0].data.portionJson).toBeNull();
    expect(mocks.savedFood.create.mock.calls[0][0].data).not.toHaveProperty('barcode');
  });

  it('the old sheet, which sends a barcode and no portion, is unchanged', async () => {
    mocks.savedFood.findUnique.mockResolvedValue(null);
    await createMealEntry('u', { ...base, barcode: '064420051124' });
    expect(mocks.savedFood.findFirst).not.toHaveBeenCalled();
    expect(mocks.savedFood.create.mock.calls[0][0].data).not.toHaveProperty('lastGrams');
  });
});
