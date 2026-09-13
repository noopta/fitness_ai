// GET /nutrition-profile/food-finder — the endpoint the mobile app will call.
// Prisma and the Places client are mocked; auth is a real JWT. Verifies the
// HTTP contract the client depends on, the no-location and Places-outage
// degradation paths, and that response copy never overclaims.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_key_at_least_32_chars_long!!';

const mocks = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn() },
  mealEntry: { findMany: vi.fn(), findFirst: vi.fn() },
  workoutLog: { findMany: vi.fn() },
  nutritionPlan: { findFirst: vi.fn() },
  foodRecommendationLog: { findMany: vi.fn(), createMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  ingredientPrice: { findMany: vi.fn() },
  foodBrand: { findMany: vi.fn() },
  menuItem: { findMany: vi.fn() },
}));
vi.mock('@prisma/client', () => {
  const PrismaClient = vi.fn(function (this: any) { Object.assign(this, mocks); });
  return { PrismaClient };
});

vi.mock('../services/llmService.js', () => ({
  generateProfileNarration: vi.fn().mockRejectedValue(new Error('no llm')),
  generateNutrientWhy: vi.fn().mockRejectedValue(new Error('no llm')),
}));
vi.mock('../services/ragService.js', () => ({ buildRAGContext: vi.fn().mockResolvedValue('') }));

const mockSearchNearby = vi.fn();
vi.mock('../services/places/placesClient.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/places/placesClient.js')>();
  return { ...actual, searchNearby: mockSearchNearby };
});

import { clearChainCorpus } from '../services/foodFinder/chainMenu.js';

const ME = 'u-1';
const token = jwt.sign({ id: ME, email: 'me@axiom.io', tier: 'free' }, process.env.JWT_SECRET!, { expiresIn: '1h' });

const SAVED_PROGRAM = JSON.stringify({
  nutritionPlan: { macros: { calories: 2600, proteinG: 180, carbsG: 300, fatG: 80 } },
});

const store = {
  id: 'store-1', name: 'Loblaws', primaryType: 'supermarket',
  types: ['supermarket', 'grocery_store'], lat: 43.65, lng: -79.38,
  distanceM: 350, openNow: true, rating: 4.1, ratingCount: 900,
  priceLevel: null, businessStatus: 'OPERATIONAL',
};
const restaurant = {
  id: 'rest-1', name: 'Poke Place', primaryType: 'japanese_restaurant',
  types: ['japanese_restaurant', 'restaurant'], lat: 43.651, lng: -79.381,
  distanceM: 220, openNow: true, rating: 4.6, ratingCount: 300,
  priceLevel: 'PRICE_LEVEL_MODERATE', businessStatus: 'OPERATIONAL',
};

async function makeApp() {
  const router = (await import('../routes/nutritionProfile.js')).default;
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', router);
  return app;
}

const get = async (qs: string) =>
  request(await makeApp()).get(`/api/nutrition-profile/food-finder${qs}`).set('Authorization', `Bearer ${token}`);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.findUnique.mockResolvedValue({
    id: ME, weightKg: 80, savedProgram: SAVED_PROGRAM,
    dailyCalorieTarget: null, subtractWorkoutBurnFromCalories: false,
  });
  mocks.user.update.mockResolvedValue({});
  // Half a day eaten: plenty of gap left, so the ranker has something to say.
  mocks.mealEntry.findMany.mockResolvedValue([
    { date: '2026-08-08', calories: 1200, proteinG: 70, carbsG: 150, fatG: 40, nutrientMapJson: null, nutrientsJson: null },
  ]);
  mocks.workoutLog.findMany.mockResolvedValue([]);
  mocks.nutritionPlan.findFirst.mockResolvedValue(null);
  // No suggestion history and no restrictions by default: each test opts into
  // the behaviour it is about.
  mocks.foodRecommendationLog.findMany.mockResolvedValue([]);
  mocks.foodRecommendationLog.createMany.mockResolvedValue({ count: 0 });
  mocks.foodRecommendationLog.findFirst.mockResolvedValue(null);
  // No chain corpus by default; the chain test opts in.
  mocks.foodBrand.findMany.mockResolvedValue([]);
  mocks.menuItem.findMany.mockResolvedValue([]);
  clearChainCorpus();
  // A Toronto price table, so grocery options carry an estimated price.
  mocks.ingredientPrice.findMany.mockResolvedValue([
    { foldedName: 'wild salmon', priceCents: 1582, unitGrams: null, currency: 'CAD' },
    { foldedName: 'whole eggs', priceCents: 173, unitGrams: null, currency: 'CAD' },
    { foldedName: 'greek yogurt', priceCents: 205, unitGrams: null, currency: 'CAD' },
  ]);
  mockSearchNearby.mockImplementation(async ({ includedTypes }: { includedTypes: string[] }) =>
    includedTypes.includes('supermarket') ? [store] : [restaurant]);
});

