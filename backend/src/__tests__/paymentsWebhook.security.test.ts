// Stripe webhook hardening: checkout.session.completed grants Pro only for a
// paid (or legitimately free) session for our price, and a replayed event id
// is handled once.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const m = vi.hoisted(() => ({
  userUpdate: vi.fn(async () => ({})),
  retrieve: vi.fn(),
  recordCommission: vi.fn(),
}));

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(function (this: any) {
    this.user = { update: m.userUpdate, findFirst: vi.fn(async () => null), findUnique: vi.fn() };
    this.affiliate = { findUnique: vi.fn() };
    this.affiliateCommission = { findFirst: vi.fn() };
  }),
}));
vi.mock('../services/stripeService.js', () => ({
  stripe: {
    webhooks: { constructEvent: (raw: any) => (typeof raw === 'string' ? JSON.parse(raw) : raw) },
    checkout: { sessions: { retrieve: m.retrieve } },
    subscriptions: { retrieve: vi.fn(async () => ({ items: { data: [{ price: { unit_amount: 999 } }] } })) },
  },
}));
vi.mock('../services/affiliateService.js', () => ({
  recordCommission: m.recordCommission,
  getOrCreateAffiliateCoupon: vi.fn(),
  renewalCommissionBaseCents: () => 0,
}));
vi.mock('../middleware/requireAuth.js', () => ({ requireAuth: (_q: any, _s: any, n: any) => n() }));
vi.mock('../services/posthogClient.js', () => ({ default: { capture: vi.fn(), captureException: vi.fn() } }));

process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
process.env.STRIPE_PRO_PRICE_ID = 'price_pro';

const { default: paymentsRouter, checkoutGrantsPro, __resetWebhookDedupeForTests } = await import('../routes/payments.js');

const app = express();
app.use(express.json());
app.use('/api', paymentsRouter);

const session = (over: any = {}) => ({
  id: 'cs_1', client_reference_id: 'u1', metadata: {}, customer: 'cus_1', subscription: null,
  payment_status: 'paid', line_items: { data: [{ price: { id: 'price_pro' } }] }, ...over,
});
const send = (id: string) => request(app).post('/api/payments/webhook').set('stripe-signature', 'sig')
  .send({ id, type: 'checkout.session.completed', data: { object: { id: 'cs_1' } } });

beforeEach(() => {
  __resetWebhookDedupeForTests();
  m.userUpdate.mockClear();
  m.retrieve.mockReset();
});

describe('checkoutGrantsPro', () => {
  it('accepts paid and no_payment_required (trial / 100% coupon) for our price', () => {
    expect(checkoutGrantsPro(session())).toEqual({ ok: true });
    expect(checkoutGrantsPro(session({ payment_status: 'no_payment_required' }))).toEqual({ ok: true });
  });
  it('refuses unpaid sessions and foreign prices', () => {
    expect(checkoutGrantsPro(session({ payment_status: 'unpaid' })).ok).toBe(false);
    expect(checkoutGrantsPro(session({ line_items: { data: [{ price: { id: 'price_cheap' } }] } })).ok).toBe(false);
    expect(checkoutGrantsPro(session({ line_items: { data: [] } })).ok).toBe(false);
  });
  it('honours STRIPE_EXTRA_PRICE_IDS', () => {
    process.env.STRIPE_EXTRA_PRICE_IDS = 'price_link';
    expect(checkoutGrantsPro(session({ line_items: { data: [{ price: { id: 'price_link' } }] } })).ok).toBe(true);
    delete process.env.STRIPE_EXTRA_PRICE_IDS;
  });
});

describe('POST /payments/webhook checkout.session.completed', () => {
  it('upgrades a paid session for our price', async () => {
    m.retrieve.mockResolvedValue(session());
    const r = await send('evt_1');
    expect(r.status).toBe(200);
    expect(m.userUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'u1' }, data: expect.objectContaining({ tier: 'pro' }) }));
  });
  it('does not upgrade an unpaid session', async () => {
    m.retrieve.mockResolvedValue(session({ payment_status: 'unpaid' }));
    await send('evt_2');
    expect(m.userUpdate).not.toHaveBeenCalled();
  });
  it('does not upgrade a session for some other price', async () => {
    m.retrieve.mockResolvedValue(session({ line_items: { data: [{ price: { id: 'price_other' } }] } }));
    await send('evt_3');
    expect(m.userUpdate).not.toHaveBeenCalled();
  });
  it('prefers our server-set metadata.userId over client_reference_id', async () => {
    m.retrieve.mockResolvedValue(session({ metadata: { userId: 'u_meta' }, client_reference_id: 'u_link' }));
    await send('evt_4');
    expect(m.userUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'u_meta' } }));
  });
  it('handles a replayed event id once', async () => {
    m.retrieve.mockResolvedValue(session());
    await send('evt_dup');
    const r = await send('evt_dup');
    expect(r.body.duplicate).toBe(true);
    expect(m.userUpdate).toHaveBeenCalledTimes(1);
    expect(m.retrieve).toHaveBeenCalledTimes(1);
  });
  it('a failed event is not marked handled, so the retry runs', async () => {
    m.retrieve.mockRejectedValueOnce(new Error('stripe down')).mockResolvedValue(session());
    expect((await send('evt_retry')).status).toBe(500);
    expect((await send('evt_retry')).status).toBe(200);
    expect(m.userUpdate).toHaveBeenCalledTimes(1);
  });
});
