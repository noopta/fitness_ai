import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import {
  onboardAffiliate,
  getAffiliateDashboardUrl,
  checkAndUpdateOnboardingStatus,
  AFFILIATE_CUT_CENTS,
} from '../services/affiliateService.js';

const router = Router();
const prisma = new PrismaClient();

// All affiliate routes require auth + admin
router.use('/affiliates', requireAuth, requireAdmin);

// GET /api/affiliates — list all affiliates with stats
router.get('/affiliates', async (_req, res) => {
  try {
    const affiliates = await prisma.affiliate.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        payouts: { select: { amountCents: true, stripeTransferId: true, createdAt: true } },
        subscriptions: { select: { subscriptionId: true } },
      },
    });

    const result = affiliates.map(a => ({
      id: a.id,
      name: a.name,
      email: a.email,
      promoCodeId: a.promoCodeId,
      stripeAccountId: a.stripeAccountId,
      onboarded: a.onboarded,
      createdAt: a.createdAt,
      activeSubscriptions: a.subscriptions.length,
      totalPayoutCents: a.payouts.reduce((sum, p) => sum + p.amountCents, 0),
      pendingPayouts: a.payouts.filter(p => !p.stripeTransferId).length,
      payoutCount: a.payouts.filter(p => !!p.stripeTransferId).length,
    }));

    res.json(result);
  } catch (err) {
    console.error('[affiliates] list error:', err);
    res.status(500).json({ error: 'Failed to fetch affiliates' });
  }
});

// POST /api/affiliates — create affiliate
router.post('/affiliates', async (req, res) => {
  const { name, email, promoCodeId } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'name and email are required' });

  try {
    const affiliate = await prisma.affiliate.create({
      data: { name, email: email.toLowerCase().trim(), promoCodeId: promoCodeId || null },
    });
    res.status(201).json(affiliate);
  } catch (err: any) {
    if (err?.code === 'P2002') return res.status(409).json({ error: 'Email or promo code already exists' });
    console.error('[affiliates] create error:', err);
    res.status(500).json({ error: 'Failed to create affiliate' });
  }
});

// PATCH /api/affiliates/:id — update promo code
router.patch('/affiliates/:id', async (req, res) => {
  const { promoCodeId, name } = req.body;
  try {
    const affiliate = await prisma.affiliate.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(promoCodeId !== undefined && { promoCodeId: promoCodeId || null }),
      },
    });
    res.json(affiliate);
  } catch (err: any) {
    if (err?.code === 'P2025') return res.status(404).json({ error: 'Affiliate not found' });
    res.status(500).json({ error: 'Failed to update affiliate' });
  }
});

// DELETE /api/affiliates/:id
router.delete('/affiliates/:id', async (req, res) => {
  try {
    await prisma.affiliate.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err: any) {
    if (err?.code === 'P2025') return res.status(404).json({ error: 'Affiliate not found' });
    res.status(500).json({ error: 'Failed to delete affiliate' });
  }
});

// POST /api/affiliates/:id/onboard — generate Stripe Connect onboarding link
router.post('/affiliates/:id/onboard', async (req, res) => {
  try {
    const url = await onboardAffiliate(req.params.id);
    res.json({ url });
  } catch (err: any) {
    console.error('[affiliates] onboard error:', err);
    res.status(500).json({ error: err?.message || 'Failed to generate onboarding link' });
  }
});

// GET /api/affiliates/:id/dashboard — generate Stripe Express dashboard link
router.get('/affiliates/:id/dashboard', async (req, res) => {
  try {
    // Refresh onboarding status before issuing dashboard link
    await checkAndUpdateOnboardingStatus(req.params.id);
    const url = await getAffiliateDashboardUrl(req.params.id);
    res.json({ url });
  } catch (err: any) {
    console.error('[affiliates] dashboard error:', err);
    res.status(500).json({ error: err?.message || 'Failed to generate dashboard link' });
  }
});

// GET /api/affiliates/:id/payouts — payout history for one affiliate
router.get('/affiliates/:id/payouts', async (req, res) => {
  try {
    const payouts = await prisma.affiliatePayout.findMany({
      where: { affiliateId: req.params.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json(payouts);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch payouts' });
  }
});

// GET /api/affiliates/stats/summary — global stats for dashboard header
router.get('/affiliates/stats/summary', async (_req, res) => {
  try {
    const [affiliateCount, payouts, subs] = await Promise.all([
      prisma.affiliate.count(),
      prisma.affiliatePayout.aggregate({ _sum: { amountCents: true } }),
      prisma.affiliateSubscription.count(),
    ]);
    res.json({
      totalAffiliates: affiliateCount,
      totalPayoutCents: payouts._sum.amountCents ?? 0,
      activeSubscriptions: subs,
      affiliateCutCents: AFFILIATE_CUT_CENTS,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

export default router;
