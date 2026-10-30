// One write path for workout logs. The /workouts routes and Anakin's chat
// tools both call these, so a workout logged in chat gets exactly what one
// logged in the app gets: exercise normalisation, calorie estimate, cache
// invalidation, strength recompute, streak + pushes, PR detection, adaptive-
// progression proposals and the post-workout proactive sweep.

import { track } from './productEvents.js';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { bounded } from '../validation/physiologicalBounds.js';
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
import { todayForTz } from './localDate.js';
import { runPostWorkout } from '../adaptation/proposalService.js';
import { postInitiatedLater } from '../agent/initiated.js';
import { scheduleReview } from './logReview/index.js';
import { momentForWorkout, dropMomentsForWorkout } from './moments/index.js';
import type { ProgressMoment } from './moments/types.js';

const prisma = new PrismaClient();

// Per-set entry — used when a user's weights/reps vary across sets
// (e.g. 135x4 → 100x8 → 100x8). When `setEntries` is present, it is the
// source of truth for the diagnostic engine + e1RM calc; the top-level
// `weightKg` and `reps` then represent a summary view (top set's load and
// reps) and are still accepted for backward compatibility with old clients.
//
// Bounds (Oct 2026 audit): every number finite and inside the physiological
// HARD range (validation/physiologicalBounds.ts), every string and list
// capped — a log is replayed into LLM prompts and the leaderboard.
export const WORKOUT_LIMITS = { name: 120, title: 120, notes: 2000, reps: 20, exercises: 60, setEntries: 100 } as const;

export const setEntrySchema = z.object({
  weightKg: bounded('liftWeightKg', 'Weight').optional().nullable(),
  reps: bounded('reps', 'Reps').int(),
  rpe: z.number().finite().min(0).max(10).optional().nullable(),
});

export const exerciseSchema = z.object({
  name: z.string().trim().min(1).max(WORKOUT_LIMITS.name),
  sets: bounded('sets', 'Sets').int().min(1),
  reps: z.string().min(1).max(WORKOUT_LIMITS.reps),         // e.g. "8" or "6-8"
  weightKg: bounded('liftWeightKg', 'Weight').optional().nullable(),
  rpe: z.number().finite().min(0).max(10).optional().nullable(),
  notes: z.string().max(WORKOUT_LIMITS.notes).optional().nullable(),
  // True for unloaded movements (abs, push-ups, etc.). Stored verbatim so
  // progress/PR logic can track by reps instead of load.
  bodyweight: z.boolean().optional(),
  // Optional per-set breakdown. When provided, length should match `sets`
  // but we don't fail validation if it doesn't — we just trust whichever
  // value is the source of truth (setEntries.length).
  setEntries: z.array(setEntrySchema).max(WORKOUT_LIMITS.setEntries).optional().nullable(),
  // Machine, cable or free weight, when known (log review asks when a number
  // only fits a machine). Free text: descriptive fields never gate a save.
  equipment: z.string().max(20).optional().nullable(),
  // Numbers Anakin assumed ("average 8–10 reps" → 9): kept out of PRs and progression.
  estimated: z.boolean().optional(),
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
  title: z.string().max(WORKOUT_LIMITS.title).optional().nullable(),
  exercises: z.array(exerciseSchema).min(1).max(WORKOUT_LIMITS.exercises),
  notes: z.string().max(WORKOUT_LIMITS.notes).optional().nullable(),
  duration: z.number().int().min(1).max(600).optional().nullable(),
  programDayRef: programDayRefSchema.optional().nullable(),
});
export type WorkoutLogInput = z.infer<typeof workoutLogSchema>;

