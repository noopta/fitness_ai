// Native billing on the trainer's own Stripe account (handoff B7, gap #3).
//
// - Stripe Connect, standard accounts: the trainer is the merchant of record,
//   gets their own Stripe dashboard and payouts, and handles their own
//   refunds and disputes.
// - Direct charges with NO application fee. Axiom's platform fee is 0%; the
//   only fee is Stripe's own processing.
// - Stripe is the source of truth for money. Our rows mirror it from
//   webhooks so the dashboard can show plans, credits and revenue without
//   calling Stripe on every page.
// - Dunning: Stripe retries failed subscription payments (the trainer's
//   Smart Retries settings); we tell the trainer and, if they left the
//   setting on, send the client one reminder with the pay link.

import type Stripe from 'stripe';
import { stripe as defaultStripe } from '../stripeService.js';
import { audit, sendAutomated } from './drafts.js';
import { prisma } from './db.js';
import { notifyLinkClient, portalUrlFor } from './links.js';
import type { BillingStatus, ClientPlanView, OfferView, PaymentView, RevenueSummary } from './types.js';

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://axiomtraining.io';
const DAY_MS = 86_400_000;

export class BillingError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'BillingError';
    this.status = status;
    this.code = code;
  }
}

type StripeLike = Pick<Stripe, 'accounts' | 'accountLinks' | 'products' | 'prices' | 'checkout' | 'subscriptions' | 'billingPortal' | 'customers'>;
let client: StripeLike = defaultStripe;
/** Tests replace the Stripe client; nothing else should. */
export function setStripeClient(c: StripeLike) { client = c; }

export const billingEnabled = () => process.env.PT_BILLING_ENABLED !== '0' && !!process.env.STRIPE_SECRET_KEY;

// ── The trainer's account ────────────────────────────────────────────────────

export async function connectAccount(practiceId: string, trainerId: string): Promise<{ url: string }> {
  if (!billingEnabled()) throw new BillingError('Payments are not set up on this server', 503);
  let row = await prisma.ptStripeAccount.findUnique({ where: { practiceId } });
  if (!row) {
    const trainer = await prisma.user.findUnique({ where: { id: trainerId }, select: { email: true } });
    const account = await client.accounts.create({ type: 'standard', ...(trainer?.email ? { email: trainer.email } : {}), metadata: { practiceId } });
    row = await prisma.ptStripeAccount.create({ data: { practiceId, stripeAccountId: account.id } });
    await audit({ practiceId, trainerId, action: 'billing_connected', itemType: 'billing', itemId: row.id });
  }
  const link = await client.accountLinks.create({
    account: row.stripeAccountId,
    refresh_url: `${FRONTEND_URL}/personal-training/billing?connect=refresh`,
    return_url: `${FRONTEND_URL}/personal-training/billing?connect=done`,
    type: 'account_onboarding',
  });
  return { url: link.url };
}

export async function syncAccount(practiceId: string) {
  const row = await prisma.ptStripeAccount.findUnique({ where: { practiceId } });
  if (!row) return null;
  try {
    const a = await client.accounts.retrieve(row.stripeAccountId);
    return prisma.ptStripeAccount.update({
      where: { id: row.id },
      data: { chargesEnabled: !!a.charges_enabled, payoutsEnabled: !!a.payouts_enabled, detailsSubmitted: !!a.details_submitted, currency: a.default_currency ?? row.currency },
    });
  } catch (err) {
    console.warn('[personal-training] stripe account sync failed', (err as Error)?.message);
    return row;
  }
}

export async function billingStatus(practiceId: string, opts: { refresh?: boolean } = {}): Promise<BillingStatus> {
  const row = opts.refresh ? await syncAccount(practiceId) : await prisma.ptStripeAccount.findUnique({ where: { practiceId } });
  return {
    available: billingEnabled(),
    connected: !!row,
    chargesEnabled: !!row?.chargesEnabled,
    payoutsEnabled: !!row?.payoutsEnabled,
    detailsSubmitted: !!row?.detailsSubmitted,
    currency: row?.currency ?? 'usd',
    dunningNudges: row?.dunningNudges ?? true,
    bookingNeedsCredit: row?.bookingNeedsCredit ?? false,
    platformFeePercent: 0,
  };
}

