// Positive-reinforcement detection for strength PRs, body-weight progress
// milestones, and protein-target consistency. All functions are stateless and
// derive milestones from existing logs — no new schema fields required.
//
// The notifications themselves live in notificationService.ts; this module
// only decides "did this log cross a meaningful threshold?".

import type { PrismaClient } from '@prisma/client';
import {
  notifyNewPR,
  notifyWeightProgress,
} from './notificationService.js';

// ─── Strength PR detection ────────────────────────────────────────────────────

interface LoggedSetEntry {
  weightKg?: number | null;
  reps: number;
  rpe?: number | null;
}

interface LoggedExercise {
  name: string;
  sets: number;
  reps: number | string;
  weightKg?: number | null;
  rpe?: number | null;
  // When present, per-set breakdown is the source of truth for e1RM and
  // diagnostic strength signals. Each entry is one working set.
  setEntries?: LoggedSetEntry[] | null;
}

/** Epley 1RM. Reps clamped to 10 — past that the estimate diverges fast. */
export function epley1RM(weightLbs: number, reps: number): number {
  const r = Math.min(Math.max(reps, 1), 10);
  return Math.round(weightLbs * (1 + r / 30));
}

function lowerRep(reps: number | string): number | null {
  if (typeof reps === 'number') return Number.isFinite(reps) ? reps : null;
  const s = String(reps).trim();
  const m = s.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function normalizeLiftName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Compute best e1RM per lift across a set of logged exercises (in lbs).
 *
 * When `setEntries` is present, we compute e1RM for each set independently
 * and keep the highest — this is the realistic top-set estimate. Otherwise
 * we fall back to the uniform `weightKg`/`reps` shape (legacy logs and
 * single-load workouts).
 *
 * weightKg → lbs since notifications/UI use imperial units.
 */
export function bestE1RMByLift(exercises: LoggedExercise[]): Map<string, { displayName: string; e1RMLbs: number }> {
  const out = new Map<string, { displayName: string; e1RMLbs: number }>();

  function consider(key: string, displayName: string, e1RMLbs: number) {
    const existing = out.get(key);
    if (!existing || e1RMLbs > existing.e1RMLbs) {
      out.set(key, { displayName, e1RMLbs });
    }
  }

  for (const ex of exercises) {
    const key = normalizeLiftName(ex.name);
    const displayName = ex.name.trim();

    if (ex.setEntries && ex.setEntries.length > 0) {
      // Per-set path: evaluate each set on its own merits. The top set may be
      // a heavy 4-rep effort while later sets are lighter back-off sets — the
      // heavy one drives the e1RM, not an average.
      for (const set of ex.setEntries) {
        if (!set.weightKg || set.weightKg <= 0) continue;
        if (set.reps < 1 || set.reps > 10) continue;
        const lbs = set.weightKg * 2.20462;
        consider(key, displayName, epley1RM(lbs, set.reps));
      }
      continue;
    }

    // Legacy path: a single weight + rep range for all sets.
    if (!ex.weightKg || ex.weightKg <= 0) continue;
    const reps = lowerRep(ex.reps);
    if (reps == null || reps < 1 || reps > 10) continue;
    const lbs = ex.weightKg * 2.20462;
    consider(key, displayName, epley1RM(lbs, reps));
  }
  return out;
}

/**
 * Detect PRs vs the user's prior history and fire `notifyNewPR` for each.
 * Filters out trivially-light lifts (< 50 lbs) and tiny improvements (< 2.5 lbs)
 * so the user isn't pinged on every warmup or noise-level rerack.
 */
export async function detectAndNotifyStrengthPRs(
  prisma: PrismaClient,
  userId: string,
  newWorkoutId: string,
  newExercises: LoggedExercise[],
): Promise<void> {
  const newBests = bestE1RMByLift(newExercises);
  if (newBests.size === 0) return;

  // Pull prior logs (excluding this one) — keep this bounded; 200 most recent
  // workouts is enough to establish a lifetime PR baseline for typical users.
  const prior = await prisma.workoutLog.findMany({
    where: { userId, NOT: { id: newWorkoutId } },
    orderBy: { date: 'desc' },
    take: 200,
    select: { exercises: true },
  });

  const lifetimeBest = new Map<string, number>();
  for (const log of prior) {
    let exs: LoggedExercise[];
    try { exs = JSON.parse(log.exercises); } catch { continue; }
    if (!Array.isArray(exs)) continue;
    const bests = bestE1RMByLift(exs);
    for (const [k, v] of bests) {
      const cur = lifetimeBest.get(k) ?? 0;
      if (v.e1RMLbs > cur) lifetimeBest.set(k, v.e1RMLbs);
    }
  }

  for (const [key, { displayName, e1RMLbs }] of newBests) {
    if (e1RMLbs < 50) continue; // ignore body-weight / warm-up territory
    const prev = lifetimeBest.get(key) ?? 0;
    if (e1RMLbs >= prev + 2.5 && prev > 0) {
      // Real PR — they had a baseline and beat it by a meaningful margin.
      await notifyNewPR(userId, displayName, e1RMLbs, 'lbs').catch(() => {});
    }
    // First-ever entry for a lift (prev === 0) is not announced as a PR — too
    // noisy when a user is just exploring exercises. Reinforcement only kicks
    // in once we have a baseline to beat.
  }
}

// ─── Body-weight progress ─────────────────────────────────────────────────────

const FAT_LOSS_MILESTONES_LBS = [5, 10, 15, 20, 25, 30, 40, 50];
const MASS_GAIN_MILESTONES_LBS = [5, 10, 15, 20, 25];

export type GoalDirection = 'lose' | 'gain' | 'maintain';

/** Mirror nutritionEngine's goal-keyword logic so reinforcement aligns with plan. */
export function inferGoalDirection(coachGoal: string | null | undefined): GoalDirection {
  const g = (coachGoal ?? '').toLowerCase();
  const isFatLoss = ['loss', 'cut', 'lean', 'lose', 'deficit', 'shred', 'slim', 'drop']
    .some(k => g.includes(k));
  const isMassGain = ['gain', 'bulk', 'mass', 'surplus'].some(k => g.includes(k));
  if (isFatLoss && !isMassGain) return 'lose';
  if (isMassGain) return 'gain';
  return 'maintain';
}

/**
 * Pure helper. Returns milestones the user crossed *between* the prior weight
 * and the current one, given their goal direction. Used both at runtime and
 * in tests — keeping it pure makes the threshold logic auditable.
 */
export function crossedWeightMilestones(
  startingLbs: number,
  prevLbs: number | null,
  currLbs: number,
  direction: GoalDirection,
): number[] {
  if (direction === 'maintain') return [];
  const milestones = direction === 'lose' ? FAT_LOSS_MILESTONES_LBS : MASS_GAIN_MILESTONES_LBS;
  // Cumulative delta: positive when user is moving in their goal direction.
  const sign = direction === 'lose' ? 1 : -1;
  const currDelta = sign * (startingLbs - currLbs);
  const prevDelta = prevLbs == null ? 0 : sign * (startingLbs - prevLbs);
  return milestones.filter(m => currDelta >= m && prevDelta < m);
}

export async function detectAndNotifyWeightMilestone(
  prisma: PrismaClient,
  userId: string,
  newDate: string,
  newWeightLbs: number,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { coachGoal: true },
  });
  const direction = inferGoalDirection(user?.coachGoal);
  if (direction === 'maintain') return;

  // Need a starting baseline + the prior log just before today.
  const [first, prior] = await Promise.all([
    prisma.bodyWeightLog.findFirst({
      where: { userId },
      orderBy: { date: 'asc' },
      select: { weightLbs: true, date: true },
    }),
    prisma.bodyWeightLog.findFirst({
      where: { userId, date: { lt: newDate } },
      orderBy: { date: 'desc' },
      select: { weightLbs: true },
    }),
  ]);

  if (!first || first.date === newDate) return; // need at least one prior anchor
  const milestones = crossedWeightMilestones(
    first.weightLbs,
    prior?.weightLbs ?? null,
    newWeightLbs,
    direction,
  );

  for (const m of milestones) {
    await notifyWeightProgress(userId, m, direction).catch(() => {});
  }
}

