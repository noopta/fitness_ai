/**
 * The filter that must not fail quietly.
 *
 * These tests are written from the failure side: each one describes a specific
 * way a food recommender hurts someone, and asserts we don't do it.
 */
import { describe, it, expect } from 'vitest';
import {
  checkCandidate, parseDietProfile, filterCandidates, canonicalAllergen,
  emptyProfile, fold, resolveDietProfile, type DietProfile,
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

  it('honours a free-from tag only from a verified source', () => {
    const verified = checkCandidate(
      { name: 'Grilled chicken bowl', confidence: 'published', tags: ['free peanut'] },
      profile({ allergies: ['peanut'] }));
    expect(verified.verdict).toBe('allow');
  });

  it('does not let an unverified "peanut-free" tag clear an allergy warning', () => {
    // An all-clear from data nobody checked is the one claim this filter must
    // never pass along.
    const unverified = checkCandidate(
      { name: 'Grilled chicken bowl', confidence: 'inferred', tags: ['free peanut'] },
      profile({ allergies: ['peanut'] }));
    expect(unverified.verdict).toBe('unverifiable');
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

  it('tolerates free text rather than silently dropping a restriction', () => {
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

describe('allergens outside the known list', () => {
  it('matches a custom allergen by its own name', () => {
    // Previously an allergy with no term list matched nothing, and a verified
    // composition of that very food was allowed through.
    const d = checkCandidate(usda('Mango'), profile({ allergies: ['mango'] }));
    expect(d.verdict).toBe('exclude');
  });

  it('still allows unrelated verified food for a custom allergy', () => {
    expect(checkCandidate(usda('Grilled chicken breast'), profile({ allergies: ['mango'] })).verdict).toBe('allow');
  });
});

describe('an allergy the user never named', () => {
  it('warns on every dish we cannot see inside', () => {
    const d = checkCandidate(menu('Chicken shawarma plate'), profile({ unspecifiedAllergy: true }));
    expect(d.verdict).toBe('unverifiable');
    expect(d.reason).toMatch(/food allergies/i);
  });

  it('does not invent an exclusion for verified food', () => {
    expect(checkCandidate(usda('Brown rice'), profile({ unspecifiedAllergy: true })).verdict).toBe('allow');
  });
});

describe('resolveDietProfile — everywhere the user has told us', () => {
  const coach = (o: unknown) => JSON.stringify(o);

  it('reads the coach intake, which the finder used to ignore', () => {
    const r = resolveDietProfile({ coachProfile: coach({ dietaryRestrictions: ['vegetarian', 'dairy_free'] }) });
    expect(r.profile.restrictions).toEqual(['vegetarian', 'dairy-free']);
    expect(r.sources).toEqual(['coach_intake']);
    expect(r.explicit).toBe(false);
  });

  it('turns the combined Halal / Kosher option into BOTH filters, and flags it', () => {
    // 9 real users picked this. Showing shrimp to someone who keeps kosher is
    // not recoverable; hiding it from a halal user is.
    const r = resolveDietProfile({ coachProfile: coach({ dietaryRestrictions: ['halal_kosher'] }) });
    expect(r.profile.restrictions).toEqual(['halal', 'kosher']);
    expect(r.halalKosherAmbiguous).toBe(true);
  });

  it('keeps pork away from a user who only ever told the coach halal/kosher', () => {
    const r = resolveDietProfile({ coachProfile: coach({ dietaryRestrictions: ['halal_kosher'] }) });
    expect(checkCandidate(usda('Pork tenderloin'), r.profile).verdict).toBe('exclude');
    expect(checkCandidate(usda('Shrimp'), r.profile).verdict).toBe('exclude');
  });

  it('treats "Food allergies" with no specifics as an unspecified allergy', () => {
    const r = resolveDietProfile({ coachProfile: coach({ dietaryRestrictions: ['allergies'] }) });
    expect(r.profile.unspecifiedAllergy).toBe(true);
    expect(r.profile.allergies).toEqual([]);
  });

  it('ignores "none"', () => {
    const r = resolveDietProfile({ coachProfile: coach({ dietaryRestrictions: ['none'] }) });
    expect(r.profile.restrictions).toEqual([]);
    expect(r.sources).toEqual([]);
  });

  it('reads the nutrition assessment eating style and intolerances', () => {
    const r = resolveDietProfile({ coachProfile: coach({
      nutrition: { dietaryStyle: 'pescatarian', digestion: { intolerances: ['lactose', 'onions'] } },
    }) });
    expect(r.profile.restrictions).toEqual(['pescatarian', 'dairy-free']);
    expect(r.profile.dislikes).toEqual(['onions']);
    expect(r.sources).toEqual(['nutrition_assessment']);
  });

  it('unions both sources, because a filter should err toward hiding', () => {
    const r = resolveDietProfile({ coachProfile: coach({
      dietaryRestrictions: ['gluten_free'], nutrition: { dietaryStyle: 'vegan' },
    }) });
    expect(r.profile.restrictions.sort()).toEqual(['gluten-free', 'vegan']);
  });

  it('lets a saved Food Finder profile override the intake — including an empty one', () => {
    // The user saw the intake answers pre-filled and chose to clear them.
    const r = resolveDietProfile({
      dietaryRestrictions: '[]', allergies: '[]', dislikedFoods: '[]',
      coachProfile: coach({ dietaryRestrictions: ['halal_kosher'] }),
    });
    expect(r.explicit).toBe(true);
    expect(r.profile.restrictions).toEqual([]);
    expect(r.halalKosherAmbiguous).toBe(false);
  });

  it('survives a corrupt coachProfile', () => {
    expect(resolveDietProfile({ coachProfile: '{not json' }).profile).toEqual(emptyProfile());
  });
});

describe('catalogue leaks found by auditing every food against every restriction', () => {
  it('keeps kefir, skyr and whey off a vegan or dairy-free plate', () => {
    for (const r of ['vegan', 'dairy-free']) {
      for (const [name, cat] of [['Kefir', 'Fermented dairy'], ['Skyr', 'Dairy'], ['Whey protein', 'Supplement']]) {
        expect(checkCandidate(usda(name, cat), profile({ restrictions: [r] })).verdict, `${r} / ${name}`).toBe('exclude');
      }
    }
  });

  it('does not mistake soy milk for dairy', () => {
    expect(checkCandidate(usda('Fortified soy milk', 'Plant dairy'), profile({ restrictions: ['vegan'] })).verdict).toBe('allow');
    expect(checkCandidate(usda('Fortified soy milk', 'Plant dairy'), profile({ allergies: ['milk'] })).verdict).toBe('allow');
  });

  it('still catches the plant in a plant milk', () => {
    expect(checkCandidate(usda('Almond milk'), profile({ allergies: ['tree-nut'] })).verdict).toBe('exclude');
    expect(checkCandidate(usda('Fortified soy milk'), profile({ allergies: ['soy'] })).verdict).toBe('exclude');
  });

  it('treats peanut butter as peanut, not as butter', () => {
    expect(checkCandidate(usda('Peanut butter', 'Nut butter'), profile({ allergies: ['peanut'] })).verdict).toBe('exclude');
    expect(checkCandidate(usda('Peanut butter', 'Nut butter'), profile({ restrictions: ['dairy-free'] })).verdict).toBe('allow');
  });

  it('matches plurals, so "Brazil nuts" is a tree nut', () => {
    expect(checkCandidate(usda('Brazil nuts', 'Nut'), profile({ allergies: ['tree-nut'] })).verdict).toBe('exclude');
  });

  it('does not let a plural rule create a false match', () => {
    expect(checkCandidate(usda('Eggplant'), profile({ allergies: ['egg'] })).verdict).toBe('allow');
    expect(checkCandidate(usda('Hamburger'), profile({ restrictions: ['no-pork'] })).verdict).toBe('allow');
  });

  it('keeps ordinary oats away from gluten-free, but not from a wheat allergy', () => {
    expect(checkCandidate(usda('Rolled oats', 'Whole grain'), profile({ restrictions: ['gluten-free'] })).verdict).toBe('exclude');
    expect(checkCandidate(usda('Rolled oats', 'Whole grain'), profile({ allergies: ['wheat'] })).verdict).toBe('allow');
  });

  it('accepts plural allergy names typed as free text', () => {
    expect(canonicalAllergen('Peanuts')).toBe('peanut');
    expect(canonicalAllergen('eggs')).toBe('egg');
    expect(canonicalAllergen('Sesame seeds')).toBe('sesame');
    expect(canonicalAllergen('mango')).toBe('mango');
  });
});

describe('halal and kosher meat', () => {
  it('keeps permitted meat but asks for certified meat', () => {
    for (const r of ['halal', 'kosher']) {
      const d = checkCandidate(usda('Chicken breast', 'Lean protein'), profile({ restrictions: [r] }));
      expect(d.verdict, r).toBe('unverifiable');
      expect(d.reason).toMatch(new RegExp(`${r}-certified chicken`));
    }
  });

  it('adds no caveat to food with no meat in it', () => {
    expect(checkCandidate(usda('Lentils', 'Legume'), profile({ restrictions: ['halal'] })).verdict).toBe('allow');
  });

  it('rejects a kosher meal that mixes meat and dairy', () => {
    const d = checkCandidate(usda('Chicken breast salad with cheddar cheese'), profile({ restrictions: ['kosher'] }));
    expect(d.verdict).toBe('exclude');
    expect(d.rule).toBe('restriction:kosher-meat-dairy');
  });

  it('lets an outright exclusion win over the certification caveat', () => {
    expect(checkCandidate(usda('Pork tenderloin'), profile({ restrictions: ['halal'] })).verdict).toBe('exclude');
  });
});

describe('exclusions always win, caveats accumulate', () => {
  it('still excludes a restaurant pork dish for a halal user who also has an allergy', () => {
    // The bug: the allergy caveat returned first, so the restriction never ran
    // and the pork dish was SHOWN, with a peanut warning.
    const d = checkCandidate(menu('Pork belly bao'), profile({ restrictions: ['halal'], allergies: ['peanut'] }));
    expect(d.verdict).toBe('exclude');
    expect(d.rule).toBe('restriction:halal');
  });

  it('combines every caveat that applies instead of showing only the first', () => {
    const d = checkCandidate(menu('Chicken shawarma plate'), profile({ restrictions: ['halal'], allergies: ['peanut'] }));
    expect(d.verdict).toBe('unverifiable');
    expect(d.reason).toMatch(/peanut/);
    expect(d.reason).toMatch(/halal-certified chicken/);
  });

  it('flags a restaurant dish that merely passes the keyword check for a vegan', () => {
    const d = checkCandidate(menu('Medium French fries'), profile({ restrictions: ['vegan'] }));
    expect(d.verdict).toBe('unverifiable');
    expect(d.reason).toMatch(/check it's vegan/);
  });

  it('ignores diet tags from an unverified source', () => {
    const d = checkCandidate({ name: 'Medium French fries', tags: ['vegetarian'], confidence: 'inferred' }, profile({ restrictions: ['vegetarian'] }));
    expect(d.verdict).toBe('unverifiable');
  });

  it('trusts diet tags from a verified source', () => {
    const d = checkCandidate({ name: 'Sofritas bowl', tags: ['vegan'], confidence: 'published' }, profile({ restrictions: ['vegan'] }));
    expect(d.verdict).toBe('allow');
  });
});