export async function saveBillingSettings(practiceId: string, trainerId: string, body: Record<string, unknown>) {
  const row = await prisma.ptStripeAccount.findUnique({ where: { practiceId } });
  if (!row) throw new BillingError('Connect Stripe first', 409, 'not_connected');
  const data: Record<string, boolean> = {};
  for (const k of ['dunningNudges', 'bookingNeedsCredit'] as const) if (typeof body[k] === 'boolean') data[k] = body[k] as boolean;
  await prisma.ptStripeAccount.update({ where: { id: row.id }, data });
  await audit({ practiceId, trainerId, action: 'billing_settings', itemType: 'billing', itemId: row.id, meta: data });
  return billingStatus(practiceId);
}

async function readyAccount(practiceId: string) {
  if (!billingEnabled()) throw new BillingError('Payments are not set up on this server', 503);
  const row = await prisma.ptStripeAccount.findUnique({ where: { practiceId } });
  if (!row) throw new BillingError('Connect Stripe first', 409, 'not_connected');
  if (!row.chargesEnabled) {
    const fresh = await syncAccount(practiceId);
    if (!fresh?.chargesEnabled) throw new BillingError('Finish setting up your Stripe account before taking payments', 409, 'not_ready');
    return fresh;
  }
  return row;
}

// ── Offers ───────────────────────────────────────────────────────────────────

type OfferRow = Awaited<ReturnType<typeof prisma.ptOffer.findMany>>[number];
export const offerView = (o: OfferRow): OfferView => ({
  id: o.id, name: o.name, description: o.description ?? '', kind: o.kind as OfferView['kind'], priceCents: o.priceCents, currency: o.currency,
  interval: (o.interval as OfferView['interval']) ?? null, intervalCount: o.intervalCount, sessionCredits: o.sessionCredits, active: o.active,
});

export async function listOffers(practiceId: string, opts: { activeOnly?: boolean } = {}) {
  return (await prisma.ptOffer.findMany({ where: { practiceId, ...(opts.activeOnly ? { active: true } : {}) }, orderBy: { createdAt: 'asc' } })).map(offerView);
}

export async function createOffer(practiceId: string, trainerId: string, body: Record<string, unknown>): Promise<OfferView> {
  const acct = await readyAccount(practiceId);
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
  if (name.length < 2) throw new BillingError('Name the offer', 400);
  const kind = body.kind;
  if (kind !== 'subscription' && kind !== 'package' && kind !== 'one_time') throw new BillingError('kind must be subscription, package or one_time', 400);
  const priceCents = Number(body.priceCents);
  if (!Number.isInteger(priceCents) || priceCents < 100 || priceCents > 5_000_000) throw new BillingError('Price must be between 1 and 50,000', 400);
  const interval = kind === 'subscription' ? body.interval : null;
  if (kind === 'subscription' && !['week', 'month', 'year'].includes(interval as string)) throw new BillingError('A subscription needs week, month or year', 400);
  const intervalCount = kind === 'subscription' ? Math.max(1, Math.min(12, Number(body.intervalCount) || 1)) : 1;
  const credits = body.sessionCredits === undefined || body.sessionCredits === null || body.sessionCredits === '' ? null : Number(body.sessionCredits);
  if (credits !== null && (!Number.isInteger(credits) || credits < 1 || credits > 500)) throw new BillingError('Sessions must be 1 to 500', 400);
  if (kind === 'package' && credits === null) throw new BillingError('A package needs a number of sessions', 400);
  const description = typeof body.description === 'string' ? body.description.trim().slice(0, 500) || null : null;

  const product = await client.products.create({ name, ...(description ? { description } : {}), metadata: { practiceId } }, { stripeAccount: acct.stripeAccountId });
  const price = await client.prices.create({
    product: product.id, unit_amount: priceCents, currency: acct.currency,
    ...(kind === 'subscription' ? { recurring: { interval: interval as 'week' | 'month' | 'year', interval_count: intervalCount } } : {}),
  }, { stripeAccount: acct.stripeAccountId });
  const row = await prisma.ptOffer.create({
    data: { practiceId, name, description, kind, priceCents, currency: acct.currency, interval: interval as string | null, intervalCount, sessionCredits: credits, stripeProductId: product.id, stripePriceId: price.id },
  });
  await audit({ practiceId, trainerId, action: 'offer_created', itemType: 'offer', itemId: row.id, meta: { kind, priceCents } });
  return offerView(row);
}

