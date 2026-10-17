// Affiliate extras: personal terms, trainer referrals (+ coach sign-ups
// attributed from the ?ref= link), payouts made outside Stripe, admin CRUD,
// and the markdown payment-structure resource.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const store = vi.hoisted(() => ({
  affiliates: [] as any[],
  referrals: [] as any[],
  payouts: [] as any[],
  signups: [] as any[],
  seq: 0,
}));

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(function (this: any) {
    this.affiliate = {
      findUnique: vi.fn(async (a: any) => {
        if (a.where.inviteToken !== undefined) return store.affiliates.find(x => x.inviteToken === a.where.inviteToken) ?? null;
        if (a.where.id !== undefined) return store.affiliates.find(x => x.id === a.where.id) ?? null;
        return null;
      }),
      update: vi.fn(),
    };
  }),
}));

// In-memory stand-in for the raw-SQL repo.
vi.mock('../services/affiliateExtrasRepo.js', () => {
  class UniqueConstraintError extends Error { code = 'P2002'; }
  const pick = (o: any, cols: readonly string[]) => Object.fromEntries(cols.filter(c => o[c] !== undefined).map(c => [c, o[c]]));
  const TR = ['trainerName', 'organization', 'contact', 'plan', 'status', 'coachBetaSignupId', 'startedAt', 'note'];
  const MP = ['kind', 'description', 'amountCents', 'currency', 'status', 'paidAt', 'reference', 'note'];
  const TERMS = ['commissionRate', 'trainerCommissionRate', 'campaignRate', 'perVideoFeeCents', 'agreementNote', 'agreementUpdatedAt'];
  return {
    UniqueConstraintError,
    getTermsRow: async (id: string) => { const a = store.affiliates.find(x => x.id === id); return a ? pick(a, TERMS) : null; },
    updateTermsRow: async (id: string, patch: any) => { const a = store.affiliates.find(x => x.id === id); if (!a) return 0; Object.assign(a, pick(patch, TERMS)); return 1; },
    listTrainerReferralRows: async (aid: string) => store.referrals.filter(r => r.affiliateId === aid).sort((a, b) => +b.createdAt - +a.createdAt),
    insertTrainerReferralRow: async (aid: string, data: any) => {
      if (data.coachBetaSignupId && store.referrals.some(r => r.coachBetaSignupId === data.coachBetaSignupId)) throw new UniqueConstraintError('UNIQUE');
      const row = { id: `tr-${++store.seq}`, affiliateId: aid, organization: null, contact: null, plan: null, coachBetaSignupId: null, startedAt: null, note: null, ...pick(data, TR), createdAt: new Date(Date.now() + store.seq), updatedAt: new Date() };
      store.referrals.push(row); return row;
    },
    updateTrainerReferralRow: async (aid: string, id: string, patch: any) => {
      const r = store.referrals.find(x => x.id === id && x.affiliateId === aid); if (!r) return null;
      Object.assign(r, pick(patch, TR), { updatedAt: new Date() }); return r;
    },
    deleteTrainerReferralRow: async (aid: string, id: string) => {
      const before = store.referrals.length; store.referrals = store.referrals.filter(x => !(x.id === id && x.affiliateId === aid)); return before - store.referrals.length;
    },
    listManualPayoutRows: async (aid: string) => store.payouts.filter(p => p.affiliateId === aid),
    getManualPayoutRow: async (aid: string, id: string) => store.payouts.find(x => x.id === id && x.affiliateId === aid) ?? null,
    findManualPayoutByReference: async () => null,
    insertManualPayoutRow: async (aid: string, data: any) => {
      const row = { id: `mp-${++store.seq}`, affiliateId: aid, paidAt: null, reference: null, note: null, ...pick(data, MP), createdAt: new Date(Date.now() + store.seq), updatedAt: new Date() };
      store.payouts.push(row); return row;
    },
    updateManualPayoutRow: async (aid: string, id: string, patch: any) => {
      const r = store.payouts.find(x => x.id === id && x.affiliateId === aid); if (!r) return null;
      Object.assign(r, pick(patch, MP), { updatedAt: new Date() }); return r;
    },
    deleteManualPayoutRow: async (aid: string, id: string) => {
      const before = store.payouts.length; store.payouts = store.payouts.filter(x => !(x.id === id && x.affiliateId === aid)); return before - store.payouts.length;
    },
    coachSignupsWithSource: async () => store.signups,
  };
});

