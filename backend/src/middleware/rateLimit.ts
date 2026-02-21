import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const UPGRADE_URL = `https://buy.stripe.com/9B614gaQ2gjIdxV26NfUQ01`;

export async function checkAnalysisRateLimit(req: Request, res: Response, next: NextFunction) {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Pro/enterprise users bypass rate limit
  if (user.tier === 'pro' || user.tier === 'enterprise') {
    return next();
  }

  const limit = parseInt(process.env.FREE_TIER_DAILY_LIMIT || '2', 10);

  try {
    const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
    if (!dbUser) {
      return res.status(401).json({ error: 'User not found' });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const lastDate = dbUser.dailyAnalysisDate ? new Date(dbUser.dailyAnalysisDate) : null;
    const isNewDay = !lastDate || lastDate < today;

    const currentCount = isNewDay ? 0 : dbUser.dailyAnalysisCount;

    if (currentCount >= limit) {
      return res.status(429).json({
        error: 'Daily analysis limit reached',
        limit,
        upgradeUrl: `${UPGRADE_URL}?client_reference_id=${user.id}`
      });
    }

    // Increment counter
    await prisma.user.update({
      where: { id: user.id },
      data: {
        dailyAnalysisCount: currentCount + 1,
        dailyAnalysisDate: isNewDay ? new Date() : undefined
      }
    });

    next();
  } catch (err) {
    console.error('Rate limit check error:', err);
    next(); // fail open
  }
}
