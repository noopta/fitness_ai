// Nutrition Profile routes — day profile, effect/nutrient detail, meal
// breakdown, trend, recommendations. Prisma + LLM narration + RAG are mocked;
// auth is a real JWT. Verifies the engine wiring, the deterministic narration
// fallback path, ownership checks, and open-vector round-tripping.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_key_at_least_32_chars_long!!';

const mocks = vi.hoisted(() => ({
  // update: requireAuth fires a background lastActiveAt write on every request.
  user: { findUnique: vi.fn(), update: vi.fn() },
  mealEntry: { findMany: vi.fn(), findFirst: vi.fn() },
}));
vi.mock('@prisma/client', () => {
  const PrismaClient = vi.fn(function (this: any) { Object.assign(this, mocks); });
  return { PrismaClient };
});

// LLM + RAG mocked. Narration REJECTS by default so tests exercise the
// deterministic fallback; individual tests can override.
const mockNarration = vi.fn();
const mockNutrientWhy = vi.fn();
const mockRag = vi.fn();
vi.mock('../services/llmService.js', () => ({
  generateProfileNarration: mockNarration,
  generateNutrientWhy: mockNutrientWhy,
}));
vi.mock('../services/ragService.js', () => ({ buildRAGContext: mockRag }));

const ME = 'u-1';
const token = jwt.sign({ id: ME, email: 'me@axiom.io', tier: 'free' }, process.env.JWT_SECRET!, { expiresIn: '1h' });

function meal(over: Partial<any> = {}) {
  return {
    id: 'm-1', name: 'Eggs & oats', mealType: 'breakfast', calories: 500,
    proteinG: 30, carbsG: 40, fatG: 18,
    nutrientMapJson: JSON.stringify({ proteinG: 30, cholineMg: 440, ironMg: 3, magnesiumMg: 90, omega3G: 0.3 }),
    nutrientsJson: null, ingredientsJson: JSON.stringify(['eggs', 'oats']),
    ingredientNutrientsJson: JSON.stringify([
      { name: 'eggs', nutrients: { proteinG: 18, cholineMg: 440, vitaminDIU: 120 } },
      { name: 'oats', nutrients: { carbsG: 27, fiberG: 4, magnesiumMg: 60 } },
    ]),
    createdAt: new Date('2026-07-16T08:00:00Z'),
    ...over,
  };
}

async function buildApp() {
  const { default: routes } = await import('../routes/nutritionProfile.js');
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use('/api', routes);
  return app;
}

beforeEach(() => {
  mocks.user.findUnique.mockReset().mockResolvedValue({ weightKg: 80 });
  mocks.user.update.mockReset().mockResolvedValue({});
  mocks.mealEntry.findMany.mockReset();
  mocks.mealEntry.findFirst.mockReset();
  mockNarration.mockReset().mockRejectedValue(new Error('llm off')); // force fallback
  mockNutrientWhy.mockReset().mockRejectedValue(new Error('llm off'));
  mockRag.mockReset().mockResolvedValue('');
});

describe('GET /nutrition-profile', () => {
  it('returns the empty state when no meals are logged', async () => {
    const app = await buildApp();
    mocks.mealEntry.findMany.mockResolvedValue([]);
    const res = await request(app).get('/api/nutrition-profile?date=2026-07-16').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.hasData).toBe(false);
    expect(res.body.mealsLogged).toBe(0);
  });

  it('builds the day profile with quantified deterministic narration (LLM off)', async () => {
    const app = await buildApp();
    mocks.mealEntry.findMany.mockResolvedValue([meal()]);
    const res = await request(app).get('/api/nutrition-profile?date=2026-07-16').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.hasData).toBe(true);
    expect(res.body.systems).toHaveLength(5);
    // headline + every driver carries a number (spec §8)
    expect(res.body.headline).toMatch(/\d/);
    for (const s of res.body.systems) expect(s.driver).toMatch(/\d/);
    expect(res.body.profileScoreProvisional).toBe(true);
    expect(res.body.topMove?.gain).toMatch(/^\+\d+/);
    expect(res.body.meals[0].id).toBe('m-1');
  });

  it('prefers LLM narration when available', async () => {
    const app = await buildApp();
    mocks.mealEntry.findMany.mockResolvedValue([meal()]);
    mockNarration.mockResolvedValue({
      headline: 'Fueling recovery at 78 — cognition the lever at 61.',
      drivers: { Recovery: 'Protein at 144% is carrying recovery to 78.' },
    });
    const res = await request(app).get('/api/nutrition-profile').set('Authorization', `Bearer ${token}`);
    expect(res.body.headline).toContain('Fueling recovery');
    const recovery = res.body.systems.find((s: any) => s.id === 'recovery');
    expect(recovery.driver).toContain('144%');
  });

  it('falls back to macros+micros for pre-migration entries with no nutrientMap', async () => {
    const app = await buildApp();
    mocks.mealEntry.findMany.mockResolvedValue([meal({
      nutrientMapJson: null,
      nutrientsJson: JSON.stringify({ cholineMg: 300, ironMg: 5 }),
    })]);
    const res = await request(app).get('/api/nutrition-profile').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    // derived totals still produce systems
    expect(res.body.systems.find((s: any) => s.id === 'cognition').score).toBeGreaterThan(0);
  });
});

