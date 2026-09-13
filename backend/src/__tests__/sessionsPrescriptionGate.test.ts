// Diagnostic-first prescription gate — verifies that under the
// diagnostic-first funnel the plan endpoints serve free users the diagnosis
// but strip the prescription, that pro/enterprise (and unflagged) users get
// the full plan, that the tier check reads the DB rather than the stale JWT,
// and that neither the session-detail nor the public share route works as a
// side door around the gate.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';

// vi.hoisted so these are set before the static imports below evaluate —
// featureFlags reads its env at module load, and a plain top-level assignment
// runs AFTER the import graph.
vi.hoisted(() => {
  process.env.JWT_SECRET = 'test_secret_key_at_least_32_chars_long!!';
  // Global switch left OFF — the allowlist path is what prod runs first, and
  // it doubles as the "flag off for everyone else" control group here.
  delete process.env.DIAGNOSTIC_FIRST_ONBOARDING_ENABLED;
  process.env.DIAGNOSTIC_FIRST_ONBOARDING_USERS = 'locked@axiom.io, u-by-id';
});

// ─── Prisma mock ──────────────────────────────────────────────────────────────
const { prismaUser, prismaSession, prismaGeneratedPlan } = vi.hoisted(() => ({
  prismaUser: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
  prismaSession: { findUnique: vi.fn(), create: vi.fn() },
  prismaGeneratedPlan: { findFirst: vi.fn(), create: vi.fn() },
}));

vi.mock('@prisma/client', () => {
  const PrismaClient = vi.fn(function (this: any) {
    this.user = prismaUser;
    this.session = prismaSession;
    this.generatedPlan = prismaGeneratedPlan;
  });
  return { PrismaClient };
});

// ─── Service mocks (imported by the sessions router) ─────────────────────────
vi.mock('../services/llmService.js', () => ({
  generateDiagnosticQuestion: vi.fn(),
  generateWorkoutPlan: vi.fn(),
  generateInitialAnalysis: vi.fn(),
  createChatThread: vi.fn(),
  sendChatMessage: vi.fn(),
}));
vi.mock('../services/youtubeService.js', () => ({ getExerciseVideo: vi.fn() }));
vi.mock('../services/posthogClient.js', () => ({
  default: { capture: vi.fn(), captureException: vi.fn() },
}));

import sessionsRouter from '../routes/sessions.js';
import { diagnosticFirstAvailableFor } from '../services/featureFlags.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const FULL_PLAN = {
  diagnosis: [{ limiterName: 'Triceps lockout weakness', confidence: 0.8, evidence: ['e1'] }],
  diagnostic_signals: { primary_phase: 'lockout', efficiency_score: 72 },
  // generateWorkoutPlan emits these at the plan ROOT as well as (sometimes)
  // nested — the strip must catch the top-level copy.
  progression_rules: ['Add 2.5kg when all sets hit'],
  track_next_time: ['Bar speed on last rep'],
  bench_day_plan: {
    primary_lift: { exercise_name: 'Bench Press', sets: 4, reps: 5, intensity: 80, rest_minutes: 3 },
    accessories: [
      { exercise_name: 'Close-Grip Bench', priority: 1 },
      { exercise_name: 'Dips', priority: 2 },
      { exercise_name: 'Overhead Extension', priority: 3 },
    ],
    progression_rules: ['Add 2.5kg when all sets hit'],
    track_next_time: ['Bar speed on last rep'],
  },
};

const SESSION_ROW = { id: 's1', userId: 'u1' };

function token(id: string, email: string, tier = 'free') {
  return jwt.sign({ id, email, tier }, process.env.JWT_SECRET!, { expiresIn: '1h' });
}

function makeApp() {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use('/api', sessionsRouter);
  return app;
}

beforeEach(() => {
  prismaUser.findUnique.mockReset();
  prismaSession.findUnique.mockReset();
  prismaGeneratedPlan.findFirst.mockReset();
  // Ownership check + detail route both hit session.findUnique.
  prismaSession.findUnique.mockResolvedValue({
    ...SESSION_ROW,
    isPublic: false,
    selectedLift: 'bench_press',
    user: null,
    snapshots: [],
    messages: [],
    plans: [{ id: 'p1', planJson: JSON.stringify(FULL_PLAN), planText: 'full text' }],
  });
  prismaGeneratedPlan.findFirst.mockResolvedValue({ planJson: JSON.stringify(FULL_PLAN) });
});

// ─── Flag predicate ───────────────────────────────────────────────────────────

describe('diagnosticFirstAvailableFor', () => {
  it('is on for an allowlisted email and an allowlisted id, off otherwise', () => {
    expect(diagnosticFirstAvailableFor('u1', 'locked@axiom.io')).toBe(true);
    expect(diagnosticFirstAvailableFor('u-by-id', null)).toBe(true);
    expect(diagnosticFirstAvailableFor('someone-else', 'other@axiom.io')).toBe(false);
  });
});