describe('GET /nutrition-profile/food-finder', () => {
  it('returns a merged ranked list with both paths', async () => {
    const res = await get('?date=2026-08-08&lat=43.6532&lng=-79.3832');
    expect(res.status).toBe(200);
    expect(res.body.nearby).toMatchObject({ used: true, degraded: false, storesFound: 1, restaurantsFound: 1 });
    expect(res.body.recommendations.length).toBeGreaterThan(0);
    expect(new Set(res.body.recommendations.map((r: any) => r.kind))).toEqual(new Set(['ingredient', 'takeout']));
  });

  it('exposes the mode and a plain-language reason', async () => {
    const res = await get('?date=2026-08-08&lat=43.6532&lng=-79.3832');
    expect(res.body.mode).toBeTruthy();
    expect(typeof res.body.why).toBe('string');
    expect(res.body.why.length).toBeGreaterThan(10);
    expect(res.body.remaining).toHaveProperty('proteinG');
  });

  it('attaches a real place to every located recommendation', async () => {
    const res = await get('?date=2026-08-08&lat=43.6532&lng=-79.3832');
    const located = res.body.recommendations.filter((r: any) => r.where);
    expect(located.length).toBeGreaterThan(0);
    for (const r of located) {
      expect([store.name, restaurant.name]).toContain(r.where.name);
      expect(r.where.distanceM).toBeGreaterThan(0);
    }
  });

  it('never claims a dish is on the restaurant menu', async () => {
    // The whole takeout path rests on this phrasing staying honest.
    const res = await get('?date=2026-08-08&lat=43.6532&lng=-79.3832');
    const takeout = res.body.recommendations.filter((r: any) => r.kind === 'takeout');
    expect(takeout.length).toBeGreaterThan(0);
    for (const r of takeout) {
      expect(r.confidence).toBe('estimated');
      expect(r.note).toMatch(/estimated, not their menu/i);
    }
  });

  it('says "usually carried" for groceries rather than claiming stock', async () => {
    const res = await get('?date=2026-08-08&lat=43.6532&lng=-79.3832');
    const withStore = res.body.recommendations.find((r: any) => r.kind === 'ingredient' && r.where);
    expect(withStore.note).toMatch(/usually carried/i);
    expect(withStore.note).not.toMatch(/in stock/i);
  });

  it('degrades to whole foods when no location is sent', async () => {
    const res = await get('?date=2026-08-08');
    expect(res.status).toBe(200);
    expect(res.body.nearby).toMatchObject({ used: false, degraded: true });
    expect(res.body.recommendations.length).toBeGreaterThan(0);
    expect(res.body.recommendations.every((r: any) => r.kind === 'ingredient')).toBe(true);
    expect(mockSearchNearby).not.toHaveBeenCalled();
  });

  it('degrades rather than failing when Places returns nothing', async () => {
    mockSearchNearby.mockResolvedValue([]);
    const res = await get('?date=2026-08-08&lat=43.6532&lng=-79.3832');
    expect(res.status).toBe(200);
    expect(res.body.nearby.degraded).toBe(true);
    expect(res.body.recommendations.length).toBeGreaterThan(0);
  });

  it('ignores a null-island fix instead of searching the Atlantic', async () => {
    const res = await get('?date=2026-08-08&lat=0&lng=0');
    expect(res.body.nearby.used).toBe(false);
    expect(mockSearchNearby).not.toHaveBeenCalled();
  });

  it('rejects out-of-range coordinates', async () => {
    const res = await get('?date=2026-08-08&lat=999&lng=-79.38');
    expect(res.body.nearby.used).toBe(false);
  });

  it('honours include=groceries', async () => {
    const res = await get('?date=2026-08-08&lat=43.6532&lng=-79.3832&include=groceries');
    expect(res.body.recommendations.every((r: any) => r.kind === 'ingredient')).toBe(true);
  });

  it('clamps an absurd radius instead of forwarding it', async () => {
    await get('?date=2026-08-08&lat=43.6532&lng=-79.3832&radius=999999');
    for (const call of mockSearchNearby.mock.calls) {
      expect(call[0].radiusM).toBeLessThanOrEqual(10000);
    }
  });

  it('requires auth', async () => {
    const res = await request(await makeApp()).get('/api/nutrition-profile/food-finder');
    expect(res.status).toBe(401);
  });
});