vi.mock('../services/affiliateService.js', () => ({
  generateOnboardingLink: vi.fn(), generateDashboardLink: vi.fn(), checkAndUpdateOnboardingStatus: vi.fn(),
  getAffiliateDashboard: vi.fn(), inviteAffiliate: vi.fn(), runMonthlyPayouts: vi.fn(),
}));
// Admin routes: authenticated only with the test header.
vi.mock('../middleware/requireAuth.js', () => ({
  requireAuth: (req: any, res: any, next: any) => (req.get('x-test-admin') === '1' ? next() : res.status(401).json({ error: 'auth' })),
}));
vi.mock('../middleware/requireAdmin.js', () => ({ requireAdmin: (_req: any, _res: any, next: any) => next() }));

process.env.API_PUBLIC_URL = 'https://api.example.test/api';

import affiliatesRouter from '../routes/affiliates.js';
import { resetAffiliateResourcesCache, listResources } from '../services/affiliateResources.js';
import { sourceMatchesCode, maskName, maskEmail, totalsOf } from '../services/affiliateExtras.js';
import { AFFILIATE_PAYMENT_STRUCTURE, renderPaymentStructureMarkdown } from '../services/affiliatePaymentStructure.js';

const app = express();
app.use(express.json());
app.use('/api', affiliatesRouter);

const A1 = {
  id: 'aff-1', name: 'Saeed', email: 's@x.com', referralCode: 'SAEED10', inviteToken: 'tok-1', active: true, onboarded: true,
  commissionRate: 0.4, trainerCommissionRate: 0.2, campaignRate: 0.3, perVideoFeeCents: 4000, agreementNote: 'Growth rungs: see PDF', agreementUpdatedAt: new Date('2026-10-01T00:00:00Z'),
};
const A2 = { id: 'aff-2', name: 'Other', email: 'o@x.com', referralCode: 'OTHER', inviteToken: 'tok-2', active: false, onboarded: false, commissionRate: 0.4, campaignRate: 0.3 };

const admin = (r: request.Test) => r.set('x-test-admin', '1');

beforeEach(() => {
  store.affiliates = [{ ...A1 }, { ...A2 }];
  store.referrals = [];
  store.payouts = [];
  store.seq = 0;
  store.signups = [
    { id: 'cb-1', name: 'Jane Doe', email: 'jane@gym.com', source: 'SAEED10', createdAt: new Date('2026-10-10T00:00:00Z'), invitedAt: null },
    { id: 'cb-2', name: 'Bob', email: 'bob@fit.io', source: 'ref=saeed10&utm_source=ig', createdAt: new Date('2026-10-11T00:00:00Z'), invitedAt: new Date('2026-10-12T00:00:00Z') },
    { id: 'cb-3', name: 'Carl Q Public', email: 'carl@x.com', source: 'saeed10 ig/bio/oct', createdAt: new Date('2026-10-12T00:00:00Z'), invitedAt: null },
    { id: 'cb-4', name: 'Nope', email: 'n@x.com', source: 'SAEED100', createdAt: new Date(), invitedAt: null },
    { id: 'cb-5', name: 'Nope2', email: 'n2@x.com', source: 'OTHER', createdAt: new Date(), invitedAt: null },
  ];
  resetAffiliateResourcesCache();
});