// Delegates to streakService so workout + nutrition share one source of truth
// (handles freezes, personal bests, comebacks, surprise rewards).
// `silent` (a backfilled day): the streak is recounted but no push goes out —
// filling in July shouldn't announce a "30-day streak!" milestone in October.
function updateStreakInBackground(userId: string, workoutDate: string, silent = false): void {
  (async () => {
    try {
      const result = await recordActivity(prisma, userId, 'workout', workoutDate);
      if (!result || result.newStreak === result.prevStreak || silent) return;
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
  // Log review: duplicates, odd values and gaps are flagged for the user to
  // approve (design "Log review 1a"). Debounced, so a quick correction lands first.
  scheduleReview(userId);
}

/** A workout dated after the user's today. */
export class WorkoutDateError extends Error {}

/** Today in the user's timezone (ET when unknown), as YYYY-MM-DD. Lives in
 *  localDate.ts so the adaptation engine can share it; re-exported here for
 *  existing callers. */
export { todayForTz };

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * How many days back a log still counts as "just done". Older logs are
 * history being filled in: they count for streaks, PRs and progress, but do
 * not send a PR push or propose a program change about a session from weeks ago.
 */
export const RECENT_DAYS = 2;

export interface CreatedWorkout {
  log: any;
  exercises: WorkoutLogInput['exercises'];
  shareable: unknown;
  adaptationProposals: unknown[];
  prs: { key: string; displayName: string; e1RMLbs: number; prevLbs: number; deltaLbs: number }[];
  /** Logged for a day more than RECENT_DAYS ago. */
  backdated: boolean;
  /**
   * The congratulation and share cards this log earned (spec "Progress
   * Moments"). Every log gets one, backdated ones included; null only when a
   * quiet batch member (the batch gets one for its latest) or on failure.
   */
  moment: ProgressMoment | null;
}

export interface CreateOpts {
  /**
   * Part of a bulk backfill (createWorkoutLogsBulk): save the row and record
   * PRs, but leave cache invalidation, the strength recompute and the streak
   * to the batch, and send nothing — no pushes, adaptation, sweep or chat card.
   */
  quiet?: boolean;
  /** How the log was made and why it's on this day (agent/logDate.ts LogTrace). Default: {via: app|chat}. */
  trace?: Record<string, unknown> | null;
}

/** Log a workout with every side effect the app has. `source` is analytics only. */
export async function createWorkoutLog(userId: string, input: WorkoutLogInput, source: 'app' | 'agent' = 'app', opts: CreateOpts = {}): Promise<CreatedWorkout> {
  const quiet = !!opts.quiet;
  const data = workoutLogSchema.parse(input);
  const { date, title, exercises, notes, duration, programDayRef } = data;

  // Fire-and-forget normalization — doesn't block the response
  const names = exercises.map((e) => e.name);
  normalizeExerciseBatch(names).catch((err) => console.error('[workouts] normalization error on create:', err));

  // Estimated calorie burn, stored on the row so /workouts/burn-today is a
  // cheap GROUP BY rather than a re-compute on every request.
  const userForEstimate = await prisma.user.findUnique({ where: { id: userId }, select: { weightKg: true, unitPreference: true, timezone: true } });
  const today = todayForTz(userForEstimate?.timezone);
  // A day of slack for a phone a timezone ahead of the account's.
  if (date > addDays(today, 1)) throw new WorkoutDateError('That date is in the future');
  const backdated = date < addDays(today, -RECENT_DAYS);
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
      logTrace: JSON.stringify(opts.trace ?? { via: source === 'agent' ? 'chat' : 'app', ...(source === 'app' ? { basis: 'client' } : {}), sentAt: new Date().toISOString() }),
    },
  });

  if (!quiet) {
    invalidate(userId);
    updateStreakInBackground(userId, date, backdated);
  }

  // PRs detected inline so the celebration gets an accurate PR object; pushes
  // still fire in the background. A failure here never loses the saved log.
  let shareable: unknown;
  let prs: CreatedWorkout['prs'] = [];
  try {
    prs = await detectStrengthPRs(prisma, userId, log.id, exercises, backdated ? date : undefined);
    if (!backdated && !quiet) {
      for (const pr of prs) {
        const { value, unit } = prDisplay(pr.e1RMLbs, unitPref);
        notifyNewPR(userId, pr.displayName, value, unit).catch(() => {});
      }
    }
    shareable = buildShareableWorkout({ title, exercises, durationMin: duration, loggedAt: log.createdAt }, prs as any);
  } catch (err) {
    console.error('[workouts] shareable build error:', err);
    shareable = buildShareableWorkout({ title, exercises, durationMin: duration, loggedAt: log.createdAt }, []);
  }

  const moment = quiet ? null : await momentForWorkout(userId, log.id, { prs });

  // Adaptive progression — never mutates the program; that takes a decide() tap.
  let adaptationProposals: unknown[] = [];
  try {
    if (!backdated && !quiet) adaptationProposals = await runPostWorkout(userId, names);
  } catch (err: any) {
    console.error('[workouts] adaptation post-workout failed:', err?.message ?? err);
  }

  // Proactive agent drop-in. Gated HERE, not only at delivery: the evaluation
  // is a paid agent turn, and it used to run on every log (audit HIGH-2).
  if (!backdated && !quiet && process.env.AGENT_PROACTIVE_ENABLED === 'true') void (async () => {
    try {
      const { runProactiveSweep } = await import('../agent/proactiveSweep.js');
      await runProactiveSweep('post_workout', [userId]);
    } catch (err: any) {
      console.error('[workouts] post_workout proactive sweep failed:', err?.message ?? err);
    }
  })();

  // Chat logs already show these on their card; for a workout logged in the
  // app, Anakin raises the PR and any suggestion in the thread.
  if (source === 'app' && !backdated && !quiet && (prs.length || adaptationProposals.length)) {
    postInitiatedLater(userId, async () => {
      const { toolCtx } = await import('../agent/turn.js');
      const { adaptationCard } = await import('../agent/toolkits/adaptation.js');
      const { prCard } = await import('../agent/toolkits/cards.js');
      const ctx = await toolCtx(userId);
      const cards = [
        ...(prs.length ? [prCard(prs.map((p) => ({ name: p.displayName, e1rmLbs: p.e1RMLbs })), ctx.unit)] : []),
        ...(adaptationProposals as any[]).slice(0, 2).map((p) => adaptationCard(p, ctx)),
      ];
      const first = (adaptationProposals as any[])[0];
      // Log-trend cards (freestyle release) aren't all "ready to move" — a
      // deload or a reset needs a different opener.
      const text = prs.length
        ? `New best on ${prs.map((p) => p.displayName).join(' and ')}! That's the strongest you've ever been on ${prs.length > 1 ? 'them' : 'it'} — all that work is paying off. Nice lifting.`
        : first?.kind === 'deload' ? 'Your last few sessions point to a lighter week.'
        : first?.kind === 'next_session' ? `I have a suggestion for your next ${first?.proposal?.exercise ?? 'session'}.`
        : 'Your last session says a lift is ready to move.';
      return { text, cards };
    });
  }
  // ActivityLog counts activity on the day it happens (it stamps today), so a
  // backfilled session isn't counted as training today.
  if (!backdated && !quiet) logActivity(userId, 'workout').catch(() => {});
  posthog.capture({ distinctId: userId, event: 'workout_logged', properties: { exercise_count: exercises.length, duration_minutes: duration ?? null, workout_date: date, source, backdated, days_back: Math.max(0, Math.round((Date.parse(today) - Date.parse(date)) / 86_400_000)) } });

  return { log, exercises, shareable, adaptationProposals, prs, backdated, moment };
}

