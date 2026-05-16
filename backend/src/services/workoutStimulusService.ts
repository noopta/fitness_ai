// Workout stimulus dissection. Takes a logged workout and breaks it down
// into a per-muscle stimulus map: which muscles were worked, how much
// volume (tonnage + hard sets), in which intensity zones, and at what
// estimated e1RM. This is the "dissection" step of the Athlete Model —
// it converts raw logs into the structured signal the per-muscle ledger
// (Phase 2) accumulates over time.
//
// Pure + deterministic: same workout in, same dissection out. No DB, no
// side effects — callers (the ledger builder, the strength route) own
// persistence and caching.

import { muscleWeightsFor, type MuscleGroup } from '../data/muscleAttribution.js';
import {
  movementPatternFor, intensityZone, type MovementPattern, type IntensityZone,
} from '../data/liftMechanics.js';
import { e1rmWithRpe, parseRPE } from '../engine/e1rm.js';

/** One logged exercise as it appears in a WorkoutLog's exercises JSON. */
export interface LoggedExercise {
  name: string;            // canonical name (caller normalizes before passing)
  sets: number;
  reps: string | number;   // may be a range string like "8-10"
  weightKg?: number | null;
  rpe?: string | number | null;
}

/** Per-muscle stimulus accumulated from one workout (or many). */
export interface MuscleStimulus {
  tonnageKg: number;                       // Σ weight × reps × setCount × muscleWeight
  hardSets: number;                        // Σ setCount × muscleWeight (a "fractional set" count)
  byZone: Record<IntensityZone, number>;   // tonnage split across intensity zones
  bestE1rmKg: number;                      // highest contributing e1RM seen for this muscle
}

export interface WorkoutStimulus {
  perMuscle: Partial<Record<MuscleGroup, MuscleStimulus>>;
  patternsCovered: Partial<Record<MovementPattern, number>>; // pattern → hard-set count
  totalTonnageKg: number;
  totalHardSets: number;
}

function firstRepValue(reps: string | number): number {
  if (typeof reps === 'number') return Math.max(0, Math.round(reps));
  const m = String(reps).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function emptyMuscleStimulus(): MuscleStimulus {
  return {
    tonnageKg: 0,
    hardSets: 0,
    byZone: { strength: 0, hypertrophy: 0, endurance: 0, power: 0 },
    bestE1rmKg: 0,
  };
}

/**
 * Dissect a set of logged exercises into a per-muscle stimulus map.
 * `exercises` should already have canonical names — the caller normalizes.
 */
export function dissectWorkout(exercises: LoggedExercise[]): WorkoutStimulus {
  const perMuscle: Partial<Record<MuscleGroup, MuscleStimulus>> = {};
  const patternsCovered: Partial<Record<MovementPattern, number>> = {};
  let totalTonnageKg = 0;
  let totalHardSets = 0;

  for (const ex of exercises) {
    const reps = firstRepValue(ex.reps);
    const setCount = Math.max(0, Math.round(ex.sets));
    const weightKg = ex.weightKg ?? 0;
    if (reps <= 0 || setCount <= 0) continue;

    const weights = muscleWeightsFor(ex.name);
    if (Object.keys(weights).length === 0) continue; // unmapped lift — skip

    const zone = intensityZone(ex.name, reps);
    const setTonnage = weightKg > 0 ? weightKg * reps * setCount : 0;
    const e1rm = weightKg > 0 ? e1rmWithRpe(weightKg, reps, parseRPE(ex.rpe)) : 0;

    totalTonnageKg += setTonnage;
    totalHardSets += setCount;

    const pattern = movementPatternFor(ex.name);
    if (pattern) {
      patternsCovered[pattern] = (patternsCovered[pattern] ?? 0) + setCount;
    }

    for (const [muscle, weight] of Object.entries(weights) as Array<[MuscleGroup, number]>) {
      const slot = (perMuscle[muscle] ??= emptyMuscleStimulus());
      const muscleTonnage = setTonnage * weight;
      slot.tonnageKg += muscleTonnage;
      slot.hardSets += setCount * weight;
      slot.byZone[zone] += muscleTonnage;
      if (e1rm > slot.bestE1rmKg) slot.bestE1rmKg = e1rm;
    }
  }

  // Round tonnage for cleanliness — hardSets stays fractional (it's a
  // weighted count, not a literal integer).
  for (const slot of Object.values(perMuscle)) {
    if (!slot) continue;
    slot.tonnageKg = Math.round(slot.tonnageKg);
    slot.hardSets = Math.round(slot.hardSets * 10) / 10;
    for (const z of Object.keys(slot.byZone) as IntensityZone[]) {
      slot.byZone[z] = Math.round(slot.byZone[z]);
    }
  }

  return {
    perMuscle,
    patternsCovered,
    totalTonnageKg: Math.round(totalTonnageKg),
    totalHardSets,
  };
}

/**
 * Merge many workout dissections into one cumulative stimulus — used by the
 * per-muscle ledger to roll a rolling window (e.g. last 4 weeks) into a
 * single view. Tonnage + hard sets + zone splits sum; bestE1rm takes the max.
 */
export function mergeStimulus(parts: WorkoutStimulus[]): WorkoutStimulus {
  const merged: WorkoutStimulus = {
    perMuscle: {},
    patternsCovered: {},
    totalTonnageKg: 0,
    totalHardSets: 0,
  };
  for (const part of parts) {
    merged.totalTonnageKg += part.totalTonnageKg;
    merged.totalHardSets += part.totalHardSets;
    for (const [pat, n] of Object.entries(part.patternsCovered) as Array<[MovementPattern, number]>) {
      merged.patternsCovered[pat] = (merged.patternsCovered[pat] ?? 0) + n;
    }
    for (const [muscle, s] of Object.entries(part.perMuscle) as Array<[MuscleGroup, MuscleStimulus]>) {
      const slot = (merged.perMuscle[muscle] ??= emptyMuscleStimulus());
      slot.tonnageKg += s.tonnageKg;
      slot.hardSets = Math.round((slot.hardSets + s.hardSets) * 10) / 10;
      slot.bestE1rmKg = Math.max(slot.bestE1rmKg, s.bestE1rmKg);
      for (const z of Object.keys(slot.byZone) as IntensityZone[]) {
        slot.byZone[z] += s.byZone[z];
      }
    }
  }
  return merged;
}