describe('helpers', () => {
  it('sourceMatchesCode: ref=CODE or bare code token, case-insensitive, no prefix matches', () => {
    expect(sourceMatchesCode('SAEED10', 'SAEED10')).toBe(true);
    expect(sourceMatchesCode('ref=saeed10', 'SAEED10')).toBe(true);
    expect(sourceMatchesCode('?utm_source=x&ref=Saeed10', 'SAEED10')).toBe(true);
    expect(sourceMatchesCode('saeed10 ig/bio', 'SAEED10')).toBe(true);
    expect(sourceMatchesCode('SAEED100', 'SAEED10')).toBe(false);
    expect(sourceMatchesCode('xSAEED10', 'SAEED10')).toBe(false);
    expect(sourceMatchesCode(null, 'SAEED10')).toBe(false);
    expect(sourceMatchesCode('SAEED10', '')).toBe(false);
  });
  it('masks names and emails', () => {
    expect(maskName('Jane Doe')).toBe('Jane D.');
    expect(maskName('carl q public')).toBe('carl P.');
    expect(maskName('Bob')).toBe('Bob');
    expect(maskName(null)).toBe('Coach');
    expect(maskEmail('Jane@Gym.COM')).toBe('@gym.com');
    expect(maskEmail('')).toBeNull();
  });
  it('totals split paid and pending', () => {
    expect(totalsOf([{ status: 'paid', amountCents: 100 }, { status: 'pending', amountCents: 50 }, { status: 'paid', amountCents: 1 }])).toEqual({ paidCents: 101, pendingCents: 50 });
  });
});

describe('affiliate-facing routes require the token', () => {
  for (const path of ['/api/affiliate/terms', '/api/affiliate/trainer-referrals', '/api/affiliate/manual-payouts']) {
    it(`${path}: 401 without/with a bad token, never by email or id`, async () => {
      expect((await request(app).get(path)).status).toBe(401);
      expect((await request(app).get(path).set('X-Affiliate-Token', 'guess')).status).toBe(401);
      expect((await request(app).get(`${path}?email=s@x.com`)).status).toBe(401);
      expect((await request(app).get(`${path}?affiliateId=aff-1`)).status).toBe(401);
      expect((await request(app).get(path).set('X-Affiliate-Token', 'tok-1')).status).toBe(200);
    });
  }
});

describe('GET /api/affiliate/terms', () => {
  it('returns personal terms and the shared general structure', async () => {
    const r = await request(app).get('/api/affiliate/terms').set('X-Affiliate-Token', 'tok-1');
    expect(r.body.terms).toEqual({
      commissionRate: 0.4, trainerCommissionRate: 0.2, campaignRate: 0.3, perVideoFeeCents: 4000,
      agreementNote: 'Growth rungs: see PDF', agreementUpdatedAt: '2026-10-01T00:00:00.000Z',
    });
    expect(r.body.structure.title).toBe('Axiom Affiliate Payment Structure');
    expect(r.body.structure.streams).toHaveLength(4);
    expect(r.body.structure).toEqual(JSON.parse(JSON.stringify(AFFILIATE_PAYMENT_STRUCTURE)));
    expect(r.headers['cache-control']).toBe('private, no-store');
  });
  it('unset personal fields come back as null', async () => {
    const r = await request(app).get('/api/affiliate/terms').set('X-Affiliate-Token', 'tok-2');
    expect(r.body.terms).toMatchObject({ trainerCommissionRate: null, perVideoFeeCents: null, agreementNote: null, agreementUpdatedAt: null });
  });
});

describe('GET /api/affiliate/trainer-referrals', () => {
  it('lists this affiliate’s referrals (no contact) and masked auto sign-ups', async () => {
    store.referrals.push(
      { id: 'tr-a', affiliateId: 'aff-1', trainerName: 'Coach K', organization: 'K Gym', contact: 'k@kgym.com', plan: 'coach', status: 'active', coachBetaSignupId: 'cb-1', startedAt: new Date('2026-09-01T00:00:00Z'), note: 'n', createdAt: new Date(), updatedAt: new Date() },
      { id: 'tr-b', affiliateId: 'aff-2', trainerName: 'Not mine', status: 'lead', createdAt: new Date(), updatedAt: new Date() },
    );
    const r = await request(app).get('/api/affiliate/trainer-referrals').set('X-Affiliate-Token', 'tok-1');
    expect(r.status).toBe(200);
    expect(r.body.referrals).toHaveLength(1);
    expect(r.body.referrals[0]).toMatchObject({ trainerName: 'Coach K', organization: 'K Gym', plan: 'coach', status: 'active', startedAt: '2026-09-01T00:00:00.000Z' });
    expect(r.body.referrals[0]).not.toHaveProperty('contact');
    expect(r.body.autoSignups.map((s: any) => s.id)).toEqual(['cb-1', 'cb-2', 'cb-3']);
    expect(r.body.autoSignups[0]).toEqual({ id: 'cb-1', name: 'Jane D.', emailDomain: '@gym.com', createdAt: '2026-10-10T00:00:00.000Z', invitedAt: null });
    expect(r.body.autoSignups[1]).toMatchObject({ name: 'Bob', emailDomain: '@fit.io', invitedAt: '2026-10-12T00:00:00.000Z' });
    const json = JSON.stringify(r.body);
    expect(json).not.toContain('jane@gym.com');
    expect(json).not.toContain('Doe');
    expect(json).not.toContain('k@kgym.com');
  });
});

