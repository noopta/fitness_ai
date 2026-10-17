// Self-reported referrals: affiliates log people they referred before they had
// a code (per-affiliate opt-in); admins review them. Ownership, status locks,
// validation, and what each side is allowed to see.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const store = vi.hoisted(() => ({
  affiliates: [] as any[],
  rows: [] as any[],
  users: [] as any[],
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

// In-memory stand-in for the raw-SQL repo (same contract: affiliate-scoped,
// status-guarded writes for the affiliate, column whitelists).
vi.mock('../services/affiliateSelfReportsRepo.js', () => {
  const AFF = ['name', 'email', 'note', 'approxSignupDate'];
  const ADM = ['status', 'adminNote', 'matchedUserId'];
  const pick = (o: any, cols: string[]) => Object.fromEntries(cols.filter(c => o[c] !== undefined).map(c => [c, o[c]]));
  const find = (aid: string, id: string) => store.rows.find(r => r.id === id && r.affiliateId === aid) ?? null;
  return {
    getSelfReportEnabled: async (id: string) => { const a = store.affiliates.find(x => x.id === id); return a ? !!a.flag : null; },
    setSelfReportEnabled: async (id: string, on: boolean) => { const a = store.affiliates.find(x => x.id === id); if (!a) return 0; a.selfReportEnabled = on; return 1; },
    listSelfReportRows: async (aid: string) => store.rows.filter(r => r.affiliateId === aid).sort((a, b) => b.createdAt - a.createdAt),
    countSelfReportRows: async (aid: string) => store.rows.filter(r => r.affiliateId === aid).length,
    getSelfReportRow: async (aid: string, id: string) => find(aid, id),
    insertSelfReportRow: async (aid: string, data: any) => {
      const row = { id: `sr-${++store.seq}`, affiliateId: aid, email: null, note: null, approxSignupDate: null, matchedUserId: null, adminNote: null, ...pick(data, AFF), status: 'submitted', createdAt: Date.now() + store.seq, updatedAt: Date.now() };
      store.rows.push(row); return row;
    },
    updateSelfReportRowAsAffiliate: async (aid: string, id: string, patch: any) => {
      const r = find(aid, id); if (!r || r.status !== 'submitted') return null;
      Object.assign(r, pick(patch, AFF), { updatedAt: Date.now() }); return r;
    },
    updateSelfReportRowAsAdmin: async (aid: string, id: string, patch: any) => {
      const r = find(aid, id); if (!r) return null;
      Object.assign(r, pick(patch, ADM), { updatedAt: Date.now() }); return r;
    },
    deleteSubmittedSelfReportRow: async (aid: string, id: string) => {
      const before = store.rows.length; store.rows = store.rows.filter(r => !(r.id === id && r.affiliateId === aid && r.status === 'submitted')); return before - store.rows.length;
    },
    usersByEmails: async (emails: string[]) => store.users.filter(u => emails.map(e => e.toLowerCase()).includes(u.email.toLowerCase())),
    userExists: async (id: string) => store.users.some(u => u.id === id),
  };
});

vi.mock('../services/affiliateService.js', () => ({
  generateOnboardingLink: vi.fn(), generateDashboardLink: vi.fn(), checkAndUpdateOnboardingStatus: vi.fn(async () => true),
  getAffiliateDashboard: vi.fn(async (id: string) => ({ id, referralCode: 'X' })), inviteAffiliate: vi.fn(), runMonthlyPayouts: vi.fn(),
}));
vi.mock('../middleware/requireAuth.js', () => ({
  requireAuth: (req: any, res: any, next: any) => (req.get('x-test-admin') === '1' ? next() : res.status(401).json({ error: 'auth' })),
}));
vi.mock('../middleware/requireAdmin.js', () => ({ requireAdmin: (_req: any, _res: any, next: any) => next() }));

import affiliatesRouter from '../routes/affiliates.js';
import { MAX_SELF_REPORTS_PER_AFFILIATE } from '../services/affiliateSelfReports.js';

const app = express();
app.use(express.json());
app.use('/api', affiliatesRouter);

