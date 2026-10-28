// Barcode by grams (Oct 2026): 200 g of a 115 g-serving yogurt is 200/115 servings.
import { describe, it, expect } from 'vitest';
import { barcodeFactor, barcodeAmountLabel } from '../src/portion';

describe('barcodeFactor', () => {
  it('grams against the serving size', () => {
    const f = barcodeFactor({ mode: 'grams', grams: 200 }, 115);
    expect(Math.round(130 * f)).toBe(226); // kcal
    expect(Math.round(13 * f)).toBe(23); // protein
  });
  it('servings as before', () => { expect(barcodeFactor({ mode: 'servings', servings: 1.5 }, 115)).toBe(1.5); });
  it('no grams typed, or no serving grams: falls back to servings', () => {
    expect(barcodeFactor({ mode: 'grams', grams: null }, 115, 2)).toBe(2);
    expect(barcodeFactor({ mode: 'grams', grams: 200 }, null, 1)).toBe(1);
  });
  it('labels', () => {
    expect(barcodeAmountLabel({ mode: 'grams', grams: 200 })).toBe('200 g');
    expect(barcodeAmountLabel({ mode: 'servings', servings: 1 })).toBe('1 serving');
  });
});
