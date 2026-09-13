// Working-set write-through (handoff §10): numbers typed into the diagnostic
// land in the training log, so the user never types them twice.
//
// One WorkoutLog row per diagnostic session, created on the first set and
// rewritten as accessories arrive (including late "Add the missing numbers"
// sets). It deliberately skips the POST /workouts side effects that assume a
// session was just trained — streaks, PR pushes, adaptation proposals — since
// these are recalled working sets, not today's workout. The strength profile
// is recomputed, because that's exactly what these numbers are for.

import { PrismaClient } from '@prisma/client';
import { lbToKg } from '../weightUnits.js';
import type { StoredExercise } from '../workoutExercises.js';
import { recomputeStrengthProfileInBackground } from '../../routes/strength.js';
import { cacheDelete } from '../cacheService.js';
import { LIFT_NAMES, exerciseName, type ConversationLift } from './policy.js';
import type { DiagnosisInputs, SetPayload } from './verdict.js';

const prisma = new PrismaClient();

function toKg(set: SetPayload): number {
  const kg = set.unit === 'kg' ? set.weight : lbToKg(set.weight);
  return Math.round(kg * 10) / 10;
}

export function exercisesFor(inputs: Pick<DiagnosisInputs, 'lift' | 'main' | 'accessories'>): StoredExercise[] {
  const out: StoredExercise[] = [];
  const push = (name: string, set: SetPayload) =>
    out.push({
      name,
      sets: set.sets,
      reps: String(set.reps),
      weightKg: toKg(set),
      setEntries: Array.from({ length: set.sets }, () => ({ weightKg: toKg(set), reps: set.reps })),
    });
  if (inputs.main) push(LIFT_NAMES[inputs.lift], inputs.main);
  for (const [id, rec] of inputs.accessories) {
    if (rec.status === 'logged' && rec.set) push(exerciseName(id), rec.set);
  }
  return out;
}

export async function writeThroughWorkingSets(opts: {
  userId: string;
  sessionId: string;
  workoutLogId: string | null;
  lift: ConversationLift;
  inputs: DiagnosisInputs;
}): Promise<string | null> {
  const exercises = exercisesFor(opts.inputs);
  if (exercises.length === 0) return opts.workoutLogId;
  const data = {
    title: `${LIFT_NAMES[opts.lift]} diagnostic`,
    exercises: JSON.stringify(exercises),
    notes: 'Working sets from your lift diagnostic.',
  };

  let id = opts.workoutLogId;
  if (id) {
    const updated = await prisma.workoutLog.updateMany({ where: { id, userId: opts.userId }, data });
    if (updated.count === 0) id = null; // the user deleted it — start a fresh one
  }
  if (!id) {
    const created = await prisma.workoutLog.create({
      data: { ...data, userId: opts.userId, date: new Date().toISOString().slice(0, 10) },
      select: { id: true },
    });
    id = created.id;
    await prisma.session.update({ where: { id: opts.sessionId }, data: { workoutLogId: id } });
  }

  cacheDelete(`userctx:${opts.userId}`);
  recomputeStrengthProfileInBackground(opts.userId);
  return id;
}