// ─── GET /sessions/:id/plan ───────────────────────────────────────────────────

describe('GET /api/sessions/:id/plan under the diagnostic-first funnel', () => {
  it('strips the prescription for a flagged free user but keeps the diagnosis', async () => {
    prismaUser.findUnique.mockResolvedValue({ tier: 'free' });
    const res = await request(makeApp())
      .get('/api/sessions/s1/plan')
      .set('Authorization', `Bearer ${token('u1', 'locked@axiom.io')}`);

    expect(res.status).toBe(200);
    expect(res.body.plan.prescription_locked).toBe(true);
    expect(res.body.plan.bench_day_plan).toBeUndefined();
    expect(res.body.plan.diagnosis[0].limiterName).toBe('Triceps lockout weakness');
    expect(res.body.plan.diagnostic_signals.primary_phase).toBe('lockout');
    expect(res.body.plan.prescription_preview.accessory_count).toBe(3);
    // The silhouette must not leak exercise names or numbers.
    expect(JSON.stringify(res.body.plan)).not.toContain('Close-Grip');
    // Top-level progression rules are part of the fix, not the diagnosis.
    expect(res.body.plan.progression_rules).toBeUndefined();
    // track_next_time is observational and stays free.
    expect(res.body.plan.track_next_time).toEqual(['Bar speed on last rep']);
  });

  it('serves the full plan when the DB says pro, even though the JWT still says free', async () => {
    prismaUser.findUnique.mockResolvedValue({ tier: 'pro' });
    const res = await request(makeApp())
      .get('/api/sessions/s1/plan')
      .set('Authorization', `Bearer ${token('u1', 'locked@axiom.io', 'free')}`);

    expect(res.status).toBe(200);
    expect(res.body.plan.prescription_locked).toBeUndefined();
    expect(res.body.plan.bench_day_plan.accessories).toHaveLength(3);
  });

  it('serves the full plan to a free user the funnel is not on for', async () => {
    prismaUser.findUnique.mockResolvedValue({ tier: 'free' });
    prismaSession.findUnique.mockResolvedValue({ id: 's1', userId: 'u2' });
    const res = await request(makeApp())
      .get('/api/sessions/s1/plan')
      .set('Authorization', `Bearer ${token('u2', 'other@axiom.io')}`);

    expect(res.status).toBe(200);
    expect(res.body.plan.prescription_locked).toBeUndefined();
    expect(res.body.plan.bench_day_plan.primary_lift.exercise_name).toBe('Bench Press');
  });
});

// ─── GET /sessions/:id (detail embeds plan rows) ─────────────────────────────

describe('GET /api/sessions/:id', () => {
  it('strips the embedded plan rows for a locked user', async () => {
    prismaUser.findUnique.mockResolvedValue({ tier: 'free' });
    const res = await request(makeApp())
      .get('/api/sessions/s1')
      .set('Authorization', `Bearer ${token('u1', 'locked@axiom.io')}`);

    expect(res.status).toBe(200);
    const embedded = JSON.parse(res.body.session.plans[0].planJson);
    expect(embedded.prescription_locked).toBe(true);
    expect(embedded.bench_day_plan).toBeUndefined();
    // planText is the whole prescription as prose — must not survive either.
    expect(res.body.session.plans[0].planText).toBe('');
  });
});

// ─── GET /sessions/:id/public (share link, no auth) ──────────────────────────

describe('GET /api/sessions/:id/public', () => {
  it('is not a side door: a locked owner\'s public share is stripped too', async () => {
    prismaSession.findUnique.mockResolvedValue({
      ...SESSION_ROW,
      isPublic: true,
      selectedLift: 'bench_press',
      plans: [{ planJson: JSON.stringify(FULL_PLAN) }],
    });
    prismaUser.findUnique.mockImplementation(({ select }: any) =>
      Promise.resolve(select?.email ? { id: 'u1', email: 'locked@axiom.io' } : { tier: 'free' }),
    );

    const res = await request(makeApp()).get('/api/sessions/s1/public');
    expect(res.status).toBe(200);
    expect(res.body.plan.prescription_locked).toBe(true);
    expect(res.body.plan.bench_day_plan).toBeUndefined();
  });

  it('serves the full plan when the owner is pro', async () => {
    prismaSession.findUnique.mockResolvedValue({
      ...SESSION_ROW,
      isPublic: true,
      selectedLift: 'bench_press',
      plans: [{ planJson: JSON.stringify(FULL_PLAN) }],
    });
    prismaUser.findUnique.mockImplementation(({ select }: any) =>
      Promise.resolve(select?.email ? { id: 'u1', email: 'locked@axiom.io' } : { tier: 'pro' }),
    );

    const res = await request(makeApp()).get('/api/sessions/s1/public');
    expect(res.status).toBe(200);
    expect(res.body.plan.bench_day_plan.accessories).toHaveLength(3);
  });
});