const UMAR = { id: 'aff-umar', name: 'Umar', email: 'faruqanjo@gmail.com', referralCode: 'UMAR10', inviteToken: 'tok-umar', active: true, selfReportEnabled: true };
const OTHER = { id: 'aff-2', name: 'Other', email: 'o@x.com', referralCode: 'OTHER', inviteToken: 'tok-2', active: true, selfReportEnabled: true };
const OFF = { id: 'aff-3', name: 'Off', email: 'off@x.com', referralCode: 'OFF', inviteToken: 'tok-off', active: true, selfReportEnabled: false };
const INACTIVE = { id: 'aff-4', name: 'In', email: 'in@x.com', referralCode: 'IN', inviteToken: 'tok-in', active: false, selfReportEnabled: true };
// Old Prisma client: no selfReportEnabled property → read through the repo.
const LEGACY = { id: 'aff-5', name: 'Legacy', email: 'l@x.com', referralCode: 'LEG', inviteToken: 'tok-leg', active: true, flag: true };

const as = (token: string) => (r: request.Test) => r.set('X-Affiliate-Token', token);
const umar = as('tok-umar');
const admin = (r: request.Test) => r.set('x-test-admin', '1');

beforeEach(() => {
  store.affiliates = [{ ...UMAR }, { ...OTHER }, { ...OFF }, { ...INACTIVE }, { ...LEGACY }];
  store.rows = [];
  store.seq = 0;
  store.users = [{ id: 'user-1', name: 'Ali Khan', email: 'Ali@Example.com', tier: 'pro', createdAt: new Date('2026-08-01T00:00:00Z'), referredByCode: null }];
});

describe('affiliate self-referrals — access', () => {
  it('no token → 401; not enabled or inactive → 403 not_enabled (every route)', async () => {
    expect((await request(app).get('/api/affiliate/self-referrals')).status).toBe(401);
    for (const tok of ['tok-off', 'tok-in']) {
      const t = as(tok);
      const list = await t(request(app).get('/api/affiliate/self-referrals'));
      expect(list.status).toBe(403);
      expect(list.body).toEqual({ error: 'not_enabled' });
      expect((await t(request(app).post('/api/affiliate/self-referrals')).send({ name: 'X' })).status).toBe(403);
      expect((await t(request(app).put('/api/affiliate/self-referrals/sr-1')).send({ name: 'X' })).status).toBe(403);
      expect((await t(request(app).delete('/api/affiliate/self-referrals/sr-1'))).status).toBe(403);
    }
    expect(store.rows).toHaveLength(0);
  });

  it('reads the flag through the repo when the Prisma client lacks the column', async () => {
    expect((await as('tok-leg')(request(app).get('/api/affiliate/self-referrals'))).status).toBe(200);
  });

  it('/affiliate/me includes selfReportEnabled (false when inactive)', async () => {
    expect((await umar(request(app).get('/api/affiliate/me'))).body.selfReportEnabled).toBe(true);
    expect((await as('tok-off')(request(app).get('/api/affiliate/me'))).body.selfReportEnabled).toBe(false);
    expect((await as('tok-in')(request(app).get('/api/affiliate/me'))).body.selfReportEnabled).toBe(false);
  });
});