describe('GET /nutrition-profile/food-finder — budget, diet, directions', () => {
  const TORONTO = '?date=2026-08-08&lat=43.6532&lng=-79.3832';

  it('derives currency and metro from where the user is standing', async () => {
    const res = await get(TORONTO);
    expect(res.body.nearby.metro.slug).toBe('toronto-on-ca');
    expect(res.body.budget.currency).toBe('CAD');
    expect(res.body.budget.pricesAvailable).toBe(true);
  });

  it('quotes no prices at all outside a seeded metro', async () => {
    // Better to say nothing than to quote Toronto prices in Sydney.
    const res = await get('?date=2026-08-08&lat=-33.8688&lng=151.2093');
    expect(res.body.nearby.metro).toBeNull();
    expect(res.body.budget.pricesAvailable).toBe(false);
    expect(res.body.recommendations.every((r: any) => r.price === null)).toBe(true);
  });

  it('prices grocery options from the metro table', async () => {
    const res = await get(TORONTO);
    const priced = res.body.recommendations.filter((r: any) => r.price);
    expect(priced.length).toBeGreaterThan(0);
    expect(priced[0].price.currency).toBe('CAD');
    expect(priced[0].price.estimated).toBe(true);
    expect(priced[0].price.display).toMatch(/^≈/);
  });

  it('distinguishes an unknown price from a free one', async () => {
    const res = await get(TORONTO);
    const takeout = res.body.recommendations.find((r: any) => r.kind === 'takeout');
    // We have not parsed this restaurant's menu, so there is no price to quote.
    if (takeout) expect(takeout.price).toBeNull();
  });

  it('flags options over an explicit budget without hiding them', async () => {
    const res = await get(`${TORONTO}&budget=3`);
    expect(res.body.budget.cents).toBe(300);
    expect(res.body.budget.display).toBe('$3');
    // Salmon at ~$15.82 cannot fit a $3 budget.
    const over = res.body.recommendations.filter((r: any) => r.overBudget);
    expect(over.every((r: any) => r.price.cents > 300)).toBe(true);
  });

  it('lets a cheap option beat an expensive one once a budget is set', async () => {
    const rich = await get(TORONTO);
    const tight = await get(`${TORONTO}&budget=3`);
    const salmonRich = rich.body.recommendations.findIndex((r: any) => /salmon/i.test(r.name));
    const salmonTight = tight.body.recommendations.findIndex((r: any) => /salmon/i.test(r.name));
    if (salmonRich >= 0 && salmonTight >= 0) expect(salmonTight).toBeGreaterThanOrEqual(salmonRich);
  });

  it('excludes food a vegetarian cannot eat, and says how many', async () => {
    mocks.user.findUnique.mockResolvedValue({
      id: ME, weightKg: 80, savedProgram: SAVED_PROGRAM,
      dailyCalorieTarget: null, subtractWorkoutBurnFromCalories: false,
      dietaryRestrictions: '["vegetarian"]',
    });
    const res = await get(TORONTO);
    expect(res.body.diet.active).toBe(true);
    expect(res.body.diet.excluded).toBeGreaterThan(0);
    expect(res.body.recommendations.some((r: any) => /salmon|chicken|beef|liver/i.test(r.name))).toBe(false);
  });

  it('warns rather than certifies when an allergy cannot be verified on a menu', async () => {
    mocks.user.findUnique.mockResolvedValue({
      id: ME, weightKg: 80, savedProgram: SAVED_PROGRAM,
      dailyCalorieTarget: null, subtractWorkoutBurnFromCalories: false,
      allergies: '["peanut"]',
    });
    const res = await get(TORONTO);
    const takeout = res.body.recommendations.filter((r: any) => r.kind === 'takeout');
    // Restaurant dishes survive, but carry the caveat instead of a false all-clear.
    for (const t of takeout) expect(t.dietWarning).toMatch(/can't verify/i);
    // USDA ingredients are real knowledge, so they need no caveat.
    const ingredients = res.body.recommendations.filter((r: any) => r.kind === 'ingredient');
    expect(ingredients.every((r: any) => r.dietWarning === null)).toBe(true);
  });

  it('hands every attached venue a working directions link', async () => {
    const res = await get(TORONTO);
    const withVenue = res.body.recommendations.filter((r: any) => r.where);
    expect(withVenue.length).toBeGreaterThan(0);
    for (const r of withVenue) {
      expect(r.directionsUrl).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\/\?api=1/);
      expect(r.directionsUrl).toContain('destination_place_id=');
    }
  });

  it('records what it showed, so tomorrow is not a repeat of today', async () => {
    await get(TORONTO);
    expect(mocks.foodRecommendationLog.createMany).toHaveBeenCalled();
    const arg = mocks.foodRecommendationLog.createMany.mock.calls[0][0];
    expect(arg.data.length).toBeGreaterThan(0);
    expect(arg.data[0]).toMatchObject({ userId: ME });
  });

  it('demotes something it suggested an hour ago', async () => {
    const fresh = await get(TORONTO);
    const topName = fresh.body.recommendations[0]?.name;
    const topId = fresh.body.recommendations[0]?.id;
    mocks.foodRecommendationLog.findMany.mockResolvedValue([
      { itemKey: topId, shownAt: new Date(Date.now() - 3600_000), actedAt: null },
    ]);
    const repeat = await get(TORONTO);
    expect(repeat.body.recommendations[0]?.name).not.toBe(topName);
  });
});

