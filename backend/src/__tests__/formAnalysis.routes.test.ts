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
const prismaFormAnalysis = { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), count: vi.fn() };
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
// The onboarding route drives the two passes itself off one upload, so it
// imports the split primitives rather than the all-in-one helper. All four
// must be mocked or the module fails to import.
const mockUploadFormVideo = vi.fn();
const mockAnalyzeFormVideoQuick = vi.fn();
const mockAnalyzeFormVideoFull = vi.fn();
vi.mock('../services/geminiService.js', () => ({
  analyzeWorkoutVideo: mockAnalyzeWorkoutVideo,
  uploadFormVideo: mockUploadFormVideo,
  analyzeFormVideoQuick: mockAnalyzeFormVideoQuick,
  analyzeFormVideoFull: mockAnalyzeFormVideoFull,
}));

// ─── Ingest-screening mock ────────────────────────────────────────────────────
// The real classifier calls Vertex; here we only care that the route honours
// its verdict — and, critically, that a quarantine does NOT delete the object.
const mockScreenFormVideo = vi.fn();
const mockRecordScreenVerdict = vi.fn();
vi.mock('../services/formVideoScreeningService.js', () => ({
  screenFormVideo: mockScreenFormVideo,
  recordScreenVerdict: mockRecordScreenVerdict,
}));

// ─── Reference-frame service mock ─────────────────────────────────────────────
// Real extraction shells out to ffmpeg and is covered in formFrameService.test;
// here we only care whether the route calls it, which is the consent decision.
const mockExtractReferenceFrames = vi.fn();
vi.mock('../services/formFrameService.js', () => ({
  extractReferenceFrames: mockExtractReferenceFrames,
}));

// ─── Notification service mock ────────────────────────────────────────────────
// The async path pushes a "your analysis is ready / failed" notification when
// the background job lands. Mock it (and resolve a promise — the route does
// `.catch()` on the result) so we can assert it fires.
const mockSendPushToUser = vi.fn();
vi.mock('../services/notificationService.js', () => ({
  sendPushToUser: mockSendPushToUser,
}));

// requireAuth uses prisma.user.findUnique; we make it always resolve a real-ish
// user by default so route logic past auth gets exercised.
function makeToken(userId: string, tier = 'free') {
  return jwt.sign({ id: userId, email: 'test@axiom.io', tier }, process.env.JWT_SECRET!, { expiresIn: '1h' });
}

// dateOfBirth is on the default user because two different call sites read
// it: requireAuth's lookup and the onboarding route's 18+ gate.
const USER = { id: 'u-1', name: 'Test', email: 't@axiom.io', tier: 'free', dateOfBirth: new Date('1990-01-01') };

const mockCleanup = vi.fn();
const MINOR_DOB = new Date(Date.now() - 15 * 365.25 * 24 * 3600 * 1000);
const QUICK = {
  exercise: 'Barbell Back Squat', formScore: 5, repCount: 4,
  timestampSec: 3.2, focusTarget: "the lifter's knees",
  headline: 'Knees collapse in out of the hole',
  cue: 'Screw your feet into the floor and push the knees out',
  summary: 'Solid depth and a stable brace. The knee track is what to fix first.',
};
const FULL = {
  exercise: 'Barbell Back Squat', formScore: 5.5, repCount: 4,
  strengths: ['Consistent depth'], weaknesses: [], recommendedDrills: [],
  programmingNotes: [], safetyFlags: [], summary: 'Full report.',
};