export interface BulkResult {
  created: { id: string; date: string; title: string | null; exercises: number; prs: string[] }[];
  failed: { date: string; title: string | null; error: string }[];
  /** One moment for the batch: its most recent session, saying how many came with it. */
  moment?: ProgressMoment | null;
}

/**
 * A backfill: many past sessions in one go (Anakin's log_past_workouts, the
 * app's paste-from-notes). Oldest first, one at a time, each saved quietly;
 * then the cache, strength profile and streak are settled once for the batch.
 * The streak update is silent — no milestone or comeback push for history.
 * One bad session doesn't sink the rest.
 */
export async function createWorkoutLogsBulk(userId: string, inputs: WorkoutLogInput[], source: 'app' | 'agent' = 'agent', trace?: Record<string, unknown> | null): Promise<BulkResult> {
  const sorted = [...inputs].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const out: BulkResult = { created: [], failed: [] };
  let latest: { id: string; date: string; prs: CreatedWorkout['prs'] } | null = null;
  for (const input of sorted) {
    try {
      const r = await createWorkoutLog(userId, input, source, { quiet: true, trace: trace ?? { via: source === 'agent' ? 'chat' : 'import', basis: 'listed', sentAt: new Date().toISOString() } });
      if (!latest || r.log.date >= latest.date) latest = { id: r.log.id, date: r.log.date, prs: r.prs };
      out.created.push({ id: r.log.id, date: r.log.date, title: r.log.title, exercises: r.exercises.length, prs: r.prs.map((p) => p.displayName) });
    } catch (err: any) {
      out.failed.push({ date: input?.date ?? '?', title: input?.title ?? null, error: String(err?.message ?? err).slice(0, 120) });
    }
  }
  if (out.created.length) {
    invalidate(userId);
    await settleStreakAfterBackfill(userId, [...new Set(out.created.map((c) => c.date))].sort());
  }
  if (latest) out.moment = await momentForWorkout(userId, latest.id, { prs: latest.prs, batch: out.created.length });
  return out;
}

/** Which recordActivity calls settle a batch: one recount for days before the last logged day, then each newer day in order. */
export function streakSettleDates(lastWorkoutDate: string | null | undefined, datesAsc: string[]): string[] {
  if (!lastWorkoutDate) return datesAsc;
  const older = datesAsc.filter((d) => d < lastWorkoutDate);
  const newer = datesAsc.filter((d) => d > lastWorkoutDate);
  // recordActivity's backdated path recounts the whole run from the log
  // dates, so one call at the newest older day covers all of them.
  return [...(older.length ? [older[older.length - 1]] : []), ...newer];
}

/** Streak after a batch, never notifying. */
async function settleStreakAfterBackfill(userId: string, datesAsc: string[]): Promise<void> {
  try {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { lastWorkoutDate: true } });
    for (const d of streakSettleDates(u?.lastWorkoutDate, datesAsc)) await recordActivity(prisma, userId, 'workout', d);
  } catch (err) {
    console.error('[streak] backfill settle error:', err);
  }
}

/** Replace a log's contents. Returns null when it isn't the user's. */
export async function updateWorkoutLog(userId: string, id: string, input: WorkoutLogInput) {
  track(userId, 'workout_edited');
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
  track(userId, 'workout_deleted');
  const existing = await prisma.workoutLog.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) return null;
  await prisma.workoutLog.delete({ where: { id } });
  await dropMomentsForWorkout(id);
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
      duration: row.duration, caloriesBurnedKcal: row.caloriesBurnedKcal, programDayRef: row.programDayRef, logTrace: row.logTrace ?? null,
      createdAt: row.createdAt ? new Date(row.createdAt) : undefined,
    },
  });
  invalidate(userId);
  return restored;
}
