import { track } from '../services/productEvents.js';
import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { generateWellnessInsight } from '../services/llmService.js';
import { cacheDelete, cacheGet, cacheSet } from '../services/cacheService.js';
import { checkinSchema, upsertCheckin } from '../services/wellnessService.js';

const router = Router();
const prisma = new PrismaClient();

// Per-user burst bound on the insight LLM call (in-handler, so a limited
// request still saves its check-in).
const INSIGHTS_PER_MIN = 6;
const insightHits = new Map<string, number[]>();
export function takeInsightSlot(userId: string, now = Date.now()): boolean {
  if (process.env.RATE_LIMIT_DISABLED === 'true') return true;
  const recent = (insightHits.get(userId) ?? []).filter((t) => t > now - 60_000);
  if (recent.length >= INSIGHTS_PER_MIN) { insightHits.set(userId, recent); return false; }
  recent.push(now);
  insightHits.set(userId, recent);
  if (insightHits.size > 20_000) insightHits.clear();
  return true;
}

// POST /api/wellness/checkin - Save or update daily check-in
router.post('/wellness/checkin', requireAuth, async (req, res) => {
  track(req.user!.id, 'wellness_checkin');
  try {
    const data = checkinSchema.parse(req.body);
    const userId = req.user!.id;
    const { checkin, before: existing } = await upsertCheckin(userId, data);

    // AI insight from recent check-ins — one per user per day (cached), and
    // the LLM call is burst-limited. The check-in itself always saves; when
    // the limit is hit the insight is simply left out (audit MEDIUM-4).
    const insightKey = `wellness-insight:${userId}:${checkin.date}`;
    let insight = cacheGet<string>(insightKey);
    if (insight == null && takeInsightSlot(userId)) {
      const recent = await prisma.wellnessCheckin.findMany({
        where: { userId },
        orderBy: { date: 'desc' },
        take: 7,
      });
      insight = await generateWellnessInsight({ recentCheckins: recent });
      if (insight) cacheSet(insightKey, insight, 24 * 60 * 60 * 1000);
    }

    res.status(existing ? 200 : 201).json({ checkin, insight: insight ?? null });
  } catch (err: any) {
    console.error('Wellness checkin error:', err);
    res.status(400).json({ error: err.message || 'Failed to save check-in' });
  }
});

// GET /api/wellness/checkins - Fetch last 30 days
router.get('/wellness/checkins', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const checkins = await prisma.wellnessCheckin.findMany({
      where: { userId },
      orderBy: { date: 'desc' },
      take: 30,
    });
    res.json({ checkins });
  } catch (err) {
    console.error('Wellness fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch check-ins' });
  }
});

export default router;