describe('GET /api/affiliate/manual-payouts', () => {
  it('newest first with paid/pending totals, scoped to the affiliate', async () => {
    store.payouts.push(
      { id: 'p1', affiliateId: 'aff-1', kind: 'ugc', description: 'old', amountCents: 14000, currency: 'CAD', status: 'paid', paidAt: new Date('2026-09-01T00:00:00Z'), createdAt: new Date('2026-09-01T00:00:00Z') },
      { id: 'p2', affiliateId: 'aff-1', kind: 'discretionary', description: 'bonus', amountCents: 2500, currency: 'CAD', status: 'pending', paidAt: null, createdAt: new Date('2026-10-15T00:00:00Z') },
      { id: 'p3', affiliateId: 'aff-1', kind: 'ugc', description: 'newer', amountCents: 2000, currency: 'CAD', status: 'paid', paidAt: new Date('2026-10-01T00:00:00Z'), createdAt: new Date('2026-08-01T00:00:00Z') },
      { id: 'px', affiliateId: 'aff-2', kind: 'ugc', description: 'other', amountCents: 999, currency: 'CAD', status: 'paid', paidAt: new Date(), createdAt: new Date() },
    );
    const r = await request(app).get('/api/affiliate/manual-payouts').set('X-Affiliate-Token', 'tok-1');
    expect(r.body.payouts.map((p: any) => p.id)).toEqual(['p2', 'p3', 'p1']);
    expect(r.body.totals).toEqual({ paidCents: 16000, pendingCents: 2500 });
    expect(r.body.payouts[0]).toMatchObject({ kind: 'discretionary', currency: 'CAD', paidAt: null });
  });
});

