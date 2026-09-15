// The legacy wizard interview must not spend the daily diagnosis per message.
// With FREE_TIER_DAILY_LIMIT=1 the hidden opening trigger used to consume the
// day's allowance and a free user's first real answer came back 429, so no
// free user could finish an interview. The quota belongs on /generate only.

import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.hoisted(() => {
  process.env.JWT_SECRET = 'test_secret_key_at_least_32_chars_long!!';
});

const quotaSpy = vi.hoisted(() => vi.fn((_req: any, res: any) => res.status(429).json({ error: 'Daily analysis limit reached' })));
vi.mock('../middleware/rateLimit.js', () => ({ checkAnalysisRateLimit: quotaSpy }));
vi.mock('../middleware/rateLimiter.js', () => ({ aiLimiter: (_q: any, _s: any, next: any) => next() }));

const prisma = vi.hoisted(() => ({
  user: { findUnique: vi.fn(async () => null), update: vi.fn(async () => ({})) },
  session: { findUnique: vi.fn(async () => ({ id: 's1', userId: 'u1', selectedLift: 'flat_bench_press' })), create: vi.fn() },
  diagnosticMessage: { create: vi.fn(async ({ data }: any) => ({ id: 'm', ...data })) },
  generatedPlan: { findFirst: vi.fn(), create: vi.fn() },
}));
vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(function (this: any) {
    Object.assign(this, prisma);
  }),
}));
vi.mock('../services/llmService.js', () => ({
  generateDiagnosticQuestion: vi.fn(async () => ({ complete: false, question: 'Where does the bar slow down?' })),
  generateWorkoutPlan: vi.fn(),
  generateInitialAnalysis: vi.fn(),
  createChatThread: vi.fn(),
  sendChatMessage: vi.fn(),
}));
vi.mock('../services/youtubeService.js', () => ({ getExerciseVideo: vi.fn() }));
vi.mock('../services/posthogClient.js', () => ({ default: { capture: vi.fn(), captureException: vi.fn() } }));

import sessionsRouter from '../routes/sessions.js';

const app = express();
app.use(express.json());
app.use('/api', sessionsRouter);
const auth = `Bearer ${jwt.sign({ id: 'u1', email: 'free@axiom.io', tier: 'free' }, process.env.JWT_SECRET!)}`;

describe('POST /sessions/:id/messages', () => {
  it('never runs the daily analysis quota, so a free user can answer every question', async () => {
    const init = await request(app).post('/api/sessions/s1/messages').set('Authorization', auth).send({ message: '__init__' });
    const answer = await request(app).post('/api/sessions/s1/messages').set('Authorization', auth).send({ message: 'It slows at lockout' });
    expect(quotaSpy).not.toHaveBeenCalled();
    expect(init.status).not.toBe(429);
    expect(answer.status).not.toBe(429);
  });

  it('plan generation is still metered', async () => {
    const res = await request(app).post('/api/sessions/s1/generate').set('Authorization', auth).send({});
    expect(quotaSpy).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(429);
  });
});
