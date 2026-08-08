import { describe, it, expect } from 'vitest';
import {
  bestStoreFor,
  groceryCandidates,
  storeCarries,
  takeoutCandidates,
  GROCERY_PLACE_TYPES,
  VERIFIED_PLACE_TYPES,
} from '../services/foodFinder/nearbyFinder.js';
import { dishesForPlace, CUISINE_DISHES, DISH_PLACE_TYPES } from '../engine/cuisineDishes.js';
import { haversineM, gridKey } from '../services/places/placesClient.js';
import type { NearbyPlace } from '../services/places/placesClient.js';
import { FOOD_SOURCES } from '../engine/nutritionRecommendations.js';
import { arbitrate, buildFinderGap, rankCandidates, scoreCandidate } from '../engine/foodFinderRanker.js';
import { computeDayRemaining } from '../services/nutritionRemaining.js';

const place = (over: Partial<NearbyPlace> & { id: string; name: string }): NearbyPlace => ({
  primaryType: null, types: [], lat: 0, lng: 0, distanceM: 500,
  openNow: true, rating: 4.2, ratingCount: 100, priceLevel: null,
  businessStatus: 'OPERATIONAL',
  ...over,
});

const food = (name: string) => FOOD_SOURCES.find(f => f.name === name)!;

describe('haversineM', () => {
  it('measures a known distance', () => {
    // Toronto City Hall → Union Station, ~1.2 km.
    const d = haversineM(43.6534, -79.3841, 43.6453, -79.3806);
    expect(d).toBeGreaterThan(800);
    expect(d).toBeLessThan(1400);
  });

  it('is zero for the same point', () => {
    expect(haversineM(43.65, -79.38, 43.65, -79.38)).toBe(0);
  });
});

describe('gridKey', () => {
  it('collapses nearby positions onto one cache cell', () => {
    expect(gridKey(43.6534, -79.3841)).toBe(gridKey(43.6537, -79.3839));
  });

  it('separates positions a few km apart', () => {
    expect(gridKey(43.65, -79.38)).not.toBe(gridKey(43.70, -79.38));
  });
});

describe('storeCarries', () => {
  it('lets a supermarket carry an everyday food', () => {
    expect(storeCarries(food('Whole eggs'), place({ id: 'a', name: 'Loblaws', primaryType: 'supermarket' }))).toBe(true);
  });

  it('refuses to promise a specialty food at a convenience store', () => {
    // Claiming beef liver at a corner store is the small lie that costs trust.
    const corner = place({ id: 'b', name: 'Corner Store', primaryType: 'convenience_store' });
    expect(storeCarries(food('Beef liver'), corner)).toBe(false);
    expect(storeCarries(food('Whole eggs'), corner)).toBe(true);
  });

  it('allows a specialty food at a butcher or health food shop', () => {
    expect(storeCarries(food('Beef liver'), place({ id: 'c', name: 'Butcher', primaryType: 'butcher_shop' }))).toBe(true);
    expect(storeCarries(food('UV-exposed mushrooms'), place({ id: 'd', name: 'Health Foods', primaryType: 'health_food_store' }))).toBe(true);
  });

  it('uses secondary types once a place is a known food retailer', () => {
    // Real shape: Whole Foods is primaryType grocery_store but lists
    // health_food_store in its types, and it IS where you'd buy the specialty
    // items. Secondary types are informative *after* the gate, not before.
    const wholeFoods = place({
      id: 'wf', name: 'Whole Foods Market', primaryType: 'grocery_store',
      types: ['grocery_store', 'health_food_store', 'deli', 'bakery', 'supermarket'],
    });
    expect(storeCarries(food('UV-exposed mushrooms'), wholeFoods)).toBe(true);
  });

  it('rejects a coffee shop that Google tagged as a food_store', () => {
    // The exact live failure this gate exists for: the finder was recommending
    // turkey breast and lentils at "Dineen Coffee Co.".
    const cafe = place({
      id: 'd', name: 'Dineen Coffee Co.', primaryType: 'coffee_shop',
      types: ['coffee_shop', 'cafe', 'food_store', 'store', 'food'],
    });
    expect(storeCarries(food('Turkey breast'), cafe)).toBe(false);
    expect(storeCarries(food('Whole eggs'), cafe)).toBe(false);
  });

  it('rejects other food_store-tagged non-grocers seen in real results', () => {
    const junk = [
      place({ id: '1', name: 'Dollarama', primaryType: 'discount_store', types: ['discount_store', 'food_store', 'store'] }),
      place({ id: '2', name: 'Petro-Canada', primaryType: 'gas_station', types: ['gas_station', 'convenience_store', 'food_store'] }),
      place({ id: '3', name: 'Crumbl', primaryType: 'bakery', types: ['bakery', 'dessert_shop', 'food_store'] }),
      place({ id: '4', name: 'Mizzica Gelateria', primaryType: 'ice_cream_shop', types: ['ice_cream_shop', 'cafe', 'bakery'] }),
    ];
    for (const p of junk) expect(storeCarries(food('Whole eggs'), p)).toBe(false);
  });
});

