// Gut-health nutrition route tests — assessment persistence, plan reads,
// daily micro bands, weekly pillar aggregation, order scan wiring (privacy:
// image never persisted), and item-level order logging with portion scaling.
// Prisma, the plan service, and the vision scanner are mocked.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test_secret_key_at_least_32_chars_long!!';
process.env.JWT_EXPIRES_IN = '1h';

const prismaUser = { findUnique: vi.fn(), update: vi.fn() };
const prismaMealEntry = { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() };

vi.mock('@prisma/client', () => {
  const PrismaClient = vi.fn(function (this: any) {
    this.user = prismaUser;
    this.mealEntry = prismaMealEntry;
    this.$transaction = (ops: Promise<unknown>[]) => Promise.all(ops);
  });
  return { PrismaClient };
});

const mockGenerate = vi.fn();
const mockLatest = vi.fn();
vi.mock('../services/nutritionPlanService.js', () => ({
  generateNutritionPlan: (...a: unknown[]) => mockGenerate(...a),
  latestNutritionPlan: (...a: unknown[]) => mockLatest(...a),
}));

const mockScan = vi.fn();
vi.mock('../services/llmService.js', () => ({
  analyzeOrderScreenshot: (...a: unknown[]) => mockScan(...a),
}));

const mockEnrich = vi.fn();
vi.mock('../services/nutritionEnrichmentService.js', () => ({
  enrichMealDetailHybrid: (...a: unknown[]) => mockEnrich(...a),
}));

const mockQuota = vi.fn();
vi.mock('../services/nutritionShared.js', () => ({
  consumeMealLoggingQuota: (...a: unknown[]) => mockQuota(...a),
  nutritionProfileCacheKey: (id: string) => `nutrition_profile:${id}`,
}));

// Dynamic import so the vi.mock factories' captured consts are initialized
// before the router module (and its transitive imports) load.
const { default: nutritionGutRoutes } = await import('../routes/nutritionGut.js');

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(cookieParser());
app.use('/api', nutritionGutRoutes);

const USER = { id: 'u-1', name: 'T', email: 't@axiom.io', tier: 'free', coachProfile: null as string | null };
const token = jwt.sign({ id: 'u-1', email: 't@axiom.io', tier: 'free' }, process.env.JWT_SECRET!, { expiresIn: '1h' });
const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

const scanItem = (over: Record<string, unknown> = {}) => ({
  name: 'Burrito bowl', quantity: 1, modifiers: ['no rice'],
  proteinG: 50, carbsG: 30, fatG: 20, calories: 500,
  mealType: 'dinner', confidence: 'high', notes: '',
  ingredients: ['chicken', 'beans'], tags: ['high-protein'],
  plants: ['black bean', 'tomato'], fermentedFoods: [], ultraProcessed: false,
  nutrients: { fiberG: 10, ironMg: 4, sodiumMg: 900 },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaUser.findUnique.mockResolvedValue({ ...USER });
  prismaUser.update.mockResolvedValue({});
  prismaMealEntry.findMany.mockResolvedValue([]);
  prismaMealEntry.findFirst.mockResolvedValue(null);
  prismaMealEntry.create.mockImplementation((args: any) => Promise.resolve({ id: 'm-1', ...args.data }));
  mockLatest.mockResolvedValue(null);
  mockQuota.mockResolvedValue(true);
  mockEnrich.mockImplementation((d: any) => Promise.resolve({ detail: d, meta: { provider: 'hybrid_llm_usda', usdaCoveragePct: 50 } }));
});

describe('POST /nutrition/assessment', () => {
  it('merges the assessment under coachProfile.nutrition preserving other keys', async () => {
    prismaUser.findUnique.mockResolvedValue({ ...USER, coachProfile: JSON.stringify({ gender: 'female', primaryGoal: 'strength' }) });
    const res = await auth(request(app).post('/api/nutrition/assessment')).send({
      dietaryStyle: 'vegan', goals: ['energy', 'sleep'], sleepQualityLow: true,
    });
    expect(res.status).toBe(201);
    const written = JSON.parse(prismaUser.update.mock.calls[0][0].data.coachProfile);
    expect(written.gender).toBe('female');            // untouched
    expect(written.nutrition.dietaryStyle).toBe('vegan');
    expect(written.nutrition.completedAt).toBeTruthy();
  });

  it('rejects invalid enum values', async () => {
    const res = await auth(request(app).post('/api/nutrition/assessment')).send({ dietaryStyle: 'carnivore' });
    expect(res.status).toBe(400);
  });
});