// ─── Protein target consistency ───────────────────────────────────────────────

const PROTEIN_HIT_THRESHOLD = 0.85;
const PROTEIN_LOOKBACK_DAYS = 21;

/**
 * Daily protein target in grams. Mirrors the nutritionEngine.calcMacroTargets
 * formula so the reinforcement thresholds match the plan the user sees.
 * Returns null if we don't have enough info to compute a target.
 */
export function computeProteinTargetG(weightKg: number | null | undefined, coachGoal: string | null | undefined): number | null {
  if (!weightKg || weightKg <= 0) return null;
  const g = (coachGoal ?? '').toLowerCase();
  const isFatLoss = ['loss', 'cut', 'lean', 'lose', 'deficit', 'shred', 'slim', 'drop', 'fat']
    .some(k => g.includes(k));
  const isMassGain = ['gain', 'bulk', 'mass', 'surplus'].some(k => g.includes(k));
  const isHypertrophy = g.includes('hypertrophy') || g.includes('muscle');
  let perKg = 1.8;
  if (g.includes('strength')) perKg = 2.0;
  if (isHypertrophy) perKg = 2.1;
  if (g.includes('endurance')) perKg = 1.6;
  if (isFatLoss && !isMassGain) perKg = 2.2;
  if (isMassGain) perKg = 2.0;
  return Math.round(weightKg * perKg);
}

