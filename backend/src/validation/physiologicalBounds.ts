// Shared bounds for human-body and training numbers.
//
// Motivation: several endpoints accepted bare `z.number()` (or, in the case of
// PUT /nutrition/targets, no validation at all), so a user could set a 25,000
// kcal target, a 900 cm height, or a 10,000 kg bench. Those values don't just
// look silly — they propagate. Bodyweight feeds TDEE, which feeds the macro
// plan; lift weight feeds e1RM, which feeds the diagnostic engine, the strength
// profile, and the public leaderboard.
//
// Two tiers, deliberately:
//
//   HARD  — physically impossible. Reject with 400. The ceilings sit above any
//           real human value (e.g. the raw deadlift world record is ~501 kg, so
//           a 500 kg per-lift cap only rejects nonsense).
//
//   SOFT  — possible but improbable. Do NOT reject. Persist the row and mark it
//           `suspect` so it can be excluded from leaderboards, population
//           averages and LLM context while still being shown back to the user.
//
// The soft tier is the important half. Strict gates on user-descriptive data
// have already rejected real user input twice in this codebase (the
// descriptiveLabel/meal-source incident). A powerlifter at 180 kg bodyweight and
// a 400 kg deadlift is real; a hard reject there is a bug, not a safeguard.
//
// All weights are canonical kilograms — the same convention as the DB. Callers
// that accept pounds must convert before validating.

import { z } from 'zod';

export const BOUNDS = {
  /** Body mass. Lower bound clears the lightest recorded adults; upper clears the heaviest. */
  bodyWeightKg: { hardMin: 20, hardMax: 400, softMin: 35, softMax: 200 },
  /** Standing height. */
  heightCm: { hardMin: 50, hardMax: 260, softMin: 130, softMax: 215 },
  /** Daily calorie target. Upper hard bound is well past any real bulk. */
  dailyCalories: { hardMin: 500, hardMax: 10000, softMin: 1200, softMax: 5000 },
  /** Manual +/- adjustment applied to a generated plan's calories. */
  calorieAdjustment: { hardMin: -3000, hardMax: 3000, softMin: -750, softMax: 750 },
  /** Load on a single lift. Hard max sits above the all-time raw deadlift record. */
  liftWeightKg: { hardMin: 0, hardMax: 600, softMin: 0, softMax: 350 },
  /** Reps in a set. */
  reps: { hardMin: 0, hardMax: 200, softMin: 1, softMax: 50 },
  /** Sets in an exercise. */
  sets: { hardMin: 0, hardMax: 50, softMin: 1, softMax: 12 },
  /** Rate of perceived exertion. */
  rpe: { hardMin: 1, hardMax: 10, softMin: 5, softMax: 10 },
} as const;

export type BoundKey = keyof typeof BOUNDS;

/**
 * A zod number constrained to a bound's HARD range.
 *
 * `.finite()` matters more than it looks: JSON.parse happily produces `1e400`
 * → Infinity, which passes a naive `.min()/.max()` pair and then poisons every
 * downstream arithmetic result as NaN.
 */
export function bounded(key: BoundKey, label?: string) {
  const { hardMin, hardMax } = BOUNDS[key];
  const name = label ?? key;
  return z
    .number()
    .finite(`${name} must be a real number`)
    .min(hardMin, `${name} must be at least ${hardMin}`)
    .max(hardMax, `${name} must be at most ${hardMax}`);
}

/** True when the value is real but outside the plausible band. */
export function isImplausible(key: BoundKey, value: number | null | undefined): boolean {
  if (value == null || !Number.isFinite(value)) return false;
  const { softMin, softMax } = BOUNDS[key];
  return value < softMin || value > softMax;
}

/**
 * Human-readable warning for an implausible-but-accepted value, or null when
 * the value sits in the normal band. Surfaced to the client as `warnings[]` so
 * the UI can show a "that looks unusual — is it right?" confirm without
 * blocking the write.
 */
export function implausibilityWarning(
  key: BoundKey,
  value: number | null | undefined,
  label?: string,
): string | null {
  if (!isImplausible(key, value)) return null;
  const { softMin, softMax } = BOUNDS[key];
  const name = label ?? key;
  return `${name} of ${value} is outside the typical range (${softMin}–${softMax}). It was saved, but double-check it.`;
}

/**
 * Day-over-day bodyweight sanity. Real bodyweight moves a couple of kg a day at
 * the extreme (water, glycogen, travel); a 15 kg jump is a typo or a unit mixup
 * — most often a user entering pounds into a kg field. Flag, don't reject:
 * genuine post-surgery or post-competition swings do happen.
 */
export const MAX_PLAUSIBLE_DAILY_WEIGHT_DELTA_KG = 10;

export function weightDeltaWarning(previousKg: number | null | undefined, nextKg: number): string | null {
  if (previousKg == null || !Number.isFinite(previousKg)) return null;
  const delta = Math.abs(nextKg - previousKg);
  if (delta <= MAX_PLAUSIBLE_DAILY_WEIGHT_DELTA_KG) return null;
  return `That's a ${delta.toFixed(1)} kg change from your last entry. It was saved — check you're using the right unit.`;
}

// ─── Date of birth ───────────────────────────────────────────────────────────

/** Minimum age. Matches the app's stated 13+ policy (COPPA / App Store). */
export const MIN_AGE_YEARS = 13;
/** Oldest plausible DOB. Beyond this it's a typo or a troll. */
export const MAX_AGE_YEARS = 100;

/**
 * Validate a date-of-birth string. Returns an error message, or null if valid.
 *
 * Replaces the previous check, which verified only the 13+ floor — a DOB in the
 * year 1200, or one in the future, both passed and then produced a nonsense age
 * everywhere it was used.
 */
export function validateDateOfBirth(dobStr: string): string | null {
  const dob = new Date(dobStr);
  if (isNaN(dob.getTime())) return 'Invalid date of birth.';

  const now = Date.now();
  if (dob.getTime() > now) return 'Date of birth cannot be in the future.';

  const ageYears = (now - dob.getTime()) / (365.25 * 86400000);
  if (ageYears < MIN_AGE_YEARS) return `You must be at least ${MIN_AGE_YEARS} years old to use this app.`;
  if (ageYears > MAX_AGE_YEARS) return 'Please enter a valid date of birth.';

  return null;
}