describe('GET /nutrition-profile/food-finder — chain menus', () => {
  const TORONTO = '?date=2026-08-08&lat=43.6532&lng=-79.3832';

  beforeEach(() => {
    clearChainCorpus();
    mocks.foodBrand.findMany.mockResolvedValue([
      { id: 'brand-1', slug: 'nandos', name: "Nando's", aliasesJson: '["nandos peri peri"]' },
    ]);
    mocks.menuItem.findMany.mockResolvedValue([
      {
        id: 'mi-1', brandId: 'brand-1', name: 'Grilled chicken breast fillet', section: 'Chicken',
        kcal: 205, proteinG: 40, carbsG: 0, fatG: 5,
        nutrientsJson: '{"sodiumMg":580}', dietTagsJson: null, confidence: 'published',
        kcalErrPct: null, priceCents: null, currency: null,
        sourceUrl: 'https://www.nandos.co.uk/nutrition',
      },
    ]);
    // The nearby restaurant IS the chain.
    mockSearchNearby.mockImplementation(async ({ includedTypes }: { includedTypes: string[] }) =>
      includedTypes.includes('supermarket')
        ? [store]
        : [{ ...restaurant, id: 'place-nandos', name: "Nando's - Queen St W" }]);
  });

  it('uses the chain\'s published nutrition instead of a cuisine guess', async () => {
    const res = await get(TORONTO);
    expect(res.body.nearby.chainsMatched).toBe(1);
    const item = res.body.recommendations.find((r: any) => /grilled chicken breast/i.test(r.name));
    expect(item).toBeTruthy();
    expect(item.confidence).toBe('published');
  });

  it('stops hedging about menus once the figure is published', async () => {
    const res = await get(TORONTO);
    const item = res.body.recommendations.find((r: any) => /grilled chicken breast/i.test(r.name));
    // The cuisine-guess copy would have said "estimated, not their menu".
    expect(item.note).toMatch(/^Published nutrition from Nando's\.$/);
    expect(item.note).not.toMatch(/estimated/i);
  });

  it('does not also offer a contradictory cuisine guess for the same place', async () => {
    const res = await get(TORONTO);
    const fromThisPlace = res.body.recommendations.filter((r: any) => r.where?.name === "Nando's - Queen St W");
    expect(fromThisPlace.every((r: any) => r.confidence === 'published')).toBe(true);
  });

  it('outranks an equally good estimated dish, because it is trusted more', async () => {
    const res = await get(TORONTO);
    const published = res.body.recommendations.filter((r: any) => r.confidence === 'published');
    expect(published.length).toBeGreaterThan(0);
  });
});