describe('bestStoreFor', () => {
  it('picks the nearest store that plausibly carries it', () => {
    const stores = [
      place({ id: 'far', name: 'Far Market', primaryType: 'supermarket', distanceM: 2000 }),
      place({ id: 'near', name: 'Near Market', primaryType: 'supermarket', distanceM: 300 }),
    ];
    expect(bestStoreFor(food('Whole eggs'), stores)?.id).toBe('near');
  });

  it('skips nearer stores that cannot plausibly carry it', () => {
    const stores = [
      place({ id: 'corner', name: 'Corner', primaryType: 'convenience_store', distanceM: 100 }),
      place({ id: 'butcher', name: 'Butcher', primaryType: 'butcher_shop', distanceM: 900 }),
    ];
    expect(bestStoreFor(food('Beef liver'), stores)?.id).toBe('butcher');
  });

  it('returns null when nothing nearby fits', () => {
    expect(bestStoreFor(food('Beef liver'), [place({ id: 'c', name: 'C', primaryType: 'convenience_store' })])).toBeNull();
  });
});

describe('groceryCandidates', () => {
  const stores = [place({ id: 's', name: 'Loblaws', primaryType: 'supermarket', distanceM: 400 })];

  it('attaches a store and its distance', () => {
    const eggs = groceryCandidates(stores).find(c => c.name === 'Whole eggs')!;
    expect(eggs.distanceM).toBe(400);
    expect((eggs.meta as any).store.name).toBe('Loblaws');
  });

  it('keeps unattached foods rather than dropping them', () => {
    // Being far from a butcher should not delete liver from the world.
    const liver = groceryCandidates(stores).find(c => c.name === 'Beef liver')!;
    expect(liver).toBeDefined();
    expect((liver.meta as any).store).toBeNull();
    expect(liver.distanceM).toBeNull();
  });

  it('keeps every food when there are no stores at all', () => {
    expect(groceryCandidates([])).toHaveLength(FOOD_SOURCES.length);
  });
});

describe('dishesForPlace', () => {
  it('maps a typed restaurant to its dishes', () => {
    expect(dishesForPlace({ primaryType: 'japanese_restaurant', types: [] }).length).toBeGreaterThan(0);
  });

  it('falls back to the types array when primaryType is generic', () => {
    const dishes = dishesForPlace({ primaryType: 'restaurant', types: ['japanese_restaurant'] });
    expect(dishes.length).toBeGreaterThan(0);
  });

  it('returns nothing for a restaurant it cannot type — no invented dishes', () => {
    expect(dishesForPlace({ primaryType: 'restaurant', types: ['food', 'establishment'] })).toEqual([]);
  });

  it('only searches for place types it can actually map', () => {
    for (const t of DISH_PLACE_TYPES) expect(CUISINE_DISHES[t]).toBeDefined();
  });
});

