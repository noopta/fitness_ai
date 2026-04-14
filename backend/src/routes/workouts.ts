import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { cacheDelete } from '../services/cacheService.js';
import { normalizeExerciseBatch } from '../services/exerciseNormalizationService.js';
import { recomputeStrengthProfileInBackground } from './strength.js';
import { notifyStreakMilestone } from '../services/notificationService.js';
import { logActivity } from '../services/activityService.js';
import posthog from '../services/posthogClient.js';

const router = Router();
const prisma = new PrismaClient();

// ─── Streak helper ────────────────────────────────────────────────────────────

function updateStreakInBackground(userId: string, workoutDate: string): void {
  (async () => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { currentStreak: true, longestStreak: true, lastWorkoutDate: true },
      });
      if (!user) return;

      const last = user.lastWorkoutDate;
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      let newStreak: number;
      if (!last || last < yesterdayStr) {
        // Gap > 1 day or first workout ever — reset
        newStreak = 1;
      } else if (last === yesterdayStr || last === workoutDate) {
        // Consecutive day or same-day re-log
        newStreak = last === workoutDate ? user.currentStreak : user.currentStreak + 1;
      } else {
        newStreak = user.currentStreak + 1;
      }

      const newLongest = Math.max(newStreak, user.longestStreak);

      await prisma.user.update({
        where: { id: userId },
        data: { currentStreak: newStreak, longestStreak: newLongest, lastWorkoutDate: workoutDate },
      });

      // Fire streak milestone notifications (7, 14, 30 days)
      if ([7, 14, 30].includes(newStreak)) {
        notifyStreakMilestone(userId, newStreak).catch(() => {});
      }
    } catch (err) {
      console.error('[streak] update error:', err);
    }
  })();
}

const exerciseSchema = z.object({
  name: z.string().min(1),
  sets: z.number().int().min(1).max(100),
  reps: z.string().min(1),         // e.g. "8" or "6-8"
  weightKg: z.number().nonnegative().optional().nullable(),
  rpe: z.number().min(0).max(10).optional().nullable(),
  notes: z.string().optional().nullable(),
});

const workoutLogSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().optional().nullable(),
  exercises: z.array(exerciseSchema).min(1),
  notes: z.string().optional().nullable(),
  duration: z.number().int().min(1).max(600).optional().nullable(),
});

// GET /api/workouts — list all workout logs for the user (newest first)
router.get('/workouts', requireAuth, async (req, res) => {
  try {
    const logs = await prisma.workoutLog.findMany({
      where: { userId: req.user!.id },
      orderBy: { date: 'desc' },
    });
    res.json(logs.map(l => ({ ...l, exercises: JSON.parse(l.exercises) })));
  } catch (err) {
    console.error('Get workouts error:', err);
    res.status(500).json({ error: 'Failed to fetch workout logs' });
  }
});

// GET /api/workouts/:date — get workout logs for a specific date (YYYY-MM-DD)
router.get('/workouts/:date', requireAuth, async (req, res) => {
  try {
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }
    const logs = await prisma.workoutLog.findMany({
      where: { userId: req.user!.id, date },
      orderBy: { createdAt: 'desc' },
    });
    res.json(logs.map(l => ({ ...l, exercises: JSON.parse(l.exercises) })));
  } catch (err) {
    console.error('Get workout by date error:', err);
    res.status(500).json({ error: 'Failed to fetch workout log' });
  }
});

// POST /api/workouts — log a new workout session
router.post('/workouts', requireAuth, async (req, res) => {
  try {
    const parsed = workoutLogSchema.safeParse(req.body);
    if (!parsed.success) {
      console.error('[workouts] POST validation failed:', JSON.stringify(parsed.error.issues));
      return res.status(400).json({ error: 'Invalid workout data', details: parsed.error.issues });
    }

    const { date, title, exercises, notes, duration } = parsed.data;

    // Fire-and-forget normalization — doesn't block the response
    const names = exercises.map(e => e.name);
    normalizeExerciseBatch(names).catch(err =>
      console.error('[workouts] normalization error on create:', err)
    );

    const log = await prisma.workoutLog.create({
      data: {
        userId: req.user!.id,
        date,
        title: title || null,
        exercises: JSON.stringify(exercises),
        notes: notes || null,
        duration: duration || null,
      },
    });

    cacheDelete(`userctx:${req.user!.id}`);
    recomputeStrengthProfileInBackground(req.user!.id);

    // ── Streak tracking ───────────────────────────────────────────────────────
    updateStreakInBackground(req.user!.id, parsed.data.date);

    // ── Activity tracking ─────────────────────────────────────────────────────
    logActivity(req.user!.id, 'workout').catch(() => {});

    posthog.capture({
      distinctId: req.user!.id,
      event: 'workout_logged',
      properties: {
        exercise_count: exercises.length,
        duration_minutes: duration ?? null,
        workout_date: date,
      },
    });

    res.status(201).json({ ...log, exercises });
  } catch (err) {
    posthog.captureException(err, req.user?.id);
    console.error('Create workout error:', err);
    res.status(500).json({ error: 'Failed to save workout log' });
  }
});

// PUT /api/workouts/:id — update an existing workout log
router.put('/workouts/:id', requireAuth, async (req, res) => {
  try {
    const existing = await prisma.workoutLog.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.userId !== req.user!.id) {
      return res.status(404).json({ error: 'Workout log not found' });
    }

    const parsed = workoutLogSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid workout data', details: parsed.error.issues });
    }

    const { date, title, exercises, notes, duration } = parsed.data;

    // Fire-and-forget normalization for any new exercise names
    const names = exercises.map(e => e.name);
    normalizeExerciseBatch(names).catch(err =>
      console.error('[workouts] normalization error on update:', err)
    );

    const updated = await prisma.workoutLog.update({
      where: { id: req.params.id },
      data: {
        date,
        title: title || null,
        exercises: JSON.stringify(exercises),
        notes: notes || null,
        duration: duration || null,
      },
    });

    cacheDelete(`userctx:${req.user!.id}`);
    recomputeStrengthProfileInBackground(req.user!.id);
    res.json({ ...updated, exercises });
  } catch (err) {
    console.error('Update workout error:', err);
    res.status(500).json({ error: 'Failed to update workout log' });
  }
});

// DELETE /api/workouts/:id — delete a workout log
router.delete('/workouts/:id', requireAuth, async (req, res) => {
  try {
    const existing = await prisma.workoutLog.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.userId !== req.user!.id) {
      return res.status(404).json({ error: 'Workout log not found' });
    }
    await prisma.workoutLog.delete({ where: { id: req.params.id } });
    recomputeStrengthProfileInBackground(req.user!.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete workout error:', err);
    res.status(500).json({ error: 'Failed to delete workout log' });
  }
});

export default router;
