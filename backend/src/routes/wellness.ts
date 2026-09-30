import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { generateWellnessInsight } from '../services/llmService.js';
import { cacheDelete } from '../services/cacheService.js';
import { checkinSchema, upsertCheckin } from '../services/wellnessService.js';

const router = Router();
const prisma = new PrismaClient();

// POST /api/wellness/checkin - Save or update daily check-in
router.post('/wellness/checkin', requireAuth, async (req, res) => {
  try {
    const data = checkinSchema.parse(req.body);
    const userId = req.user!.id;
    const { checkin, before: existing } = await upsertCheckin(userId, data);

    // Generate AI insight from recent check-ins
    const recent = await prisma.wellnessCheckin.findMany({
      where: { userId },
      orderBy: { date: 'desc' },
      take: 7,
    });

    const insight = await generateWellnessInsight({ recentCheckins: recent });

    res.status(existing ? 200 : 201).json({ checkin, insight });
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