/** Retire an offer: existing subscribers keep it; nobody new can buy it. Prices are immutable in Stripe, so changing price is a new offer. */
export async function archiveOffer(practiceId: string, trainerId: string, id: string) {
  const row = await prisma.ptOffer.findUnique({ where: { id } });
  if (!row || row.practiceId !== practiceId) throw new BillingError('Offer not found', 404);
  await prisma.ptOffer.update({ where: { id }, data: { active: false } });
  await audit({ practiceId, trainerId, action: 'offer_archived', itemType: 'offer', itemId: id });
}

// ── Checkout ─────────────────────────────────────────────────────────────────

/** A Stripe Checkout page for a client to buy an offer, on the trainer's account. */
export async function startCheckout(practiceId: string, clientId: string, offerId: unknown): Promise<{ url: string }> {
  const acct = await readyAccount(practiceId);
  const offer = typeof offerId === 'string' ? await prisma.ptOffer.findUnique({ where: { id: offerId } }) : null;
  if (!offer || offer.practiceId !== practiceId || !offer.active || !offer.stripePriceId) throw new BillingError('That offer is not available', 404);
  const [profile, user] = await Promise.all([
    prisma.ptClientProfile.findUnique({ where: { practiceId_clientId: { practiceId, clientId } }, select: { contactEmail: true } }),
    prisma.user.findUnique({ where: { id: clientId }, select: { email: true } }),
  ]);
  const back = (await portalUrlFor(practiceId, clientId, '?tab=billing')) ?? `${FRONTEND_URL}`;
  const metadata = { practiceId, clientId, offerId: offer.id };
  const email = profile?.contactEmail ?? user?.email ?? undefined;
  const session = await client.checkout.sessions.create({
    mode: offer.kind === 'subscription' ? 'subscription' : 'payment',
    line_items: [{ price: offer.stripePriceId, quantity: 1 }],
    client_reference_id: clientId,
    metadata,
    ...(offer.kind === 'subscription' ? { subscription_data: { metadata } } : { payment_intent_data: { metadata } }),
    ...(email ? { customer_email: email } : {}),
    success_url: `${back}${back.includes('?') ? '&' : '?'}paid=1`,
    cancel_url: back,
  }, { stripeAccount: acct.stripeAccountId });
  await prisma.ptClientPlan.create({ data: { practiceId, clientId, offerId: offer.id, status: 'pending', stripeCheckoutId: session.id } });
  if (!session.url) throw new BillingError('Stripe did not return a payment page', 502);
  return { url: session.url };
}

/** Stripe's customer portal (update card, cancel), for a client with a live plan. */
export async function customerPortal(practiceId: string, clientId: string): Promise<{ url: string }> {
  const acct = await readyAccount(practiceId);
  const plan = await prisma.ptClientPlan.findFirst({ where: { practiceId, clientId, stripeCustomerId: { not: null } }, orderBy: { createdAt: 'desc' } });
  if (!plan?.stripeCustomerId) throw new BillingError('Nothing to manage yet', 404);
  const back = (await portalUrlFor(practiceId, clientId, '?tab=billing')) ?? FRONTEND_URL;
  const s = await client.billingPortal.sessions.create({ customer: plan.stripeCustomerId, return_url: back }, { stripeAccount: acct.stripeAccountId });
  return { url: s.url };
}

// ── Webhooks (Connect events carry `account`) ────────────────────────────────

async function practiceForAccount(accountId: string | undefined) {
  if (!accountId) return null;
  return prisma.ptStripeAccount.findUnique({ where: { stripeAccountId: accountId } });
}

const coachOf = async (practiceId: string) =>
  (await prisma.institutionMember.findFirst({ where: { institutionId: practiceId, role: 'coach', active: true }, orderBy: { joinedAt: 'asc' }, select: { userId: true } }))?.userId ?? null;

