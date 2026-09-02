// Referral-code checkout behavior: public validation endpoint, and the
// 20% discount applying for ANY real code (commission stays gated on
// affiliate.active elsewhere — a referred user's discount must not depend on
// whether their affiliate finished Stripe onboarding).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const store = vi.hoisted(() => ({ affiliates: [] as any[], sessions: [] as any[] }));

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(function (this: any) {
    this.affiliate = { findUnique: vi.fn(async (a: any) => store.affiliates.find(x => x.referralCode === a.where.referralCode) ?? null) };
    this.user = {
      findUnique: vi.fn(async () => ({ id: 'u1', email: 'u@x.com', name: 'U', stripeCustomerId: 'cus_1', tier: 'free', stripeSubStatus: null })),
      update: vi.fn(async () => ({})),
    };
  }),
}));
vi.mock('../services/stripeService.js', () => ({
  stripe: {
    checkout: { sessions: { create: vi.fn(async (args: any) => { store.sessions.push(args); return { url: 'https://checkout.stripe.com/x' }; }) } },
    customers: { create: vi.fn(async () => ({ id: 'cus_new' })) },
  },
}));
vi.mock('../services/affiliateService.js', () => ({
  recordCommission: vi.fn(),
  getOrCreateAffiliateCoupon: vi.fn(async () => 'coupon_20'),
  renewalCommissionBaseCents: (i: any) => i?.subtotal ?? i?.amount_paid ?? 0,
}));
vi.mock('../middleware/requireAuth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = { id: 'u1', email: 'u@x.com' }; next(); },
}));
vi.mock('../services/posthogClient.js', () => ({ default: { capture: vi.fn(), captureException: vi.fn() } }));

import paymentsRouter from '../routes/payments.js';

const app = express();
app.use(express.json());
app.use('/api', paymentsRouter);

beforeEach(() => {
  store.affiliates = [
    { id: 'a1', referralCode: 'KAVI10', active: false, onboarded: false, discountRate: 0.2 },
    { id: 'a2', referralCode: 'ANUTEST26', active: true, onboarded: true, discountRate: 0.2 },
  ];
  store.sessions = [];
  process.env.STRIPE_PRO_PRICE_ID = 'price_test';
});

describe('GET /payments/referral-code/:code', () => {
  it('validates real codes (any onboarding state) case-insensitively', async () => {
    const r = await request(app).get('/api/payments/referral-code/kavi10');
    expect(r.body).toEqual({ valid: true, code: 'KAVI10', discountPercent: 20 });
  });
  it('rejects unknown or absurd codes without leaking anything', async () => {
    expect((await request(app).get('/api/payments/referral-code/NOPE')).body).toEqual({ valid: false });
    expect((await request(app).get(`/api/payments/referral-code/${'X'.repeat(40)}`)).body).toEqual({ valid: false });
  });
});

describe('POST /payments/create-checkout with a referral code', () => {
  it('applies the coupon + attribution for a NOT-yet-onboarded affiliate', async () => {
    const r = await request(app).post('/api/payments/create-checkout').send({ referralCode: 'kavi10' });
    expect(r.status).toBe(200);
    const session = store.sessions[0];
    expect(session.discounts).toEqual([{ coupon: 'coupon_20' }]);
    expect(session.metadata.affiliateId).toBe('a1');
    expect(session.allow_promotion_codes).toBeUndefined(); // coupon replaces promo-code entry…
    expect(session.subscription_data).toEqual({ trial_period_days: 30 }); // …so the trial is set server-side
  });
  it('without a code: no discount, promo codes (AXIOMTRIAL) allowed', async () => {
    await request(app).post('/api/payments/create-checkout').send({});
    const session = store.sessions[0];
    expect(session.discounts).toBeUndefined();
    expect(session.allow_promotion_codes).toBe(true);
  });
  it('an unknown code degrades gracefully — checkout still works at full price', async () => {
    const r = await request(app).post('/api/payments/create-checkout').send({ referralCode: 'TYPO' });
    expect(r.status).toBe(200);
    expect(store.sessions[0].discounts).toBeUndefined();
  });
});