describe('admin routes', () => {
  it('require admin auth', async () => {
    expect((await request(app).put('/api/affiliates/aff-1/terms').send({ campaignRate: 0.3 })).status).toBe(401);
    expect((await request(app).post('/api/affiliates/aff-1/trainer-referrals').send({ trainerName: 'x' })).status).toBe(401);
    expect((await request(app).post('/api/affiliates/aff-1/manual-payouts').send({ kind: 'ugc', description: 'x', amountCents: 1 })).status).toBe(401);
    expect((await request(app).delete('/api/affiliates/aff-1/manual-payouts/p1')).status).toBe(401);
    expect((await request(app).get('/api/affiliates/aff-1/extras')).status).toBe(401);
    // The affiliate token is not an admin credential.
    expect((await request(app).put('/api/affiliates/aff-1/terms').set('X-Affiliate-Token', 'tok-1').send({ campaignRate: 0.9 })).status).toBe(401);
    expect(store.affiliates[0].campaignRate).toBe(0.3);
  });

  it('PUT terms validates and stamps agreementUpdatedAt', async () => {
    expect((await admin(request(app).put('/api/affiliates/aff-1/terms')).send({ trainerCommissionRate: 1.5 })).status).toBe(400);
    expect((await admin(request(app).put('/api/affiliates/aff-1/terms')).send({ perVideoFeeCents: 10.5 })).status).toBe(400);
    expect((await admin(request(app).put('/api/affiliates/aff-1/terms')).send({ perVideoFeeCents: -1 })).status).toBe(400);
    expect((await admin(request(app).put('/api/affiliates/aff-1/terms')).send({ agreementNote: 'x'.repeat(2001) })).status).toBe(400);
    expect((await admin(request(app).put('/api/affiliates/aff-1/terms')).send({ inviteToken: 'steal' })).status).toBe(400);
    expect((await admin(request(app).put('/api/affiliates/nope/terms')).send({ campaignRate: 0.3 })).status).toBe(404);
    const r = await admin(request(app).put('/api/affiliates/aff-2/terms')).send({ trainerCommissionRate: 0.15, perVideoFeeCents: 5000, agreementNote: '  Rungs: 10/25/50  ', campaignRate: null });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ trainerCommissionRate: 0.15, perVideoFeeCents: 5000, agreementNote: 'Rungs: 10/25/50', campaignRate: null });
    expect(Date.parse(r.body.agreementUpdatedAt)).toBeGreaterThan(Date.now() - 5000);
    // Clearing the note
    const c = await admin(request(app).put('/api/affiliates/aff-2/terms')).send({ agreementNote: '' });
    expect(c.body.agreementNote).toBeNull();
  });

  it('trainer referral CRUD with validation, scoping and duplicate sign-up link', async () => {
    const base = '/api/affiliates/aff-1/trainer-referrals';
    expect((await admin(request(app).post(base)).send({})).status).toBe(400);
    expect((await admin(request(app).post(base)).send({ trainerName: 'x', status: 'vip' })).status).toBe(400);
    expect((await admin(request(app).post(base)).send({ trainerName: 'x', plan: 'gold' })).status).toBe(400);
    expect((await admin(request(app).post(base)).send({ trainerName: 'x'.repeat(121) })).status).toBe(400);
    expect((await admin(request(app).post(base)).send({ trainerName: 'x', startedAt: 'someday' })).status).toBe(400);
    expect((await admin(request(app).post('/api/affiliates/nope/trainer-referrals')).send({ trainerName: 'x' })).status).toBe(404);

    const c = await admin(request(app).post(base)).send({ trainerName: 'Coach K', organization: 'K Gym', contact: '@coachk', plan: 'coach', coachBetaSignupId: 'cb-1', startedAt: '2026-10-01' });
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({ trainerName: 'Coach K', status: 'lead', plan: 'coach', contact: '@coachk', startedAt: '2026-10-01T00:00:00.000Z' });
    const dup = await admin(request(app).post(base)).send({ trainerName: 'Dup', coachBetaSignupId: 'cb-1' });
    expect(dup.status).toBe(409);

    const u = await admin(request(app).put(`${base}/${c.body.id}`)).send({ status: 'active', note: 'Signed Coach plan' });
    expect(u.status).toBe(200);
    expect(u.body).toMatchObject({ status: 'active', note: 'Signed Coach plan', trainerName: 'Coach K' });
    expect((await admin(request(app).put(`${base}/${c.body.id}`)).send({ status: 'bogus' })).status).toBe(400);
    // Another affiliate's path can't touch it.
    expect((await admin(request(app).put(`/api/affiliates/aff-2/trainer-referrals/${c.body.id}`)).send({ status: 'lost' })).status).toBe(404);
    expect((await admin(request(app).delete(`/api/affiliates/aff-2/trainer-referrals/${c.body.id}`))).status).toBe(404);

    const extras = await admin(request(app).get('/api/affiliates/aff-1/extras'));
    expect(extras.body.trainerReferrals[0]).toMatchObject({ contact: '@coachk', coachBetaSignupId: 'cb-1' });
    expect(extras.body.autoSignups).toHaveLength(3);
    expect(extras.body.terms.perVideoFeeCents).toBe(4000);

    expect((await admin(request(app).delete(`${base}/${c.body.id}`))).status).toBe(200);
    expect((await admin(request(app).delete(`${base}/${c.body.id}`))).status).toBe(404);
  });

  it('manual payout CRUD: integer cents ≥ 0, mark paid stamps paidAt, back to pending clears it', async () => {
    const base = '/api/affiliates/aff-1/manual-payouts';
    const bad = [
      { kind: 'ugc', description: 'x', amountCents: -1 },
      { kind: 'ugc', description: 'x', amountCents: 12.5 },
      { kind: 'ugc', description: 'x', amountCents: '100' },
      { kind: 'tip', description: 'x', amountCents: 1 },
      { kind: 'ugc', description: '', amountCents: 1 },
      { kind: 'ugc', description: 'x'.repeat(301), amountCents: 1 },
      { kind: 'ugc', description: 'x', amountCents: 1, status: 'sent' },
      { kind: 'ugc', description: 'x', amountCents: 1, affiliateId: 'aff-2' },
    ];
    for (const b of bad) expect((await admin(request(app).post(base)).send(b)).status).toBe(400);

    const c = await admin(request(app).post(base)).send({ kind: 'ugc', description: '3 videos', amountCents: 12000, reference: 'e-transfer 123' });
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({ status: 'pending', currency: 'CAD', paidAt: null, amountCents: 12000 });

    const paid = await admin(request(app).put(`${base}/${c.body.id}`)).send({ status: 'paid' });
    expect(paid.status).toBe(200);
    expect(paid.body.status).toBe('paid');
    expect(Date.parse(paid.body.paidAt)).toBeGreaterThan(Date.now() - 5000);

    const zero = await admin(request(app).post(base)).send({ kind: 'discretionary', description: 'Bonus', amountCents: 0, status: 'paid', paidAt: '2026-10-17' });
    expect(zero.body.paidAt).toBe('2026-10-17T00:00:00.000Z');

    const t = await request(app).get('/api/affiliate/manual-payouts').set('X-Affiliate-Token', 'tok-1');
    expect(t.body.totals).toEqual({ paidCents: 12000, pendingCents: 0 });

    const back = await admin(request(app).put(`${base}/${c.body.id}`)).send({ status: 'pending' });
    expect(back.body.paidAt).toBeNull();
    expect((await admin(request(app).put(`/api/affiliates/aff-2/manual-payouts/${c.body.id}`)).send({ status: 'paid' })).status).toBe(404);
    expect((await admin(request(app).put(`${base}/${c.body.id}`)).send({ amountCents: -5 })).status).toBe(400);
    expect((await admin(request(app).delete(`${base}/${c.body.id}`))).status).toBe(200);
    expect((await admin(request(app).delete(`${base}/${c.body.id}`))).status).toBe(404);
    expect((await admin(request(app).post('/api/affiliates/nope/manual-payouts')).send({ kind: 'ugc', description: 'x', amountCents: 1 })).status).toBe(404);
  });
});

