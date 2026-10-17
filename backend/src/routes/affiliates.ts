import { Router, type Request, type Response } from 'express';
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
import { listResources, resolveResourceFile } from '../services/affiliateResources.js';
import {
  getTerms, updateTerms, termsUpdateSchema,
  listTrainerReferrals, autoSignupsForCode, createTrainerReferral, updateTrainerReferral, deleteTrainerReferral,
  trainerReferralCreateSchema, trainerReferralUpdateSchema,
  listManualPayouts, createManualPayout, updateManualPayout, deleteManualPayout,
  manualPayoutCreateSchema, manualPayoutUpdateSchema, zodMessage,
} from '../services/affiliateExtras.js';
import { signLink, verifyLink } from '../services/signedLinks.js';
import { createReadStream, statSync } from 'node:fs';
import { codeLookupLimiter } from '../middleware/rateLimiter.js';
import { normaliseReferralCode, REFERRAL_DISCOUNT_PERCENT, REFERRAL_TRIAL_DAYS } from '../services/referralOffer.js';

const router = Router();
const prisma = new PrismaClient();

// ─── Public: referral code check ──────────────────────────────────────────────
// GET /api/affiliate/code/:code/validate — used by the web checkout / register
// "Have a referral code?" field. Case-insensitive. Unknown, malformed or
// unknown codes answer 200 { valid: false } (no 404, so the response shape
// leaks nothing). Only the affiliate's first name is ever returned — never
// email, id or rates. IP rate-limited against enumeration.
router.get('/affiliate/code/:code/validate', codeLookupLimiter, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const code = normaliseReferralCode(req.params.code);
  if (!code) return res.json({ valid: false });
  try {
    const affiliate = await prisma.affiliate.findUnique({
      where: { referralCode: code },
      select: { name: true, active: true },
    });
    // Any real code is valid for the CUSTOMER (matches create-checkout, which
    // applies the discount even while the affiliate's own onboarding is
    // incomplete); commission is gated on affiliate.active separately.
    if (!affiliate) return res.json({ valid: false });
    const affiliateFirstName = String(affiliate.name ?? '').trim().split(/\s+/)[0] || null;
    res.json({ valid: true, code, discountPercent: REFERRAL_DISCOUNT_PERCENT, trialDays: REFERRAL_TRIAL_DAYS, affiliateFirstName });
  } catch (err: any) {
    console.error('[affiliates] code validate failed:', err?.message || err);
    res.status(500).json({ error: 'Could not check that code right now' });
  }
});

// ─── Self-service routes ──────────────────────────────────────────────────────
// Affiliates aren't app users; their invite token IS their credential — the
// setup link doubles as their permanent dashboard link. Every self-service
// route requires it. Never accept a bare email or affiliateId here: email is
// public knowledge, and an affiliateId unlocks a Stripe Express login link.

// The token travels in the X-Affiliate-Token header (preferred) or a POST
// body. `?token=` still works for older web builds, but a credential in a URL
// lands in access logs, browser history and Referer headers, so it is
// deprecated and logged (once, without the value).
let queryTokenDeprecationLogged = false;
export function affiliateTokenFrom(req: Request): string {
  const header = req.get('x-affiliate-token');
  if (typeof header === 'string' && header.trim()) return header.trim();
  const body = (req.body as any)?.token;
  if (typeof body === 'string' && body.trim()) return body.trim();
  const query = req.query?.token;
  if (typeof query === 'string' && query.trim()) {
    if (!queryTokenDeprecationLogged) {
      queryTokenDeprecationLogged = true;
      console.warn(`[affiliates] deprecated: affiliate token sent as ?token= on ${req.path}; send the X-Affiliate-Token header`);
    }
    return query.trim();
  }
  return '';
}

async function affiliateByToken(req: Request) {
  const token = affiliateTokenFrom(req);
  if (!token) return null;
  return prisma.affiliate.findUnique({ where: { inviteToken: token } });
}

// POST /api/affiliate/setup — complete onboarding from invite link
// Body: { token } — matches inviteToken on Affiliate record
router.post('/affiliate/setup', async (req, res) => {
  if (!affiliateTokenFrom(req)) return res.status(400).json({ error: 'token is required' });

  try {
    const affiliate = await affiliateByToken(req);
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
    res.status(500).json({ error: 'Setup failed' });
  }
});

// GET /api/affiliate/me?token=... — the affiliate's own dashboard
router.get('/affiliate/me', async (req, res) => {
  try {
    const affiliate = await affiliateByToken(req);
    if (!affiliate) return res.status(401).json({ error: 'Open your personal affiliate link to view your dashboard.' });

    // Refresh onboarding status from Stripe
    await checkAndUpdateOnboardingStatus(affiliate.id);

    const dashboard = await getAffiliateDashboard(affiliate.id);
    res.json(dashboard);
  } catch (err: any) {
    console.error('[affiliates] me error:', err);
    res.status(500).json({ error: 'Failed to fetch affiliate data' });
  }
});

