import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();
const prisma = new PrismaClient();

// Build an array of the last 365 date strings (YYYY-MM-DD), oldest first
function getLast365Dates(): string[] {
  const dates: string[] = [];
  const today = new Date();
  for (let i = 364; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    dates.push(d.toLocaleDateString('en-CA'));
  }
  return dates;
}

// GET /api/activity/heatmap?userId=X
// Returns [{ date, count }] for last 365 days (0-filled)
router.get('/activity/heatmap', requireAuth, async (req, res) => {
  try {
    const userId = (req.query.userId as string) || req.user!.id;
    const dates = getLast365Dates();
    const since = dates[0];

    const logs = await prisma.activityLog.findMany({
      where: { userId, date: { gte: since } },
      select: { date: true, count: true },
    });

    // Aggregate all types into total count per day
    const totals: Record<string, number> = {};
    for (const log of logs) {
      totals[log.date] = (totals[log.date] || 0) + log.count;
    }

    const result = dates.map(date => ({ date, count: totals[date] || 0 }));
    res.json(result);
  } catch (err) {
    console.error('Activity heatmap error:', err);
    res.status(500).json({ error: 'Failed to fetch activity data' });
  }
});

// GET /api/activity/heatmap/detail?userId=X
// Returns [{ date, workout, nutrition, wellness, analysis }] for last 365 days
router.get('/activity/heatmap/detail', requireAuth, async (req, res) => {
  try {
    const userId = (req.query.userId as string) || req.user!.id;
    const dates = getLast365Dates();
    const since = dates[0];

    const logs = await prisma.activityLog.findMany({
      where: { userId, date: { gte: since } },
      select: { date: true, type: true, count: true },
    });

    // Build a map of date → { workout, nutrition, wellness, analysis }
    const detail: Record<string, { workout: number; nutrition: number; wellness: number; analysis: number }> = {};
    for (const log of logs) {
      if (!detail[log.date]) {
        detail[log.date] = { workout: 0, nutrition: 0, wellness: 0, analysis: 0 };
      }
      const t = log.type as keyof typeof detail[string];
      if (t in detail[log.date]) {
        detail[log.date][t] += log.count;
      }
    }

    const result = dates.map(date => ({
      date,
      workout: detail[date]?.workout || 0,
      nutrition: detail[date]?.nutrition || 0,
      wellness: detail[date]?.wellness || 0,
      analysis: detail[date]?.analysis || 0,
    }));

    res.json(result);
  } catch (err) {
    console.error('Activity heatmap detail error:', err);
    res.status(500).json({ error: 'Failed to fetch activity detail' });
  }
});

export default router;