describe('GET /nutrition/plan', () => {
  it('404s before any plan exists', async () => {
    const res = await auth(request(app).get('/api/nutrition/plan'));
    expect(res.status).toBe(404);
  });

  it('returns the latest plan', async () => {
    mockLatest.mockResolvedValue({ plan: { summary: 'x' }, targets: { targets: [], focus: [] }, sources: [], generatedAt: new Date() });
    const res = await auth(request(app).get('/api/nutrition/plan'));
    expect(res.status).toBe(200);
    expect(res.body.plan.summary).toBe('x');
  });
});

describe('POST /nutrition/plan/generate', () => {
  it('delegates to the plan service', async () => {
    mockGenerate.mockResolvedValue({ plan: {}, targets: {}, sources: [], planId: 'p-1' });
    const res = await auth(request(app).post('/api/nutrition/plan/generate'));
    expect(res.status).toBe(201);
    expect(mockGenerate).toHaveBeenCalledWith('u-1');
    expect(res.body.planId).toBe('p-1');
  });
});

describe('GET /nutrition/micros/daily', () => {
  it('sums logged nutrients and bands them against default targets', async () => {
    prismaMealEntry.findMany.mockResolvedValue([
      { nutrientsJson: JSON.stringify({ fiberG: 20, ironMg: 6, sodiumMg: 1500 }) },
      { nutrientsJson: JSON.stringify({ fiberG: 14, ironMg: 2, sodiumMg: 1200 }) },
    ]);
    const res = await auth(request(app).get('/api/nutrition/micros/daily?date=2026-07-21'));
    expect(res.status).toBe(200);
    expect(res.body.estimateNote).toBe('est. ±30%');
    const fiber = res.body.nutrients.find((n: any) => n.key === 'fiberG');
    expect(fiber.actual).toBe(34);
    expect(fiber.status).toBe('ok');     // 34/34 male default
    expect(fiber.focus).toBe(true);      // fiber always focus
    const iron = res.body.nutrients.find((n: any) => n.key === 'ironMg');
    expect(iron.status).toBe('ok');      // 8/8
    const sodium = res.body.nutrients.find((n: any) => n.key === 'sodiumMg');
    expect(sodium.direction).toBe('limit');
    expect(sodium.status).toBe('low');   // 2700 vs 2300 cap → within 130%
  });

  it('uses personalized plan targets when a plan exists', async () => {
    mockLatest.mockResolvedValue({
      targets: {
        targets: [{ key: 'fiberG', label: 'Fiber', unit: 'g', target: 40, direction: 'meet', rationale: [] }],
        focus: ['fiberG'],
      },
    });
    prismaMealEntry.findMany.mockResolvedValue([{ nutrientsJson: JSON.stringify({ fiberG: 12 }) }]);
    const res = await auth(request(app).get('/api/nutrition/micros/daily'));
    const fiber = res.body.nutrients.find((n: any) => n.key === 'fiberG');
    expect(fiber.target).toBe(40);
    expect(fiber.pct).toBe(30);
    expect(fiber.status).toBe('vlow');
  });
});

