// Public referral-code check used by the web checkout / register code field.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const store = vi.hoisted(() => ({ affiliates: [] as any[], calls: [] as any[] }));

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(function (this: any) {
    this.affiliate = {
      findUnique: vi.fn(async (a: any) => {
        store.calls.push(a);
        const r = store.affiliates.find(x => x.referralCode === a.where.referralCode);
        if (!r) return null;
        if (!a.select) return { ...r };
        return Object.fromEntries(Object.keys(a.select).filter(k => a.select[k]).map(k => [k, r[k]]));
      }),
    };
  }),
}));
vi.mock('../services/affiliateService.js', () => ({
  inviteAffiliate: vi.fn(), generateOnboardingLink: vi.fn(), generateDashboardLink: vi.fn(),
  checkAndUpdateOnboardingStatus: vi.fn(), runMonthlyPayouts: vi.fn(), getAffiliateDashboard: vi.fn(),
}));
vi.mock('../middleware/requireAuth.js', () => ({ requireAuth: (_req: any, res: any) => res.status(401).json({ error: 'auth' }) }));
vi.mock('../middleware/requireAdmin.js', () => ({ requireAdmin: (_req: any, _res: any, next: any) => next() }));

const { default: router } = await import('../routes/affiliates.js');
const { codeLookupLimiter } = await import('../middleware/rateLimiter.js');

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use('/api', router);

beforeEach(() => {
  store.calls = [];
  store.affiliates = [
    { id: 'a1', name: 'Saeed Abi Issa', email: 'saeed.secret@example.com', referralCode: 'SAEED10', active: true, inviteToken: 'tok-1', commissionRate: 0.4 },
    { id: 'a2', name: 'Kavi', email: 'kavi.secret@example.com', referralCode: 'KAVI10', active: false, inviteToken: 'tok-2' },
  ];
});

const get = (code: string, ip = '203.0.113.9') =>
  request(app).get(`/api/affiliate/code/${encodeURIComponent(code)}/validate`).set('X-Forwarded-For', ip);

describe('GET /api/affiliate/code/:code/validate', () => {
  it('describes a valid active code: 20% for life + 30-day trial + first name only', async () => {
    const r = await get('SAEED10');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ valid: true, code: 'SAEED10', discountPercent: 20, trialDays: 30, affiliateFirstName: 'Saeed' });
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('is case-insensitive and trims', async () => {
    const r = await get('  saeed10 ');
    expect(r.body.valid).toBe(true);
    expect(r.body.code).toBe('SAEED10');
    expect(store.calls[0].where).toEqual({ referralCode: 'SAEED10' });
  });

  it('unknown code → 200 valid:false', async () => {
    const r = await get('NOPE99');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ valid: false });
  });

  it('inactive affiliate → still valid for the customer (matches create-checkout)', async () => {
    // The customer's discount applies for any real code; commission is gated
    // on affiliate.active elsewhere.
    const r = await get('kavi10');
    expect(r.status).toBe(200);
    expect(r.body.valid).toBe(true);
    expect(r.body.code).toBe('KAVI10');
  });

  it('malformed code → valid:false without a DB lookup', async () => {
    const r = await get('a b;--');
    expect(r.body).toEqual({ valid: false });
    expect(store.calls).toHaveLength(0);
  });

  it('never leaks email, id, token or rates', async () => {
    const r = await get('SAEED10');
    const text = JSON.stringify(r.body);
    expect(text).not.toContain('secret@example.com');
    expect(text).not.toContain('a1');
    expect(text).not.toContain('tok-1');
    expect(text).not.toContain('0.4');
    expect(store.calls[0].select).toEqual({ name: true, active: true });
  });

  describe('rate limit', () => {
    const prev = process.env.RATE_LIMIT_DISABLED;
    beforeEach(() => { process.env.RATE_LIMIT_DISABLED = 'false'; });
    afterEach(() => { process.env.RATE_LIMIT_DISABLED = prev; });

    it('the route is guarded by codeLookupLimiter and 429s a scripted burst per IP', async () => {
      const layer = (router as any).stack.find((l: any) => l.route?.path === '/affiliate/code/:code/validate');
      expect(layer.route.stack.map((s: any) => s.handle)).toContain(codeLookupLimiter);

      let last = 0;
      for (let i = 0; i < 31; i++) last = (await get(`CODE${i}`, '198.51.100.7')).status;
      expect(last).toBe(429);
      // A different IP is unaffected.
      expect((await get('SAEED10', '198.51.100.8')).status).toBe(200);
    });
  });
});
