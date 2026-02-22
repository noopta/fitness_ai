import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { generateWellnessInsight } from '../services/llmService.js';

const router = Router();
const prisma = new PrismaClient();

const checkinSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mood: z.number().int().min(1).max(5),
  energy: z.number().int().min(1).max(5),
  sleepHours: z.number().min(0).max(24),
  stress: z.number().int().min(1).max(5),
});

// POST /api/wellness/checkin - Save or update daily check-in
router.post('/wellness/checkin', requireAuth, async (req, res) => {
  try {
    const data = checkinSchema.parse(req.body);
    const userId = req.user!.id;

    const existing = await prisma.wellnessCheckin.findFirst({
      where: { userId, date: data.date },
    });

    let checkin;
    if (existing) {
      checkin = await prisma.wellnessCheckin.update({
        where: { id: existing.id },
        data,
      });
    } else {
      checkin = await prisma.wellnessCheckin.create({
        data: { userId, ...data },
      });
    }

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
