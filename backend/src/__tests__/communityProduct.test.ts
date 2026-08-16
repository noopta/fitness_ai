// The community barcode cache is what recovers a lookup miss for products
// OpenFoodFacts doesn't carry — which is most Nigerian and Gambian packaged
// goods. Two failure modes matter and both are silent:
//
//   1. Shape drift. app/barcode-confirm.tsx reads per100g.* without knowing
//      where the product came from. If the community response stops matching
//      the OpenFoodFacts one, community products show zeros and it reads as
//      "the label scan didn't work".
//   2. A junk row. A bad parse written to the table is inherited by every
//      future person who scans that barcode, so a bad read must be rejected
//      rather than stored.

import { describe, it, expect } from 'vitest';
import {
  serializeCommunityProduct,
  coerceNutritionLabel,
  type CommunityProductRow,
} from '../services/food/communityProduct.js';

const row = (over: Partial<CommunityProductRow> = {}): CommunityProductRow => ({
  code: '6154000123456',
  name: 'Indomie Chicken',
  brand: 'Indomie',
  caloriesPer100g: 450,
  proteinG: 9,
  carbsG: 60,
  fatG: 18,
  nutrientsJson: JSON.stringify({ sodiumMg: 1200, fiberG: 2 }),
  servingSize: '1 pack (70 g)',
  servingQuantityG: 70,
  verified: false,
  ...over,
});

describe('serializeCommunityProduct — shape parity with OpenFoodFacts', () => {
  it('exposes the exact keys barcode-confirm.tsx reads', () => {
    const out = serializeCommunityProduct(row());
    // Mirrors the OFF branch of GET /nutrition/barcode/:code.
    expect(Object.keys(out).sort()).toEqual(
      ['brand', 'code', 'imageUrl', 'name', 'per100g', 'servingSize', 'servingQuantityG', 'source', 'verified'].sort(),
    );
    expect(out.per100g.calories).toBe(450);
    expect(out.per100g.proteinG).toBe(9);
    expect(out.per100g.carbsG).toBe(60);
    expect(out.per100g.fatG).toBe(18);
    expect(out.servingQuantityG).toBe(70);
  });

  it('merges stored micronutrients into per100g alongside the macros', () => {
    const out = serializeCommunityProduct(row());
    expect((out.per100g as any).sodiumMg).toBe(1200);
    expect((out.per100g as any).fiberG).toBe(2);
  });

  it('marks the source so the client can caption a crowd-sourced label', () => {
    expect(serializeCommunityProduct(row()).source).toBe('community');
    expect(serializeCommunityProduct(row({ verified: true })).verified).toBe(true);
  });

  it('survives a corrupt nutrients payload — macros are still usable', () => {
    for (const bad of ['not json', '[1,2,3]', 'null', '']) {
      const out = serializeCommunityProduct(row({ nutrientsJson: bad }));
      expect(out.per100g.calories, bad).toBe(450);
      expect((out.per100g as any).sodiumMg, bad).toBeUndefined();
    }
  });

  it('handles a null nutrients payload', () => {
    const out = serializeCommunityProduct(row({ nutrientsJson: null }));
    expect(out.per100g).toEqual({ calories: 450, proteinG: 9, carbsG: 60, fatG: 18 });
  });
});

describe('coerceNutritionLabel — rejecting unreadable panels', () => {
  it('returns null when calories could not be read', () => {
    // The route turns this into a 422 asking for a better photo, rather than
    // writing a zero-calorie row that everyone else then inherits.
    expect(coerceNutritionLabel({ name: '', caloriesPer100g: 0 })).toBeNull();
    expect(coerceNutritionLabel({ caloriesPer100g: -5 })).toBeNull();
    expect(coerceNutritionLabel({ caloriesPer100g: 'abc' })).toBeNull();
    expect(coerceNutritionLabel({})).toBeNull();
    expect(coerceNutritionLabel(null)).toBeNull();
    expect(coerceNutritionLabel(undefined)).toBeNull();
  });

  it('accepts a well-read panel', () => {
    const out = coerceNutritionLabel({
      name: 'Dangote Spaghetti',
      brand: 'Dangote',
      caloriesPer100g: 352,
      proteinG: 12,
      carbsG: 71,
      fatG: 1.5,
      servingSize: '100 g',
      servingQuantityG: 100,
    });
    expect(out).toEqual({
      name: 'Dangote Spaghetti',
      brand: 'Dangote',
      caloriesPer100g: 352,
      proteinG: 12,
      carbsG: 71,
      fatG: 1.5,
      servingSize: '100 g',
      servingQuantityG: 100,
    });
  });
});