/** Idempotent: every handler upserts by Stripe id, so a redelivered event changes nothing. */
export async function handleConnectEvent(event: { id: string; type: string; account?: string; data: { object: any } }, now: Date = new Date()): Promise<string> {
  const acct = await practiceForAccount(event.account);
  if (!acct) return 'ignored: unknown account';
  const practiceId = acct.practiceId;
  const o = event.data.object;

  if (event.type === 'account.updated') {
    await prisma.ptStripeAccount.update({ where: { id: acct.id }, data: { chargesEnabled: !!o.charges_enabled, payoutsEnabled: !!o.payouts_enabled, detailsSubmitted: !!o.details_submitted } });
    return 'account';
  }

  if (event.type === 'checkout.session.completed') {
    const plan = await prisma.ptClientPlan.findUnique({ where: { stripeCheckoutId: o.id } });
    if (!plan || plan.practiceId !== practiceId) return 'ignored: unknown checkout';
    const offer = await prisma.ptOffer.findUnique({ where: { id: plan.offerId } });
    const paid = o.payment_status === 'paid' || o.payment_status === 'no_payment_required';
    await prisma.ptClientPlan.update({
      where: { id: plan.id },
      data: {
        status: paid ? 'active' : 'pending',
        stripeCustomerId: typeof o.customer === 'string' ? o.customer : plan.stripeCustomerId,
        ...(typeof o.subscription === 'string' ? { stripeSubscriptionId: o.subscription } : {}),
        // A package grants its credits once; a subscription grants them per period (on invoice.paid).
        ...(paid && plan.status === 'pending' && offer?.kind !== 'subscription' && offer?.sessionCredits ? { creditsTotal: offer.sessionCredits } : {}),
      },
    });
    if (offer?.kind !== 'subscription' && paid) {
      await prisma.ptPayment.upsert({
        where: { stripeId: o.id },
        update: { status: 'paid', amountPaidCents: o.amount_total ?? 0, paidAt: now },
        create: { practiceId, clientId: plan.clientId, planId: plan.id, kind: 'checkout', stripeId: o.id, amountDueCents: o.amount_total ?? 0, amountPaidCents: o.amount_total ?? 0, currency: o.currency ?? acct.currency, status: 'paid', paidAt: now },
      });
    }
    const coach = await coachOf(practiceId);
    if (coach) await audit({ practiceId, trainerId: coach, clientId: plan.clientId, action: 'plan_purchased', itemType: 'plan', itemId: plan.id, meta: { offerId: plan.offerId, paid } });
    return 'checkout';
  }

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const plan = await prisma.ptClientPlan.findUnique({ where: { stripeSubscriptionId: o.id } });
    if (!plan) return 'ignored: unknown subscription';
    const status = event.type === 'customer.subscription.deleted' || o.status === 'canceled' ? 'canceled'
      : o.status === 'past_due' || o.status === 'unpaid' ? 'past_due' : o.status === 'active' || o.status === 'trialing' ? 'active' : plan.status;
    const end = o.current_period_end ?? o.items?.data?.[0]?.current_period_end;
    await prisma.ptClientPlan.update({ where: { id: plan.id }, data: { status, ...(end ? { currentPeriodEnd: new Date(end * 1000) } : {}), ...(status === 'canceled' && !plan.canceledAt ? { canceledAt: now } : {}) } });
    return 'subscription';
  }

  if (event.type.startsWith('invoice.')) {
    const subId = typeof o.subscription === 'string' ? o.subscription : o.parent?.subscription_details?.subscription ?? null;
    const plan = subId ? await prisma.ptClientPlan.findUnique({ where: { stripeSubscriptionId: subId } }) : null;
    const status = event.type === 'invoice.paid' ? 'paid' : event.type === 'invoice.payment_failed' ? 'failed'
      : event.type === 'invoice.voided' ? 'void' : event.type === 'invoice.marked_uncollectible' ? 'uncollectible' : 'open';
    const before = await prisma.ptPayment.findUnique({ where: { stripeId: o.id } });
    const payment = await prisma.ptPayment.upsert({
      where: { stripeId: o.id },
      update: {
        status, amountPaidCents: o.amount_paid ?? 0, attemptCount: o.attempt_count ?? 0, hostedUrl: o.hosted_invoice_url ?? null,
        nextAttemptAt: o.next_payment_attempt ? new Date(o.next_payment_attempt * 1000) : null, ...(status === 'paid' ? { paidAt: now } : {}),
      },
      create: {
        practiceId, clientId: plan?.clientId ?? null, planId: plan?.id ?? null, kind: 'invoice', stripeId: o.id, amountDueCents: o.amount_due ?? 0,
        amountPaidCents: o.amount_paid ?? 0, currency: o.currency ?? acct.currency, status, attemptCount: o.attempt_count ?? 0, hostedUrl: o.hosted_invoice_url ?? null,
        nextAttemptAt: o.next_payment_attempt ? new Date(o.next_payment_attempt * 1000) : null, ...(status === 'paid' ? { paidAt: now } : {}),
      },
    });
    if (plan && status === 'paid' && before?.status !== 'paid') {
      const offer = await prisma.ptOffer.findUnique({ where: { id: plan.offerId } });
      // Each paid period grants that period's sessions.
      await prisma.ptClientPlan.update({ where: { id: plan.id }, data: { status: 'active', ...(offer?.sessionCredits ? { creditsTotal: { increment: offer.sessionCredits } } : {}) } });
    }
    if (plan && status === 'failed' && before?.status !== 'failed') await onPaymentFailed(practiceId, acct.dunningNudges, plan.clientId, payment.id, o.hosted_invoice_url ?? null, now);
    return 'invoice';
  }
  return 'ignored';
}

