import { PrismaClient } from '@prisma/client';
import { stripe } from './stripeService.js';

const prisma = new PrismaClient();

// CA$11.99 base price — affiliate cut is always 30% of this regardless of customer discount
const BASE_PRICE_CENTS = 1199;
const AFFILIATE_PCT = 0.30;
export const AFFILIATE_CUT_CENTS = Math.round(BASE_PRICE_CENTS * AFFILIATE_PCT); // 360

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://axiomtraining.io';

// ─── Onboarding ───────────────────────────────────────────────────────────────

export async function onboardAffiliate(affiliateId: string): Promise<string> {
  const affiliate = await prisma.affiliate.findUnique({ where: { id: affiliateId } });
  if (!affiliate) throw new Error('Affiliate not found');

  let accountId = affiliate.stripeAccountId;

  if (!accountId) {
    const account = await stripe.accounts.create({
      type: 'express',
      country: 'CA',
      email: affiliate.email,
      capabilities: { transfers: { requested: true } },
    });
    accountId = account.id;
    await prisma.affiliate.update({
      where: { id: affiliateId },
      data: { stripeAccountId: accountId },
    });
  }

  const link = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${FRONTEND_URL}/admin/affiliates`,
    return_url:  `${FRONTEND_URL}/admin/affiliates`,
    type: 'account_onboarding',
  });

  return link.url;
}

export async function getAffiliateDashboardUrl(affiliateId: string): Promise<string> {
  const affiliate = await prisma.affiliate.findUnique({ where: { id: affiliateId } });
  if (!affiliate?.stripeAccountId) throw new Error('Affiliate has no Stripe account');

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
    await prisma.affiliate.update({ where: { id: affiliateId }, data: { onboarded: true } });
  }

  return ready;
}

// ─── Transfer ─────────────────────────────────────────────────────────────────

interface TransferParams {
  affiliateId: string;
  stripeAccountId: string;
  sourceEventId: string;
}

export async function transferToAffiliate({
  affiliateId,
  stripeAccountId,
  sourceEventId,
}: TransferParams): Promise<void> {
  // Idempotency — never double-pay the same event
  const existing = await prisma.affiliatePayout.findUnique({ where: { sourceEventId } });
  if (existing) {
    console.log(`[affiliates] Skipping duplicate event ${sourceEventId}`);
    return;
  }

  // Verify onboarding complete
  const ready = await checkAndUpdateOnboardingStatus(affiliateId);
  if (!ready) {
    console.warn(`[affiliates] Affiliate ${affiliateId} not fully onboarded — skipping transfer`);
    // Log as pending (no stripeTransferId) so admin can see it
    await prisma.affiliatePayout.create({
      data: {
        affiliateId,
        stripeTransferId: null,
        amountCents: AFFILIATE_CUT_CENTS,
        sourceEventId,
      },
    });
    return;
  }

  const transfer = await stripe.transfers.create({
    amount: AFFILIATE_CUT_CENTS,
    currency: 'cad',
    destination: stripeAccountId,
    transfer_group: sourceEventId,
  });

  await prisma.affiliatePayout.create({
    data: {
      affiliateId,
      stripeTransferId: transfer.id,
      amountCents: AFFILIATE_CUT_CENTS,
      sourceEventId,
    },
  });

  console.log(`[affiliates] Transferred ${AFFILIATE_CUT_CENTS}¢ to affiliate ${affiliateId} (${transfer.id})`);
}
