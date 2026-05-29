// Per-day usage cap for the agentic Anakin endpoints. Every agent turn is a
// real Anthropic API call, so unlike the old coach chat this needs a cost
// guard. Mirrors checkAnalysisRateLimit's daily-counter pattern.
//
// Unlike the analysis limiter, pro/enterprise are NOT unlimited — they get a
// higher cap, because runaway agent usage costs real money even from a paying
// user. Both caps are env-configurable.

import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const UPGRADE_URL = 'https://buy.stripe.com/28E9AU15CaIJgYQ5zD0Ba00';

function dailyCap(tier: string): number {
  if (tier === 'pro' || tier === 'enterprise') {
    return parseInt(process.env.AGENT_PRO_DAILY_LIMIT || '200', 10);
  }
  return parseInt(process.env.AGENT_FREE_DAILY_LIMIT || '10', 10);
}

export async function checkAgentRateLimit(req: Request, res: Response, next: NextFunction) {
  const user = req.user;
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const limit = dailyCap(user.tier);

  try {
    const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
    if (!dbUser) return res.status(401).json({ error: 'User not found' });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const lastDate = dbUser.agentTurnsDate ? new Date(dbUser.agentTurnsDate) : null;
    const isNewDay = !lastDate || lastDate < today;
    const currentCount = isNewDay ? 0 : dbUser.agentTurnsCount;

    if (currentCount >= limit) {
      return res.status(429).json({
        error: 'Daily Anakin limit reached',
        limit,
        tier: user.tier,
        ...(user.tier === 'free'
          ? { upgradeUrl: `${UPGRADE_URL}?client_reference_id=${user.id}` }
          : {}),
      });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        agentTurnsCount: currentCount + 1,
        agentTurnsDate: isNewDay ? new Date() : undefined,
      },
    });
    next();
  } catch (err) {
    console.error('[agent] rate limit check error:', err);
    next(); // fail open — don't let a counter hiccup block coaching
  }
}
