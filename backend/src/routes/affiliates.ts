import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import {
  inviteAffiliate,
  generateOnboardingLink,
  generateDashboardLink,
  checkAndUpdateOnboardingStatus,
  runMonthlyPayouts,
  getAffiliateDashboard,
} from '../services/affiliateService.js';

const router = Router();
const prisma = new PrismaClient();

// ─── Self-service routes (affiliate identified by invite token or email) ───────

// POST /api/affiliate/setup — complete onboarding from invite link
// Body: { token } — matches inviteToken on Affiliate record
router.post('/affiliate/setup', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token is required' });

  try {
    const affiliate = await prisma.affiliate.findUnique({ where: { inviteToken: token } });
    if (!affiliate) return res.status(404).json({ error: 'Invalid or expired invite token' });

    if (affiliate.inviteUsedAt) {
      // Already set up — just return the onboarding link
      const url = await generateOnboardingLink(affiliate.id);
      return res.json({ affiliate: { id: affiliate.id, name: affiliate.name, email: affiliate.email, onboarded: affiliate.onboarded }, onboardingUrl: url });
    }

    await prisma.affiliate.update({
      where: { id: affiliate.id },
      data: { inviteUsedAt: new Date() },
    });

    const url = await generateOnboardingLink(affiliate.id);
    res.json({
      affiliate: { id: affiliate.id, name: affiliate.name, email: affiliate.email, onboarded: affiliate.onboarded },
      onboardingUrl: url,
    });
  } catch (err: any) {
    console.error('[affiliates] setup error:', err);
    res.status(500).json({ error: err?.message || 'Setup failed' });
  }
});

// GET /api/affiliate/me?email=... — get affiliate by email (used by dashboard page)
router.get('/affiliate/me', async (req, res) => {
  const email = (req.query.email as string)?.toLowerCase().trim();
  if (!email) return res.status(400).json({ error: 'email query param is required' });

  try {
    const affiliate = await prisma.affiliate.findUnique({ where: { email } });
    if (!affiliate) return res.status(404).json({ error: 'Affiliate not found' });

    // Refresh onboarding status from Stripe
    await checkAndUpdateOnboardingStatus(affiliate.id);

    const dashboard = await getAffiliateDashboard(affiliate.id);
    res.json(dashboard);
  } catch (err: any) {
    console.error('[affiliates] me error:', err);
    res.status(500).json({ error: err?.message || 'Failed to fetch affiliate data' });
  }
});

// POST /api/affiliate/onboard — get/refresh Stripe Connect onboarding link
router.post('/affiliate/onboard', async (req, res) => {
  const { affiliateId } = req.body;
  if (!affiliateId) return res.status(400).json({ error: 'affiliateId is required' });

  try {
    const url = await generateOnboardingLink(affiliateId);
    res.json({ url });
  } catch (err: any) {
    console.error('[affiliates] onboard error:', err);
    res.status(500).json({ error: err?.message || 'Failed to generate onboarding link' });
  }
});

// GET /api/affiliate/dashboard-url?affiliateId=... — Stripe Express login link
router.get('/affiliate/dashboard-url', async (req, res) => {
  const affiliateId = req.query.affiliateId as string;
  if (!affiliateId) return res.status(400).json({ error: 'affiliateId is required' });

  try {
    await checkAndUpdateOnboardingStatus(affiliateId);
    const url = await generateDashboardLink(affiliateId);
    res.json({ url });
  } catch (err: any) {
    console.error('[affiliates] dashboard-url error:', err);
    res.status(500).json({ error: err?.message || 'Failed to generate dashboard link' });
  }
});

// POST /api/affiliate/onboarding-complete — poll after Stripe Connect return
router.post('/affiliate/onboarding-complete', async (req, res) => {
  const { affiliateId } = req.body;
  if (!affiliateId) return res.status(400).json({ error: 'affiliateId is required' });

  try {
    const ready = await checkAndUpdateOnboardingStatus(affiliateId);
    res.json({ onboarded: ready });
  } catch (err: any) {
    console.error('[affiliates] onboarding-complete error:', err);
    res.status(500).json({ error: err?.message || 'Failed to check onboarding status' });
  }
});

// ─── Admin routes ─────────────────────────────────────────────────────────────

// POST /api/affiliates/invite — create affiliate and return setup link
router.post('/affiliates/invite', requireAuth, requireAdmin, async (req, res) => {
  const { name, email, referralCode } = req.body;
  if (!name || !email || !referralCode) {
    return res.status(400).json({ error: 'name, email, and referralCode are required' });
  }

  try {
    const { affiliate, setupLink } = await inviteAffiliate(name, email, referralCode);
    res.status(201).json({ affiliate, setupLink });
  } catch (err: any) {
    if (err?.code === 'P2002') return res.status(409).json({ error: 'Email or referral code already exists' });
    console.error('[affiliates] invite error:', err);
    res.status(500).json({ error: err?.message || 'Failed to create affiliate' });
  }
});

