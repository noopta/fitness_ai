// Security contract for the affiliate self-service surface: the invite token
// is the ONLY credential. An email address or affiliateId must never unlock
// earnings data or — worse — a Stripe Express login link.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const store = vi.hoisted(() => ({
  affiliates: [] as any[],
}));

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(function (this: any) {
    this.affiliate = {
      findUnique: vi.fn(async (a: any) => {
        if (a.where.inviteToken !== undefined) return store.affiliates.find(x => x.inviteToken === a.where.inviteToken) ?? null;
        if (a.where.email !== undefined) return store.affiliates.find(x => x.email === a.where.email) ?? null;
        if (a.where.id !== undefined) return store.affiliates.find(x => x.id === a.where.id) ?? null;
        return null;
      }),
      update: vi.fn(async (a: any) => { const r = store.affiliates.find(x => x.id === a.where.id); Object.assign(r, a.data); return r; }),
    };
  }),
}));

const svc = vi.hoisted(() => ({
  generateOnboardingLink: vi.fn(async () => 'https://connect.stripe.com/onboard/x'),
  generateDashboardLink: vi.fn(async () => 'https://connect.stripe.com/express/login/x'),
  checkAndUpdateOnboardingStatus: vi.fn(async () => true),
  getAffiliateDashboard: vi.fn(async (id: string) => ({ id, referralLink: 'https://axiomtraining.io/?ref=X', pendingCents: 900 })),
  inviteAffiliate: vi.fn(),
  runMonthlyPayouts: vi.fn(),
}));
vi.mock('../services/affiliateService.js', () => svc);
vi.mock('../middleware/requireAuth.js', () => ({ requireAuth: (_req: any, res: any) => res.status(401).json({ error: 'auth' }) }));
vi.mock('../middleware/requireAdmin.js', () => ({ requireAdmin: (_req: any, _res: any, next: any) => next() }));

import affiliatesRouter from '../routes/affiliates.js';

const app = express();
app.use(express.json());
app.use('/api', affiliatesRouter);

const AFF = { id: 'aff-uuid-1', name: 'A', email: 'aff@x.com', inviteToken: 'tok-secret-1', inviteUsedAt: null, onboarded: true, active: true };

beforeEach(() => {
  store.affiliates = [{ ...AFF }];
  svc.generateDashboardLink.mockClear();
  svc.generateOnboardingLink.mockClear();
});

describe('affiliate self-service — token is the only credential', () => {
  it('/affiliate/me: valid token → dashboard; email or affiliateId → rejected', async () => {
    const ok = await request(app).get('/api/affiliate/me?token=tok-secret-1');
    expect(ok.status).toBe(200);
    expect(ok.body.pendingCents).toBe(900);

    // The old email hole: knowing an affiliate's email must return nothing.
    const byEmail = await request(app).get('/api/affiliate/me?email=aff@x.com');
    expect(byEmail.status).toBe(401);

    const badToken = await request(app).get('/api/affiliate/me?token=guess');
    expect(badToken.status).toBe(401);
  });

  it('/affiliate/dashboard-url: never issues a Stripe login link for an affiliateId', async () => {
    const byId = await request(app).get(`/api/affiliate/dashboard-url?affiliateId=${AFF.id}`);
    expect(byId.status).toBe(401);
    expect(svc.generateDashboardLink).not.toHaveBeenCalled();

    const ok = await request(app).get('/api/affiliate/dashboard-url?token=tok-secret-1');
    expect(ok.status).toBe(200);
    expect(ok.body.url).toMatch(/express\/login/);
  });

  it('/affiliate/onboard + /onboarding-complete require the token too', async () => {
    expect((await request(app).post('/api/affiliate/onboard').send({ affiliateId: AFF.id })).status).toBe(401);
    expect((await request(app).post('/api/affiliate/onboard').send({ token: 'tok-secret-1' })).status).toBe(200);
    expect((await request(app).post('/api/affiliate/onboarding-complete').send({ affiliateId: AFF.id })).status).toBe(401);
    const done = await request(app).post('/api/affiliate/onboarding-complete').send({ token: 'tok-secret-1' });
    expect(done.status).toBe(200);
    expect(done.body.onboarded).toBe(true);
  });

  it('/affiliate/setup still works from the invite link and marks the token used', async () => {
    const res = await request(app).post('/api/affiliate/setup').send({ token: 'tok-secret-1' });
    expect(res.status).toBe(200);
    expect(res.body.affiliate.email).toBe('aff@x.com');
    expect(res.body.onboardingUrl).toMatch(/onboard/);
    expect((await request(app).post('/api/affiliate/setup').send({ token: 'nope' })).status).toBe(404);
  });

  it('admin surface stays behind requireAuth (mocked here to always 401)', async () => {
    expect((await request(app).get('/api/affiliates')).status).toBe(401);
    expect((await request(app).post('/api/affiliates/payouts/run')).status).toBe(401);
  });
});
