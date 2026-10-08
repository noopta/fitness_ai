// GET  /api/nutrition/day-targets?date=  — Fuel's targets, or none (v2 N-07, N-08)
// POST /api/nutrition/day-targets/quick  — set them from four answers (N-08)
// Own router so it loads without nutrition.ts's model clients.

import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { cacheMarkStale } from '../services/cacheService.js';
import { nutritionProfileCacheKey } from '../services/nutritionShared.js';
import { resolveTargets, quickTargets, summarizeRange } from '../services/nutritionTargets.js';

const router = Router();
const prisma = new PrismaClient();

router.get('/nutrition/day-targets', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const date = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : new Date().toISOString().slice(0, 10);
    const [u, logs] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { savedProgram: true, coachProfile: true, dailyCalorieTarget: true, subtractWorkoutBurnFromCalories: true } }),
      prisma.workoutLog.findMany({ where: { userId, date }, select: { title: true, caloriesBurnedKcal: true } }),
    ]);
    if (!u) return res.status(404).json({ error: 'User not found' });
    const burnKcal = Math.round(logs.reduce((s, l) => s + (l.caloriesBurnedKcal ?? 0), 0));
    res.json({
      targets: resolveTargets(u),
      // The workout's burn is its own line on today's target (N-07); the Account toggle turns it off.
      burn: { kcal: burnKcal, label: logs.find((l) => (l.caloriesBurnedKcal ?? 0) > 0)?.title ?? null, addToTarget: u.subtractWorkoutBurnFromCalories !== false },
    });
  } catch (err) {
    console.error('Day targets error:', err);
    res.status(500).json({ error: 'Failed to load targets' });
  }
});

const quickSchema = z.object({
  sex: z.enum(['male', 'female', 'unknown']),
  ageYears: z.number().int().min(13).max(100),
  heightCm: z.number().min(120).max(230),
  weightKg: z.number().min(30).max(300),
  goal: z.enum(['lose', 'maintain', 'gain', 'strength']),
  trainingDaysPerWeek: z.number().int().min(0).max(7).default(3),
});

router.post('/nutrition/day-targets/quick', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const a = quickSchema.parse(req.body);
    const t = quickTargets(a);
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { coachProfile: true, heightCm: true, weightKg: true } });
    let blob: any = {};
    try { blob = u?.coachProfile ? JSON.parse(u.coachProfile) : {}; } catch { blob = {}; }
    blob.nutritionTargets = { ...t, answers: a, setAt: new Date().toISOString() };
    await prisma.user.update({
      where: { id: userId },
      // A fresh set replaces any typed calorie number, and fills height / weight if they were missing.
      data: { coachProfile: JSON.stringify(blob), dailyCalorieTarget: null, ...(u?.heightCm ? {} : { heightCm: a.heightCm }), ...(u?.weightKg ? {} : { weightKg: a.weightKg }) },
    });
    cacheMarkStale(nutritionProfileCacheKey(userId));
    res.json({ targets: { ...t, source: 'quick' } });
  } catch (err: any) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: err.errors?.[0]?.message ?? 'Check your answers' });
    console.error('Quick targets error:', err);
    res.status(500).json({ error: 'Failed to set targets' });
  }
});

// GET /api/nutrition/summary?range=today|7d|30d&date= — the nutrition profile's
// Today / 7 / 30 days (N-09): daily totals, averages over logged days, meal shares.
router.get('/nutrition/summary', requireAuth, async (req, res) => {
  try {
    const end = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : new Date().toISOString().slice(0, 10);
    const span = req.query.range === '30d' ? 30 : req.query.range === '7d' ? 7 : 1;
    const s = new Date(`${end}T12:00:00Z`); s.setUTCDate(s.getUTCDate() - (span - 1));
    const start = s.toISOString().slice(0, 10);
    const rows = await prisma.mealEntry.findMany({
      where: { userId: req.user!.id, date: { gte: start, lte: end } },
      select: { date: true, mealType: true, calories: true, proteinG: true, carbsG: true, fatG: true, nutrientsJson: true },
    });
    // Fiber lives in the meal's micronutrients, not a column.
    const fiber = (raw: string | null) => { try { const n = raw ? JSON.parse(raw)?.fiberG : null; return typeof n === 'number' && Number.isFinite(n) ? n : null; } catch { return null; } };
    const meals = rows.map(({ nutrientsJson, ...r }) => ({ ...r, fiberG: fiber(nutrientsJson) }));
    res.json({ range: span === 1 ? 'today' : `${span}d`, start, end, ...summarizeRange(meals, start, end) });
  } catch (err) {
    console.error('Nutrition summary error:', err);
    res.status(500).json({ error: 'Failed to load the summary' });
  }
});

export default router;
