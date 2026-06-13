// Apply-suggestions write layer — lets the agent turn analysis into action by
// modifying the user's saved training program and nutrition macros. Replicates
// the persist logic of PUT /coach/program and /coach/nutrition-adjustment
// (cache invalidation + dailyCalorieTarget sync + expectedOutcomes recalc) so
// the rest of the app sees the change consistently.
//
// GOAL-PRESERVATION is the priority: applyProgramUpdate validates that the
// agent's proposed program keeps the user's stated goal and a well-formed
// structure before persisting. The agent is also instructed (task framing) to
// propose the change and wait for the user's confirmation before applying.

import { PrismaClient } from '@prisma/client';
import { cacheDelete, cacheClearByPrefix } from '../services/cacheService.js';

const prisma = new PrismaClient();

function invalidateProgramCaches(userId: string) {
  cacheDelete(`program:${userId}`);
  cacheClearByPrefix(`today:${userId}:`);
  cacheClearByPrefix(`schedule:${userId}:`);
  cacheClearByPrefix(`dashboard:${userId}:`);
  cacheDelete(`userctx:${userId}`);
}

export interface MacroChange {
  calories?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
}

/**
 * Apply absolute macro targets to the saved nutrition plan. Any omitted field
 * is left unchanged. Recomputes surplus/deficit + projected weight change from
 * the (possibly new) calories vs. stored TDEE, and syncs dailyCalorieTarget so
 * the Nutrition tab reflects it.
 */
export async function applyMacroChange(userId: string, change: MacroChange) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { savedProgram: true } });
  if (!user?.savedProgram) throw new Error('No saved program to adjust. Generate a program first.');

  const program = JSON.parse(user.savedProgram);
  const macros = program?.nutritionPlan?.macros;
  if (!macros) throw new Error('Saved program has no nutrition plan to adjust.');

  // Apply only provided fields; guard against nonsense values.
  for (const key of ['calories', 'proteinG', 'carbsG', 'fatG'] as const) {
    const v = change[key];
    if (v == null) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 12000) {
      throw new Error(`Invalid ${key}: ${v}`);
    }
    macros[key] = Math.round(v);
  }

  // Recompute outcomes from the new calorie figure vs. stored TDEE.
  const tdee = program?.nutritionPlan?.expectedOutcomes?.tdee;
  if (tdee && typeof macros.calories === 'number') {
    const delta = macros.calories - tdee;
    program.nutritionPlan.expectedOutcomes.surplusOrDeficit = delta;
    program.nutritionPlan.expectedOutcomes.weeklyWeightChangeLb = Math.round((delta / 3500) * 7 * 10) / 10;
    program.nutritionPlan.expectedOutcomes.monthlyWeightChangeLb = Math.round((delta / 3500) * 30 * 10) / 10;
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      savedProgram: JSON.stringify(program),
      ...(typeof macros.calories === 'number' ? { dailyCalorieTarget: Math.round(macros.calories) } : {}),
    },
  });
  invalidateProgramCaches(userId);
  return { macros, expectedOutcomes: program?.nutritionPlan?.expectedOutcomes ?? null };
}

/** Validate a proposed program before persisting. Throws with a clear reason
 *  the agent can act on. Goal preservation is enforced here. */
function validateProgram(updated: any, currentGoal: string | null): void {
  if (!updated || typeof updated !== 'object') throw new Error('updatedProgram must be an object.');
  if (!Array.isArray(updated.phases) || updated.phases.length === 0) {
    throw new Error('updatedProgram.phases must be a non-empty array — preserve the program structure.');
  }
  // Goal is the priority: do not let an "apply" silently change what the user
  // is training for.
  if (currentGoal && updated.goal && updated.goal !== currentGoal) {
    throw new Error(`Refusing to change the program goal (${currentGoal} → ${updated.goal}). Apply changes that keep the existing goal.`);
  }
  for (const phase of updated.phases) {
    if (!Array.isArray(phase.trainingDays) || phase.trainingDays.length === 0) {
      throw new Error('Each phase must keep its trainingDays.');
    }
    for (const day of phase.trainingDays) {
      if (!Array.isArray(day.exercises) || day.exercises.length === 0) {
        throw new Error(`Training day "${day.day ?? '?'}" must keep at least one exercise.`);
      }
    }
  }
}

