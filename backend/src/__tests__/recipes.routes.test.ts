// Recipe library routes — create/update/delete, per-serving math, snapshot
// logging into MealEntry, LLM parse quota gating, ownership checks.
// Prisma + LLM + push side-effects are mocked; auth is a real JWT
// (requireAuth is stateless).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_key_at_least_32_chars_long!!';

// ─── Prisma mock ──────────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  recipe: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  mealEntry: { create: vi.fn() },
  user: { findUnique: vi.fn(), update: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('@prisma/client', () => {
  const PrismaClient = vi.fn(function (this: any) { Object.assign(this, mocks); });
  return { PrismaClient };
});

// llmService constructs an OpenAI client at import time — mock the module.
const mockParseRecipe = vi.fn();
vi.mock('../services/llmService.js', () => ({
  parseRecipeIngredients: mockParseRecipe,
}));

// Streak/push/activity side-effects are fire-and-forget — stub them out.
vi.mock('../services/streakService.js', () => ({ recordActivity: vi.fn().mockResolvedValue(null) }));
vi.mock('../services/notificationService.js', () => ({
  notifyStreakMilestone: vi.fn(),
  notifyComeback: vi.fn(),
  notifyPersonalBest: vi.fn(),
  notifyStreakFreezeUsed: vi.fn(),
  notifySurpriseReward: vi.fn(),
}));
vi.mock('../services/activityService.js', () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));

const ME = 'u-1';
const token = jwt.sign({ id: ME, email: 'me@axiom.io', tier: 'free' }, process.env.JWT_SECRET!, { expiresIn: '1h' });

const CHILI_ITEMS = [
  { name: 'ground beef', quantity: '2 lbs', calories: 1584, proteinG: 181, carbsG: 0, fatG: 91 },
  { name: 'black beans', quantity: '1 can', calories: 368, proteinG: 24, carbsG: 66, fatG: 1 },
  { name: 'onion', quantity: '1', calories: 48, proteinG: 1, carbsG: 11, fatG: 0 },
];

const DB_RECIPE = {
  id: 'r-1',
  userId: ME,
  name: 'Chili',
  servings: 4,
  itemsJson: JSON.stringify(CHILI_ITEMS),
  calories: 500,
  proteinG: 51.5,
  carbsG: 19.3,
  fatG: 23,
  nutrientsJson: JSON.stringify({ fiberG: 4, sodiumMg: 300 }),
  useCount: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

async function buildApp() {
  const { default: routes } = await import('../routes/recipes.js');
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use('/api', routes);
  return app;
}

beforeEach(() => {
  Object.values(mocks.recipe).forEach(m => m.mockReset());
  mocks.mealEntry.create.mockReset();
  mocks.user.findUnique.mockReset();
  // requireAuth fires a background lastActiveAt update on every authed
  // request — give update a resolved default so its .catch() has a promise.
  mocks.user.update.mockReset().mockResolvedValue({});
  mocks.$transaction.mockReset();
  mockParseRecipe.mockReset();
});

describe('POST /api/nutrition/recipes', () => {
  it('computes per-serving totals server-side and stores items as JSON', async () => {
    const app = await buildApp();
    mocks.recipe.create.mockImplementation(async ({ data }: any) => ({ ...DB_RECIPE, ...data }));

    const res = await request(app)
      .post('/api/nutrition/recipes')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Chili', servings: 4, items: CHILI_ITEMS });

    expect(res.status).toBe(201);
    const data = mocks.recipe.create.mock.calls[0][0].data;
    // (1584+368+48)/4 = 500 kcal, (181+24+1)/4 = 51.5g protein
    expect(data.calories).toBe(500);
    expect(data.proteinG).toBe(51.5);
    expect(data.carbsG).toBe(19.3);
    expect(data.fatG).toBe(23);
    expect(JSON.parse(data.itemsJson)).toHaveLength(3);
    // Response deserializes items for the client
    expect(res.body.items).toHaveLength(3);
  });

  it('divides whole-recipe micros by servings and drops non-numeric keys', async () => {
    const app = await buildApp();
    mocks.recipe.create.mockImplementation(async ({ data }: any) => ({ ...DB_RECIPE, ...data }));

    const res = await request(app)
      .post('/api/nutrition/recipes')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Chili', servings: 4, items: CHILI_ITEMS,
        nutrients: { fiberG: 16, sodiumMg: 1200, digestiveSpeed: 'slow' },
      });

    expect(res.status).toBe(201);
    const stored = JSON.parse(mocks.recipe.create.mock.calls[0][0].data.nutrientsJson);
    expect(stored).toEqual({ fiberG: 4, sodiumMg: 300 });
  });

  it('rejects a recipe with no items', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/nutrition/recipes')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Empty', servings: 2, items: [] });
    expect(res.status).toBe(400);
    expect(mocks.recipe.create).not.toHaveBeenCalled();
  });

  it('requires auth', async () => {
    const app = await buildApp();
    const res = await request(app).post('/api/nutrition/recipes').send({ name: 'X', servings: 1, items: CHILI_ITEMS });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/nutrition/recipes', () => {
  it('lists the user recipes with deserialized items', async () => {
    const app = await buildApp();
    mocks.recipe.findMany.mockResolvedValue([DB_RECIPE]);

    const res = await request(app).get('/api/nutrition/recipes').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.recipes).toHaveLength(1);
    expect(res.body.recipes[0].items[0].name).toBe('ground beef');
    expect(mocks.recipe.findMany.mock.calls[0][0].where.userId).toBe(ME);
  });

  it('passes the search query through as a name filter', async () => {
    const app = await buildApp();
    mocks.recipe.findMany.mockResolvedValue([]);
    await request(app).get('/api/nutrition/recipes?q=chili').set('Authorization', `Bearer ${token}`);
    expect(mocks.recipe.findMany.mock.calls[0][0].where.name).toEqual({ contains: 'chili' });
  });
});