/** Tell the trainer, and (if they left it on) remind the client once with the link to pay. */
async function onPaymentFailed(practiceId: string, nudge: boolean, clientId: string, paymentId: string, payUrl: string | null, now: Date) {
  const coach = await coachOf(practiceId);
  if (!coach) return;
  await audit({ practiceId, trainerId: coach, clientId, action: 'payment_failed', itemType: 'payment', itemId: paymentId });
  const user = await prisma.user.findUnique({ where: { id: clientId }, select: { name: true } });
  await prisma.ptNotification.upsert({
    where: { trainerId_sourceKey: { trainerId: coach, sourceKey: `payment_failed:${paymentId}` } },
    update: {},
    create: { practiceId, trainerId: coach, clientId, eventType: 'paymentFailed', tier: 'immediate', title: `${user?.name ?? 'A client'}'s payment failed`, body: 'Stripe will retry it. You can see it under Billing.', sourceKey: `payment_failed:${paymentId}`, at: now },
  }).catch(() => {});
  if (!nudge || !payUrl) return;
  const claimed = await prisma.ptPayment.updateMany({ where: { id: paymentId, nudgedAt: null }, data: { nudgedAt: now } });
  if (claimed.count !== 1) return;
  await sendAutomated({ practiceId, trainerId: coach, clientId, action: 'payment_reminder', itemId: paymentId, body: `Your last payment didn't go through. You can update your card and pay here: ${payUrl}` });
  await notifyLinkClient(practiceId, clientId, { subject: "Your payment didn't go through", preview: 'Your last payment did not go through. Open your page to update your card.', path: '?tab=billing' });
}

// ── Reading ──────────────────────────────────────────────────────────────────

type PlanRow = Awaited<ReturnType<typeof prisma.ptClientPlan.findMany>>[number];
export function planView(p: PlanRow, offers: Map<string, OfferRow>): ClientPlanView {
  const o = offers.get(p.offerId);
  return {
    id: p.id, clientId: p.clientId, offer: o ? offerView(o) : null, status: p.status as ClientPlanView['status'],
    creditsTotal: p.creditsTotal, creditsUsed: p.creditsUsed, creditsLeft: Math.max(0, p.creditsTotal - p.creditsUsed),
    ...(p.currentPeriodEnd ? { currentPeriodEnd: p.currentPeriodEnd.toISOString() } : {}), createdAt: p.createdAt.toISOString(),
  };
}

type PayRow = Awaited<ReturnType<typeof prisma.ptPayment.findMany>>[number];
export const paymentView = (p: PayRow): PaymentView => ({
  id: p.id, clientId: p.clientId, kind: p.kind as PaymentView['kind'], amountDueCents: p.amountDueCents, amountPaidCents: p.amountPaidCents, currency: p.currency,
  status: p.status as PaymentView['status'], attemptCount: p.attemptCount, ...(p.nextAttemptAt ? { nextAttemptAt: p.nextAttemptAt.toISOString() } : {}),
  ...(p.paidAt ? { paidAt: p.paidAt.toISOString() } : {}), ...(p.hostedUrl ? { hostedUrl: p.hostedUrl } : {}), createdAt: p.createdAt.toISOString(),
});