// GET /api/affiliates — list all affiliates with commission summary
router.get('/affiliates', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const affiliates = await prisma.affiliate.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        commissions: { select: { commissionCents: true, status: true } },
        payouts: { select: { totalCents: true, status: true, createdAt: true } },
      },
    });

    const result = affiliates.map(a => ({
      id: a.id,
      name: a.name,
      email: a.email,
      referralCode: a.referralCode,
      stripeAccountId: a.stripeAccountId,
      onboarded: a.onboarded,
      active: a.active,
      commissionRate: a.commissionRate,
      discountRate: a.discountRate,
      createdAt: a.createdAt,
      pendingCents: a.commissions.filter(c => c.status === 'pending').reduce((s, c) => s + c.commissionCents, 0),
      paidCents: a.commissions.filter(c => c.status === 'paid').reduce((s, c) => s + c.commissionCents, 0),
      totalCommissions: a.commissions.length,
      payoutCount: a.payouts.filter(p => p.status === 'completed').length,
    }));

    res.json(result);
  } catch (err) {
    console.error('[affiliates] list error:', err);
    res.status(500).json({ error: 'Failed to fetch affiliates' });
  }
});

// GET /api/affiliates/summary — global stats for admin header
router.get('/affiliates/summary', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const [affiliateCount, pendingAgg, paidAgg] = await Promise.all([
      prisma.affiliate.count({ where: { active: true } }),
      prisma.affiliateCommission.aggregate({ where: { status: 'pending' }, _sum: { commissionCents: true } }),
      prisma.affiliateCommission.aggregate({ where: { status: 'paid' }, _sum: { commissionCents: true } }),
    ]);

    res.json({
      activeAffiliates: affiliateCount,
      pendingCents: pendingAgg._sum.commissionCents ?? 0,
      paidCents: paidAgg._sum.commissionCents ?? 0,
    });
  } catch (err) {
    console.error('[affiliates] summary error:', err);
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

// POST /api/affiliates/:id/onboard — admin: generate onboarding link for a specific affiliate
router.post('/affiliates/:id/onboard', requireAuth, requireAdmin, async (req, res) => {
  try {
    const url = await generateOnboardingLink(req.params.id);
    res.json({ url });
  } catch (err: any) {
    console.error('[affiliates] admin onboard error:', err);
    res.status(500).json({ error: err?.message || 'Failed to generate onboarding link' });
  }
});

// PATCH /api/affiliates/:id — update name, active status, commission/discount rates
router.patch('/affiliates/:id', requireAuth, requireAdmin, async (req, res) => {
  const { name, active, commissionRate, discountRate, referralCode } = req.body;
  try {
    const affiliate = await prisma.affiliate.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(active !== undefined && { active }),
        ...(commissionRate !== undefined && { commissionRate }),
        ...(discountRate !== undefined && { discountRate }),
        ...(referralCode !== undefined && { referralCode: referralCode.toUpperCase().trim() }),
      },
    });
    res.json(affiliate);
  } catch (err: any) {
    if (err?.code === 'P2025') return res.status(404).json({ error: 'Affiliate not found' });
    console.error('[affiliates] patch error:', err);
    res.status(500).json({ error: 'Failed to update affiliate' });
  }
});

// DELETE /api/affiliates/:id
router.delete('/affiliates/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await prisma.affiliate.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err: any) {
    if (err?.code === 'P2025') return res.status(404).json({ error: 'Affiliate not found' });
    console.error('[affiliates] delete error:', err);
    res.status(500).json({ error: 'Failed to delete affiliate' });
  }
});

// GET /api/affiliates/:id/payouts — payout history for one affiliate
router.get('/affiliates/:id/payouts', requireAuth, requireAdmin, async (req, res) => {
  try {
    const payouts = await prisma.affiliatePayout.findMany({
      where: { affiliateId: req.params.id },
      orderBy: { createdAt: 'desc' },
      include: { commissions: { select: { id: true, commissionCents: true, stripeInvoiceId: true } } },
    });
    res.json(payouts);
  } catch (err) {
    console.error('[affiliates] payouts error:', err);
    res.status(500).json({ error: 'Failed to fetch payouts' });
  }
});

// POST /api/affiliates/payouts/run — trigger monthly payout batch (admin only)
router.post('/affiliates/payouts/run', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const result = await runMonthlyPayouts();
    res.json(result);
  } catch (err: any) {
    console.error('[affiliates] payout run error:', err);
    res.status(500).json({ error: err?.message || 'Payout run failed' });
  }
});

export default router;
