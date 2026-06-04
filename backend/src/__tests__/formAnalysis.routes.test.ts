// Form-analysis route integration tests — verify multipart upload, quota
// gating, Gemini call wiring, persistence, refund-on-failure, and the
// list/detail endpoints. Gemini SDK + Prisma are mocked so no real API calls
// or DB writes happen.

import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test_secret_key_at_least_32_chars_long!!';
process.env.JWT_EXPIRES_IN = '1h';

// ─── Prisma mock ──────────────────────────────────────────────────────────────
const prismaUser = { findUnique: vi.fn(), update: vi.fn() };
const prismaFormAnalysis = { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() };
const prismaFeatureUsage = { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn(), updateMany: vi.fn() };

vi.mock('@prisma/client', () => {
  const PrismaClient = vi.fn(function (this: any) {
    this.user = prismaUser;
    this.formAnalysis = prismaFormAnalysis;
    this.featureUsage = prismaFeatureUsage;
  });
  return { PrismaClient };
});

// ─── Gemini service mock ──────────────────────────────────────────────────────
const mockAnalyzeWorkoutVideo = vi.fn();
vi.mock('../services/geminiService.js', () => ({
  analyzeWorkoutVideo: mockAnalyzeWorkoutVideo,
}));

// requireAuth uses prisma.user.findUnique; we make it always resolve a real-ish
// user by default so route logic past auth gets exercised.
function makeToken(userId: string, tier = 'free') {
  return jwt.sign({ id: userId, email: 'test@axiom.io', tier }, process.env.JWT_SECRET!, { expiresIn: '1h' });
}

const USER = { id: 'u-1', name: 'Test', email: 't@axiom.io', tier: 'free' };

beforeEach(() => {
  prismaUser.findUnique.mockReset();
  prismaUser.update.mockReset();
  prismaFormAnalysis.create.mockReset();
  prismaFormAnalysis.findMany.mockReset();
  prismaFormAnalysis.findFirst.mockReset();
  prismaFormAnalysis.update.mockReset();
  prismaFormAnalysis.update.mockResolvedValue({});
  prismaFormAnalysis.updateMany.mockReset();
  prismaFormAnalysis.updateMany.mockResolvedValue({ count: 0 });
  prismaFeatureUsage.findUnique.mockReset();
  prismaFeatureUsage.upsert.mockReset();
  prismaFeatureUsage.update.mockReset();
  prismaFeatureUsage.updateMany.mockReset();
  prismaFeatureUsage.updateMany.mockResolvedValue({ count: 0 });
  mockAnalyzeWorkoutVideo.mockReset();

  // Default: a valid free user
  prismaUser.findUnique.mockResolvedValue(USER);
  // requireAuth fires a fire-and-forget lastActiveAt update via setImmediate;
  // give it a thenable so the un-awaited `.catch()` doesn't throw an unhandled
  // rejection that fails the run (all assertions pass regardless).
  prismaUser.update.mockResolvedValue({});
});

