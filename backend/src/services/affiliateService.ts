import { PrismaClient } from '@prisma/client';
import { stripe } from './stripeService.js';
import crypto from 'crypto';

const prisma = new PrismaClient();

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://axiomtraining.io';

// ─── Invite ───────────────────────────────────────────────────────────────────

export async function inviteAffiliate(
  name: string,
  email: string,
  referralCode: string,
): Promise<{ affiliate: any; setupLink: string }> {
  const inviteToken = crypto.randomUUID();

  const affiliate = await prisma.affiliate.create({
    data: {
      name,
      email: email.toLowerCase().trim(),
      referralCode: referralCode.toUpperCase().trim(),
      inviteToken,
      active: false,
      onboarded: false,
    },
  });

  const setupLink = `${FRONTEND_URL}/affiliate/setup?token=${inviteToken}`;
  console.log(`[affiliates] Invited ${email} — code: ${referralCode} — setup: ${setupLink}`);
  return { affiliate, setupLink };
}

// ─── Stripe Connect onboarding ────────────────────────────────────────────────

async function getOrCreateStripeAccount(affiliateId: string): Promise<string> {
  const affiliate = await prisma.affiliate.findUnique({ where: { id: affiliateId } });
  if (!affiliate) throw new Error('Affiliate not found');
  if (affiliate.stripeAccountId) return affiliate.stripeAccountId;

  const account = await stripe.accounts.create({
    type: 'express',
    email: affiliate.email,
    capabilities: { transfers: { requested: true } },
    metadata: { affiliateId },
  });

  await prisma.affiliate.update({
    where: { id: affiliateId },
    data: { stripeAccountId: account.id },
  });

  return account.id;
}

export async function generateOnboardingLink(affiliateId: string): Promise<string> {
  const stripeAccountId = await getOrCreateStripeAccount(affiliateId);

  const link = await stripe.accountLinks.create({
    account: stripeAccountId,
    refresh_url: `${FRONTEND_URL}/affiliate?onboarding=refresh`,
    return_url: `${FRONTEND_URL}/affiliate?onboarding=complete`,
    type: 'account_onboarding',
  });

  return link.url;
}

export async function generateDashboardLink(affiliateId: string): Promise<string> {
  const affiliate = await prisma.affiliate.findUnique({ where: { id: affiliateId } });
  if (!affiliate?.stripeAccountId) throw new Error('Stripe onboarding not yet complete');
  const loginLink = await stripe.accounts.createLoginLink(affiliate.stripeAccountId);
  return loginLink.url;
}

export async function checkAndUpdateOnboardingStatus(affiliateId: string): Promise<boolean> {
  const affiliate = await prisma.affiliate.findUnique({ where: { id: affiliateId } });
  if (!affiliate?.stripeAccountId) return false;

  const account = await stripe.accounts.retrieve(affiliate.stripeAccountId);
  const ready =
    account.details_submitted === true &&
    (account.requirements?.currently_due?.length ?? 0) === 0;

  if (ready && !affiliate.onboarded) {
    await prisma.affiliate.update({
      where: { id: affiliateId },
      data: { onboarded: true, active: true },
    });
    console.log(`[affiliates] ${affiliate.email} onboarding complete — activated`);
  }

  return ready;
}

// ─── Shared 20%-off coupon for all affiliate referrals ────────────────────────

let _couponIdCache: string | null = null;

export async function getOrCreateAffiliateCoupon(): Promise<string> {
  if (_couponIdCache) return _couponIdCache;
  if (process.env.STRIPE_AFFILIATE_COUPON_ID) {
    _couponIdCache = process.env.STRIPE_AFFILIATE_COUPON_ID;
    return _couponIdCache;
  }

  const coupon = await stripe.coupons.create({
    name: 'Axiom Affiliate — 20% Off',
    percent_off: 20,
    duration: 'forever',
    metadata: { purpose: 'affiliate_referral' },
  });

  _couponIdCache = coupon.id;
  console.log(
    `[affiliates] Created coupon ${coupon.id} — add STRIPE_AFFILIATE_COUPON_ID=${coupon.id} to .env to avoid recreating`,
  );
  return coupon.id;
}

// ─── Commission recording (idempotent, called from webhook) ──────────────────

