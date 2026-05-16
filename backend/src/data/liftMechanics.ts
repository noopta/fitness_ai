// Movement-pattern classification for each canonical lift, plus helpers for
// muscle role + training-intensity zone. Complements muscleAttribution.ts
// (which holds the muscle weight maps) — together they're the "lift library"
// the Athlete Model dissects every workout against.
//
// Movement pattern enables coverage analysis: "you've done zero vertical
// pulling in 6 weeks". Muscle role (prime mover vs synergist) is derived
// from the attribution weight rather than stored separately — a muscle
// carrying ≥40% of a lift is its prime mover, 15-40% a synergist, below
// that a stabilizer.

import { muscleWeightsFor, type MuscleGroup } from './muscleAttribution.js';

export type MovementPattern =
  | 'horizontal-push'
  | 'incline-push'
  | 'vertical-push'
  | 'horizontal-pull'
  | 'vertical-pull'
  | 'squat'
  | 'hinge'
  | 'lunge'
  | 'isolation'
  | 'core-flexion'
  | 'core-rotation'
  | 'core-anti'      // anti-extension / anti-rotation (planks, pallof)
  | 'explosive';

export const LIFT_MOVEMENT_PATTERN: Record<string, MovementPattern> = {
  // Horizontal push
  'Bench Press': 'horizontal-push',
  'Dumbbell Bench Press': 'horizontal-push',
  'Decline Bench Press': 'horizontal-push',
  'Close Grip Bench Press': 'horizontal-push',
  'Cable Fly': 'horizontal-push',
  'Chest Fly': 'horizontal-push',
  'Pec Deck': 'horizontal-push',
  'Push-Up': 'horizontal-push',
  'Dips': 'horizontal-push',
  // Incline push (hybrid horizontal/vertical)
  'Incline Bench Press': 'incline-push',
  'Incline Dumbbell Press': 'incline-push',
  // Vertical push
  'Overhead Press': 'vertical-push',
  'Seated Overhead Press': 'vertical-push',
  'Dumbbell Shoulder Press': 'vertical-push',
  'Arnold Press': 'vertical-push',
  // Horizontal pull
  'Barbell Row': 'horizontal-pull',
  'Dumbbell Row': 'horizontal-pull',
  'Cable Row': 'horizontal-pull',
  'Machine Row': 'horizontal-pull',
  'T-Bar Row': 'horizontal-pull',
  'Face Pull': 'horizontal-pull',
  // Vertical pull
  'Pull-Up': 'vertical-pull',
  'Chin-Up': 'vertical-pull',
  'Lat Pulldown': 'vertical-pull',
  // Squat (knee-dominant)
  'Squat': 'squat',
  'Front Squat': 'squat',
  'Goblet Squat': 'squat',
  'Hack Squat': 'squat',
  'Leg Press': 'squat',
  // Hinge (hip-dominant)
  'Deadlift': 'hinge',
  'Sumo Deadlift': 'hinge',
  'Trap Bar Deadlift': 'hinge',
  'Romanian Deadlift': 'hinge',
  'Stiff Leg Deadlift': 'hinge',
  'Good Morning': 'hinge',
  'Hip Thrust': 'hinge',
  'Glute Ham Raise': 'hinge',
  'Nordic Curl': 'hinge',
  // Lunge (unilateral knee-dominant)
  'Bulgarian Split Squat': 'lunge',
  'Lunge': 'lunge',
  'Step Up': 'lunge',
  // Isolation
  'Lateral Raise': 'isolation',
  'Front Raise': 'isolation',
  'Skullcrusher': 'isolation',
  'Overhead Triceps Extension': 'isolation',
  'Triceps Pressdown': 'isolation',
  'Barbell Curl': 'isolation',
  'Dumbbell Curl': 'isolation',
  'Cable Curl': 'isolation',
  'EZ Bar Curl': 'isolation',
  'Hammer Curl': 'isolation',
  'Concentration Curl': 'isolation',
  'Preacher Curl': 'isolation',
  'Incline Dumbbell Curl': 'isolation',
  'Leg Extension': 'isolation',
  'Leg Curl': 'isolation',
  'Calf Raise': 'isolation',
  // Core
  'Crunch': 'core-flexion',
  'Sit-Up': 'core-flexion',
  'Cable Crunch': 'core-flexion',
  'Hanging Knee Raise': 'core-flexion',
  'Hanging Leg Raise': 'core-flexion',
  'Leg Raise': 'core-flexion',
  'Russian Twist': 'core-rotation',
  'Landmine Twist': 'core-rotation',
  'Pallof Press': 'core-anti',
  'Plank': 'core-anti',
  'Ab Wheel Rollout': 'core-anti',
  // Explosive
  'Kettlebell Swing': 'explosive',
};

// Human-readable grouping of movement patterns for the coverage report.
export const PATTERN_LABEL: Record<MovementPattern, string> = {
  'horizontal-push': 'Horizontal Push',
  'incline-push': 'Incline Push',
  'vertical-push': 'Vertical Push',
  'horizontal-pull': 'Horizontal Pull',
  'vertical-pull': 'Vertical Pull',
  'squat': 'Squat',
  'hinge': 'Hinge',
  'lunge': 'Lunge / Unilateral',
  'isolation': 'Isolation',
  'core-flexion': 'Core — Flexion',
  'core-rotation': 'Core — Rotation',
  'core-anti': 'Core — Stability',
  'explosive': 'Explosive / Power',
};

export function movementPatternFor(canonicalName: string): MovementPattern | null {
  return LIFT_MOVEMENT_PATTERN[canonicalName] ?? null;
}

export type MuscleRole = 'prime' | 'synergist' | 'stabilizer';

/**
 * Classify a muscle's role in a lift from its attribution weight.
 *   ≥ 0.40  → prime mover
 *   0.15-0.40 → synergist
 *   < 0.15  → stabilizer / minor contributor
 */
export function muscleRoleFor(canonicalName: string, muscle: MuscleGroup): MuscleRole | null {
  const w = muscleWeightsFor(canonicalName)[muscle];
  if (w == null) return null;
  if (w >= 0.40) return 'prime';
  if (w >= 0.15) return 'synergist';
  return 'stabilizer';
}

// ─── Training-intensity zones ────────────────────────────────────────────────
// Classify a working set by rep range — the universal coaching convention.
// Rep range is a cleaner zone signal than %1RM (which is circular when the
// e1RM is itself derived from the set). Explosive movement patterns are
// tagged 'power' regardless of reps.

export type IntensityZone = 'strength' | 'hypertrophy' | 'endurance' | 'power';

export const ZONE_LABEL: Record<IntensityZone, string> = {
  strength: 'Max Strength',
  hypertrophy: 'Hypertrophy',
  endurance: 'Strength-Endurance',
  power: 'Power',
};

/**
 * Intensity zone for a set. Explosive lifts → power. Otherwise by rep count:
 * ≤5 strength, 6-12 hypertrophy, ≥13 endurance.
 */
export function intensityZone(canonicalName: string, reps: number): IntensityZone {
  if (movementPatternFor(canonicalName) === 'explosive') return 'power';
  if (reps <= 5) return 'strength';
  if (reps <= 12) return 'hypertrophy';
  return 'endurance';
}