async function buildApp() {
  const { default: routes } = await import('../routes/formAnalysis.js');
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use('/api', routes);
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/form-analysis/video', () => {
  let app: express.Express;
  beforeAll(async () => { app = await buildApp(); });

  it('returns 401 when no auth', async () => {
    const res = await request(app)
      .post('/api/form-analysis/video')
      .attach('video', Buffer.from('mock video'), { filename: 'lift.mp4', contentType: 'video/mp4' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when no video file is attached', async () => {
    const res = await request(app)
      .post('/api/form-analysis/video')
      .set('Authorization', `Bearer ${makeToken('u-1')}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no video/i);
  });

  it('rejects non-video uploads', async () => {
    const res = await request(app)
      .post('/api/form-analysis/video')
      .set('Authorization', `Bearer ${makeToken('u-1')}`)
      .attach('video', Buffer.from('definitely a jpg'), { filename: 'oops.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/only video/i);
  });

  it('returns 202 + pending immediately, then completes asynchronously', async () => {
    prismaFeatureUsage.upsert.mockResolvedValue({ count: 1 });
    // Gate the Gemini call so we can observe pending → complete transition.
    const fakeAnalysis = {
      exercise: 'Back squat',
      formScore: 7.5,
      repCount: 5,
      strengths: ['Solid bracing', 'Consistent depth'],
      weaknesses: [{ issue: 'Slight knee valgus on rep 3', severity: 'minor', cue: 'Push knees out' }],
      recommendedDrills: [{ name: 'Goblet squat', why: 'Reinforces knees-out cue' }],
      programmingNotes: ['Keep working sets at RPE 7'],
      safetyFlags: [],
      summary: 'Strong squat with one minor knee fix.',
    };
    let resolveAnalysis!: (a: typeof fakeAnalysis) => void;
    const gate = new Promise<typeof fakeAnalysis>((res) => { resolveAnalysis = res; });
    mockAnalyzeWorkoutVideo.mockImplementation(() => gate);
    prismaFormAnalysis.create.mockResolvedValue({ id: 'fa-1', createdAt: new Date('2026-06-03T12:00:00Z') });

    const res = await request(app)
      .post('/api/form-analysis/video')
      .set('Authorization', `Bearer ${makeToken('u-1', 'free')}`)
      .field('exerciseHint', 'back squat')
      .attach('video', Buffer.from('mock video data'), { filename: 'lift.mp4', contentType: 'video/mp4' });

    // Upload returns 202 + pending while Gemini is still running.
    expect(res.status).toBe(202);
    expect(res.body.id).toBe('fa-1');
    expect(res.body.status).toBe('pending');
    expect(res.body.usage.feature).toBe('form_video');
    // The pending row was created with status='pending' (no analysis fields yet).
    const createData = prismaFormAnalysis.create.mock.calls[0][0].data;
    expect(createData.status).toBe('pending');
    expect(createData.exercise).toBe('pending');
    expect(createData.exerciseHint).toBe('back squat');
    // No 'complete' update yet — Gemini hasn't returned.
    expect(prismaFormAnalysis.update).not.toHaveBeenCalled();

    // Let Gemini resolve, then drain microtasks. The fire-and-forget promise
    // should now update the row to 'complete' with the real fields.
    resolveAnalysis(fakeAnalysis);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(prismaFormAnalysis.update).toHaveBeenCalledTimes(1);
    const updateData = prismaFormAnalysis.update.mock.calls[0][0].data;
    expect(updateData.status).toBe('complete');
    expect(updateData.exercise).toBe('Back squat');
    expect(updateData.formScore).toBe(7.5);
    expect(JSON.parse(updateData.analysisJson).summary).toMatch(/squat/i);

    // Gemini service was called with the right args.
    expect(mockAnalyzeWorkoutVideo).toHaveBeenCalledTimes(1);
    const [bufArg, mimeArg, hintArg] = mockAnalyzeWorkoutVideo.mock.calls[0];
    expect(bufArg).toBeInstanceOf(Buffer);
    expect(mimeArg).toBe('video/mp4');
    expect(hintArg).toBe('back squat');
  });

  it('returns 429 when free user has already used today\'s quota', async () => {
    // consumeDailyQuota does an atomic upsert+increment, then rejects when
    // the post-increment count exceeds the limit. So mock upsert to return
    // count=2 (above the limit of 1 for form_video).
    prismaFeatureUsage.upsert.mockResolvedValue({ count: 2 });

    const res = await request(app)
      .post('/api/form-analysis/video')
      .set('Authorization', `Bearer ${makeToken('u-1', 'free')}`)
      .attach('video', Buffer.from('x'), { filename: 'v.mp4', contentType: 'video/mp4' });

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/free tier/i);
    expect(res.body.upgradeUrl).toContain('client_reference_id=u-1');
    // Gemini was NOT called — quota gated before the API spend.
    expect(mockAnalyzeWorkoutVideo).not.toHaveBeenCalled();
  });

  it('refunds the daily credit + marks row failed when Gemini errors asynchronously', async () => {
    prismaFeatureUsage.upsert.mockResolvedValue({ count: 1 });
    mockAnalyzeWorkoutVideo.mockRejectedValue(new Error('Vertex AI timeout'));
    prismaFormAnalysis.create.mockResolvedValue({ id: 'fa-3', createdAt: new Date() });

    const res = await request(app)
      .post('/api/form-analysis/video')
      .set('Authorization', `Bearer ${makeToken('u-1', 'free')}`)
      .attach('video', Buffer.from('x'), { filename: 'v.mp4', contentType: 'video/mp4' });

    // Upload still returns 202 — the failure happens in the background.
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('pending');

    // Drain microtasks so the fire-and-forget catch path runs.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    // Refund happened: featureUsage.updateMany with decrement.
    expect(prismaFeatureUsage.updateMany).toHaveBeenCalledTimes(1);
    const refundCall = prismaFeatureUsage.updateMany.mock.calls[0][0];
    expect(refundCall.where.userId).toBe('u-1');
    expect(refundCall.where.feature).toBe('form_video');
    expect(refundCall.data.count).toEqual({ decrement: 1 });

    // Row got flipped to status='failed' with the error message.
    expect(prismaFormAnalysis.update).toHaveBeenCalled();
    const updateData = prismaFormAnalysis.update.mock.calls[0][0].data;
    expect(updateData.status).toBe('failed');
    expect(updateData.errorMessage).toMatch(/Vertex AI timeout/);
  });

  it('pro tier is unmetered (no quota upsert)', async () => {
    prismaUser.findUnique.mockResolvedValue({ ...USER, tier: 'pro' });
    mockAnalyzeWorkoutVideo.mockResolvedValue({
      exercise: 'Deadlift', formScore: 9, repCount: 1,
      strengths: [], weaknesses: [], recommendedDrills: [], programmingNotes: [],
      safetyFlags: [], summary: 'Solid pull.',
    });
    prismaFormAnalysis.create.mockResolvedValue({ id: 'fa-2', createdAt: new Date() });

    const res = await request(app)
      .post('/api/form-analysis/video')
      .set('Authorization', `Bearer ${makeToken('u-1', 'pro')}`)
      .attach('video', Buffer.from('x'), { filename: 'v.mp4', contentType: 'video/mp4' });

    // 202 same as free — async pattern is tier-agnostic on this route.
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('pending');
    // No quota upsert for pro tier.
    expect(prismaFeatureUsage.upsert).not.toHaveBeenCalled();
  });
});

describe('GET /api/form-analysis', () => {
  let app: express.Express;
  beforeAll(async () => { app = await buildApp(); });

  it('returns the caller\'s history (newest first)', async () => {
    prismaFormAnalysis.findMany.mockResolvedValue([
      { id: 'a', exercise: 'Bench', formScore: 7, repCount: 5, createdAt: new Date('2026-06-03') },
      { id: 'b', exercise: 'Squat', formScore: 8, repCount: 6, createdAt: new Date('2026-06-02') },
    ]);
    const res = await request(app)
      .get('/api/form-analysis')
      .set('Authorization', `Bearer ${makeToken('u-1')}`);
    expect(res.status).toBe(200);
    expect(res.body.analyses).toHaveLength(2);
    expect(prismaFormAnalysis.findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: 'desc' });
  });
});

describe('sweepStalePendingFormAnalyses', () => {
  it('marks pending rows older than 10 min as failed', async () => {
    prismaFormAnalysis.updateMany.mockResolvedValue({ count: 3 });
    const { sweepStalePendingFormAnalyses } = await import('../routes/formAnalysis.js');
    const r = await sweepStalePendingFormAnalyses();
    expect(r.marked).toBe(3);
    expect(prismaFormAnalysis.updateMany).toHaveBeenCalledTimes(1);
    const call = prismaFormAnalysis.updateMany.mock.calls[0][0];
    expect(call.where.status).toBe('pending');
    expect(call.where.updatedAt.lt).toBeInstanceOf(Date);
    // 10min cutoff (within a 2-second test tolerance).
    const minutesAgo = (Date.now() - call.where.updatedAt.lt.getTime()) / 60_000;
    expect(minutesAgo).toBeGreaterThan(9.99);
    expect(minutesAgo).toBeLessThan(10.05);
    expect(call.data.status).toBe('failed');
    expect(call.data.exercise).toBe('unknown');
  });
});

describe('GET /api/form-analysis/:id', () => {
  let app: express.Express;
  beforeAll(async () => { app = await buildApp(); });

  it('returns the full record with parsed JSON + status + errorMessage', async () => {
    prismaFormAnalysis.findFirst.mockResolvedValue({
      id: 'a', status: 'complete', errorMessage: null,
      exercise: 'Bench', formScore: 7, repCount: 5, exerciseHint: null,
      createdAt: new Date('2026-06-03'),
      analysisJson: JSON.stringify({ summary: 'Solid', strengths: ['braced'] }),
    });
    const res = await request(app)
      .get('/api/form-analysis/a')
      .set('Authorization', `Bearer ${makeToken('u-1')}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('complete');
    expect(res.body.analysis.summary).toBe('Solid');
    expect(res.body.analysis.strengths).toEqual(['braced']);
  });

  it('exposes pending status while analysis runs', async () => {
    prismaFormAnalysis.findFirst.mockResolvedValue({
      id: 'b', status: 'pending', errorMessage: null,
      exercise: 'pending', formScore: null, repCount: null, exerciseHint: 'squat',
      createdAt: new Date('2026-06-04'),
      analysisJson: '{}',
    });
    const res = await request(app)
      .get('/api/form-analysis/b')
      .set('Authorization', `Bearer ${makeToken('u-1')}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');
    expect(res.body.formScore).toBeNull();
  });

  it('returns 404 when no row for this user/id', async () => {
    prismaFormAnalysis.findFirst.mockResolvedValue(null);
    const res = await request(app)
      .get('/api/form-analysis/missing')
      .set('Authorization', `Bearer ${makeToken('u-1')}`);
    expect(res.status).toBe(404);
  });
});
