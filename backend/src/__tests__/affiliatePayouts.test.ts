// Affiliate money math: pre-discount commission basis + the monthly payout
// runner (bundling, idempotency, only active+onboarded affiliates).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = vi.hoisted(() => ({
  affiliates: [] as any[],
  commissions: [] as any[],
  payouts: [] as any[],
  transfers: [] as any[],
  seq: 0,
}));

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(function (this: any) {
    this.affiliate = {
      findUnique: vi.fn(async (a: any) => store.affiliates.find(x => x.id === a.where.id) ?? null),
      findMany: vi.fn(async (a: any) => store.affiliates
        .filter(x => x.active && x.onboarded && x.stripeAccountId)
        .filter(x => store.commissions.some(c => c.affiliateId === x.id && c.status === 'pending'))
        .map(x => ({ ...x, commissions: store.commissions.filter(c => c.affiliateId === x.id && c.status === 'pending') }))),
    };
    this.affiliateCommission = {
      findUnique: vi.fn(async (a: any) => store.commissions.find(c => c.stripeInvoiceId === a.where.stripeInvoiceId) ?? null),
      create: vi.fn(async (a: any) => { const row = { id: 'c' + (++store.seq), ...a.data }; store.commissions.push(row); return row; }),
      updateMany: vi.fn(async (a: any) => {
        let n = 0;
        for (const c of store.commissions) if (c.affiliateId === a.where.affiliateId && c.status === a.where.status) { Object.assign(c, a.data); n++; }
        return { count: n };
      }),
    };
    this.affiliatePayout = {
      create: vi.fn(async (a: any) => { const row = { id: 'po' + (++store.seq), ...a.data }; store.payouts.push(row); return row; }),
      update: vi.fn(async (a: any) => { const r = store.payouts.find(p => p.id === a.where.id); Object.assign(r, a.data); return r; }),
    };
  }),
}));
vi.mock('../services/stripeService.js', () => ({
  stripe: {
    transfers: { create: vi.fn(async (args: any) => { store.transfers.push(args); return { id: 'tr_' + store.transfers.length }; }) },
  },
}));

import { recordCommission, runMonthlyPayouts, renewalCommissionBaseCents } from '../services/affiliateService.js';

beforeEach(() => { store.affiliates = []; store.commissions = []; store.payouts = []; store.transfers = []; store.seq = 0; });

const aff = (over: any = {}) => ({ id: 'a1', email: 'aff@x.com', active: true, onboarded: true, stripeAccountId: 'acct_1', commissionRate: 0.3, ...over });

describe('renewalCommissionBaseCents — affiliates are paid on the PRE-discount price', () => {
  it('uses subtotal (pre-discount) when present', () => {
    expect(renewalCommissionBaseCents({ subtotal: 2999, amount_paid: 2399 })).toBe(2999);
  });
  it('falls back to amount_paid when subtotal is missing or nonsensical', () => {
    expect(renewalCommissionBaseCents({ amount_paid: 2399 })).toBe(2399);
    expect(renewalCommissionBaseCents({ subtotal: 0, amount_paid: 2399 })).toBe(2399);
    expect(renewalCommissionBaseCents({ subtotal: 100, amount_paid: 2399 })).toBe(2399); // credit-note weirdness
  });
});

describe('recordCommission', () => {
  it('records commissionRate × original amount, once per invoice, only for active affiliates', async () => {
    store.affiliates = [aff()];
    const params = { affiliateId: 'a1', stripeSubscriptionId: 'sub_1', stripeInvoiceId: 'in_1', stripeCustomerId: 'cus_1', originalAmountCents: 2999 };
    await recordCommission(params);
    await recordCommission(params); // duplicate invoice → no second row
    expect(store.commissions).toHaveLength(1);
    expect(store.commissions[0].commissionCents).toBe(900); // round(2999 × 0.3)

    store.affiliates = [aff({ id: 'a2', active: false })];
    await recordCommission({ ...params, affiliateId: 'a2', stripeInvoiceId: 'in_2' });
    // Inactive → the attribution row is still written (renewals look it up),
    // but no money accrues.
    expect(store.commissions).toHaveLength(2);
    expect(store.commissions[1].commissionCents).toBe(0);
  });
});

describe('runMonthlyPayouts', () => {
  it('bundles pending commissions into one transfer per affiliate and marks them paid', async () => {
    store.affiliates = [aff()];
    store.commissions = [
      { id: 'c1', affiliateId: 'a1', status: 'pending', commissionCents: 900 },
      { id: 'c2', affiliateId: 'a1', status: 'pending', commissionCents: 900 },
      { id: 'c3', affiliateId: 'a1', status: 'paid', commissionCents: 900 },
    ];
    const r = await runMonthlyPayouts();
    expect(r).toMatchObject({ affiliatesPaid: 1, totalCents: 1800, errors: [] });
    expect(store.transfers).toHaveLength(1);
    expect(store.transfers[0]).toMatchObject({ amount: 1800, destination: 'acct_1' });
    expect(store.commissions.filter(c => c.status === 'pending')).toHaveLength(0);
    expect(store.payouts[0].status).toBe('completed');

    // Idempotent: nothing pending → a second run (cron + admin button same day) moves no money.
    const again = await runMonthlyPayouts();
    expect(again).toMatchObject({ affiliatesPaid: 0, totalCents: 0 });
    expect(store.transfers).toHaveLength(1);
  });
  it('skips affiliates who are inactive or not onboarded', async () => {
    store.affiliates = [aff({ active: false }), aff({ id: 'a2', onboarded: false }), aff({ id: 'a3', stripeAccountId: null })];
    store.commissions = ['a1', 'a2', 'a3'].map((id, i) => ({ id: 'c' + i, affiliateId: id, status: 'pending', commissionCents: 500 }));
    const r = await runMonthlyPayouts();
    expect(r.affiliatesPaid).toBe(0);
    expect(store.transfers).toHaveLength(0);
  });
  it('a failed transfer is reported, other affiliates still get paid', async () => {
    store.affiliates = [aff(), aff({ id: 'a2', email: 'b@x.com', stripeAccountId: 'acct_2' })];
    store.commissions = [
      { id: 'c1', affiliateId: 'a1', status: 'pending', commissionCents: 700 },
      { id: 'c2', affiliateId: 'a2', status: 'pending', commissionCents: 800 },
    ];
    const { stripe } = await import('../services/stripeService.js');
    (stripe.transfers.create as any).mockRejectedValueOnce(new Error('insufficient funds'));
    const r = await runMonthlyPayouts();
    expect(r.affiliatesPaid).toBe(1);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/insufficient funds/);
  });
});