describe('GET /nutrition/gut/week', () => {
  it('aggregates pillars from the trailing week', async () => {
    prismaMealEntry.findMany.mockResolvedValue([
      { date: '2026-07-20', nutrientsJson: JSON.stringify({ fiberG: 30 }), plantsJson: JSON.stringify(['tomato', 'spinach']), fermentedJson: JSON.stringify(['kefir']), ultraProcessed: false },
      { date: '2026-07-20', nutrientsJson: JSON.stringify({ fiberG: 10 }), plantsJson: JSON.stringify(['tomatoes', 'lentils']), fermentedJson: null, ultraProcessed: true },
      { date: '2026-07-21', nutrientsJson: JSON.stringify({ fiberG: 25 }), plantsJson: JSON.stringify(['oat', 'blueberry']), fermentedJson: null, ultraProcessed: false },
    ]);
    prismaMealEntry.findFirst.mockResolvedValue({ date: '2026-06-01' });
    const res = await auth(request(app).get('/api/nutrition/gut/week?end=2026-07-21'));
    expect(res.status).toBe(200);
    expect(res.body.days).toBe(7);
    // tomato deduped across plural forms → 5 distinct plants
    expect(res.body.plantCount).toBe(5);
    expect(res.body.plants).toContain('tomato');
    expect(res.body.pillars).toHaveLength(5);
    const ferment = res.body.pillars.find((p: any) => p.key === 'ferment');
    expect(ferment.detail).toContain('1 / 7');
  });

  it('scales the window for accounts younger than 7 days', async () => {
    prismaMealEntry.findMany.mockResolvedValue([
      { date: '2026-07-21', nutrientsJson: JSON.stringify({ fiberG: 30 }), plantsJson: JSON.stringify(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']), fermentedJson: JSON.stringify(['kimchi', 'kefir']), ultraProcessed: false },
      { date: '2026-07-21', nutrientsJson: JSON.stringify({ fiberG: 8 }), plantsJson: null, fermentedJson: null, ultraProcessed: false },
    ]);
    prismaMealEntry.findFirst.mockResolvedValue({ date: '2026-07-20' });
    const res = await auth(request(app).get('/api/nutrition/gut/week?end=2026-07-21'));
    expect(res.body.days).toBe(2);
    const plants = res.body.pillars.find((p: any) => p.key === 'plants');
    expect(plants.score).toBe(100); // 9 plants vs scaled target round(30*2/7)=9
  });
});

describe('POST /nutrition/order-scan', () => {
  const payload = { imageBase64: 'x'.repeat(200), mimeType: 'image/png' };

  it('returns extracted items enriched, and consumes the shared quota', async () => {
    mockScan.mockResolvedValue({ kind: 'order', vendor: 'UberEats · Chipotle', items: [scanItem()] });
    const res = await auth(request(app).post('/api/nutrition/order-scan')).send(payload);
    expect(res.status).toBe(200);
    expect(mockQuota).toHaveBeenCalled();
    expect(res.body.vendor).toBe('UberEats · Chipotle');
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].plants).toContain('black bean');
    expect(res.body.estimateNote).toBe('est. ±30%');
  });

  it('never echoes or stores the image — response carries food data only', async () => {
    mockScan.mockResolvedValue({ kind: 'order', vendor: 'DoorDash', items: [scanItem()] });
    const res = await auth(request(app).post('/api/nutrition/order-scan')).send(payload);
    expect(JSON.stringify(res.body)).not.toContain(payload.imageBase64.slice(0, 50));
    expect(prismaMealEntry.create).not.toHaveBeenCalled(); // scan is read-only
  });

  it('422s with a recoverable message when unreadable', async () => {
    mockScan.mockResolvedValue({ kind: 'unreadable', vendor: null, items: [] });
    const res = await auth(request(app).post('/api/nutrition/order-scan')).send(payload);
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/clearer screenshot|log by text/);
  });

  it('respects quota denial', async () => {
    mockQuota.mockImplementation(async (_p: unknown, _u: string, _t: string, res: any) => {
      res.status(429).json({ error: 'quota' });
      return false;
    });
    const res = await auth(request(app).post('/api/nutrition/order-scan')).send(payload);
    expect(res.status).toBe(429);
    expect(mockScan).not.toHaveBeenCalled();
  });
});

describe('POST /nutrition/order-log', () => {
  it('logs selected items with portion scaling and reports gut wins', async () => {
    const res = await auth(request(app).post('/api/nutrition/order-log')).send({
      date: '2026-07-21', mealType: 'dinner', vendor: 'UberEats · Chipotle',
      items: [
        { name: 'Burrito bowl', portionFactor: 0.5, quantity: 1, calories: 600, proteinG: 50, carbsG: 40, fatG: 20, plants: ['black bean', 'tomato'], fermentedFoods: [], ultraProcessed: false, nutrients: { fiberG: 12, ironMg: 4 }, ingredients: [], tags: [] },
        { name: 'Chips & guac', portionFactor: 1, quantity: 1, calories: 500, proteinG: 6, carbsG: 50, fatG: 30, plants: ['corn', 'avocado'], fermentedFoods: [], ultraProcessed: true, nutrients: { fiberG: 8 }, ingredients: [], tags: [] },
      ],
    });
    expect(res.status).toBe(201);
    expect(prismaMealEntry.create).toHaveBeenCalledTimes(2);
    const first = prismaMealEntry.create.mock.calls[0][0].data;
    expect(first.calories).toBe(300);                 // 600 × 0.5
    expect(first.proteinG).toBe(25);
    expect(first.name).toContain('(UberEats · Chipotle)');
    expect(JSON.parse(first.nutrientsJson).fiberG).toBe(6); // scaled
    expect(first.source).toBe('order-scan');
    expect(res.body.gutWins.plants).toEqual(expect.arrayContaining(['avocado', 'black bean', 'corn', 'tomato']));
  });

  it('rejects an empty item list', async () => {
    const res = await auth(request(app).post('/api/nutrition/order-log')).send({ items: [] });
    expect(res.status).toBe(400);
  });
});