export async function recordCommission(params: {
  affiliateId: string;
  stripeSubscriptionId: string;
  stripeInvoiceId: string;
  stripeCustomerId: string;
  originalAmountCents: number;
}): Promise<void> {
  const { affiliateId, stripeSubscriptionId, stripeInvoiceId, stripeCustomerId, originalAmountCents } = params;

  const existing = await prisma.affiliateCommission.findUnique({ where: { stripeInvoiceId } });
  if (existing) return;

  const affiliate = await prisma.affiliate.findUnique({ where: { id: affiliateId } });
  if (!affiliate?.active) return;

  const commissionCents = Math.round(originalAmountCents * affiliate.commissionRate);

  await prisma.affiliateCommission.create({
    data: {
      affiliateId,
      stripeSubscriptionId,
      stripeInvoiceId,
      stripeCustomerId,
      originalAmountCents,
      commissionCents,
      currency: 'cad',
      status: 'pending',
    },
  });

  console.log(`[affiliates] Commission ${commissionCents}¢ → ${affiliate.email} (invoice ${stripeInvoiceId})`);
}

// ─── Monthly payout runner ────────────────────────────────────────────────────

export async function runMonthlyPayouts(): Promise<{
  affiliatesPaid: number;
  totalCents: number;
  errors: string[];
}> {
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getFullYear(), periodEnd.getMonth(), 1);

  const affiliatesWithPending = await prisma.affiliate.findMany({
    where: {
      active: true,
      onboarded: true,
      stripeAccountId: { not: null },
      commissions: { some: { status: 'pending' } },
    },
    include: { commissions: { where: { status: 'pending' } } },
  });

  let affiliatesPaid = 0;
  let totalCents = 0;
  const errors: string[] = [];

  for (const affiliate of affiliatesWithPending) {
    const pendingCents = affiliate.commissions.reduce((s, c) => s + c.commissionCents, 0);
    if (pendingCents === 0) continue;

    try {
      const payout = await prisma.affiliatePayout.create({
        data: {
          affiliateId: affiliate.id,
          totalCents: pendingCents,
          currency: 'cad',
          periodStart,
          periodEnd,
          status: 'pending',
        },
      });

      await prisma.affiliateCommission.updateMany({
        where: { affiliateId: affiliate.id, status: 'pending' },
        data: { status: 'paid', payoutId: payout.id },
      });

      const transfer = await stripe.transfers.create({
        amount: pendingCents,
        currency: 'cad',
        destination: affiliate.stripeAccountId!,
        description: `Axiom affiliate — ${periodStart.toISOString().slice(0, 7)}`,
        metadata: { affiliateId: affiliate.id, payoutId: payout.id },
      });

      await prisma.affiliatePayout.update({
        where: { id: payout.id },
        data: { stripeTransferId: transfer.id, status: 'completed' },
      });

      affiliatesPaid++;
      totalCents += pendingCents;
      console.log(`[affiliates] Paid ${pendingCents}¢ to ${affiliate.email} (${transfer.id})`);
    } catch (err: any) {
      const msg = `${affiliate.email}: ${err?.message ?? String(err)}`;
      errors.push(msg);
      console.error(`[affiliates] Payout failed for ${affiliate.email}:`, err);
    }
  }

  return { affiliatesPaid, totalCents, errors };
}

// ─── Dashboard data ───────────────────────────────────────────────────────────

export async function getAffiliateDashboard(affiliateId: string) {
  const affiliate = await prisma.affiliate.findUnique({
    where: { id: affiliateId },
    include: {
      commissions: { orderBy: { createdAt: 'desc' }, take: 100 },
      payouts: { orderBy: { createdAt: 'desc' }, take: 24 },
    },
  });

  if (!affiliate) throw new Error('Affiliate not found');

  const pendingCents = affiliate.commissions
    .filter(c => c.status === 'pending')
    .reduce((s, c) => s + c.commissionCents, 0);

  const paidCents = affiliate.commissions
    .filter(c => c.status === 'paid')
    .reduce((s, c) => s + c.commissionCents, 0);

  const activeSubscriptions = new Set(
    affiliate.commissions.filter(c => c.status === 'pending').map(c => c.stripeSubscriptionId),
  ).size;

  return {
    id: affiliate.id,
    name: affiliate.name,
    email: affiliate.email,
    referralCode: affiliate.referralCode,
    referralLink: `${FRONTEND_URL}?ref=${affiliate.referralCode}`,
    active: affiliate.active,
    onboarded: affiliate.onboarded,
    pendingCents,
    paidCents,
    activeSubscriptions,
    commissionRate: affiliate.commissionRate,
    discountRate: affiliate.discountRate,
    recentCommissions: affiliate.commissions.map(c => ({
      id: c.id,
      commissionCents: c.commissionCents,
      originalAmountCents: c.originalAmountCents,
      status: c.status,
      createdAt: c.createdAt.toISOString(),
    })),
    payouts: affiliate.payouts.map(p => ({
      id: p.id,
      totalCents: p.totalCents,
      status: p.status,
      periodStart: p.periodStart.toISOString(),
      periodEnd: p.periodEnd.toISOString(),
      stripeTransferId: p.stripeTransferId,
      createdAt: p.createdAt.toISOString(),
    })),
  };
}
