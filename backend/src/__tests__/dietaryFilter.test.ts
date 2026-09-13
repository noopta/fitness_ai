/**
 * The filter that must not fail quietly.
 *
 * These tests are written from the failure side: each one describes a specific
 * way a food recommender hurts someone, and asserts we don't do it.
 */
import { describe, it, expect } from 'vitest';
import {
  checkCandidate, parseDietProfile, filterCandidates, canonicalAllergen,
  emptyProfile, fold, type DietProfile,
} from '../engine/dietaryFilter.js';

const profile = (over: Partial<DietProfile> = {}): DietProfile => ({ ...emptyProfile(), ...over });
const usda = (name: string, description?: string) =>
  ({ name, description, confidence: 'usda' as const });
const menu = (name: string, description?: string) =>
  ({ name, description, confidence: 'inferred' as const });

describe('fold', () => {
  it('strips diacritics and punctuation so Ẹ̀bà matches eba', () => {
    expect(fold('Ẹ̀bà')).toBe('eba');
    expect(fold("McDonald's  Quarter-Pounder")).toBe('mcdonald s quarter pounder');
  });
});

describe('allergens', () => {
  it('excludes the obvious case', () => {
    const d = checkCandidate(usda('Peanut butter toast'), profile({ allergies: ['peanut'] }));
    expect(d.verdict).toBe('exclude');
    expect(d.rule).toBe('allergen:peanut');
  });

  it('catches allergens hiding behind a dish name', () => {
    // Nobody types "tree-nut" when they mean pesto, and satay is peanut.
    expect(checkCandidate(usda('Pesto pasta'), profile({ allergies: ['tree-nut'] })).verdict).toBe('exclude');
    expect(checkCandidate(usda('Chicken satay'), profile({ allergies: ['peanut'] })).verdict).toBe('exclude');
    expect(checkCandidate(usda('Caesar salad', 'anchovy dressing'), profile({ allergies: ['fish'] })).verdict).toBe('exclude');
    expect(checkCandidate(usda('Hummus bowl'), profile({ allergies: ['sesame'] })).verdict).toBe('exclude');
  });

  it('does not match a substring inside an unrelated word', () => {
    // "ham" inside "hamburger" must not read as pork to a no-pork user.
    const d = checkCandidate(usda('Hamburger'), profile({ restrictions: ['no-pork'] }));
    expect(d.verdict).toBe('allow');
  });

  it('accepts the aliases people actually type', () => {
    expect(canonicalAllergen('dairy')).toBe('milk');
    expect(canonicalAllergen('Tree Nuts')).toBe('tree-nut');
    expect(canonicalAllergen('gluten')).toBe('wheat');
  });

  it('will not certify a restaurant dish it cannot verify', () => {
    // The core honesty case: we know a NAME, not what the kitchen does.
    const d = checkCandidate(menu('Grilled chicken bowl'), profile({ allergies: ['peanut'] }));
    expect(d.verdict).toBe('unverifiable');
    expect(d.reason).toMatch(/can't verify/i);
  });

  it('allows a verified composition through', () => {
    expect(checkCandidate(usda('Grilled chicken breast'), profile({ allergies: ['peanut'] })).verdict).toBe('allow');
  });

  it('honours an explicit free-from tag over the unverifiable default', () => {
    const d = checkCandidate(
      { name: 'Grilled chicken bowl', confidence: 'inferred', tags: ['free peanut'] },
      profile({ allergies: ['peanut'] }));
    expect(d.verdict).toBe('allow');
  });
});

describe('restrictions', () => {
  it('excludes meat for a vegetarian and fish too', () => {
    expect(checkCandidate(usda('Beef brisket'), profile({ restrictions: ['vegetarian'] })).verdict).toBe('exclude');
    expect(checkCandidate(usda('Grilled salmon'), profile({ restrictions: ['vegetarian'] })).verdict).toBe('exclude');
  });

  it('lets a pescatarian keep fish but not chicken', () => {
    expect(checkCandidate(usda('Grilled salmon'), profile({ restrictions: ['pescatarian'] })).verdict).toBe('allow');
    expect(checkCandidate(usda('Chicken thigh'), profile({ restrictions: ['pescatarian'] })).verdict).toBe('exclude');
  });

  it('excludes dairy and egg for a vegan but not for a vegetarian', () => {
    expect(checkCandidate(usda('Cheese omelette'), profile({ restrictions: ['vegan'] })).verdict).toBe('exclude');
    expect(checkCandidate(usda('Cheese omelette'), profile({ restrictions: ['vegetarian'] })).verdict).toBe('allow');
  });

  it('covers halal beyond pork', () => {
    expect(checkCandidate(usda('Beer-battered cod'), profile({ restrictions: ['halal'] })).verdict).toBe('exclude');
    expect(checkCandidate(usda('Prosciutto panini'), profile({ restrictions: ['halal'] })).verdict).toBe('exclude');
  });

  it('names the offending ingredient so the user can trust the filter', () => {
    const d = checkCandidate(usda('Pork belly bowl'), profile({ restrictions: ['halal'] }));
    expect(d.reason).toMatch(/pork/i);
  });
});

describe('profile parsing', () => {
  it('reads JSON arrays', () => {
    const p = parseDietProfile({ dietaryRestrictions: '["vegetarian"]', allergies: '["Dairy"]', dislikedFoods: '["olives"]' });
    expect(p.restrictions).toEqual(['vegetarian']);
    expect(p.allergies).toEqual(['milk']);
    expect(p.dislikes).toEqual(['olives']);
  });

  it('tolerates free text, because the coach writes these too', () => {
    const p = parseDietProfile({ dietaryRestrictions: 'vegetarian, no-pork', allergies: null, dislikedFoods: null });
    expect(p.restrictions).toEqual(['vegetarian', 'no pork']);
  });

  it('treats absent fields as no restriction rather than guessing', () => {
    const p = parseDietProfile({});
    expect(p).toEqual(emptyProfile());
  });
});

describe('filterCandidates', () => {
  const items = [
    { id: 'a', name: 'Grilled salmon', confidence: 'usda' as const },
    { id: 'b', name: 'Pork belly', confidence: 'usda' as const },
    { id: 'c', name: 'Lentil stew', confidence: 'usda' as const },
  ];
  const facts = (t: typeof items[number]) => ({ name: t.name, confidence: t.confidence });

  it('is a no-op when the user declared nothing', () => {
    expect(filterCandidates(items, facts, emptyProfile())).toHaveLength(3);
  });

  it('drops excluded items entirely', () => {
    const kept = filterCandidates(items, facts, profile({ restrictions: ['vegetarian'] }));
    expect(kept.map(k => k.item.id)).toEqual(['c']);
  });

  it('keeps unverifiable items with their warning rather than deleting takeout', () => {
    // Dropping every restaurant dish the moment someone declares an allergy
    // would silently remove half the product. They get told instead.
    const takeout = [{ id: 'd', name: 'Pad thai', confidence: 'inferred' as const }];
    const kept = filterCandidates(takeout, t => ({ name: t.name, confidence: t.confidence }), profile({ allergies: ['sesame'] }));
    expect(kept).toHaveLength(1);
    expect(kept[0].decision.verdict).toBe('unverifiable');
  });
});