// POST /api/affiliate/onboard — get/refresh Stripe Connect onboarding link
router.post('/affiliate/onboard', async (req, res) => {
  try {
    const affiliate = await affiliateByToken(req);
    if (!affiliate) return res.status(401).json({ error: 'Open your personal affiliate link to continue.' });
    const url = await generateOnboardingLink(affiliate.id);
    res.json({ url });
  } catch (err: any) {
    console.error('[affiliates] onboard error:', err);
    res.status(500).json({ error: 'Failed to generate onboarding link' });
  }
});

// GET /api/affiliate/dashboard-url?token=... — Stripe Express login link.
// Token-gated: this link is a full login to the affiliate's Stripe account.
router.get('/affiliate/dashboard-url', async (req, res) => {
  try {
    const affiliate = await affiliateByToken(req);
    if (!affiliate) return res.status(401).json({ error: 'Open your personal affiliate link to continue.' });
    await checkAndUpdateOnboardingStatus(affiliate.id);
    const url = await generateDashboardLink(affiliate.id);
    res.json({ url });
  } catch (err: any) {
    console.error('[affiliates] dashboard-url error:', err);
    res.status(500).json({ error: 'Failed to generate dashboard link' });
  }
});

// POST /api/affiliate/onboarding-complete — poll after Stripe Connect return
router.post('/affiliate/onboarding-complete', async (req, res) => {
  try {
    const affiliate = await affiliateByToken(req);
    if (!affiliate) return res.status(401).json({ error: 'Open your personal affiliate link to continue.' });
    const ready = await checkAndUpdateOnboardingStatus(affiliate.id);
    res.json({ onboarded: ready });
  } catch (err: any) {
    console.error('[affiliates] onboarding-complete error:', err);
    res.status(500).json({ error: 'Failed to check onboarding status' });
  }
});

// ─── Enablement resources (outreach guide, playbook) ─────────────────────────
// List + link are token-gated like the rest of the self-service surface and
// need an ACTIVE affiliate. The browser can't send X-Affiliate-Token when it
// opens a PDF in a new tab, and the long-lived token must not go in a URL, so
// /link mints a 10-minute HMAC-signed URL (slug|affiliateId|exp) and /file
// accepts only that signature.
const RESOURCE_LINK_TTL_MS = 10 * 60 * 1000;
const API_PUBLIC_URL = () => (process.env.API_PUBLIC_URL || 'https://api.airthreads.ai:4009/api').replace(/\/+$/, '');

async function activeAffiliateByToken(req: Request, res: Response) {
  const affiliate = await affiliateByToken(req);
  if (!affiliate) {
    res.status(401).json({ error: 'Open your personal affiliate link to continue.' });
    return null;
  }
  if (!affiliate.active) {
    res.status(403).json({ error: 'Resources are available once your affiliate account is active.' });
    return null;
  }
  return affiliate;
}

// GET /api/affiliate/resources — document metadata (no file paths)
router.get('/affiliate/resources', async (req, res) => {
  try {
    const affiliate = await activeAffiliateByToken(req, res);
    if (!affiliate) return;
    res.json({ resources: listResources() });
  } catch (err: any) {
    console.error('[affiliates] resources list error:', err?.message ?? err);
    res.status(500).json({ error: 'Failed to load resources' });
  }
});

// GET /api/affiliate/resources/:slug/link — short-lived signed file URL
router.get('/affiliate/resources/:slug/link', async (req, res) => {
  try {
    const affiliate = await activeAffiliateByToken(req, res);
    if (!affiliate) return;
    const slug = String(req.params.slug);
    if (!resolveResourceFile(slug)) return res.status(404).json({ error: 'Resource not found' });
    const { exp, sig } = signLink(['affiliate-resource', slug, affiliate.id], RESOURCE_LINK_TTL_MS);
    const qs = new URLSearchParams({ aid: affiliate.id, exp: String(exp), sig });
    res.set('Cache-Control', 'private, no-store');
    res.json({
      url: `${API_PUBLIC_URL()}/affiliate/resources/${encodeURIComponent(slug)}/file?${qs.toString()}`,
      expiresAt: new Date(exp).toISOString(),
    });
  } catch (err: any) {
    console.error('[affiliates] resource link error:', err?.message ?? err);
    res.status(500).json({ error: 'Failed to create link' });
  }
});

