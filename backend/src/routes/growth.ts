// Growth pipeline routes.
//
//   POST /api/growth/run-now                  — manually trigger today's digest
//   POST /api/growth/recommendation/:id/:action — flip a recommendation
//                                                 (action = approve | park | reject)
//   GET  /api/growth/digests                   — recent digest history
//   GET  /api/growth/recommendations           — outstanding queue
//
// The action endpoint accepts callbacks from Telegram's inline buttons
// (the bridge forwards them) AND can be called directly from a web admin
// console in the future. Auth is by a shared secret header for now —
// these aren't user-scoped endpoints.

import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { runDailyDigest } from '../services/growth/dailyDigestRunner.js';

const router = Router();
const prisma = new PrismaClient();

const GROWTH_AUTH = process.env.GROWTH_API_SECRET || '';

// Shared-secret gate. Set GROWTH_API_SECRET in backend/.env to anything
// hard-to-guess; the Telegram bridge + any admin tooling must pass it as
// X-Growth-Secret header (or ?secret=… for quick curl tests).
function requireGrowthAuth(req: any, res: any, next: any) {
  if (!GROWTH_AUTH) {
    return res.status(503).json({ error: 'GROWTH_API_SECRET not configured' });
  }
  const provided = req.header('x-growth-secret') ?? (typeof req.query.secret === 'string' ? req.query.secret : '');
  if (provided !== GROWTH_AUTH) return res.status(403).json({ error: 'forbidden' });
  next();
}

router.post('/growth/run-now', requireGrowthAuth, async (req, res) => {
  try {
    const force = req.query.force === '1' || req.query.force === 'true';
    const result = await runDailyDigest({ force });
    return res.json(result);
  } catch (err: any) {
    console.error('[growth/run-now] failed:', err?.message ?? err);
    return res.status(500).json({ error: err?.message ?? 'run failed' });
  }
});

router.post('/growth/recommendation/:id/:action', requireGrowthAuth, async (req, res) => {
  const { id, action } = req.params;
  const validActions = new Set(['approve', 'park', 'reject']);
  if (!validActions.has(action)) {
    return res.status(400).json({ error: 'invalid action' });
  }
  const status = action === 'approve' ? 'approved' : action;
  try {
    const updated = await prisma.recommendation.update({
      where: { id },
      data: {
        status,
        approvedAt: action === 'approve' ? new Date() : null,
      },
    });
    return res.json({ ok: true, id: updated.id, status: updated.status });
  } catch (err: any) {
    console.error('[growth/action] failed:', err?.message ?? err);
    return res.status(500).json({ error: err?.message ?? 'update failed' });
  }
});

router.get('/growth/digests', requireGrowthAuth, async (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? '14'), 10) || 14, 90);
  const digests = await prisma.dailyDigest.findMany({
    orderBy: { date: 'desc' },
    take: limit,
    select: {
      id: true,
      date: true,
      modelUsed: true,
      sentToTelegram: true,
      sentAt: true,
      createdAt: true,
      _count: { select: { recommendations: true } },
    },
  });
  return res.json({ digests });
});

router.get('/growth/recommendations', requireGrowthAuth, async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : 'pending';
  const recs = await prisma.recommendation.findMany({
    where: { status },
    orderBy: [{ digest: { date: 'desc' } }, { createdAt: 'asc' }],
    take: 50,
    include: { digest: { select: { date: true } } },
  });
  return res.json({ recommendations: recs });
});

export default router;