describe('affiliate self-referrals — CRUD', () => {
  it('create, list newest first, edit, delete', async () => {
    const a = await umar(request(app).post('/api/affiliate/self-referrals')).send({ name: '  Ali Khan ', email: 'ALI@Example.com', approxSignupDate: '2026-08-01', note: 'gym friend' });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ name: 'Ali Khan', email: 'ali@example.com', note: 'gym friend', status: 'submitted' });
    expect(a.body.approxSignupDate).toBe('2026-08-01T00:00:00.000Z');
    const b = await umar(request(app).post('/api/affiliate/self-referrals')).send({ name: 'Sara' });
    expect(b.status).toBe(201);
    expect(b.body).toMatchObject({ email: null, note: null, approxSignupDate: null });

    const list = await umar(request(app).get('/api/affiliate/self-referrals'));
    expect(list.status).toBe(200);
    expect(list.body.referrals.map((r: any) => r.name)).toEqual(['Sara', 'Ali Khan']);

    const ed = await umar(request(app).put(`/api/affiliate/self-referrals/${b.body.id}`)).send({ email: 'sara@x.com', note: '' });
    expect(ed.status).toBe(200);
    expect(ed.body).toMatchObject({ name: 'Sara', email: 'sara@x.com', note: null });

    const del = await umar(request(app).delete(`/api/affiliate/self-referrals/${b.body.id}`));
    expect(del.status).toBe(200);
    expect(store.rows.map(r => r.id)).toEqual([a.body.id]);
  });

  it('ownership: another affiliate gets 404 on edit/delete and never sees the row', async () => {
    const a = await umar(request(app).post('/api/affiliate/self-referrals')).send({ name: 'Ali' });
    const other = as('tok-2');
    expect((await other(request(app).put(`/api/affiliate/self-referrals/${a.body.id}`)).send({ name: 'Hacked' })).status).toBe(404);
    expect((await other(request(app).delete(`/api/affiliate/self-referrals/${a.body.id}`))).status).toBe(404);
    expect((await other(request(app).get('/api/affiliate/self-referrals'))).body.referrals).toEqual([]);
    expect(store.rows[0].name).toBe('Ali');
    expect((await umar(request(app).put('/api/affiliate/self-referrals/nope')).send({ name: 'x' })).status).toBe(404);
  });

  it('edit/delete after review → 409', async () => {
    const a = await umar(request(app).post('/api/affiliate/self-referrals')).send({ name: 'Ali' });
    store.rows[0].status = 'approved';
    expect((await umar(request(app).put(`/api/affiliate/self-referrals/${a.body.id}`)).send({ name: 'Changed' })).status).toBe(409);
    expect((await umar(request(app).delete(`/api/affiliate/self-referrals/${a.body.id}`))).status).toBe(409);
    expect(store.rows[0].name).toBe('Ali');
  });

  it('validation', async () => {
    const post = (body: any) => umar(request(app).post('/api/affiliate/self-referrals')).send(body);
    expect((await post({})).status).toBe(400);
    expect((await post({ name: '   ' })).status).toBe(400);
    expect((await post({ name: 'x'.repeat(121) })).status).toBe(400);
    expect((await post({ name: 'A', email: 'not-an-email' })).status).toBe(400);
    expect((await post({ name: 'A', email: `${'a'.repeat(250)}@x.com` })).status).toBe(400);
    expect((await post({ name: 'A', note: 'n'.repeat(1001) })).status).toBe(400);
    expect((await post({ name: 'A', approxSignupDate: 'yesterday-ish' })).status).toBe(400);
    const future = new Date(Date.now() + 5 * 86400_000).toISOString();
    const f = await post({ name: 'A', approxSignupDate: future });
    expect(f.status).toBe(400);
    expect(f.body.error).toMatch(/future/);
    // Affiliates can't write review fields.
    expect((await post({ name: 'A', status: 'approved' })).status).toBe(400);
    expect((await post({ name: 'A', matchedUserId: 'user-1' })).status).toBe(400);
    expect(store.rows).toHaveLength(0);
    // Empty optional email is fine.
    expect((await post({ name: 'A', email: '' })).status).toBe(201);
  });

  it(`caps at ${MAX_SELF_REPORTS_PER_AFFILIATE} rows per affiliate`, async () => {
    for (let i = 0; i < MAX_SELF_REPORTS_PER_AFFILIATE; i++) store.rows.push({ id: `pre-${i}`, affiliateId: UMAR.id, name: 'x', status: 'submitted', createdAt: i });
    const r = await umar(request(app).post('/api/affiliate/self-referrals')).send({ name: 'One more' });
    expect(r.status).toBe(409);
  });

  it('affiliate list hides adminNote and matchedUserId', async () => {
    await umar(request(app).post('/api/affiliate/self-referrals')).send({ name: 'Ali', email: 'ali@example.com' });
    Object.assign(store.rows[0], { status: 'matched', matchedUserId: 'user-1', adminNote: 'internal only' });
    const list = await umar(request(app).get('/api/affiliate/self-referrals'));
    const row = list.body.referrals[0];
    expect(row.status).toBe('matched');
    expect(row).not.toHaveProperty('adminNote');
    expect(row).not.toHaveProperty('matchedUserId');
    expect(JSON.stringify(list.body)).not.toContain('internal only');
    expect(JSON.stringify(list.body)).not.toContain('user-1');
  });
});

