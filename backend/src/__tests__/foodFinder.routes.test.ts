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