describe('coerceNutritionLabel — clamping implausible reads', () => {
  it('caps calories at pure fat', () => {
    // A value above ~900 means the model read a per-PACK total as per-100 g.
    // Capping beats trusting it, since the row is cached for everyone.
    expect(coerceNutritionLabel({ caloriesPer100g: 2400 })!.caloriesPer100g).toBe(900);
    expect(coerceNutritionLabel({ caloriesPer100g: 884 })!.caloriesPer100g).toBe(884);
  });

  it('caps each macro at 100 g per 100 g', () => {
    const out = coerceNutritionLabel({
      caloriesPer100g: 400, proteinG: 250, carbsG: 900, fatG: 130,
    })!;
    expect(out.proteinG).toBe(100);
    expect(out.carbsG).toBe(100);
    expect(out.fatG).toBe(100);
  });

  it('treats negative and non-numeric macros as zero, not NaN', () => {
    const out = coerceNutritionLabel({
      caloriesPer100g: 200, proteinG: -3, carbsG: 'lots', fatG: null,
    })!;
    expect(out.proteinG).toBe(0);
    expect(out.carbsG).toBe(0);
    expect(out.fatG).toBe(0);
  });

  it('parses numeric strings, which the model often returns', () => {
    const out = coerceNutritionLabel({
      caloriesPer100g: '352', proteinG: '12.5', servingQuantityG: '70',
    })!;
    expect(out.caloriesPer100g).toBe(352);
    expect(out.proteinG).toBe(12.5);
    expect(out.servingQuantityG).toBe(70);
  });
});

describe('coerceNutritionLabel — text fields', () => {
  it('trims and bounds name, brand and serving size', () => {
    const out = coerceNutritionLabel({
      caloriesPer100g: 100,
      name: '  ' + 'x'.repeat(300),
      brand: '  Nestle  ',
      servingSize: ' ' + 'y'.repeat(200),
    })!;
    expect(out.name.length).toBe(200);
    expect(out.brand).toBe('Nestle');
    expect(out.servingSize!.length).toBe(80);
  });

  it('nulls empty optional text rather than storing blanks', () => {
    const out = coerceNutritionLabel({ caloriesPer100g: 100, brand: '   ', servingSize: '' })!;
    expect(out.brand).toBeNull();
    expect(out.servingSize).toBeNull();
  });

  it('nulls a zero or missing serving weight', () => {
    expect(coerceNutritionLabel({ caloriesPer100g: 100, servingQuantityG: 0 })!.servingQuantityG).toBeNull();
    expect(coerceNutritionLabel({ caloriesPer100g: 100 })!.servingQuantityG).toBeNull();
  });
});

describe('round trip — a scanned label serializes like an OFF product', () => {
  it('keeps the shape stable from parse through to client response', () => {
    const coerced = coerceNutritionLabel({
      name: 'Milo', brand: 'Nestle', caloriesPer100g: 380,
      proteinG: 8, carbsG: 74, fatG: 5, servingSize: '3 tbsp (20 g)', servingQuantityG: 20,
    })!;
    const out = serializeCommunityProduct({
      code: '6154001112223',
      ...coerced,
      nutrientsJson: JSON.stringify({ sugarG: 40 }),
      verified: false,
    });
    expect(out.name).toBe('Milo');
    expect(out.per100g.calories).toBe(380);
    expect((out.per100g as any).sugarG).toBe(40);
    expect(out.servingQuantityG).toBe(20);
    expect(out.source).toBe('community');
  });
});
