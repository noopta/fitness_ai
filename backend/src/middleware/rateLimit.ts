import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { rateLimit } from './rateLimiter.js';
import { takeDailyUnit } from './checkAgentRateLimit.js';

const prisma = new PrismaClient();
const UPGRADE_URL = `https://buy.stripe.com/28E9AU15CaIJgYQ5zD0Ba00`;

// Per-minute burst bound for every tier — pro included (Oct 2026 audit
// MEDIUM-4: pro had no bound at all on the analysis LLM routes). Its own
// bucket so it doesn't share a budget with aiLimiter on other routes.
const analysisBurst = rateLimit({
  windowMs: 60_000,
  max: (() => { const n = parseInt(process.env.RATE_LIMIT_ANALYSIS_PER_MIN || '', 10); return Number.isFinite(n) && n > 0 ? n : 12; })(),
  message: 'You are sending requests too quickly. Give it a moment and try again.',
});

export async function checkAnalysisRateLimit(req: Request, res: Response, next: NextFunction) {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Burst limit first; it answers 429 itself when exceeded.
  let burstOk = false;
  analysisBurst(req, res, () => { burstOk = true; });
  if (!burstOk) return;

  // Pro/enterprise have no daily cap (the burst limit above still applies).
  if (user.tier === 'pro' || user.tier === 'enterprise') {
    return next();
  }

  const limit = parseInt(process.env.FREE_TIER_DAILY_LIMIT || '2', 10);

  let outcome: 'ok' | 'limit' | 'missing';
  try {
    // One conditional UPDATE — parallel requests can't overshoot the cap.
    outcome = await takeDailyUnit(prisma, user.id, limit, { count: 'dailyAnalysisCount', date: 'dailyAnalysisDate' });
  } catch (err) {
    // Fail closed: every pass is a paid LLM call.
    console.error('Rate limit check error:', err);
    return res.status(503).json({ error: 'Analysis is unavailable right now. Please try again in a moment.', code: 'limit_unavailable' });
  }
  if (outcome === 'missing') return res.status(401).json({ error: 'User not found' });
  if (outcome === 'limit') {
    return res.status(429).json({
      error: 'Daily analysis limit reached',
      limit,
      upgradeUrl: `${UPGRADE_URL}?client_reference_id=${user.id}`,
    });
  }
  next();
}