/** The route fires the passes without awaiting; let the microtasks drain. */
const settle = () => new Promise((r) => setTimeout(r, 20));

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
  prismaFormAnalysis.deleteMany.mockReset();
  prismaFormAnalysis.deleteMany.mockResolvedValue({ count: 1 });
  mockExtractReferenceFrames.mockReset();
  mockExtractReferenceFrames.mockResolvedValue([]);
  mockSendPushToUser.mockReset();
  mockSendPushToUser.mockResolvedValue(undefined);
  prismaFeatureUsage.findUnique.mockReset();
  prismaFeatureUsage.upsert.mockReset();
  prismaFeatureUsage.update.mockReset();
  prismaFeatureUsage.updateMany.mockReset();
  prismaFeatureUsage.updateMany.mockResolvedValue({ count: 0 });
  mockAnalyzeWorkoutVideo.mockReset();
  prismaFormAnalysis.count = prismaFormAnalysis.count ?? vi.fn();
  prismaFormAnalysis.count.mockReset();
  prismaFormAnalysis.count.mockResolvedValue(0);
  mockCleanup.mockReset();
  mockUploadFormVideo.mockReset();
  mockUploadFormVideo.mockResolvedValue({ fileUri: 'gs://bucket/obj.mp4', cleanup: mockCleanup });
  mockAnalyzeFormVideoQuick.mockReset();
  mockAnalyzeFormVideoQuick.mockResolvedValue(QUICK);
  mockAnalyzeFormVideoFull.mockReset();
  mockAnalyzeFormVideoFull.mockResolvedValue(FULL);
  mockScreenFormVideo.mockReset();
  mockScreenFormVideo.mockResolvedValue({ action: 'allow', concern: 'none' });
  mockRecordScreenVerdict.mockReset();
  mockRecordScreenVerdict.mockResolvedValue(undefined);

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
      .set('X-Form-Analysis-Async', '1')
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

    // Completion pushed a notification deep-linking to this analysis, so the
    // user gets pulled back in if they left the app.
    expect(mockSendPushToUser).toHaveBeenCalledTimes(1);
    const [pushUserId, pushTitle, , pushData] = mockSendPushToUser.mock.calls[0];
    expect(pushUserId).toBe('u-1');
    expect(pushTitle).toMatch(/ready/i);
    expect(pushData).toEqual({ screen: 'form-analysis', id: 'fa-1' });
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
      .set('X-Form-Analysis-Async', '1')
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

    // Failure also notifies the user (so they're not stuck on a spinner they
    // navigated away from), deep-linking back to retry.
    expect(mockSendPushToUser).toHaveBeenCalledTimes(1);
    const [pushUserId, pushTitle, , pushData] = mockSendPushToUser.mock.calls[0];
    expect(pushUserId).toBe('u-1');
    expect(pushTitle).toMatch(/didn't finish/i);
    expect(pushData).toEqual({ screen: 'form-analysis', id: 'fa-3' });
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
      .set('X-Form-Analysis-Async', '1')
      .attach('video', Buffer.from('x'), { filename: 'v.mp4', contentType: 'video/mp4' });

    // 202 same as free — async pattern is tier-agnostic on this route.
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('pending');
    // No quota upsert for pro tier.
    expect(prismaFeatureUsage.upsert).not.toHaveBeenCalled();
  });

  it('SYNC mode (no async header): returns 200 with the analysis inline + persists complete', async () => {
    // Installed clients don't send X-Form-Analysis-Async — they get the legacy
    // synchronous contract: the analysis runs inline and comes back in the 200.
    prismaFeatureUsage.upsert.mockResolvedValue({ count: 1 });
    const analysis = {
      exercise: 'Bench press', formScore: 8, repCount: 5,
      strengths: ['Tight arch'], weaknesses: [], recommendedDrills: [],
      programmingNotes: [], safetyFlags: [], summary: 'Clean press.',
    };
    mockAnalyzeWorkoutVideo.mockResolvedValue(analysis);
    prismaFormAnalysis.create.mockResolvedValue({ id: 'fa-sync', createdAt: new Date('2026-06-04T12:00:00Z') });

    const res = await request(app)
      .post('/api/form-analysis/video')
      .set('Authorization', `Bearer ${makeToken('u-1', 'free')}`)
      .attach('video', Buffer.from('x'), { filename: 'v.mp4', contentType: 'video/mp4' });

    // Legacy 200 shape: { id, createdAt, analysis, usage } — NOT 202.
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('fa-sync');
    expect(res.body.analysis.exercise).toBe('Bench press');
    expect(res.body.usage.feature).toBe('form_video');
    // Row was created pending then updated to complete before responding.
    expect(prismaFormAnalysis.update).toHaveBeenCalledTimes(1);
    expect(prismaFormAnalysis.update.mock.calls[0][0].data.status).toBe('complete');
    // No push in sync mode — the client is already waiting on the response.
    expect(mockSendPushToUser).not.toHaveBeenCalled();
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

// ─── Reference stills: consent + age gating ──────────────────────────────────
//
// These stills are retained imagery of the user's body in a pipeline that
// otherwise retains nothing, so the interesting assertions are all about when
// we DON'T produce them.

describe('reference stills', () => {
  let app: express.Express;
  beforeAll(async () => { app = await buildApp(); });

  const ANALYSIS = {
    exercise: 'Back squat',
    formScore: 6,
    repCount: 3,
    strengths: ['Good depth'],
    weaknesses: [{ issue: 'Lumbar rounds at the bottom', severity: 'major', cue: 'Brace harder', timestampSec: 2.5, box2d: [400, 300, 700, 650] }],
    recommendedDrills: [],
    programmingNotes: [],
    safetyFlags: [],
    summary: 'One thing to fix.',
  };

  const adult = { ...USER, dateOfBirth: new Date('1995-01-01') };
  const minor = { ...USER, dateOfBirth: new Date(Date.now() - 15 * 365.25 * 864e5) };

  /** Upload and wait for the fire-and-forget analysis to write its terminal row. */
  async function upload(fields: Record<string, string>, user: any) {
    prismaFeatureUsage.upsert.mockResolvedValue({ count: 1 });
    prismaUser.findUnique.mockResolvedValue(user);
    prismaFormAnalysis.create.mockResolvedValue({ id: 'fa-x', createdAt: new Date() });
    mockAnalyzeWorkoutVideo.mockResolvedValue(ANALYSIS);

    const settled = new Promise<any>((resolve) => {
      prismaFormAnalysis.update.mockImplementation(async (args: any) => {
        if (args?.data?.status === 'complete') resolve(args);
        return {};
      });
    });

    let req = request(app)
      .post('/api/form-analysis/video')
      .set('Authorization', `Bearer ${makeToken('u-1')}`)
      .set('X-Form-Analysis-Async', '1');
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    const res = await req.attach('video', Buffer.from('mock video'), { filename: 'lift.mp4', contentType: 'video/mp4' });
    expect(res.status).toBe(202);
    return JSON.parse((await settled).data.analysisJson);
  }

  it('extracts stills when an adult opts in', async () => {
    mockExtractReferenceFrames.mockResolvedValue([
      { weaknessIndex: 0, timestampSec: 2.5, b64: 'AAAA', box2d: [400, 300, 700, 650] },
    ]);
    const stored = await upload({ saveFrames: '1' }, adult);
    expect(mockExtractReferenceFrames).toHaveBeenCalledOnce();
    expect(stored.framesConsent).toBe(true);
    expect(stored.referenceFrames).toHaveLength(1);
    expect(stored.referenceFrames[0].b64).toBe('AAAA');
  });

  it('does not extract when the client omits the flag', async () => {
    // The installed build never sends saveFrames, so it must keep behaving
    // exactly as it does today: analysis, no imagery.
    const stored = await upload({}, adult);
    expect(mockExtractReferenceFrames).not.toHaveBeenCalled();
    expect(stored.framesConsent).toBe(false);
    expect(stored.referenceFrames).toEqual([]);
  });

  it('does not extract when the user explicitly opts out', async () => {
    const stored = await upload({ saveFrames: '0' }, adult);
    expect(mockExtractReferenceFrames).not.toHaveBeenCalled();
    expect(stored.framesConsent).toBe(false);
  });

  it('refuses stills for an under-18 account even when opted in', async () => {
    const stored = await upload({ saveFrames: '1' }, minor);
    expect(mockExtractReferenceFrames).not.toHaveBeenCalled();
    expect(stored.framesConsent).toBe(false);
  });

  it('refuses stills when the date of birth is unknown', async () => {
    const stored = await upload({ saveFrames: '1' }, { ...USER, dateOfBirth: null });
    expect(mockExtractReferenceFrames).not.toHaveBeenCalled();
    expect(stored.framesConsent).toBe(false);
  });

  it('still completes the analysis when extraction fails', async () => {
    // extractReferenceFrames is contracted not to throw, but a defect there
    // must not cost the user the analysis they are waiting on.
    mockExtractReferenceFrames.mockResolvedValue([]);
    const stored = await upload({ saveFrames: '1' }, adult);
    expect(stored.summary).toBe('One thing to fix.');
    expect(stored.referenceFrames).toEqual([]);
  });
});

describe('DELETE /api/form-analysis/:id', () => {
  let app: express.Express;
  beforeAll(async () => { app = await buildApp(); });

  it('returns 401 when no auth', async () => {
    const res = await request(app).delete('/api/form-analysis/fa-1');
    expect(res.status).toBe(401);
  });

  it('deletes the row, scoped to the caller', async () => {
    const res = await request(app)
      .delete('/api/form-analysis/fa-1')
      .set('Authorization', `Bearer ${makeToken('u-1')}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // The ownership predicate has to be part of the write, not a prior read.
    expect(prismaFormAnalysis.deleteMany).toHaveBeenCalledWith({
      where: { id: 'fa-1', userId: 'u-1' },
    });
  });

  it('returns 404 when the row belongs to someone else', async () => {
    prismaFormAnalysis.deleteMany.mockResolvedValue({ count: 0 });
    const res = await request(app)
      .delete('/api/form-analysis/fa-other')
      .set('Authorization', `Bearer ${makeToken('u-1')}`);
    expect(res.status).toBe(404);
  });

  it('returns 500 when the delete fails', async () => {
    prismaFormAnalysis.deleteMany.mockRejectedValue(new Error('db down'));
    const res = await request(app)
      .delete('/api/form-analysis/fa-1')
      .set('Authorization', `Bearer ${makeToken('u-1')}`);
    expect(res.status).toBe(500);
  });
});


describe('POST /api/form-analysis/onboarding', () => {
  let app: express.Express;
  beforeAll(async () => { app = await buildApp(); });

  const post = (token?: string) => {
    const r = request(app).post('/api/form-analysis/onboarding');
    if (token) r.set('Authorization', `Bearer ${token}`);
    return r.attach('video', Buffer.from('mock video'), { filename: 'lift.mp4', contentType: 'video/mp4' });
  };

  it('returns 401 when no auth', async () => {
    expect((await post()).status).toBe(401);
  });

  it('returns 202 with the row id and never consumes the daily quota', async () => {
    prismaFormAnalysis.create.mockResolvedValue({ id: 'fa-1', createdAt: new Date() });
    const res = await post(makeToken('u-1'));
    expect(res.status).toBe(202);
    expect(res.body.id).toBe('fa-1');
    expect(res.body.status).toBe('pending');
    // The whole point of the route: the first clip is free AND retryable.
    expect(prismaFeatureUsage.upsert).not.toHaveBeenCalled();
    expect(prismaFeatureUsage.update).not.toHaveBeenCalled();
  });

  it('409s once the user already has an analysis, pointing at the metered route', async () => {
    prismaFormAnalysis.count.mockResolvedValue(1);
    const res = await post(makeToken('u-1'));
    expect(res.status).toBe(409);
    expect(res.body.useInstead).toBe('/api/form-analysis/video');
    expect(prismaFormAnalysis.create).not.toHaveBeenCalled();
  });

  it('writes the quick result first, then upgrades the same row to the full report', async () => {
    prismaFormAnalysis.create.mockResolvedValue({ id: 'fa-1', createdAt: new Date() });
    await post(makeToken('u-1'));
    await settle();

    // One upload, two analyses.
    expect(mockUploadFormVideo).toHaveBeenCalledTimes(1);
    expect(mockAnalyzeFormVideoQuick).toHaveBeenCalledTimes(1);
    expect(mockAnalyzeFormVideoFull).toHaveBeenCalledTimes(1);
    expect(mockAnalyzeFormVideoFull.mock.calls[0][0]).toBe('gs://bucket/obj.mp4');

    const [quickWrite, fullWrite] = prismaFormAnalysis.update.mock.calls;
    expect(quickWrite[0].data.status).toBe('complete');
    expect(JSON.parse(quickWrite[0].data.analysisJson).mode).toBe('quick');
    expect(JSON.parse(quickWrite[0].data.analysisJson).headline).toBe(QUICK.headline);

    const fullJson = JSON.parse(fullWrite[0].data.analysisJson);
    expect(fullJson.mode).toBe('full');
    // The line the user actually read survives into the full report.
    expect(fullJson.onboardingHeadline).toBe(QUICK.headline);
    expect(mockCleanup).toHaveBeenCalled();
  });

  it('keeps the delivered quick result when the background full pass fails', async () => {
    prismaFormAnalysis.create.mockResolvedValue({ id: 'fa-1', createdAt: new Date() });
    mockAnalyzeFormVideoFull.mockRejectedValue(new Error('vertex exploded'));
    await post(makeToken('u-1'));
    await settle();

    // Exactly one write — the quick one — and the row is NOT downgraded.
    expect(prismaFormAnalysis.update).toHaveBeenCalledTimes(1);
    expect(prismaFormAnalysis.update.mock.calls[0][0].data.status).toBe('complete');
    expect(mockCleanup).toHaveBeenCalled();
  });

  it('marks the row failed when the quick pass itself fails', async () => {
    prismaFormAnalysis.create.mockResolvedValue({ id: 'fa-1', createdAt: new Date() });
    mockAnalyzeFormVideoQuick.mockRejectedValue(new Error('unreadable clip'));
    await post(makeToken('u-1'));
    await settle();

    const write = prismaFormAnalysis.update.mock.calls[0][0];
    expect(write.data.status).toBe('failed');
    expect(write.data.errorMessage).toContain('unreadable clip');
    expect(mockAnalyzeFormVideoFull).not.toHaveBeenCalled();
    expect(mockCleanup).toHaveBeenCalled();
  });

  it('never sends a push — the user is looking at the screen', async () => {
    prismaFormAnalysis.create.mockResolvedValue({ id: 'fa-1', createdAt: new Date() });
    await post(makeToken('u-1'));
    await settle();
    expect(mockSendPushToUser).not.toHaveBeenCalled();
  });
});


describe('onboarding hook — legal protections', () => {
  let app: express.Express;
  beforeAll(async () => { app = await buildApp(); });

  const post = () => request(app)
    .post('/api/form-analysis/onboarding')
    .set('Authorization', `Bearer ${makeToken('u-1')}`)
    .attach('video', Buffer.from('mock video'), { filename: 'lift.mp4', contentType: 'video/mp4' });

  const settle = () => new Promise((r) => setTimeout(r, 20));

  describe('age gate (18+)', () => {
    it('403s an under-18 user and never touches the video', async () => {
      prismaUser.findUnique.mockResolvedValue({ ...USER, dateOfBirth: MINOR_DOB });
      const res = await post();
      expect(res.status).toBe(403);
      expect(res.body.reason).toBe('age_restricted');
      expect(prismaFormAnalysis.create).not.toHaveBeenCalled();
      expect(mockUploadFormVideo).not.toHaveBeenCalled();
    });

    it('fails closed when no date of birth is on file', async () => {
      prismaUser.findUnique.mockResolvedValue({ ...USER, dateOfBirth: null });
      const res = await post();
      expect(res.status).toBe(403);
      expect(mockUploadFormVideo).not.toHaveBeenCalled();
    });

    it('allows an adult through', async () => {
      prismaFormAnalysis.create.mockResolvedValue({ id: 'fa-1', createdAt: new Date() });
      expect((await post()).status).toBe(202);
    });
  });

  describe('ingest screening', () => {
    beforeEach(() => prismaFormAnalysis.create.mockResolvedValue({ id: 'fa-1', createdAt: new Date() }));

    it('screens concurrently with the analysis, not in front of it', async () => {
      await post(); await settle();
      // Both were issued against the same single upload.
      expect(mockUploadFormVideo).toHaveBeenCalledTimes(1);
      expect(mockScreenFormVideo).toHaveBeenCalledWith('gs://bucket/obj.mp4', 'video/mp4');
      expect(mockAnalyzeFormVideoQuick).toHaveBeenCalledTimes(1);
    });

    it('on reject: fails the row, discards the analysis, and DELETES the object', async () => {
      mockScreenFormVideo.mockResolvedValue({
        action: 'reject', concern: 'not_exercise', userMessage: 'not a lift',
      });
      await post(); await settle();

      const write = prismaFormAnalysis.update.mock.calls[0][0];
      expect(write.data.status).toBe('failed');
      expect(write.data.errorMessage).toBe('not a lift');
      // The coaching text derived from a refused clip is never persisted...
      expect(prismaFormAnalysis.update).toHaveBeenCalledTimes(1);
      // ...and the full pass never runs.
      expect(mockAnalyzeFormVideoFull).not.toHaveBeenCalled();
      // No preservation obligation attaches to a plain reject.
      expect(mockCleanup).toHaveBeenCalled();
    });

    it('on quarantine: PRESERVES the object rather than deleting it', async () => {
      mockScreenFormVideo.mockResolvedValue({
        action: 'quarantine', concern: 'minor_and_sexual', userMessage: 'could not process',
      });
      await post(); await settle();

      // The whole point: auto-delete is suppressed so the material still
      // exists when a human reviews and reports it.
      expect(mockCleanup).not.toHaveBeenCalled();
      expect(mockRecordScreenVerdict).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u-1',
          surface: 'form_video_onboarding',
          preservedObject: 'gs://bucket/obj.mp4',
        }),
      );
      expect(prismaFormAnalysis.update.mock.calls[0][0].data.status).toBe('failed');
      expect(mockAnalyzeFormVideoFull).not.toHaveBeenCalled();
    });

    it('records a flag for reject too, but with no preserved object', async () => {
      mockScreenFormVideo.mockResolvedValue({ action: 'reject', concern: 'sexual_content' });
      await post(); await settle();
      expect(mockRecordScreenVerdict).toHaveBeenCalledWith(
        expect.objectContaining({ preservedObject: null }),
      );
    });

    it('a clean verdict proceeds to the normal two-pass flow', async () => {
      await post(); await settle();
      expect(mockRecordScreenVerdict).not.toHaveBeenCalled();
      expect(mockAnalyzeFormVideoFull).toHaveBeenCalledTimes(1);
      expect(mockCleanup).toHaveBeenCalled();
    });
  });
});


describe('onboarding hook — reference stills', () => {
  let app: express.Express;
  beforeAll(async () => { app = await buildApp(); });

  const post = (saveFrames: string) => request(app)
    .post('/api/form-analysis/onboarding')
    .set('Authorization', `Bearer ${makeToken('u-1')}`)
    .field('saveFrames', saveFrames)
    .attach('video', Buffer.from('mock video'), { filename: 'lift.mp4', contentType: 'video/mp4' });

  const settle = () => new Promise((r) => setTimeout(r, 20));

  beforeEach(() => {
    prismaFormAnalysis.create.mockResolvedValue({ id: 'fa-1', createdAt: new Date() });
    mockExtractReferenceFrames.mockResolvedValue([
      { weaknessIndex: 0, timestampSec: 3.2, b64: 'ZmFrZQ==', box2d: [100, 200, 400, 500] },
    ]);
  });

  it('extracts a still from the QUICK pass, so it lands on the aha screen', async () => {
    await post('1'); await settle();

    // Anchored off the quick pass's own headline — not the full report's
    // weaknesses, which arrive ~20s too late to be the feature.
    const [buf, mime, weaknesses] = mockExtractReferenceFrames.mock.calls[0];
    expect(weaknesses).toEqual([expect.objectContaining({
      issue: QUICK.headline,
      cue: QUICK.cue,
      timestampSec: 3.2,
      focusTarget: "the lifter's knees",
    })]);

    const quickJson = JSON.parse(prismaFormAnalysis.update.mock.calls[0][0].data.analysisJson);
    expect(quickJson.mode).toBe('quick');
    expect(quickJson.framesConsent).toBe(true);
    expect(quickJson.referenceFrames).toHaveLength(1);
  });

  it('stores no stills when the user did not opt in', async () => {
    await post('0'); await settle();
    expect(mockExtractReferenceFrames).not.toHaveBeenCalled();
    const quickJson = JSON.parse(prismaFormAnalysis.update.mock.calls[0][0].data.analysisJson);
    expect(quickJson.framesConsent).toBe(false);
    expect(quickJson.referenceFrames).toEqual([]);
  });

  it('treats a missing saveFrames field as no consent', async () => {
    await request(app)
      .post('/api/form-analysis/onboarding')
      .set('Authorization', `Bearer ${makeToken('u-1')}`)
      .attach('video', Buffer.from('v'), { filename: 'l.mp4', contentType: 'video/mp4' });
    await settle();
    expect(mockExtractReferenceFrames).not.toHaveBeenCalled();
  });

  it('a failed still extraction never costs the analysis', async () => {
    mockExtractReferenceFrames.mockResolvedValue([]);
    await post('1'); await settle();
    const quickJson = JSON.parse(prismaFormAnalysis.update.mock.calls[0][0].data.analysisJson);
    expect(quickJson.headline).toBe(QUICK.headline);
    expect(quickJson.referenceFrames).toEqual([]);
    expect(prismaFormAnalysis.update.mock.calls[0][0].data.status).toBe('complete');
  });

  it('screened-out clips never reach frame extraction', async () => {
    mockScreenFormVideo.mockResolvedValue({ action: 'reject', concern: 'not_exercise' });
    await post('1'); await settle();
    expect(mockExtractReferenceFrames).not.toHaveBeenCalled();
  });
});