describe('GET /nutrition-profile/effect/:systemId', () => {
  it('returns drivers, mechanisms and a watch-for for a valid system', async () => {
    const app = await buildApp();
    mocks.mealEntry.findMany.mockResolvedValue([meal()]);
    const res = await request(app).get('/api/nutrition-profile/effect/cognition').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Cognition & focus');
    expect(res.body.drivers.length).toBeGreaterThan(0);
    expect(res.body.mechanisms.length).toBeGreaterThan(0);
    expect(res.body.drivers.some((d: any) => d.key === 'cholineMg')).toBe(true);
  });

  it('404s an unknown system', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/nutrition-profile/effect/telepathy').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /nutrition-profile/nutrient/:key', () => {
  it('returns the mechanism chain, sources and a deterministic why (LLM off)', async () => {
    const app = await buildApp();
    mocks.mealEntry.findMany.mockResolvedValue([meal()]);
    const res = await request(app).get('/api/nutrition-profile/nutrient/cholineMg').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.label).toBe('Choline');
    expect(res.body.chain.length).toBeGreaterThan(0);
    expect(res.body.sources.length).toBeGreaterThan(0);
    expect(res.body.sources[0].amount).toMatch(/^\+\d+ mg$/);
    expect(res.body.why).toMatch(/\d/); // quantified fallback
  });

  it('404s an unknown nutrient key', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/nutrition-profile/nutrient/unobtainium').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /nutrition-profile/meal/:mealId', () => {
  it('returns per-ingredient nutrient chips when resolved', async () => {
    const app = await buildApp();
    mocks.mealEntry.findFirst.mockResolvedValue(meal());
    const res = await request(app).get('/api/nutrition-profile/meal/m-1').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.ingredients[0].resolved).toBe(true);
    expect(res.body.ingredients[0].chips.some((c: string) => /Choline/.test(c))).toBe(true);
    expect(res.body.macros.proteinG).toBe(30);
  });

  it('marks ingredients unresolved when only names are stored (§7)', async () => {
    const app = await buildApp();
    mocks.mealEntry.findFirst.mockResolvedValue(meal({ ingredientNutrientsJson: null }));
    const res = await request(app).get('/api/nutrition-profile/meal/m-1').set('Authorization', `Bearer ${token}`);
    expect(res.body.ingredients[0].resolved).toBe(false);
    expect(res.body.ingredients[0].chips).toHaveLength(0);
  });

  it('404s a meal the user does not own', async () => {
    const app = await buildApp();
    mocks.mealEntry.findFirst.mockResolvedValue(null);
    const res = await request(app).get('/api/nutrition-profile/meal/nope').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /nutrition-profile/trend', () => {
  it('returns a per-day series and per-nutrient consistency', async () => {
    const app = await buildApp();
    mocks.mealEntry.findMany.mockResolvedValue([
      meal({ date: '2026-07-15' }),
      meal({ id: 'm-2', date: '2026-07-16' }),
    ]);
    const res = await request(app).get('/api/nutrition-profile/trend?range=7d').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.range).toBe('7d');
    expect(res.body.series.length).toBe(2);
    expect(res.body.consistency.length).toBeGreaterThan(0);
    expect(res.body.consistency[0]).toHaveProperty('pctDaysOnTarget');
  });
});

describe('GET /nutrition-profile/recommendations', () => {
  it('returns ranked foods with a deep-link prefill payload', async () => {
    const app = await buildApp();
    mocks.mealEntry.findMany.mockResolvedValue([meal({
      nutrientMapJson: JSON.stringify({ proteinG: 30 }), // lots of gaps
    })]);
    const res = await request(app).get('/api/nutrition-profile/recommendations').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.recommendations.length).toBeGreaterThan(0);
    const r = res.body.recommendations[0];
    expect(r.gain).toMatch(/^\+\d+/);
    expect(r.prefill.source).toBe('recommendation');
    expect(r.prefill.name).toContain(r.name);
  });
});
