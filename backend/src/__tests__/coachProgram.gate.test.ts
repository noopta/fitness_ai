// Coach program-generation paywall gate. Verifies the free-tier funnel rule on
// POST /api/coach/program: free users get exactly ONE generated plan (the
// onboarding hook), regeneration is pro-only, and pro/enterprise generate
// freely. The LLM generators + Prisma are mocked so no real API/DB calls run.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test_secret_key_at_least_32_chars_long!!';
process.env.OPENAI_API_KEY = 'test-openai-key'; // coach.ts does `new OpenAI()` at module load

// ─── Prisma mock ──────────────────────────────────────────────────────────────
const prismaUser = { findUnique: vi.fn(), update: vi.fn() };
vi.mock('@prisma/client', () => {
  const PrismaClient = vi.fn(function (this: any) {
    this.user = prismaUser;
  });
  return { PrismaClient };
});

// ─── LLM service mock ─────────────────────────────────────────────────────────
// Only the generators reached by POST /coach/program need real return values;
// the rest are stubbed so the module imports cleanly.
const mockGenerateTrainingProgram = vi.fn();
const mockGenerateNutritionPlan = vi.fn();
vi.mock('../services/llmService.js', () => ({
  createCoachThread: vi.fn(),
  sendCoachMessage: vi.fn(),
  getCoachMessages: vi.fn(),
  generateNutritionPlan: mockGenerateNutritionPlan,
  generateMealSuggestions: vi.fn(),
  generateTrainingProgram: mockGenerateTrainingProgram,
  generateCoachInsight: vi.fn(),
  generateTodayCoachingTips: vi.fn(),
  generateProgramAdjustment: vi.fn(),
  extractBodyCompositionGoal: vi.fn(() => 'maintenance'),
  generateWelcomeMessage: vi.fn(),
  rebalanceWeekAfterSwap: vi.fn(),
}));

// Import the router only after mocks are registered.
const { default: coachRoutes } = await import('../routes/coach.js');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', coachRoutes);
  return app;
}

function token(tier: string) {
  return jwt.sign({ id: 'u-1', email: 't@axiom.io', tier }, process.env.JWT_SECRET!, { expiresIn: '1h' });
}

const VALID_BODY = { goal: 'strength', bodyCompositionGoal: 'maintenance', daysPerWeek: 4, durationWeeks: 8 };

// A route-shaped user record. `savedProgram` is what the gate keys off of.
function userRecord(savedProgram: string | null) {
  return {
    id: 'u-1',
    savedProgram,
    coachProfile: null,
    trainingAge: 'intermediate',
    equipment: 'full_gym',
    weightKg: 80,
    heightCm: 180,
    coachBudget: null,
    sessions: [],
  };
}

beforeEach(() => {
  prismaUser.findUnique.mockReset();
  prismaUser.update.mockReset();
  prismaUser.update.mockResolvedValue({});
  mockGenerateTrainingProgram.mockReset();
  mockGenerateTrainingProgram.mockResolvedValue({ name: 'Test Program', phases: [] });
  mockGenerateNutritionPlan.mockReset();
  mockGenerateNutritionPlan.mockResolvedValue({ macros: { calories: 2500 } });
});

describe('POST /api/coach/program — free-tier generation gate', () => {
  it('lets a free user generate their FIRST plan (no savedProgram yet)', async () => {
    prismaUser.findUnique.mockResolvedValue(userRecord(null));
    const res = await request(makeApp())
      .post('/api/coach/program')
      .set('Authorization', `Bearer ${token('free')}`)
      .send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Test Program');
    expect(mockGenerateTrainingProgram).toHaveBeenCalledOnce();
  });

  it('blocks a free user from REgenerating once a plan is saved (403 upgrade)', async () => {
    prismaUser.findUnique.mockResolvedValue(userRecord(JSON.stringify({ name: 'Existing' })));
    const res = await request(makeApp())
      .post('/api/coach/program')
      .set('Authorization', `Bearer ${token('free')}`)
      .send(VALID_BODY);

    expect(res.status).toBe(403);
    expect(res.body.upgrade).toBe(true);
    expect(mockGenerateTrainingProgram).not.toHaveBeenCalled();
  });

  it('lets a pro user regenerate even with an existing saved plan', async () => {
    prismaUser.findUnique.mockResolvedValue(userRecord(JSON.stringify({ name: 'Existing' })));
    const res = await request(makeApp())
      .post('/api/coach/program')
      .set('Authorization', `Bearer ${token('pro')}`)
      .send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(mockGenerateTrainingProgram).toHaveBeenCalledOnce();
  });

  it('lets an enterprise user regenerate with an existing saved plan', async () => {
    prismaUser.findUnique.mockResolvedValue(userRecord(JSON.stringify({ name: 'Existing' })));
    const res = await request(makeApp())
      .post('/api/coach/program')
      .set('Authorization', `Bearer ${token('enterprise')}`)
      .send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(mockGenerateTrainingProgram).toHaveBeenCalledOnce();
  });
});
