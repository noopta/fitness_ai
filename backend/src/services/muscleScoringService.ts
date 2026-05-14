// Per-muscle strength scoring. Takes a user's lifts (with e1RMs) and rolls
// them up into a 0-100 score for each muscle group via the lift-to-muscle
// attribution map. Drives the radar drill-down on the Strength Profile
// screen (level 2: tap "Pull" on the radar → muscle-level sub-radar).
//
// Scoring math:
//   raw_score(muscle) = Σ over user's lifts: log1p(e1RM_kg) × muscle_weight(lift)
//   normalized(muscle) = round(raw / max(raw across all muscles) × 100)
//
// Why log1p:
//   Without it, a deadlift (300 kg e1RM × 0.25 = 75 raw) would dwarf a curl
//   (40 kg e1RM × 0.95 = 38 raw) so much that biceps would always look
//   strong relative to hamstrings even if the user trains them equally.
//   log1p(300) = 5.71, log1p(40) = 3.71 — same lifts contribute much
//   closer-to-proportionate raw values. Standard practice in strength-cohort
//   normalization.
//
// Why user-relative normalization (not cohort-relative):
//   Cohort would let us say "your chest is in the 78th percentile of
//   athletes." We don't have a baseline cohort dataset yet. User-relative
//   correctly answers "which of YOUR muscles are strongest/weakest" — which
//   is what the radar visualizes. Cohort can be layered in later by replacing
//   the normalizer without changing this function's shape.

import { muscleWeightsFor, MUSCLE_GROUPS, type MuscleGroup } from '../data/muscleAttribution.js';

export interface UserLiftInput {
  canonicalName: string;
  current1RMkg: number; // e1RM in kg
}

export type MuscleScores = Partial<Record<MuscleGroup, number>>;

/**
 * Compute per-muscle strength scores from a user's canonical lifts.
 * Returns scores keyed by MuscleGroup, normalized 0-100 within the user.
 *
 * Muscles with no contributing lift get omitted from the result (rather
 * than scoring 0) so the radar can render an em-dash placeholder instead
 * of a falsely-zero score that implies "tested and zero."
 */
export function computeMuscleScores(lifts: UserLiftInput[]): MuscleScores {
  if (lifts.length === 0) return {};

  // Step 1: accumulate raw contributions per muscle
  const raw: Partial<Record<MuscleGroup, number>> = {};
  for (const lift of lifts) {
    if (!lift.current1RMkg || lift.current1RMkg <= 0) continue;
    const weights = muscleWeightsFor(lift.canonicalName);
    const logE1rm = Math.log1p(lift.current1RMkg);
    for (const [muscle, weight] of Object.entries(weights) as Array<[MuscleGroup, number]>) {
      raw[muscle] = (raw[muscle] ?? 0) + logE1rm * weight;
    }
  }

  // Step 2: normalize to 0-100 against the user's own max-scoring muscle.
  // If only one muscle scored anything (rare — usually a brand-new user with
  // one logged lift), it gets 100 and the rest are omitted.
  const values = Object.values(raw).filter((v): v is number => typeof v === 'number');
  if (values.length === 0) return {};
  const max = Math.max(...values);
  if (max <= 0) return {};

  const normalized: MuscleScores = {};
  for (const [muscle, val] of Object.entries(raw) as Array<[MuscleGroup, number]>) {
    normalized[muscle] = Math.round((val / max) * 100);
  }
  return normalized;
}

/**
 * Default target scores for the muscle-level radar's target polygon.
 * These match the movement-level default (80/100) so the visual reads
 * consistently across drill-down levels — a muscle in-band looks the same
 * as a movement bucket in-band.
 *
 * Future enhancement: per-muscle targets weighted by athlete archetype
 * (a powerlifter has higher targets for posterior chain than a runner).
 */
export const DEFAULT_MUSCLE_TARGET = 80;

/**
 * Convenience: shaped result the route returns alongside radarScores.
 * Keeps the muscleScores key out of the legacy radarScores object so old
 * clients that read radarScores don't accidentally see Chest/Lats keys.
 */
export interface StrengthProfileMuscleAddition {
  muscleScores: MuscleScores;
  muscleTargets: { default: number };
  muscleGroupsKnown: readonly string[];
}

export function buildMuscleProfileAddition(lifts: UserLiftInput[]): StrengthProfileMuscleAddition {
  return {
    muscleScores: computeMuscleScores(lifts),
    muscleTargets: { default: DEFAULT_MUSCLE_TARGET },
    muscleGroupsKnown: MUSCLE_GROUPS,
  };
}
