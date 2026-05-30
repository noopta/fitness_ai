// Archive a user's prior program with a stats snapshot the history screen
// can render without re-querying every related log. Called from the program
// save endpoint (when a new program replaces an existing one) and from the
// explicit "finish program" flow once we add it.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface ProgramArchiveStats {
  workoutsLogged: number;
  daysActive: number;
  totalVolumeLb: number;
  bodyWeightStartLb: number | null;
  bodyWeightEndLb: number | null;
  bodyWeightChangeLb: number | null;
  durationWeeks: number | null;
}

function safeParse(json: string | null): any {
  if (!json) return null;
  try { return JSON.parse(json); } catch { return null; }
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function computeVolumeLb(exercisesJson: string | null): number {
  // Schema stores exercises as a JSON string of [{ sets, reps, weight, weightLbs, ... }].
  // Same logic the strength-profile screen uses — defensive against missing fields.
  const arr = safeParse(exercisesJson);
  if (!Array.isArray(arr)) return 0;
  let total = 0;
  for (const ex of arr) {
    const sets = Number(ex?.sets ?? 0);
    const reps = Number(ex?.reps ?? 0);
    // Prefer explicit lb; fall back to kg→lb conversion if present.
    const weightLb = ex?.weightLbs != null
      ? Number(ex.weightLbs)
      : (ex?.weightKg != null ? Number(ex.weightKg) * 2.20462 : Number(ex?.weight ?? 0));
    if (!Number.isFinite(sets) || !Number.isFinite(reps) || !Number.isFinite(weightLb)) continue;
    if (ex?.bodyweight) continue; // bodyweight exercises don't contribute to external volume
    total += sets * reps * weightLb;
  }
  return Math.round(total);
}

export async function computeProgramStats(
  userId: string,
  startDate: Date,
  endDate: Date,
  programObj: any | null,
): Promise<ProgramArchiveStats> {
  const startIso = isoDate(startDate);
  const endIso = isoDate(endDate);

  // Workouts logged inside the program window. We index by (userId, date) so
  // this is one cheap scan.
  const workouts = await prisma.workoutLog.findMany({
    where: { userId, date: { gte: startIso, lte: endIso } },
    select: { date: true, exercises: true },
  });
  const daysActive = new Set(workouts.map((w) => w.date)).size;
  const totalVolumeLb = workouts.reduce((s, w) => s + computeVolumeLb(w.exercises), 0);

  // First and last body-weight reading inside the window (if any). Both index
  // hits — also indexed by (userId, date).
  const [first, last] = await Promise.all([
    prisma.bodyWeightLog.findFirst({
      where: { userId, date: { gte: startIso, lte: endIso } },
      orderBy: { date: 'asc' },
      select: { weightLbs: true },
    }),
    prisma.bodyWeightLog.findFirst({
      where: { userId, date: { gte: startIso, lte: endIso } },
      orderBy: { date: 'desc' },
      select: { weightLbs: true },
    }),
  ]);
  const bodyWeightStartLb = first?.weightLbs ?? null;
  const bodyWeightEndLb = last?.weightLbs ?? null;
  const bodyWeightChangeLb = (bodyWeightStartLb != null && bodyWeightEndLb != null)
    ? Math.round((bodyWeightEndLb - bodyWeightStartLb) * 10) / 10
    : null;

  const durationWeeks = programObj?.durationWeeks ?? null;

  return {
    workoutsLogged: workouts.length,
    daysActive,
    totalVolumeLb,
    bodyWeightStartLb,
    bodyWeightEndLb,
    bodyWeightChangeLb,
    durationWeeks,
  };
}

/**
 * Archive the given saved program as a CompletedProgram. Idempotent at the
 * call site — callers should only invoke this when they're about to replace
 * the saved program (or when they explicitly want to finalize one).
 *
 * Returns the created row, or null if the program JSON is missing/unparseable
 * (don't archive empty placeholders).
 */
export async function archiveProgram(
  userId: string,
  savedProgramJson: string | null,
  startDate: Date | null,
  reason: 'replaced' | 'completed',
): Promise<{ id: string } | null> {
  if (!savedProgramJson) return null;
  const programObj = safeParse(savedProgramJson);
  if (!programObj || typeof programObj !== 'object') return null;

  const effectiveStart = startDate ?? new Date();
  const endDate = new Date();
  const stats = await computeProgramStats(userId, effectiveStart, endDate, programObj);

  const created = await prisma.completedProgram.create({
    data: {
      userId,
      programJson: savedProgramJson,
      startDate: effectiveStart,
      endDate,
      goal: typeof programObj.goal === 'string' ? programObj.goal : null,
      durationWeeks: typeof programObj.durationWeeks === 'number' ? programObj.durationWeeks : null,
      daysPerWeek: typeof programObj.daysPerWeek === 'number' ? programObj.daysPerWeek : null,
      stats: JSON.stringify(stats),
      reason,
    },
    select: { id: true },
  });
  return created;
}