function dateAddDaysStr(dateStr: string, deltaDays: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().split('T')[0];
}

/**
 * Walk backwards from today, counting consecutive days the user hit
 * ≥85% of their protein target. Returns 0 if today isn't a hit.
 */
export function computeProteinStreak(
  todayStr: string,
  proteinByDate: Map<string, number>,
  targetG: number,
): number {
  const cutoff = Math.round(targetG * PROTEIN_HIT_THRESHOLD);
  let streak = 0;
  let cursor = todayStr;
  for (let i = 0; i < PROTEIN_LOOKBACK_DAYS; i++) {
    const got = proteinByDate.get(cursor);
    if (got == null || got < cutoff) break;
    streak += 1;
    cursor = dateAddDaysStr(cursor, -1);
  }
  return streak;
}

export async function detectAndNotifyProteinHit(
  prisma: PrismaClient,
  userId: string,
  dateStr: string,
  proteinGToday: number,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { weightKg: true, coachGoal: true },
  });
  const target = computeProteinTargetG(user?.weightKg, user?.coachGoal);
  if (!target) return;

  const cutoff = Math.round(target * PROTEIN_HIT_THRESHOLD);
  if (proteinGToday < cutoff) return; // not a hit — no nudge

  const since = dateAddDaysStr(dateStr, -(PROTEIN_LOOKBACK_DAYS - 1));
  const logs = await prisma.nutritionLog.findMany({
    where: { userId, date: { gte: since, lte: dateStr } },
    select: { date: true, proteinG: true },
  });
  const byDate = new Map<string, number>();
  for (const l of logs) {
    // If multiple logs for same date (shouldn't happen given upsert), keep max
    byDate.set(l.date, Math.max(byDate.get(l.date) ?? 0, l.proteinG));
  }
  // Make sure today's just-saved value is reflected even if the read happens
  // before the write becomes visible.
  byDate.set(dateStr, Math.max(byDate.get(dateStr) ?? 0, proteinGToday));

  // Protein-goal recognition is now an IN-APP celebration only (handled on the
  // client when the protein ring reaches 100%), per product decision — we do
  // NOT fire a push notification for hitting the protein goal or for protein
  // streak milestones. The streak is still computed above in case future
  // surfaces want it, but no push is sent here.
  void computeProteinStreak(dateStr, byDate, target);
}