describe('takeoutCandidates', () => {
  const poke = place({ id: 'p1', name: 'Poke Place', primaryType: 'japanese_restaurant', distanceM: 250 });

  it('builds candidates carrying the vendor and distance', () => {
    const [c] = takeoutCandidates([poke]);
    expect(c.kind).toBe('takeout');
    expect(c.distanceM).toBe(250);
    expect((c.meta as any).vendor.name).toBe('Poke Place');
  });

  it('always marks dish nutrition as estimated', () => {
    // The 0.7 confidence discount is what lets guessed macros share a scale
    // with USDA figures. If this ever ships as 'usda' the ranking is a lie.
    for (const c of takeoutCandidates([poke])) expect(c.confidence).toBe('estimated');
  });

  it('produces nothing for untypeable restaurants', () => {
    expect(takeoutCandidates([place({ id: 'x', name: 'Generic', primaryType: 'restaurant' })])).toEqual([]);
  });

  it('gives each dish at each vendor a distinct id', () => {
    const ids = takeoutCandidates([poke, place({ id: 'p2', name: 'Other', primaryType: 'japanese_restaurant' })])
      .map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// The merge — the point of the whole phase.
// ---------------------------------------------------------------------------
const dayWith = (over: Record<string, number>, plan = { calories: 2600, proteinG: 180, carbsG: 300, fatG: 80 }) =>
  computeDayRemaining({
    date: '2026-08-08',
    todayTotals: over,
    weekDayTotals: [],
    bodyweightKg: 80,
    mealsLogged: 2,
    planMacros: plan,
  });

describe('merged ranking', () => {
  const stores = [place({ id: 's', name: 'Loblaws', primaryType: 'supermarket', distanceM: 350 })];
  const restaurants = [place({ id: 'r', name: 'Poke Place', primaryType: 'japanese_restaurant', distanceM: 200 })];

  it('ranks groceries and takeout on one scale', () => {
    const d = dayWith({ calories: 1200, proteinG: 70, carbsG: 150, fatG: 40 });
    const { results } = rankCandidates(
      [...groceryCandidates(stores), ...takeoutCandidates(restaurants)],
      d,
      { limit: 6 },
    );
    expect(results.length).toBeGreaterThan(0);
    expect(new Set(results.map(r => r.kind)).size).toBe(2);
  });

  it('prefers the known whole food over the estimated dish, all else close', () => {
    // Same day, and a dish and an ingredient that close similar gaps: the USDA
    // figure should win on confidence.
    const d = dayWith({ calories: 1200, proteinG: 70, carbsG: 150, fatG: 40 });
    const { results } = rankCandidates(
      [...groceryCandidates(stores), ...takeoutCandidates(restaurants)],
      d,
      { limit: 10, guaranteeBothKinds: false },
    );
    expect(results[0].kind).toBe('ingredient');
  });

  it('penalises a distant vendor against a close one', () => {
    // Scored directly: two identical dishes share a diversity signature, so the
    // farther one is correctly deduped out of a ranked list entirely.
    const d = dayWith({ calories: 1200, proteinG: 70, carbsG: 150, fatG: 40 });
    const arb = arbitrate(d);
    const gap = buildFinderGap(d, arb);
    const [near] = takeoutCandidates([place({ id: 'n', name: 'Near', primaryType: 'japanese_restaurant', distanceM: 150 })]);
    const [far] = takeoutCandidates([place({ id: 'f', name: 'Far', primaryType: 'japanese_restaurant', distanceM: 6000 })]);
    expect(scoreCandidate(near, gap, d, arb).score).toBeGreaterThan(scoreCandidate(far, gap, d, arb).score);
  });

  it('surfaces a sodium warning on a salty takeout dish', () => {
    // Most takeout dishes are salty; the day is already near the cap.
    const d = dayWith({ calories: 1200, proteinG: 70, carbsG: 150, fatG: 40, sodiumMg: 1900 });
    const pho = takeoutCandidates([place({ id: 'v', name: 'Pho Spot', primaryType: 'vietnamese_restaurant', distanceM: 300 })]);
    const { results } = rankCandidates([...pho, ...groceryCandidates(stores)], d, { limit: 10, guaranteeBothKinds: false });
    const scoredPho = results.find(r => r.name === 'Beef pho');
    // Either it carries a warning, or it was rejected outright for the sodium.
    if (scoredPho) expect(scoredPho.warns.some(w => w.key === 'sodiumMg')).toBe(true);
    else expect(results.every(r => r.name !== 'Beef pho')).toBe(true);
  });

  it('still answers with whole foods when there is nothing nearby', () => {
    const d = dayWith({ calories: 1200, proteinG: 70, carbsG: 150, fatG: 40 });
    const { results } = rankCandidates(groceryCandidates([]), d, { limit: 6, guaranteeBothKinds: false });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(r => r.kind === 'ingredient')).toBe(true);
  });
});

describe('place type coverage', () => {
  it('only searches Places types verified against the live API', () => {
    // One invalid type 400s the WHOLE request, so this is a production
    // kill-switch, not a nicety — `seafood_market` looked real and is not.
    for (const t of GROCERY_PLACE_TYPES) expect(VERIFIED_PLACE_TYPES.has(t)).toBe(true);
  });

  it('keeps the availability tiers nested rather than overlapping', () => {
    // A convenience store must not satisfy a specialty food, or the tier is
    // decorative and the store claim becomes a guess.
    const corner = place({ id: 'c', name: 'C', primaryType: 'convenience_store' });
    const superm = place({ id: 's', name: 'S', primaryType: 'supermarket' });
    const specialty = FOOD_SOURCES.filter(f => f.retail.availability === 'specialty');
    expect(specialty.length).toBeGreaterThan(0);
    for (const f of specialty) {
      expect(storeCarries(f, corner)).toBe(false);
      expect(storeCarries(f, superm)).toBe(false);
    }
  });

  it('searches grocery types that cover every availability tier', () => {
    for (const f of FOOD_SOURCES) {
      const tierTypes = GROCERY_PLACE_TYPES.filter(t =>
        storeCarries(f, place({ id: 't', name: 't', primaryType: t })),
      );
      expect(tierTypes.length).toBeGreaterThan(0);
    }
  });
});
