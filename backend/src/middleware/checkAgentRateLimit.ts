// Per-day usage cap for the agentic Anakin endpoints. Every agent turn is a
// real Anthropic API call, so unlike the old coach chat this needs a cost
// guard. Mirrors checkAnalysisRateLimit's daily-counter pattern.
//
// Unlike the analysis limiter, pro/enterprise are NOT unlimited — they get a
// higher cap, because runaway agent usage costs real money even from a paying
// user. Both caps are env-configurable.
//
// Oct 2026 audit HIGH-3: the counter used to read → compare → write in two
// queries (50 parallel requests all passed before the first write landed) and
// failed OPEN on a DB error. It is now one conditional UPDATE (count < limit)
// and fails CLOSED.

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

function startOfToday(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

/**
 * Atomically take one unit of today's allowance. Returns 'ok', 'limit' or
 * 'missing' (no such user). Each step is a single conditional UPDATE, so two
 * concurrent requests can never both take the last unit.
 */
export async function takeDailyUnit(
  client: any,
  userId: string,
  limit: number,
  fields: { count: string; date: string },
): Promise<'ok' | 'limit' | 'missing'> {
  const today = startOfToday();
  // New day (or never used): reset to 0. Only one concurrent reset can match,
  // because the first one moves the date into today.
  await client.user.updateMany({
    where: { id: userId, OR: [{ [fields.date]: null }, { [fields.date]: { lt: today } }] },
    data: { [fields.count]: 0, [fields.date]: new Date() },
  });
  if (limit <= 0) return (await client.user.findUnique({ where: { id: userId }, select: { id: true } })) ? 'limit' : 'missing';
  const taken = await client.user.updateMany({
    where: { id: userId, [fields.count]: { lt: limit } },
    data: { [fields.count]: { increment: 1 } },
  });
  if (taken.count > 0) return 'ok';
  // Re-read to tell "over the limit" from "no such user".
  const row = await client.user.findUnique({ where: { id: userId }, select: { id: true } });
  return row ? 'limit' : 'missing';
}

export async function checkAgentRateLimit(req: Request, res: Response, next: NextFunction) {
  const user = req.user;
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const limit = dailyCap(user.tier);

  let outcome: 'ok' | 'limit' | 'missing';
  try {
    outcome = await takeDailyUnit(prisma, user.id, limit, { count: 'agentTurnsCount', date: 'agentTurnsDate' });
  } catch (err) {
    // Fail closed: an unmetered agent turn is a real Anthropic bill.
    console.error('[agent] rate limit check error:', err);
    return res.status(503).json({ error: 'Anakin is busy right now. Please try again in a moment.', code: 'limit_unavailable' });
  }
  if (outcome === 'missing') return res.status(401).json({ error: 'User not found' });
  if (outcome === 'limit') {
    return res.status(429).json({
      error: 'Daily Anakin limit reached',
      limit,
      tier: user.tier,
      ...(user.tier === 'free'
        ? { upgradeUrl: `${UPGRADE_URL}?client_reference_id=${user.id}` }
        : {}),
    });
  }
  next();
}
