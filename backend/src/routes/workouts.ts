import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/requireAuth.js';
import { cacheDelete, cacheClearByPrefix } from '../services/cacheService.js';
import { normalizeExerciseBatch } from '../services/exerciseNormalizationService.js';
import { recomputeStrengthProfileInBackground } from './strength.js';
import {
  notifyStreakMilestone,
  notifyComeback,
  notifyPersonalBest,
  notifyStreakFreezeUsed,
  notifySurpriseReward,
} from '../services/notificationService.js';
import { recordActivity } from '../services/streakService.js';
import { detectStrengthPRs, prDisplay } from '../services/progressService.js';
import { notifyNewPR } from '../services/notificationService.js';
import { normalizePreference } from '../services/weightUnits.js';
import { buildShareableWorkout } from '../services/shareableWorkout.js';
import { logActivity } from '../services/activityService.js';
import posthog from '../services/posthogClient.js';
import { estimateWorkoutCalories } from '../services/workoutCalories.js';
import { parseExercisesColumn } from '../services/workoutExercises.js';
import { lastForExercises } from '../adaptation/proposalService.js';
import { workoutLogSchema, createWorkoutLog, updateWorkoutLog, deleteWorkoutLog } from '../services/workoutLogService.js';

const router = Router();
const prisma = new PrismaClient();

// GET /api/workouts — list all workout logs for the user (newest first)
router.get('/workouts', requireAuth, async (req, res) => {
  try {
    const logs = await prisma.workoutLog.findMany({
      where: { userId: req.user!.id },
      orderBy: { date: 'desc' },
    });
    res.json(logs.map(l => ({ ...l, exercises: parseExercisesColumn(l.exercises) })));
  } catch (err) {
    console.error('Get workouts error:', err);
    res.status(500).json({ error: 'Failed to fetch workout logs' });
  }
});

// GET /api/workouts/exercise/:name/last — last few exposures of one lift,
// with the program target + how the latest session scored against it. This
// is the "Last time: 80 kg × 8 @ RPE 6.5" line on the logging sheet.
router.get('/workouts/exercise/:name/last', requireAuth, async (req, res) => {
  try {
    const name = String(req.params.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    const [result] = await lastForExercises(req.user!.id, [name]);
    res.json(result ?? { name, key: null, exposures: [], target: null, lastScore: null });
  } catch (err) {
    console.error('Get exercise history error:', err);
    res.status(500).json({ error: 'Failed to fetch exercise history' });
  }
});

// POST /api/workouts/exercises/last — batch form of the above for a whole
// session's worth of exercises in one round-trip. { names: string[] }
router.post('/workouts/exercises/last', requireAuth, async (req, res) => {
  try {
    const names = Array.isArray(req.body?.names)
      ? (req.body.names as unknown[]).map(n => String(n ?? '').trim()).filter(Boolean).slice(0, 40)
      : [];
    if (names.length === 0) return res.json({ results: [] });
    const results = await lastForExercises(req.user!.id, names);
    res.json({ results });
  } catch (err) {
    console.error('Batch exercise history error:', err);
    res.status(500).json({ error: 'Failed to fetch exercise history' });
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
    res.json(logs.map(l => ({ ...l, exercises: parseExercisesColumn(l.exercises) })));
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
    // Every side effect (streak, PRs, adaptation, strength recompute…) lives in
    // the shared service so chat-logged workouts behave identically.
    const { log, exercises, shareable, adaptationProposals } = await createWorkoutLog(req.user!.id, parsed.data, 'app');
    res.status(201).json({ ...log, exercises, shareable, adaptationProposals });
  } catch (err) {
    posthog.captureException(err, req.user?.id);
    console.error('Create workout error:', err);
    res.status(500).json({ error: 'Failed to save workout log' });
  }
});

// PUT /api/workouts/:id — update an existing workout log
router.put('/workouts/:id', requireAuth, async (req, res) => {
  try {
    const parsed = workoutLogSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid workout data', details: parsed.error.issues });
    }
    const r = await updateWorkoutLog(req.user!.id, req.params.id, parsed.data);
    if (!r) return res.status(404).json({ error: 'Workout log not found' });
    res.json(r.updated);
  } catch (err) {
    console.error('Update workout error:', err);
    res.status(500).json({ error: 'Failed to update workout log' });
  }
});

// DELETE /api/workouts/:id — delete a workout log
router.delete('/workouts/:id', requireAuth, async (req, res) => {
  try {
    const gone = await deleteWorkoutLog(req.user!.id, req.params.id);
    if (!gone) return res.status(404).json({ error: 'Workout log not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete workout error:', err);
    res.status(500).json({ error: 'Failed to delete workout log' });
  }
});

export default router;
