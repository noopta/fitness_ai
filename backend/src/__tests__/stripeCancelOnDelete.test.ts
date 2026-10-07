// Deleting an account must stop Stripe billing: every live subscription is cancelled,
// finished ones are left alone, and the period end is read for the confirm screen.
import { describe, it, expect, vi } from 'vitest';

// The Stripe module builds its client at import; these tests pass their own fake client.
vi.hoisted(() => { process.env.STRIPE_SECRET_KEY ||= 'sk_test_dummy'; });
import { cancelActiveSubscriptions, liveSubscriptionEnd } from '../services/stripeService.js';

const client = (subs: any[]) => ({
  subscriptions: {
    list: vi.fn(async () => ({ data: subs })),
    cancel: vi.fn(async (id: string) => ({ id, status: 'canceled' })),
  },
}) as any;

describe('cancelActiveSubscriptions', () => {
  it('cancels every live subscription and skips finished ones', async () => {
    const c = client([
      { id: 'sub_a', status: 'active' },
      { id: 'sub_b', status: 'past_due' },
      { id: 'sub_c', status: 'canceled' },
      { id: 'sub_d', status: 'incomplete_expired' },
    ]);
    expect(await cancelActiveSubscriptions('cus_1', c)).toBe(2);
    expect(c.subscriptions.cancel.mock.calls.map((x: any[]) => x[0])).toEqual(['sub_a', 'sub_b']);
    expect(c.subscriptions.list).toHaveBeenCalledWith({ customer: 'cus_1', status: 'all', limit: 20 });
  });

  it('cancels nothing when there is nothing live', async () => {
    const c = client([{ id: 'sub_c', status: 'canceled' }]);
    expect(await cancelActiveSubscriptions('cus_1', c)).toBe(0);
    expect(c.subscriptions.cancel).not.toHaveBeenCalled();
  });

  it('lets a Stripe failure through, so the delete is refused rather than half-done', async () => {
    const c = client([{ id: 'sub_a', status: 'active' }]);
    c.subscriptions.cancel.mockRejectedValueOnce(new Error('stripe down'));
    await expect(cancelActiveSubscriptions('cus_1', c)).rejects.toThrow('stripe down');
  });
});

describe('liveSubscriptionEnd', () => {
  it('reads the period end from the subscription or, on newer API versions, its item', async () => {
    expect(await liveSubscriptionEnd('cus_1', client([{ id: 's', status: 'active', current_period_end: 1791072000 }]))).toBe('2026-10-04');
    expect(await liveSubscriptionEnd('cus_1', client([{ id: 's', status: 'trialing', items: { data: [{ current_period_end: 1791072000 }] } }]))).toBe('2026-10-04');
    expect(await liveSubscriptionEnd('cus_1', client([{ id: 's', status: 'canceled', current_period_end: 1791072000 }]))).toBeNull();
  });
});