describe('payment-structure markdown resource', () => {
  it('the shipped document matches the shared constant', () => {
    const shipped = readFileSync(join(process.cwd(), 'data', 'affiliate-resources', 'payment-structure.md'), 'utf8');
    expect(shipped).toBe(renderPaymentStructureMarkdown());
    expect(shipped).toMatch(/^# Axiom Affiliate Payment Structure/);
    for (const s of AFFILIATE_PAYMENT_STRUCTURE.streams) expect(shipped).toContain(s.name);
    expect(shipped).toContain('40% of every Pro payment ($12.99/mo)');
    expect(shipped).toContain('Your terms');
  });

  it('is listed with format md and served as text/markdown via the signed link', async () => {
    const meta = listResources().find(r => r.slug === 'payment-structure')!;
    expect(meta).toMatchObject({ format: 'md', category: 'Payments', fileName: 'payment-structure.md' });
    expect(listResources().find(r => r.slug === 'outreach-guide')!.format).toBe('pdf');

    const link = await request(app).get('/api/affiliate/resources/payment-structure/link').set('X-Affiliate-Token', 'tok-1');
    expect(link.status).toBe(200);
    const u = new URL(link.body.url);
    const r = await request(app).get(`${u.pathname}${u.search}`);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('text/markdown; charset=utf-8');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.text).toBe(readFileSync(join(process.cwd(), 'data', 'affiliate-resources', 'payment-structure.md'), 'utf8'));
  });
});
