import Stripe from 'stripe';

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2024-04-10' as any
});

const LIVE_STATUSES = ['active', 'trialing', 'past_due', 'unpaid', 'incomplete'];

/**
 * Cancel every live subscription a customer has. Used when they delete their
 * account: the user row goes, but Stripe would keep charging the card — and
 * there'd be no account left to cancel it from.
 */
export async function cancelActiveSubscriptions(customerId: string, client: Pick<Stripe, 'subscriptions'> = stripe): Promise<number> {
  const subs = await client.subscriptions.list({ customer: customerId, status: 'all', limit: 20 });
  let n = 0;
  for (const s of subs.data) {
    if (!LIVE_STATUSES.includes(s.status)) continue;
    await client.subscriptions.cancel(s.id);
    n++;
  }
  return n;
}

/** The current period end (ISO date) of a customer's live subscription, if they have one. */
export async function liveSubscriptionEnd(customerId: string, client: Pick<Stripe, 'subscriptions'> = stripe): Promise<string | null> {
  const subs = await client.subscriptions.list({ customer: customerId, status: 'all', limit: 20 });
  const live = subs.data.find((s) => LIVE_STATUSES.includes(s.status)) as any;
  if (!live) return null;
  const end = live.current_period_end ?? live.items?.data?.[0]?.current_period_end ?? null;
  return end ? new Date(end * 1000).toISOString().slice(0, 10) : null;
}
