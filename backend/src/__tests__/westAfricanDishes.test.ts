// Integrity guards for the hand-authored West African dish table.
//
// These values are typed by hand, so the realistic failure mode is an authoring
// slip — a duplicated slug, an alias claimed by two dishes, a macro row that
// doesn't add up to its calorie figure. Each of those produces silently wrong
// user data rather than a crash, so they're asserted here.

import { describe, it, expect } from 'vitest';
import {
  WEST_AFRICAN_DISHES,
  getWestAfricanDish,
  westAfricanDishesForRegion,
  westAfricanDishNames,
  WEST_AFRICAN_FERMENTED,
} from '../data/westAfricanDishes.js';
import { foldFoodName } from '../services/food/foodNameNormalize.js';

describe('dish table — structural integrity', () => {
  it('has a meaningful number of dishes', () => {
    expect(WEST_AFRICAN_DISHES.length).toBeGreaterThanOrEqual(50);
  });

  it('has unique slugs', () => {
    const slugs = WEST_AFRICAN_DISHES.map((d) => d.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('uses slug characters that are safe as a sourceCode', () => {
    for (const d of WEST_AFRICAN_DISHES) {
      expect(d.slug, d.slug).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('gives every dish at least one portion', () => {
    // Per-100 g data is unloggable without a portion — nobody weighs a wrap of eba.
    for (const d of WEST_AFRICAN_DISHES) {
      expect(d.portions.length, d.slug).toBeGreaterThan(0);
    }
  });

  it('gives every dish exactly one default portion', () => {
    for (const d of WEST_AFRICAN_DISHES) {
      const defaults = d.portions.filter((p) => p.isDefault);
      expect(defaults.length, `${d.slug} default portions`).toBe(1);
    }
  });

  it('uses positive portion weights', () => {
    for (const d of WEST_AFRICAN_DISHES) {
      for (const p of d.portions) {
        expect(p.grams, `${d.slug}/${p.label}`).toBeGreaterThan(0);
        expect(p.grams, `${d.slug}/${p.label}`).toBeLessThanOrEqual(1000);
      }
    }
  });

  it('records a basis for every row so values are reviewable', () => {
    for (const d of WEST_AFRICAN_DISHES) {
      expect(d.basis.length, d.slug).toBeGreaterThan(10);
    }
  });
});

describe('dish table — no ambiguous lookups', () => {
  it('never lets two dishes claim the same folded name or alias', () => {
    // A collision here means a user query resolves arbitrarily to one of two
    // different foods — worse than a miss, because it looks like it worked.
    const owner = new Map<string, string>();
    const collisions: string[] = [];
    for (const d of WEST_AFRICAN_DISHES) {
      for (const term of [d.name, ...d.aliases]) {
        const key = foldFoodName(term);
        const existing = owner.get(key);
        if (existing && existing !== d.slug) {
          collisions.push(`"${key}" claimed by both ${existing} and ${d.slug}`);
        }
        owner.set(key, d.slug);
      }
    }
    expect(collisions).toEqual([]);
  });

  it('folds every alias to something non-empty', () => {
    for (const d of WEST_AFRICAN_DISHES) {
      for (const a of d.aliases) {
        expect(foldFoodName(a), `${d.slug}: "${a}"`).not.toBe('');
      }
    }
  });
});

describe('dish table — nutritional plausibility', () => {
  it('has positive calories for every dish', () => {
    for (const d of WEST_AFRICAN_DISHES) {
      expect(d.per100g.calories, d.slug).toBeGreaterThan(0);
    }
  });

  it('keeps macros within 100 g of food', () => {
    for (const d of WEST_AFRICAN_DISHES) {
      const { proteinG, carbsG, fatG } = d.per100g;
      expect(proteinG + carbsG + fatG, d.slug).toBeLessThanOrEqual(100);
    }
  });

  it('reconciles stated calories with the 4/4/9 macro total', () => {
    // Atwater: 4 kcal/g protein and carb, 9 kcal/g fat. Composite dishes carry
    // fibre and water that shift this a little, so the tolerance is generous —
    // it is catching typos (a misplaced decimal), not auditing precision.
    const bad: string[] = [];
    for (const d of WEST_AFRICAN_DISHES) {
      const { calories, proteinG, carbsG, fatG } = d.per100g;
      const atwater = proteinG * 4 + carbsG * 4 + fatG * 9;
      const drift = Math.abs(atwater - calories) / calories;
      if (drift > 0.25) {
        bad.push(`${d.slug}: stated ${calories} vs Atwater ${atwater.toFixed(0)} (${(drift * 100).toFixed(0)}% off)`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('clears the hasUsableMicros bar (>=3 nonzero micros) for composite dishes', () => {
    // Below this bar the enrichment service re-asks the LLM, throwing away the
    // curated row entirely.
    const thin = WEST_AFRICAN_DISHES
      .filter((d) => d.isComposite)
      .filter((d) => Object.values(d.nutrients).filter((v) => typeof v === 'number' && v > 0).length < 3)
      .map((d) => d.slug);
    expect(thin).toEqual([]);
  });

  it('never writes a zero micronutrient — absent means unknown', () => {
    // A written 0 is a confident claim of absence and drags the blend down.
    for (const d of WEST_AFRICAN_DISHES) {
      for (const [k, v] of Object.entries(d.nutrients)) {
        if (k === 'saturatedFatG' || k === 'sugarG') continue; // legitimately 0 in pure oils
        expect(v, `${d.slug}.${k}`).not.toBe(0);
      }
    }
  });
});

describe('dish table — spot checks against known values', () => {
  const kcal = (slug: string) => getWestAfricanDish(slug)!.per100g.calories;

  it('prices swallows well below their dry flour', () => {
    // The single biggest calorie error in Nigerian logging: dry garri is
    // ~360 kcal/100 g, but eba as eaten is mostly water.
    expect(kcal('eba')).toBeGreaterThan(100);
    expect(kcal('eba')).toBeLessThan(200);
    expect(kcal('pounded-yam')).toBeLessThan(180);
  });

  it('prices red palm oil as a pure fat with very high vitamin A', () => {
    const oil = getWestAfricanDish('palm-oil-red')!;
    expect(oil.per100g.calories).toBeGreaterThan(850);
    expect(oil.per100g.fatG).toBe(100);
    expect(oil.nutrients.vitaminAIU!).toBeGreaterThan(10000);
  });

  it('makes egusi soup fat-dominant, not seed-dominant', () => {
    // Resolving to "egusi seed, raw" (~590 kcal) instead of the soup is the
    // exact failure this table exists to prevent.
    const egusi = getWestAfricanDish('egusi-soup')!;
    expect(egusi.per100g.calories).toBeLessThan(300);
    expect(egusi.per100g.fatG).toBeGreaterThan(egusi.per100g.carbsG);
  });

  it('distinguishes boiled from fried yam', () => {
    expect(kcal('fried-yam')).toBeGreaterThan(kcal('boiled-yam') * 1.5);
  });
});

describe('accessors', () => {
  it('finds a dish by slug', () => {
    expect(getWestAfricanDish('jollof-rice')?.name).toBe('Jollof rice');
    expect(getWestAfricanDish('nope')).toBeUndefined();
  });

  it('includes pan-regional WA dishes in both country lists', () => {
    const ng = westAfricanDishesForRegion('NG').map((d) => d.slug);
    const gm = westAfricanDishesForRegion('GM').map((d) => d.slug);
    expect(ng).toContain('jollof-rice');   // WA
    expect(gm).toContain('jollof-rice');   // WA
    expect(ng).toContain('egusi-soup');    // NG
    expect(gm).not.toContain('egusi-soup');
    expect(gm).toContain('domoda');        // GM
  });

  it('exposes dish names for the prompt vocabulary', () => {
    expect(westAfricanDishNames('NG')).toContain('Egusi soup');
  });

  it('collects fermented foods for the gut pillar', () => {
    // These are the terms the parser currently has no idea about.
    for (const term of ['iru', 'dawadawa', 'ogi', 'ugba', 'wara']) {
      expect(WEST_AFRICAN_FERMENTED.map(foldFoodName)).toContain(term);
    }
  });
});
