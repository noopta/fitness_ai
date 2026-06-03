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
const prismaFormAnalysis = { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() };
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
  prismaFeatureUsage.findUnique.mockReset();
  prismaFeatureUsage.upsert.mockReset();
  prismaFeatureUsage.update.mockReset();
  prismaFeatureUsage.updateMany.mockReset();
  prismaFeatureUsage.updateMany.mockResolvedValue({ count: 0 });
  mockAnalyzeWorkoutVideo.mockReset();

  // Default: a valid free user
  prismaUser.findUnique.mockResolvedValue(USER);
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

  it('analyzes a valid video and persists the result', async () => {
    // Free user, no prior usage today
    prismaFeatureUsage.findUnique.mockResolvedValue(null);
    prismaFeatureUsage.upsert.mockResolvedValue({ count: 1 });
    // Gemini returns a structured analysis
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
    mockAnalyzeWorkoutVideo.mockResolvedValue(fakeAnalysis);
    prismaFormAnalysis.create.mockResolvedValue({ id: 'fa-1', createdAt: new Date('2026-06-03T12:00:00Z') });

    const res = await request(app)
      .post('/api/form-analysis/video')
      .set('Authorization', `Bearer ${makeToken('u-1', 'free')}`)
      .field('exerciseHint', 'back squat')
      .attach('video', Buffer.from('mock video data'), { filename: 'lift.mp4', contentType: 'video/mp4' });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('fa-1');
    expect(res.body.analysis.exercise).toBe('Back squat');
    expect(res.body.analysis.formScore).toBe(7.5);
    expect(res.body.usage.feature).toBe('form_video');
    expect(res.body.usage.used).toBe(1);

    // Gemini service was called with the right args
    expect(mockAnalyzeWorkoutVideo).toHaveBeenCalledTimes(1);
    const [bufArg, mimeArg, hintArg] = mockAnalyzeWorkoutVideo.mock.calls[0];
    expect(bufArg).toBeInstanceOf(Buffer);
    expect(mimeArg).toBe('video/mp4');
    expect(hintArg).toBe('back squat');

    // Persisted
    const createCall = prismaFormAnalysis.create.mock.calls[0][0].data;
    expect(createCall.userId).toBe('u-1');
    expect(createCall.exercise).toBe('Back squat');
    expect(createCall.formScore).toBe(7.5);
    expect(JSON.parse(createCall.analysisJson).summary).toMatch(/squat/i);
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

  it('refunds the daily credit when Gemini fails', async () => {
    prismaFeatureUsage.upsert.mockResolvedValue({ count: 1 });
    mockAnalyzeWorkoutVideo.mockRejectedValue(new Error('Vertex AI timeout'));

    const res = await request(app)
      .post('/api/form-analysis/video')
      .set('Authorization', `Bearer ${makeToken('u-1', 'free')}`)
      .attach('video', Buffer.from('x'), { filename: 'v.mp4', contentType: 'video/mp4' });

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/could not analyze/i);
    // refundDailyQuota calls updateMany with a count>0 guard — confirm it ran.
    expect(prismaFeatureUsage.updateMany).toHaveBeenCalledTimes(1);
    const refundCall = prismaFeatureUsage.updateMany.mock.calls[0][0];
    expect(refundCall.where.userId).toBe('u-1');
    expect(refundCall.where.feature).toBe('form_video');
    expect(refundCall.data.count).toEqual({ decrement: 1 });
  });

  it('pro tier is unmetered (no upsert, no quota check)', async () => {
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

    expect(res.status).toBe(200);
    // No quota upsert for pro
    expect(prismaFeatureUsage.upsert).not.toHaveBeenCalled();
    expect(res.body.analysis.exercise).toBe('Deadlift');
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

describe('GET /api/form-analysis/:id', () => {
  let app: express.Express;
  beforeAll(async () => { app = await buildApp(); });

  it('returns the full record with parsed JSON', async () => {
    prismaFormAnalysis.findFirst.mockResolvedValue({
      id: 'a', exercise: 'Bench', formScore: 7, repCount: 5, exerciseHint: null,
      createdAt: new Date('2026-06-03'),
      analysisJson: JSON.stringify({ summary: 'Solid', strengths: ['braced'] }),
    });
    const res = await request(app)
      .get('/api/form-analysis/a')
      .set('Authorization', `Bearer ${makeToken('u-1')}`);
    expect(res.status).toBe(200);
    expect(res.body.analysis.summary).toBe('Solid');
    expect(res.body.analysis.strengths).toEqual(['braced']);
  });

  it('returns 404 when no row for this user/id', async () => {
    prismaFormAnalysis.findFirst.mockResolvedValue(null);
    const res = await request(app)
      .get('/api/form-analysis/missing')
      .set('Authorization', `Bearer ${makeToken('u-1')}`);
    expect(res.status).toBe(404);
  });
});
