// One write path for workout logs. The /workouts routes and Anakin's chat
// tools both call these, so a workout logged in chat gets exactly what one
// logged in the app gets: exercise normalisation, calorie estimate, cache
// invalidation, strength recompute, streak + pushes, PR detection, adaptive-
// progression proposals and the post-workout proactive sweep.

import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { cacheDelete, cacheClearByPrefix } from './cacheService.js';
import { normalizeExerciseBatch } from './exerciseNormalizationService.js';
import { recomputeStrengthProfileInBackground } from '../routes/strength.js';
import {
  notifyStreakMilestone, notifyComeback, notifyPersonalBest, notifyStreakFreezeUsed, notifySurpriseReward, notifyNewPR,
} from './notificationService.js';
import { recordActivity } from './streakService.js';
import { detectStrengthPRs, prDisplay } from './progressService.js';
import { normalizePreference } from './weightUnits.js';
import { buildShareableWorkout } from './shareableWorkout.js';
import { logActivity } from './activityService.js';
import posthog from './posthogClient.js';
import { estimateWorkoutCalories } from './workoutCalories.js';
import { runPostWorkout } from '../adaptation/proposalService.js';

const prisma = new PrismaClient();

// Per-set entry — used when a user's weights/reps vary across sets
// (e.g. 135x4 → 100x8 → 100x8). When `setEntries` is present, it is the
// source of truth for the diagnostic engine + e1RM calc; the top-level
// `weightKg` and `reps` then represent a summary view (top set's load and
// reps) and are still accepted for backward compatibility with old clients.
export const setEntrySchema = z.object({
  weightKg: z.number().nonnegative().optional().nullable(),
  reps: z.number().int().min(0).max(100),
  rpe: z.number().min(0).max(10).optional().nullable(),
});

export const exerciseSchema = z.object({
  name: z.string().min(1),
  sets: z.number().int().min(1).max(100),
  reps: z.string().min(1),         // e.g. "8" or "6-8"
  weightKg: z.number().nonnegative().optional().nullable(),
  rpe: z.number().min(0).max(10).optional().nullable(),
  notes: z.string().optional().nullable(),
  // True for unloaded movements (abs, push-ups, etc.). Stored verbatim so
  // progress/PR logic can track by reps instead of load.
  bodyweight: z.boolean().optional(),
  // Optional per-set breakdown. When provided, length should match `sets`
  // but we don't fail validation if it doesn't — we just trust whichever
  // value is the source of truth (setEntries.length).
  setEntries: z.array(setEntrySchema).optional().nullable(),
});

// Which planned program day this log fulfils. Sent by the client when the
// log sheet was opened from a program session; absent for ad-hoc workouts.
export const programDayRefSchema = z.object({
  phaseIndex: z.number().int().min(0),
  dayIndex: z.number().int().min(0),
  weekNumber: z.number().int().min(1).optional(),
  day: z.string().optional().nullable(),
});

export const workoutLogSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().optional().nullable(),
  exercises: z.array(exerciseSchema).min(1),
  notes: z.string().optional().nullable(),
  duration: z.number().int().min(1).max(600).optional().nullable(),
  programDayRef: programDayRefSchema.optional().nullable(),
});
export type WorkoutLogInput = z.infer<typeof workoutLogSchema>;

// Delegates to streakService so workout + nutrition share one source of truth
// (handles freezes, personal bests, comebacks, surprise rewards).
function updateStreakInBackground(userId: string, workoutDate: string): void {
  (async () => {
    try {
      const result = await recordActivity(prisma, userId, 'workout', workoutDate);
      if (!result || result.newStreak === result.prevStreak) return;
      // Fire reinforcement pushes — order matters so we don't double-notify on
      // the same log: milestones win over surprise; freeze-used and PB are
      // independent and can both fire.
      if (result.isMilestone) {
        notifyStreakMilestone(userId, result.newStreak).catch(() => {});
      } else if (result.fireSurpriseReward) {
        notifySurpriseReward(userId, 'workout', result.newStreak).catch(() => {});
      }
      if (result.freezeUsed) {
        notifyStreakFreezeUsed(userId, 'workout', result.newStreak).catch(() => {});
      }
      if (result.isPersonalBest && !result.isMilestone) {
        notifyPersonalBest(userId, 'workout', result.newStreak).catch(() => {});
      }
      if (result.isComeback && result.newStreak === 1) {
        const u = await prisma.user.findUnique({ where: { id: userId }, select: { longestStreak: true } });
        if (u && u.longestStreak >= 3) notifyComeback(userId, 'workout', u.longestStreak).catch(() => {});
      }
    } catch (err) {
      console.error('[streak] update error:', err);
    }
  })();
}

function invalidate(userId: string) {
  cacheDelete(`userctx:${userId}`);
  cacheClearByPrefix(`schedule:${userId}:`);
  cacheClearByPrefix(`today:${userId}:`);
  recomputeStrengthProfileInBackground(userId);
}

export interface CreatedWorkout {
  log: any;
  exercises: WorkoutLogInput['exercises'];
  shareable: unknown;
  adaptationProposals: unknown[];
  prs: { displayName: string; e1RMLbs: number }[];
}

