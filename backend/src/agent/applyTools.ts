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

/** Normalize a training-day label ("Day 1", "Push") for matching. */
function normDay(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Every distinct exercise display-name present in the program. When dayFilter is
 * given, only exercises on training days whose label matches it are returned —
 * this scopes a swap to one day ("today's workout") instead of the whole plan.
 */
export function collectExerciseNames(program: any, dayFilter?: string | null): string[] {
  const wantDay = dayFilter ? normDay(dayFilter) : null;
  const names = new Set<string>();
  for (const phase of program?.phases ?? [])
    for (const day of phase?.trainingDays ?? []) {
      if (wantDay && normDay(String(day?.day ?? '')) !== wantDay) continue;
      for (const ex of day?.exercises ?? [])
        names.add(String(ex?.exercise ?? ex?.name ?? '').trim());
    }
  names.delete('');
  return [...names];
}

/**
 * Resolve a free-text exercise name to a SINGLE exercise that actually exists in
 * the program — never invent or accept a name that isn't stored. This is what
 * makes "use the already-stored names" real: the agent can only act on entries
 * the program contains, and ambiguity becomes a clarifying question instead of a
 * silent no-op or a wrong swap.
 *   1. exact normalized match            -> resolve
 *   2. exactly one substring match        -> resolve (e.g. "bench" -> "Barbell Bench Press")
 *   3. multiple / none                    -> candidates (closest stored names, else the list)
 */
export function resolveExerciseTarget(
  program: any,
  fromName: string,
  dayFilter?: string | null,
): { resolvedKey: string | null; resolvedName: string | null; candidates: string[] } {
  const fromKey = normExercise(fromName);
  const all = collectExerciseNames(program, dayFilter);
  if (!fromKey || all.length === 0) return { resolvedKey: null, resolvedName: null, candidates: all };

  // 1. Exact normalized match.
  const exact = all.find(n => normExercise(n) === fromKey);
  if (exact) return { resolvedKey: fromKey, resolvedName: exact, candidates: [] };

  // 2. Substring either direction; resolve only if it points to ONE stored exercise.
  const subs = all.filter(n => {
    const k = normExercise(n);
    return k.includes(fromKey) || fromKey.includes(k);
  });
  const distinct = [...new Set(subs.map(normExercise))];
  if (distinct.length === 1) {
    const name = subs.find(n => normExercise(n) === distinct[0])!;
    return { resolvedKey: distinct[0], resolvedName: name, candidates: [] };
  }
  if (subs.length > 0) return { resolvedKey: null, resolvedName: null, candidates: [...new Set(subs)] };

  // 3. Token overlap as a hint; otherwise surface the actual list to choose from.
  const fromTokens = new Set(fromKey.split(' ').filter(Boolean));
  const scored = all
    .map(n => ({ n, score: normExercise(n).split(' ').filter(t => fromTokens.has(t)).length }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length) return { resolvedKey: null, resolvedName: null, candidates: scored.slice(0, 6).map(x => x.n) };
  return { resolvedKey: null, resolvedName: null, candidates: all.slice(0, 12) };
}

// ─── Plan Patch proposal (Flow A — propose, do NOT mutate) ───────────────────

export interface PlanPatchProposal {
  kind: 'plan_patch';
  day: string | null;
  scope: 'day' | 'program';
  from: { name: string; sets?: number | string; reps?: number | string };
  to: { name: string; sets?: number | string; reps?: number | string };
  meta: { primaryTarget?: string[]; equipment?: string; stimulusDelta?: string; shoulderLoad?: string };
  rationale: string;
  summary: string;
}

/** Current sets/reps of the resolved exercise (first match within scope). */
function findExerciseScheme(program: any, resolvedKey: string, dayFilter: string | null): { sets?: any; reps?: any } {
  const wantDay = dayFilter ? normDay(dayFilter) : null;
  for (const phase of program?.phases ?? [])
    for (const d of phase?.trainingDays ?? []) {
      if (wantDay && normDay(String(d?.day ?? '')) !== wantDay) continue;
      for (const ex of d?.exercises ?? []) {
        const nameField = (ex?.exercise ?? ex?.name ?? '').toString();
        if (normExercise(nameField) === resolvedKey) return { sets: ex?.sets, reps: ex?.reps };
      }
    }
  return {};
}

/**
 * Build a Plan Patch proposal WITHOUT mutating (the assistant proposes; the user
 * disposes). Resolves the from-name against actually-stored names (scoped to the
 * day by default); ambiguous/missing -> candidates so the agent re-proposes with
 * the exact one. Carries the diff-card payload (from/to scheme + meta + rationale).
 */
export function buildPlanPatchProposal(
  program: any,
  args: {
    fromName: string; toName: string;
    toSets?: number | string; toReps?: number | string;
    scope?: 'day' | 'program'; day?: string;
    primaryTarget?: string[]; equipment?: string;
    stimulusDelta?: string; shoulderLoad?: string;
    rationale?: string;
  },
): { ok: true; proposal: PlanPatchProposal } | { ok: false; candidates: string[]; reason: string } {
  const toName = (args.toName ?? '').trim();
  if (!args.fromName?.trim() || !toName) {
    return { ok: false, candidates: [], reason: 'fromName and toName are both required.' };
  }
  const scope: 'day' | 'program' = args.scope === 'program' ? 'program' : 'day';
  const day = args.day?.trim() || null;
  if (scope === 'day' && !day) {
    return { ok: false, candidates: [], reason: "scope 'day' needs a day label (from read_schedule_week), or pass scope:'program'." };
  }
  const dayFilter = scope === 'program' ? null : day;

  const { resolvedKey, resolvedName, candidates } = resolveExerciseTarget(program, args.fromName, dayFilter);
  if (!resolvedKey || !resolvedName) {
    return {
      ok: false,
      candidates,
      reason: candidates.length
        ? `"${args.fromName}" didn't resolve to one exercise${dayFilter ? ` on ${day}` : ''}. Choose from: ${candidates.join(', ')}.`
        : `No exercises found${dayFilter ? ` on ${day}` : ' in the program'}.`,
    };
  }

  const fromScheme = findExerciseScheme(program, resolvedKey, dayFilter);
  return {
    ok: true,
    proposal: {
      kind: 'plan_patch',
      day,
      scope,
      from: { name: resolvedName, sets: fromScheme.sets, reps: fromScheme.reps },
      to: { name: toName, sets: args.toSets ?? fromScheme.sets, reps: args.toReps ?? fromScheme.reps },
      meta: {
        primaryTarget: args.primaryTarget,
        equipment: args.equipment,
        stimulusDelta: args.stimulusDelta,
        shoulderLoad: args.shoulderLoad,
      },
      rationale: args.rationale ?? '',
      summary: `Swap ${resolvedName} → ${toName} on ${dayFilter ? day : 'the whole plan'}.`,
    },
  };
}

export async function applyExerciseSwap(
  userId: string,
  fromName: string,
  toName: string,
  reason?: string,
  opts?: { scope?: 'day' | 'program'; day?: string },
) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { savedProgram: true } });
  if (!user?.savedProgram) throw new Error('No saved program to update. Generate a program first.');
  const program = JSON.parse(user.savedProgram);

  const toLabel = toName.trim();
  if (!fromName.trim() || !toLabel) throw new Error('fromExerciseName and toExerciseName are both required.');

  // Scope: 'day' (DEFAULT) changes only the named day's workout — today's day by
  // default; 'program' changes the exercise everywhere it appears in the plan.
  const scope = opts?.scope === 'program' ? 'program' : 'day';
  const day = opts?.day?.trim() || null;
  if (scope === 'day' && !day) {
    return {
      applied: false,
      occurrences: 0,
      reason: "Scope 'day' needs a day label — call read_schedule_week to get today's day (or the day the user means), or pass scope:'program' to change it across the whole plan.",
    };
  }
  const dayFilter = scope === 'program' ? null : day;

  // Resolve the from-name against names that ACTUALLY exist in the scoped set.
  // Ambiguous/missing -> candidates, so the agent re-calls with the exact name
  // instead of silently changing nothing while reporting success.
  const { resolvedKey, resolvedName, candidates } = resolveExerciseTarget(program, fromName, dayFilter);
  if (!resolvedKey) {
    const where = dayFilter ? ` on ${day}` : ' in the program';
    return {
      applied: false,
      occurrences: 0,
      candidates,
      reason: candidates.length
        ? `"${fromName}" didn't resolve to one exercise${where}. Stored names to choose from: ${candidates.join(', ')}. Re-call with the exact stored name.`
        : `No exercises found${where}.`,
    };
  }

  const wantDay = dayFilter ? normDay(dayFilter) : null;
  let touched = 0;
  const daysAffected: string[] = [];
  for (const phase of program.phases ?? []) {
    for (const d of phase.trainingDays ?? []) {
      if (wantDay && normDay(String(d.day ?? '')) !== wantDay) continue;
      for (const ex of d.exercises ?? []) {
        const nameField = (ex.exercise ?? ex.name ?? '').toString();
        if (normExercise(nameField) === resolvedKey) {
          // Preserve the original field name (`exercise` vs `name` is mixed).
          if ('exercise' in ex) ex.exercise = toLabel;
          if ('name' in ex) ex.name = toLabel;
          if (!('exercise' in ex) && !('name' in ex)) ex.name = toLabel;
          touched += 1;
          if (d.day && !daysAffected.includes(d.day)) daysAffected.push(d.day);
        }
      }
    }
  }

  if (touched === 0) {
    return { applied: false, occurrences: 0, candidates, reason: `Could not apply the swap for "${resolvedName ?? fromName}".` };
  }

  await prisma.user.update({ where: { id: userId }, data: { savedProgram: JSON.stringify(program) } });
  invalidateProgramCaches(userId);

  return {
    applied: true,
    occurrences: touched,
    daysAffected,
    resolvedFrom: resolvedName,
    scope,
    summary: dayFilter
      ? `Swapped ${resolvedName} → ${toLabel} on ${daysAffected.join(', ')}${reason ? ` (${reason})` : ''}.`
      : `Swapped ${resolvedName} → ${toLabel} across ${touched} occurrence(s) in the program${reason ? ` (${reason})` : ''}.`,
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