/**
 * Persist an agent-modified training program. The agent reads the current
 * program (read_program), applies the suggested change while preserving goal +
 * progression, and passes the full updated program here. Validated, then
 * persisted with the same cache + dailyCalorieTarget handling as the program
 * save endpoint.
 */
/**
 * Simpler swap: take exercise NAMES, edit the saved program server-side,
 * persist. Removes the cognitive load on the agent of constructing a full
 * updatedProgram object — it just hands us the from/to names + reason and
 * we do the surgery. Case-insensitive match for the exercise name; also
 * matches the `exercise` field (some entries use `exercise` instead of
 * `name`). Bumps useCount for analytics. Returns how many days were
 * affected so the agent can confirm.
 */
function normExercise(s: string): string {
  return s.toLowerCase().replace(/[—–]/g, '-').replace(/\s+/g, ' ').trim();
}

export async function applyExerciseSwap(userId: string, fromName: string, toName: string, reason?: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { savedProgram: true } });
  if (!user?.savedProgram) throw new Error('No saved program to update. Generate a program first.');
  const program = JSON.parse(user.savedProgram);

  const fromKey = normExercise(fromName);
  const toLabel = toName.trim();
  if (!fromKey || !toLabel) throw new Error('fromExerciseName and toExerciseName are both required.');

  let touched = 0;
  const daysAffected: string[] = [];
  for (const phase of program.phases ?? []) {
    for (const day of phase.trainingDays ?? []) {
      for (const ex of day.exercises ?? []) {
        const nameField = (ex.exercise ?? ex.name ?? '').toString();
        if (normExercise(nameField) === fromKey) {
          // Preserve the original field name so the program shape stays
          // consistent (`exercise` vs `name` is mixed across phases).
          if ('exercise' in ex) ex.exercise = toLabel;
          if ('name' in ex) ex.name = toLabel;
          if (!('exercise' in ex) && !('name' in ex)) ex.name = toLabel;
          touched += 1;
          if (day.day && !daysAffected.includes(day.day)) daysAffected.push(day.day);
        }
      }
    }
  }

  if (touched === 0) {
    return {
      applied: false,
      reason: `Could not find "${fromName}" in your program. Try the exact name as listed in today's workout.`,
      occurrences: 0,
    };
  }

  await prisma.user.update({
    where: { id: userId },
    data: { savedProgram: JSON.stringify(program) },
  });
  invalidateProgramCaches(userId);

  return {
    applied: true,
    occurrences: touched,
    daysAffected,
    summary: `Swapped ${fromName} → ${toLabel} across ${touched} occurrence(s)${reason ? ` (${reason})` : ''}.`,
  };
}

export async function applyProgramUpdate(userId: string, updatedProgram: any) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { savedProgram: true } });
  if (!user?.savedProgram) throw new Error('No saved program to update. Generate a program first.');
  const current = JSON.parse(user.savedProgram);

  validateProgram(updatedProgram, current?.goal ?? null);

  // Sync calorie target if the updated program carries nutrition macros.
  const programCalories = updatedProgram?.nutritionPlan?.macros?.calories ?? null;

  await prisma.user.update({
    where: { id: userId },
    data: {
      savedProgram: JSON.stringify(updatedProgram),
      ...(programCalories != null ? { dailyCalorieTarget: Math.round(programCalories) } : {}),
    },
  });
  invalidateProgramCaches(userId);

  const dayCount = updatedProgram.phases.reduce((n: number, p: any) => n + (p.trainingDays?.length ?? 0), 0);
  return { applied: true, phases: updatedProgram.phases.length, trainingDays: dayCount, goal: updatedProgram.goal };
}