/** Log a workout with every side effect the app has. `source` is analytics only. */
export async function createWorkoutLog(userId: string, input: WorkoutLogInput, source: 'app' | 'agent' = 'app'): Promise<CreatedWorkout> {
  const data = workoutLogSchema.parse(input);
  const { date, title, exercises, notes, duration, programDayRef } = data;

  // Fire-and-forget normalization — doesn't block the response
  const names = exercises.map((e) => e.name);
  normalizeExerciseBatch(names).catch((err) => console.error('[workouts] normalization error on create:', err));

  // Estimated calorie burn, stored on the row so /workouts/burn-today is a
  // cheap GROUP BY rather than a re-compute on every request.
  const userForEstimate = await prisma.user.findUnique({ where: { id: userId }, select: { weightKg: true, unitPreference: true } });
  const unitPref = normalizePreference(userForEstimate?.unitPreference);
  const caloriesBurnedKcal = estimateWorkoutCalories(exercises, {
    bodyweightKg: userForEstimate?.weightKg ?? null,
    totalDurationMinutes: duration ?? null,
  });

  const log = await prisma.workoutLog.create({
    data: {
      userId,
      date,
      title: title || null,
      exercises: JSON.stringify(exercises),
      notes: notes || null,
      duration: duration || null,
      caloriesBurnedKcal: caloriesBurnedKcal > 0 ? caloriesBurnedKcal : null,
      programDayRef: programDayRef ? JSON.stringify(programDayRef) : null,
    },
  });

  invalidate(userId);
  updateStreakInBackground(userId, date);

  // PRs detected inline so the celebration gets an accurate PR object; pushes
  // still fire in the background. A failure here never loses the saved log.
  let shareable: unknown;
  let prs: { displayName: string; e1RMLbs: number }[] = [];
  try {
    prs = await detectStrengthPRs(prisma, userId, log.id, exercises);
    for (const pr of prs) {
      const { value, unit } = prDisplay(pr.e1RMLbs, unitPref);
      notifyNewPR(userId, pr.displayName, value, unit).catch(() => {});
    }
    shareable = buildShareableWorkout({ title, exercises, durationMin: duration, loggedAt: log.createdAt }, prs as any);
  } catch (err) {
    console.error('[workouts] shareable build error:', err);
    shareable = buildShareableWorkout({ title, exercises, durationMin: duration, loggedAt: log.createdAt }, []);
  }

  // Adaptive progression — never mutates the program; that takes a decide() tap.
  let adaptationProposals: unknown[] = [];
  try {
    adaptationProposals = await runPostWorkout(userId, names);
  } catch (err: any) {
    console.error('[workouts] adaptation post-workout failed:', err?.message ?? err);
  }

  // Proactive agent drop-in (inert until AGENT_PROACTIVE_ENABLED).
  void (async () => {
    try {
      const { runProactiveSweep } = await import('../agent/proactiveSweep.js');
      await runProactiveSweep('post_workout', [userId]);
    } catch (err: any) {
      console.error('[workouts] post_workout proactive sweep failed:', err?.message ?? err);
    }
  })();

  logActivity(userId, 'workout').catch(() => {});
  posthog.capture({ distinctId: userId, event: 'workout_logged', properties: { exercise_count: exercises.length, duration_minutes: duration ?? null, workout_date: date, source } });

  return { log, exercises, shareable, adaptationProposals, prs };
}

/** Replace a log's contents. Returns null when it isn't the user's. */
export async function updateWorkoutLog(userId: string, id: string, input: WorkoutLogInput) {
  const existing = await prisma.workoutLog.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) return null;
  const { date, title, exercises, notes, duration, programDayRef } = workoutLogSchema.parse(input);
  normalizeExerciseBatch(exercises.map((e) => e.name)).catch((err) => console.error('[workouts] normalization error on update:', err));
  const updated = await prisma.workoutLog.update({
    where: { id },
    data: {
      date,
      title: title || null,
      exercises: JSON.stringify(exercises),
      notes: notes || null,
      duration: duration || null,
      // Only touch the link when the caller sent one; an old client editing a
      // log must not wipe it.
      ...(programDayRef !== undefined ? { programDayRef: programDayRef ? JSON.stringify(programDayRef) : null } : {}),
    },
  });
  invalidate(userId);
  return { before: existing, updated: { ...updated, exercises } };
}

/** Delete a log; returns the deleted row (for undo) or null. */
export async function deleteWorkoutLog(userId: string, id: string) {
  const existing = await prisma.workoutLog.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) return null;
  await prisma.workoutLog.delete({ where: { id } });
  invalidate(userId);
  return existing;
}

/** Put a deleted log back exactly as it was (same id and timestamps). Used by undo. */
export async function restoreWorkoutLog(userId: string, row: any) {
  if (!row || row.userId !== userId) throw new Error('Nothing to restore.');
  const exists = await prisma.workoutLog.findUnique({ where: { id: row.id } });
  if (exists) return exists;
  const restored = await prisma.workoutLog.create({
    data: {
      id: row.id, userId, date: row.date, title: row.title, exercises: row.exercises, notes: row.notes,
      duration: row.duration, caloriesBurnedKcal: row.caloriesBurnedKcal, programDayRef: row.programDayRef,
      createdAt: row.createdAt ? new Date(row.createdAt) : undefined,
    },
  });
  invalidate(userId);
  return restored;
}