// GET /api/affiliate/resources/:slug/file?aid=&exp=&sig=[&download=1]
// The signature is the credential — no affiliate token here.
router.get('/affiliate/resources/:slug/file', async (req, res) => {
  try {
    const slug = String(req.params.slug);
    const file = resolveResourceFile(slug);
    if (!file) return res.status(404).json({ error: 'Resource not found' });

    const aid = typeof req.query.aid === 'string' ? req.query.aid : '';
    const exp = typeof req.query.exp === 'string' ? req.query.exp : '';
    const sig = typeof req.query.sig === 'string' ? req.query.sig : '';
    if (!aid || !verifyLink(['affiliate-resource', slug, aid], exp, sig)) {
      return res.status(403).json({ error: 'This link is invalid or has expired. Open it again from your dashboard.' });
    }
    // Deactivated since the link was minted → no file.
    const affiliate = await prisma.affiliate.findUnique({ where: { id: aid } });
    if (!affiliate || !affiliate.active) {
      return res.status(403).json({ error: 'This link is invalid or has expired. Open it again from your dashboard.' });
    }

    const size = statSync(file.absPath).size;
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    res.status(200);
    res.set({
      'Content-Type': file.contentType,
      'Content-Disposition': `${disposition}; filename="${file.fileName.replace(/["\\\r\n]/g, '')}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Length': String(size),
    });
    const stream = createReadStream(file.absPath);
    stream.on('error', err => {
      console.error('[affiliates] resource stream error:', slug, err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Failed to read resource' });
      else res.destroy();
    });
    stream.pipe(res);
  } catch (err: any) {
    console.error('[affiliates] resource file error:', err?.message ?? err);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to read resource' });
  }
});

// ─── Terms, trainer referrals, payouts outside Stripe ────────────────────────
// Read-only for the affiliate (token); written by admins below.

// GET /api/affiliate/terms — personal rates + the published general structure
router.get('/affiliate/terms', async (req, res) => {
  try {
    const affiliate = await affiliateByToken(req);
    if (!affiliate) return res.status(401).json({ error: 'Open your personal affiliate link to continue.' });
    const terms = await getTerms(affiliate.id);
    if (!terms) return res.status(401).json({ error: 'Open your personal affiliate link to continue.' });
    res.set('Cache-Control', 'private, no-store');
    res.json(terms);
  } catch (err: any) {
    console.error('[affiliates] terms error:', err?.message ?? err);
    res.status(500).json({ error: 'Failed to load terms' });
  }
});

// GET /api/affiliate/trainer-referrals — recorded referrals + masked coach
// sign-ups that came through this affiliate's ?ref= link
router.get('/affiliate/trainer-referrals', async (req, res) => {
  try {
    const affiliate = await affiliateByToken(req);
    if (!affiliate) return res.status(401).json({ error: 'Open your personal affiliate link to continue.' });
    const [referrals, autoSignups] = await Promise.all([
      listTrainerReferrals(affiliate.id),
      autoSignupsForCode(affiliate.referralCode),
    ]);
    // The affiliate sees the trainer's name/org/status, not the contact we hold.
    const visible = referrals.map(({ contact: _contact, coachBetaSignupId: _sid, ...r }: any) => r);
    res.set('Cache-Control', 'private, no-store');
    res.json({ referrals: visible, autoSignups });
  } catch (err: any) {
    console.error('[affiliates] trainer-referrals error:', err?.message ?? err);
    res.status(500).json({ error: 'Failed to load trainer referrals' });
  }
});

// GET /api/affiliate/manual-payouts — UGC fees / bonuses paid outside Stripe
router.get('/affiliate/manual-payouts', async (req, res) => {
  try {
    const affiliate = await affiliateByToken(req);
    if (!affiliate) return res.status(401).json({ error: 'Open your personal affiliate link to continue.' });
    res.set('Cache-Control', 'private, no-store');
    res.json(await listManualPayouts(affiliate.id));
  } catch (err: any) {
    console.error('[affiliates] manual-payouts error:', err?.message ?? err);
    res.status(500).json({ error: 'Failed to load payouts' });
  }
});

// ─── Admin routes ─────────────────────────────────────────────────────────────

async function affiliateExists(id: string): Promise<boolean> {
  return !!(await prisma.affiliate.findUnique({ where: { id } }));
}

// GET /api/affiliates/:id/extras — terms + trainer referrals + manual payouts
router.get('/affiliates/:id/extras', requireAuth, requireAdmin, async (req, res) => {
  try {
    const affiliate = await prisma.affiliate.findUnique({ where: { id: req.params.id } });
    if (!affiliate) return res.status(404).json({ error: 'Affiliate not found' });
    const [terms, trainerReferrals, autoSignups, manual] = await Promise.all([
      getTerms(affiliate.id),
      listTrainerReferrals(affiliate.id),
      autoSignupsForCode(affiliate.referralCode),
      listManualPayouts(affiliate.id),
    ]);
    res.json({ ...terms, trainerReferrals, autoSignups, manualPayouts: manual.payouts, manualPayoutTotals: manual.totals });
  } catch (err: any) {
    console.error('[affiliates] extras error:', err?.message ?? err);
    res.status(500).json({ error: 'Failed to load affiliate details' });
  }
});

// PUT /api/affiliates/:id/terms
router.put('/affiliates/:id/terms', requireAuth, requireAdmin, async (req, res) => {
  const parsed = termsUpdateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: zodMessage(parsed.error) });
  try {
    const terms = await updateTerms(req.params.id, parsed.data);
    if (!terms) return res.status(404).json({ error: 'Affiliate not found' });
    res.json(terms);
  } catch (err: any) {
    console.error('[affiliates] terms update error:', err?.message ?? err);
    res.status(500).json({ error: 'Failed to update terms' });
  }
});

// POST /api/affiliates/:id/trainer-referrals
router.post('/affiliates/:id/trainer-referrals', requireAuth, requireAdmin, async (req, res) => {
  const parsed = trainerReferralCreateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: zodMessage(parsed.error) });
  try {
    if (!(await affiliateExists(req.params.id))) return res.status(404).json({ error: 'Affiliate not found' });
    res.status(201).json(await createTrainerReferral(req.params.id, parsed.data));
  } catch (err: any) {
    if (err?.code === 'P2002') return res.status(409).json({ error: 'That coach sign-up is already linked to a referral' });
    console.error('[affiliates] trainer referral create error:', err?.message ?? err);
    res.status(500).json({ error: 'Failed to create trainer referral' });
  }
});

// PUT /api/affiliates/:id/trainer-referrals/:refId
router.put('/affiliates/:id/trainer-referrals/:refId', requireAuth, requireAdmin, async (req, res) => {
  const parsed = trainerReferralUpdateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: zodMessage(parsed.error) });
  try {
    const row = await updateTrainerReferral(req.params.id, req.params.refId, parsed.data);
    if (!row) return res.status(404).json({ error: 'Trainer referral not found' });
    res.json(row);
  } catch (err: any) {
    if (err?.code === 'P2002') return res.status(409).json({ error: 'That coach sign-up is already linked to a referral' });
    console.error('[affiliates] trainer referral update error:', err?.message ?? err);
    res.status(500).json({ error: 'Failed to update trainer referral' });
  }
});

// DELETE /api/affiliates/:id/trainer-referrals/:refId
router.delete('/affiliates/:id/trainer-referrals/:refId', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!(await deleteTrainerReferral(req.params.id, req.params.refId))) return res.status(404).json({ error: 'Trainer referral not found' });
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[affiliates] trainer referral delete error:', err?.message ?? err);
    res.status(500).json({ error: 'Failed to delete trainer referral' });
  }
});

// POST /api/affiliates/:id/manual-payouts
router.post('/affiliates/:id/manual-payouts', requireAuth, requireAdmin, async (req, res) => {
  const parsed = manualPayoutCreateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: zodMessage(parsed.error) });
  try {
    if (!(await affiliateExists(req.params.id))) return res.status(404).json({ error: 'Affiliate not found' });
    res.status(201).json(await createManualPayout(req.params.id, parsed.data));
  } catch (err: any) {
    console.error('[affiliates] manual payout create error:', err?.message ?? err);
    res.status(500).json({ error: 'Failed to create payout' });
  }
});

// PUT /api/affiliates/:id/manual-payouts/:payoutId — { status: 'paid' } marks paid (sets paidAt)
router.put('/affiliates/:id/manual-payouts/:payoutId', requireAuth, requireAdmin, async (req, res) => {
  const parsed = manualPayoutUpdateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: zodMessage(parsed.error) });
  try {
    const row = await updateManualPayout(req.params.id, req.params.payoutId, parsed.data);
    if (!row) return res.status(404).json({ error: 'Payout not found' });
    res.json(row);
  } catch (err: any) {
    console.error('[affiliates] manual payout update error:', err?.message ?? err);
    res.status(500).json({ error: 'Failed to update payout' });
  }
});

// DELETE /api/affiliates/:id/manual-payouts/:payoutId
router.delete('/affiliates/:id/manual-payouts/:payoutId', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!(await deleteManualPayout(req.params.id, req.params.payoutId))) return res.status(404).json({ error: 'Payout not found' });
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[affiliates] manual payout delete error:', err?.message ?? err);
    res.status(500).json({ error: 'Failed to delete payout' });
  }
});


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
    res.status(500).json({ error: 'Failed to generate onboarding link' });
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
