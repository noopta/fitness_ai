// "Agree and build" is the Terms clickwrap; the build records it server-side so
// it counts on every app version (20 Oct 2026: new sign-ups had no acceptance
// on file — a fresh install's first launch runs the store bundle, which
// predates the consent sheet). Health-data consent is never inferred.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const user = { findUnique: vi.fn(), update: vi.fn(async () => ({})) };
vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) { this.user = user; }) }));
vi.mock('../middleware/requireAuth.js', () => ({ requireAuth: (req: any, _res: any, next: any) => { req.user = { id: 'u1', tier: 'pro' }; next(); } }));
vi.mock('../middleware/rateLimiter.js', () => ({ aiLimiter: (_req: any, _res: any, next: any) => next() }));
vi.mock('../services/cacheService.js', () => ({ cacheClearByPrefix: vi.fn(), cacheDelete: vi.fn() }));
vi.mock('../routes/coach.js', () => ({ generateProgramForUser: vi.fn(async () => ({ phases: [], sources: [] })) }));
vi.mock('../services/ragService.js', () => ({ retrieveProgramSources: vi.fn(async () => []) }));

const { default: router } = await import('../routes/onboardingV2.js');
const { CURRENT_TERMS_VERSION } = await import('../services/termsVersion.js');
const app = express();
app.use(express.json());
app.use('/api', router);

beforeEach(() => { user.update.mockClear(); user.findUnique.mockReset(); });

describe('POST /coach/onboarding/build records the Terms clickwrap', () => {
  it('stamps acceptance + version when none is on file, and never health consent', async () => {
    user.findUnique.mockResolvedValue({ acceptedTermsAt: null });
    const r = await request(app).post('/api/coach/onboarding/build').send({ goal: 'lose belly fat', answers: { days: '3' } });
    expect(r.status).toBe(200);
    const stamp = user.update.mock.calls.map((c: any) => c[0].data).find((d: any) => d.acceptedTermsAt);
    expect(stamp).toMatchObject({ termsVersion: CURRENT_TERMS_VERSION });
    expect(user.update.mock.calls.some((c: any) => 'healthConsentAt' in c[0].data)).toBe(false);
  });
  it('leaves an existing acceptance alone', async () => {
    user.findUnique.mockResolvedValue({ acceptedTermsAt: new Date('2026-10-01') });
    await request(app).post('/api/coach/onboarding/build').send({ goal: 'lose belly fat', answers: {} });
    expect(user.update.mock.calls.some((c: any) => c[0].data.acceptedTermsAt)).toBe(false);
  });
});