describe('admin self-referral review', () => {
  it('requires auth', async () => {
    expect((await request(app).get(`/api/affiliates/${UMAR.id}/self-referrals`)).status).toBe(401);
    expect((await request(app).put(`/api/affiliates/${UMAR.id}/self-report`).send({ enabled: true })).status).toBe(401);
  });

  it('lists all fields with an email match suggestion', async () => {
    await umar(request(app).post('/api/affiliate/self-referrals')).send({ name: 'Ali', email: 'ali@example.com' });
    await umar(request(app).post('/api/affiliate/self-referrals')).send({ name: 'Nobody', email: 'none@x.com' });
    const r = await admin(request(app).get(`/api/affiliates/${UMAR.id}/self-referrals`));
    expect(r.status).toBe(200);
    expect(r.body.selfReportEnabled).toBe(true);
    const ali = r.body.referrals.find((x: any) => x.name === 'Ali');
    expect(ali).toHaveProperty('adminNote', null);
    expect(ali).toHaveProperty('matchedUserId', null);
    expect(ali.suggestedMatch).toEqual({ userId: 'user-1', name: 'Ali Khan', tier: 'pro', createdAt: '2026-08-01T00:00:00.000Z', referredByCode: null });
    expect(r.body.referrals.find((x: any) => x.name === 'Nobody').suggestedMatch).toBeNull();
    expect((await admin(request(app).get('/api/affiliates/missing/self-referrals'))).status).toBe(404);
  });

  it('updates review fields; never touches referredByCode; rejects unknown users', async () => {
    const a = await umar(request(app).post('/api/affiliate/self-referrals')).send({ name: 'Ali', email: 'ali@example.com' });
    const put = (body: any, id = a.body.id) => admin(request(app).put(`/api/affiliates/${UMAR.id}/self-referrals/${id}`)).send(body);
    const ok = await put({ status: 'approved', adminNote: 'confirmed by DM', matchedUserId: 'user-1' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: 'approved', adminNote: 'confirmed by DM', matchedUserId: 'user-1' });
    expect(store.users[0].referredByCode).toBeNull();
    expect((await put({ status: 'bogus' })).status).toBe(400);
    expect((await put({ name: 'x' })).status).toBe(400);
    expect((await put({ matchedUserId: 'ghost' })).status).toBe(400);
    expect((await put({ status: 'rejected' }, 'nope')).status).toBe(404);
    // Scoped by affiliate id in the URL.
    expect((await admin(request(app).put(`/api/affiliates/${OTHER.id}/self-referrals/${a.body.id}`)).send({ status: 'rejected' })).status).toBe(404);
  });

  it('toggles the opt-in', async () => {
    const off = await admin(request(app).put(`/api/affiliates/${UMAR.id}/self-report`)).send({ enabled: false });
    expect(off.status).toBe(200);
    expect(off.body).toEqual({ selfReportEnabled: false });
    expect((await umar(request(app).get('/api/affiliate/self-referrals'))).status).toBe(403);
    expect((await admin(request(app).put(`/api/affiliates/${UMAR.id}/self-report`)).send({ enabled: 'yes' })).status).toBe(400);
    expect((await admin(request(app).put('/api/affiliates/missing/self-report')).send({ enabled: true })).status).toBe(404);
  });
});

describe('affiliateWriteLimiter key', () => {
  it('keys on a hash of the token, never the raw credential; falls back to IP', async () => {
    const { affiliateTokenKey } = await import('../middleware/rateLimiter.js');
    const req = (h: Record<string, string>, body: any = {}) => ({ get: (k: string) => h[k.toLowerCase()], body, ip: '203.0.113.9' }) as any;
    const k1 = affiliateTokenKey(req({ 'x-affiliate-token': 'tok-umar' }));
    expect(k1).toMatch(/^aff:[0-9a-f]{32}$/);
    expect(k1).not.toContain('tok-umar');
    expect(affiliateTokenKey(req({}, { token: 'tok-umar' }))).toBe(k1);
    expect(affiliateTokenKey(req({ 'x-affiliate-token': 'tok-2' }))).not.toBe(k1);
    expect(affiliateTokenKey(req({}))).toMatch(/^ip:/);
  });
});