export async function clientBilling(practiceId: string, clientId: string) {
  const [plans, payments, offers] = await Promise.all([
    prisma.ptClientPlan.findMany({ where: { practiceId, clientId, status: { not: 'pending' } }, orderBy: { createdAt: 'desc' } }),
    prisma.ptPayment.findMany({ where: { practiceId, clientId }, orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.ptOffer.findMany({ where: { practiceId } }),
  ]);
  const byId = new Map(offers.map((o) => [o.id, o]));
  return { plans: plans.map((p) => planView(p, byId)), payments: payments.map(paymentView) };
}

/** Monthly value of a recurring price. */
export function monthlyCents(o: Pick<OfferRow, 'priceCents' | 'interval' | 'intervalCount'>): number {
  const n = Math.max(1, o.intervalCount);
  if (o.interval === 'week') return Math.round((o.priceCents * 52) / 12 / n);
  if (o.interval === 'year') return Math.round(o.priceCents / 12 / n);
  return Math.round(o.priceCents / n);
}

export async function revenue(practiceId: string, now: Date = new Date()): Promise<RevenueSummary> {
  const since30 = new Date(now.getTime() - 30 * DAY_MS);
  const [plans, offers, payments, acct] = await Promise.all([
    prisma.ptClientPlan.findMany({ where: { practiceId } }),
    prisma.ptOffer.findMany({ where: { practiceId } }),
    prisma.ptPayment.findMany({ where: { practiceId }, orderBy: { createdAt: 'desc' }, take: 500 }),
    prisma.ptStripeAccount.findUnique({ where: { practiceId } }),
  ]);
  const byId = new Map(offers.map((o) => [o.id, o]));
  const live = plans.filter((p) => (p.status === 'active' || p.status === 'past_due') && byId.get(p.offerId)?.kind === 'subscription');
  const mrr = live.reduce((s, p) => s + monthlyCents(byId.get(p.offerId)!), 0);
  const collected30 = payments.filter((p) => p.status === 'paid' && p.paidAt && p.paidAt >= since30).reduce((s, p) => s + p.amountPaidCents, 0);
  const failing = payments.filter((p) => p.status === 'failed');
  const churned30 = plans.filter((p) => p.canceledAt && p.canceledAt >= since30).length;
  const perOffer = offers.map((o) => ({
    offerId: o.id, name: o.name,
    active: plans.filter((p) => p.offerId === o.id && (p.status === 'active' || p.status === 'past_due')).length,
    sold30: plans.filter((p) => p.offerId === o.id && p.status !== 'pending' && p.createdAt >= since30).length,
  }));
  return {
    currency: acct?.currency ?? 'usd',
    mrrCents: mrr,
    collected30Cents: collected30,
    activeSubscriptions: live.filter((p) => p.status === 'active').length,
    pastDue: live.filter((p) => p.status === 'past_due').length,
    failingCents: failing.reduce((s, p) => s + p.amountDueCents - p.amountPaidCents, 0),
    churned30,
    // Churn: subscriptions that ended in 30 days over those live at the start of the window.
    churnRate30: (() => {
      const atStart = plans.filter((p) => byId.get(p.offerId)?.kind === 'subscription' && p.createdAt < since30 && (!p.canceledAt || p.canceledAt >= since30)).length;
      return atStart ? Math.round((churned30 / atStart) * 1000) / 10 : null;
    })(),
    perOffer,
    recent: payments.slice(0, 20).map(paymentView),
    platformFeePercent: 0,
  };
}

// ── Session credits ──────────────────────────────────────────────────────────

/** Take one session credit from the client's plan with the earliest-expiring remaining credit. */
export async function consumeCredit(practiceId: string, clientId: string): Promise<string | null> {
  const plans = await prisma.ptClientPlan.findMany({ where: { practiceId, clientId, status: { in: ['active', 'past_due'] } }, orderBy: { createdAt: 'asc' } });
  for (const p of plans) {
    if (p.creditsUsed >= p.creditsTotal) continue;
    const claimed = await prisma.ptClientPlan.updateMany({ where: { id: p.id, creditsUsed: p.creditsUsed }, data: { creditsUsed: { increment: 1 } } });
    if (claimed.count === 1) return p.id;
  }
  return null;
}

export async function refundCredit(planId: string) {
  await prisma.ptClientPlan.updateMany({ where: { id: planId, creditsUsed: { gt: 0 } }, data: { creditsUsed: { decrement: 1 } } });
}