describe('PUT /api/nutrition/recipes/:id', () => {
  it('recomputes per-serving totals and 404s on other users recipes', async () => {
    const app = await buildApp();
    mocks.recipe.findFirst.mockResolvedValue(DB_RECIPE);
    mocks.recipe.update.mockImplementation(async ({ data }: any) => ({ ...DB_RECIPE, ...data }));

    const res = await request(app)
      .put('/api/nutrition/recipes/r-1')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Chili v2', servings: 8, items: CHILI_ITEMS });
    expect(res.status).toBe(200);
    expect(mocks.recipe.update.mock.calls[0][0].data.calories).toBe(250); // 2000/8

    mocks.recipe.findFirst.mockResolvedValue(null); // not mine
    const miss = await request(app)
      .put('/api/nutrition/recipes/r-other')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'X', servings: 1, items: CHILI_ITEMS });
    expect(miss.status).toBe(404);
  });
});

describe('DELETE /api/nutrition/recipes/:id', () => {
  it('deletes own recipe, 404s on unknown', async () => {
    const app = await buildApp();
    mocks.recipe.findFirst.mockResolvedValue(DB_RECIPE);
    mocks.recipe.delete.mockResolvedValue(DB_RECIPE);
    const res = await request(app).delete('/api/nutrition/recipes/r-1').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);

    mocks.recipe.findFirst.mockResolvedValue(null);
    const miss = await request(app).delete('/api/nutrition/recipes/nope').set('Authorization', `Bearer ${token}`);
    expect(miss.status).toBe(404);
    expect(mocks.recipe.delete).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/nutrition/recipes/:id/log', () => {
  it('snapshots servings × per-serving macros into a MealEntry and bumps useCount', async () => {
    const app = await buildApp();
    mocks.recipe.findFirst.mockResolvedValue(DB_RECIPE);
    mocks.mealEntry.create.mockImplementation((args: any) => args);
    mocks.recipe.update.mockImplementation((args: any) => args);
    mocks.$transaction.mockImplementation(async (ops: any[]) => [
      { id: 'm-1', ...ops[0].data },
      DB_RECIPE,
    ]);

    const res = await request(app)
      .post('/api/nutrition/recipes/r-1/log')
      .set('Authorization', `Bearer ${token}`)
      .send({ date: '2026-07-15', mealType: 'dinner', servings: 1.5 });

    expect(res.status).toBe(201);
    const entry = mocks.mealEntry.create.mock.calls[0][0].data;
    expect(entry.calories).toBe(750);      // 500 × 1.5
    expect(entry.proteinG).toBe(77.3);     // 51.5 × 1.5, rounded to 1dp
    expect(entry.source).toBe('recipe');
    expect(entry.recipeId).toBe('r-1');
    expect(entry.servings).toBe(1.5);
    expect(JSON.parse(entry.ingredientsJson)).toEqual(['ground beef', 'black beans', 'onion']);
    expect(JSON.parse(entry.nutrientsJson)).toEqual({ fiberG: 6, sodiumMg: 450 });
    // useCount increments inside the same transaction
    expect(mocks.recipe.update.mock.calls[0][0].data.useCount).toEqual({ increment: 1 });
  });

  it('404s when logging a recipe the user does not own', async () => {
    const app = await buildApp();
    mocks.recipe.findFirst.mockResolvedValue(null);
    const res = await request(app)
      .post('/api/nutrition/recipes/r-x/log')
      .set('Authorization', `Bearer ${token}`)
      .send({ date: '2026-07-15' });
    expect(res.status).toBe(404);
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it('rejects bad dates and out-of-range servings', async () => {
    const app = await buildApp();
    mocks.recipe.findFirst.mockResolvedValue(DB_RECIPE);
    const badDate = await request(app)
      .post('/api/nutrition/recipes/r-1/log')
      .set('Authorization', `Bearer ${token}`)
      .send({ date: 'yesterday' });
    expect(badDate.status).toBe(400);

    const badServings = await request(app)
      .post('/api/nutrition/recipes/r-1/log')
      .set('Authorization', `Bearer ${token}`)
      .send({ date: '2026-07-15', servings: 50 });
    expect(badServings.status).toBe(400);
  });
});

describe('POST /api/nutrition/recipes/parse', () => {
  const PARSED = {
    name: 'Chili', servings: 6, confidence: 'high', notes: '',
    items: CHILI_ITEMS.map(i => ({ ...i })),
  };

  it('parses via LLM and consumes the shared free-tier quota', async () => {
    const app = await buildApp();
    // tier lookup, then quota count lookup
    mocks.user.findUnique
      .mockResolvedValueOnce({ tier: 'free' })
      .mockResolvedValueOnce({ dailyPhotoScanCount: 0, dailyPhotoScanDate: null });
    mocks.user.update.mockResolvedValue({});
    mockParseRecipe.mockResolvedValue(PARSED);

    const res = await request(app)
      .post('/api/nutrition/recipes/parse')
      .set('Authorization', `Bearer ${token}`)
      .send({ description: '2 lbs ground beef, 1 can black beans, 1 onion. Makes 6 servings.' });

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(3);
    // quota consumed (requireAuth also updates lastActiveAt, so filter)
    const quotaWrites = mocks.user.update.mock.calls.filter(
      (c: any[]) => c[0]?.data?.dailyPhotoScanCount !== undefined,
    );
    expect(quotaWrites).toHaveLength(1);
    expect(quotaWrites[0][0].data.dailyPhotoScanCount).toBe(1);
  });

  it('429s a free user who exhausted the shared AI quota', async () => {
    const app = await buildApp();
    const today = new Date().toISOString().slice(0, 10);
    mocks.user.findUnique
      .mockResolvedValueOnce({ tier: 'free' })
      .mockResolvedValueOnce({ dailyPhotoScanCount: 7, dailyPhotoScanDate: today });

    const res = await request(app)
      .post('/api/nutrition/recipes/parse')
      .set('Authorization', `Bearer ${token}`)
      .send({ description: 'a very long recipe description here' });

    expect(res.status).toBe(429);
    expect(mockParseRecipe).not.toHaveBeenCalled();
  });

  it('skips the quota entirely for pro users', async () => {
    const app = await buildApp();
    mocks.user.findUnique.mockResolvedValueOnce({ tier: 'pro' });
    mockParseRecipe.mockResolvedValue(PARSED);

    const res = await request(app)
      .post('/api/nutrition/recipes/parse')
      .set('Authorization', `Bearer ${token}`)
      .send({ description: 'chili recipe with beans and beef' });

    expect(res.status).toBe(200);
    const quotaWrites = mocks.user.update.mock.calls.filter(
      (c: any[]) => c[0]?.data?.dailyPhotoScanCount !== undefined,
    );
    expect(quotaWrites).toHaveLength(0);
  });
});
