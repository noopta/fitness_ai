// Muscle-attribution map: canonical lift → simplified muscle groups + weights.
//
// Single source of truth for "how much of this lift's strength is attributable
// to each muscle group". Used by muscleScoringService to roll up a user's
// per-lift e1RMs into per-muscle strength scores for the radar's drill-down
// (movement → muscles).
//
// Weights are *fractional* (sum to 1.0 per lift) so each lift's contribution
// to a muscle scales by both the user's e1RM AND that muscle's share of the
// total work. Values are drawn from standard sports-science contribution
// estimates (Schoenfeld, NSCA, Stuart McRobert), simplified to the
// user-recognizable muscle groups in MUSCLE_GROUPS below rather than
// fine-grain anatomy (e.g., "Chest" not "Pectoralis Major sternal head" —
// the biomechanics.ts file remains authoritative for that finer view).
//
// To add a lift: enter it under the canonical name from
// exerciseNormalizationService.ts and assign weights summing to ~1.0. Lifts
// not in this map contribute nothing to muscle scores (intentional — we
// don't want to guess about novel exercises and pollute the scoring).

export const MUSCLE_GROUPS = [
  // Upper body — push
  'Chest', 'Front Delt', 'Triceps', 'Lateral Delt',
  // Upper body — pull
  'Lats', 'Mid-back', 'Rear Delt', 'Biceps', 'Forearms',
  // Lower body
  'Quads', 'Glutes', 'Hamstrings', 'Adductors', 'Erectors', 'Calves',
  // Core
  'Abs', 'Obliques', 'Lower Back',
  // Power axis (derived from explosive / multi-joint movements)
  'Hip Power', 'Posterior Chain', 'Grip',
] as const;

export type MuscleGroup = typeof MUSCLE_GROUPS[number];

interface LiftAttribution {
  weights: Partial<Record<MuscleGroup, number>>;
}

export const LIFT_MUSCLE_MAP: Record<string, LiftAttribution> = {
  // ─── Horizontal push ──────────────────────────────────────────────────────
  'Bench Press':              { weights: { Chest: 0.50, 'Front Delt': 0.25, Triceps: 0.25 } },
  'Dumbbell Bench Press':     { weights: { Chest: 0.50, 'Front Delt': 0.25, Triceps: 0.25 } },
  'Incline Bench Press':      { weights: { Chest: 0.40, 'Front Delt': 0.40, Triceps: 0.20 } },
  'Incline Dumbbell Press':   { weights: { Chest: 0.40, 'Front Delt': 0.40, Triceps: 0.20 } },
  'Decline Bench Press':      { weights: { Chest: 0.60, 'Front Delt': 0.15, Triceps: 0.25 } },
  'Close Grip Bench Press':   { weights: { Triceps: 0.55, Chest: 0.30, 'Front Delt': 0.15 } },
  'Cable Fly':                { weights: { Chest: 0.85, 'Front Delt': 0.15 } },
  'Chest Fly':                { weights: { Chest: 0.85, 'Front Delt': 0.15 } },
  'Pec Deck':                 { weights: { Chest: 0.90, 'Front Delt': 0.10 } },
  'Push-Up':                  { weights: { Chest: 0.50, 'Front Delt': 0.25, Triceps: 0.20, Abs: 0.05 } },
  'Dips':                     { weights: { Chest: 0.45, Triceps: 0.40, 'Front Delt': 0.15 } },

  // ─── Vertical push ────────────────────────────────────────────────────────
  'Overhead Press':           { weights: { 'Front Delt': 0.50, Triceps: 0.25, 'Lateral Delt': 0.15, Abs: 0.10 } },
  'Seated Overhead Press':    { weights: { 'Front Delt': 0.55, Triceps: 0.25, 'Lateral Delt': 0.20 } },
  'Dumbbell Shoulder Press':  { weights: { 'Front Delt': 0.50, Triceps: 0.20, 'Lateral Delt': 0.25, Chest: 0.05 } },
  'Arnold Press':             { weights: { 'Front Delt': 0.45, 'Lateral Delt': 0.30, Triceps: 0.20, 'Rear Delt': 0.05 } },
  'Lateral Raise':            { weights: { 'Lateral Delt': 0.85, 'Front Delt': 0.10, 'Rear Delt': 0.05 } },
  'Front Raise':              { weights: { 'Front Delt': 0.85, Chest: 0.10, 'Lateral Delt': 0.05 } },

  // ─── Triceps isolation ────────────────────────────────────────────────────
  'Skullcrusher':             { weights: { Triceps: 0.95, 'Front Delt': 0.05 } },
  'Overhead Triceps Extension': { weights: { Triceps: 1.00 } },
  'Triceps Pressdown':        { weights: { Triceps: 1.00 } },

  // ─── Horizontal pull ──────────────────────────────────────────────────────
  'Barbell Row':              { weights: { 'Mid-back': 0.35, Lats: 0.30, 'Rear Delt': 0.15, Biceps: 0.10, Erectors: 0.10 } },
  'Dumbbell Row':             { weights: { 'Mid-back': 0.35, Lats: 0.30, 'Rear Delt': 0.15, Biceps: 0.20 } },
  'Cable Row':                { weights: { 'Mid-back': 0.40, Lats: 0.30, 'Rear Delt': 0.15, Biceps: 0.15 } },
  'Machine Row':              { weights: { 'Mid-back': 0.40, Lats: 0.30, 'Rear Delt': 0.15, Biceps: 0.15 } },
  'T-Bar Row':                { weights: { 'Mid-back': 0.35, Lats: 0.35, 'Rear Delt': 0.10, Biceps: 0.10, Erectors: 0.10 } },
  'Face Pull':                { weights: { 'Rear Delt': 0.55, 'Mid-back': 0.40, Biceps: 0.05 } },

  // ─── Vertical pull ────────────────────────────────────────────────────────
  'Pull-Up':                  { weights: { Lats: 0.50, 'Mid-back': 0.25, Biceps: 0.20, Forearms: 0.05 } },
  'Chin-Up':                  { weights: { Lats: 0.45, Biceps: 0.30, 'Mid-back': 0.20, Forearms: 0.05 } },
  'Lat Pulldown':             { weights: { Lats: 0.55, 'Mid-back': 0.20, Biceps: 0.20, Forearms: 0.05 } },

  // ─── Biceps isolation ─────────────────────────────────────────────────────
  'Barbell Curl':             { weights: { Biceps: 0.90, Forearms: 0.10 } },
  'Dumbbell Curl':            { weights: { Biceps: 0.90, Forearms: 0.10 } },
  'Cable Curl':               { weights: { Biceps: 0.90, Forearms: 0.10 } },
  'EZ Bar Curl':              { weights: { Biceps: 0.90, Forearms: 0.10 } },
  'Hammer Curl':              { weights: { Biceps: 0.65, Forearms: 0.35 } },
  'Concentration Curl':       { weights: { Biceps: 0.95, Forearms: 0.05 } },
  'Preacher Curl':            { weights: { Biceps: 0.95, Forearms: 0.05 } },
  'Incline Dumbbell Curl':    { weights: { Biceps: 0.90, Forearms: 0.10 } },

  // ─── Squat-pattern (knee-dominant) ────────────────────────────────────────
  'Squat':                    { weights: { Quads: 0.45, Glutes: 0.30, Adductors: 0.10, Erectors: 0.10, Abs: 0.05 } },
  'Front Squat':              { weights: { Quads: 0.55, Glutes: 0.20, Adductors: 0.10, Erectors: 0.10, Abs: 0.05 } },
  'Goblet Squat':             { weights: { Quads: 0.55, Glutes: 0.20, Adductors: 0.15, Abs: 0.10 } },
  'Hack Squat':               { weights: { Quads: 0.65, Glutes: 0.25, Adductors: 0.10 } },
  'Leg Press':                { weights: { Quads: 0.50, Glutes: 0.30, Hamstrings: 0.10, Adductors: 0.10 } },
  'Leg Extension':            { weights: { Quads: 1.00 } },
  'Bulgarian Split Squat':    { weights: { Quads: 0.40, Glutes: 0.35, Adductors: 0.15, Hamstrings: 0.10 } },
  'Lunge':                    { weights: { Quads: 0.40, Glutes: 0.35, Adductors: 0.15, Hamstrings: 0.10 } },
  'Step Up':                  { weights: { Quads: 0.40, Glutes: 0.40, Hamstrings: 0.10, Adductors: 0.10 } },

  // ─── Hinge-pattern (hip-dominant) ─────────────────────────────────────────
  'Deadlift':                 { weights: { Hamstrings: 0.25, Glutes: 0.25, Erectors: 0.20, Lats: 0.10, Quads: 0.10, Forearms: 0.05, 'Posterior Chain': 0.05 } },
  'Sumo Deadlift':            { weights: { Glutes: 0.30, Quads: 0.20, Adductors: 0.15, Hamstrings: 0.15, Erectors: 0.15, Forearms: 0.05 } },
  'Trap Bar Deadlift':        { weights: { Quads: 0.25, Glutes: 0.25, Hamstrings: 0.20, Erectors: 0.20, Forearms: 0.10 } },
  'Romanian Deadlift':        { weights: { Hamstrings: 0.45, Glutes: 0.30, Erectors: 0.15, Lats: 0.05, Forearms: 0.05 } },
  'Stiff Leg Deadlift':       { weights: { Hamstrings: 0.50, Glutes: 0.25, Erectors: 0.15, 'Lower Back': 0.10 } },
  'Good Morning':             { weights: { Hamstrings: 0.40, Erectors: 0.30, Glutes: 0.20, 'Lower Back': 0.10 } },
  'Hip Thrust':               { weights: { Glutes: 0.70, Hamstrings: 0.20, Quads: 0.05, Erectors: 0.05 } },
  'Glute Ham Raise':          { weights: { Hamstrings: 0.55, Glutes: 0.30, Erectors: 0.10, Calves: 0.05 } },
  'Nordic Curl':              { weights: { Hamstrings: 0.85, Glutes: 0.10, 'Lower Back': 0.05 } },
  'Leg Curl':                 { weights: { Hamstrings: 0.95, Calves: 0.05 } },

  // ─── Calves ───────────────────────────────────────────────────────────────
  'Calf Raise':               { weights: { Calves: 1.00 } },

  // ─── Core ─────────────────────────────────────────────────────────────────
  'Plank':                    { weights: { Abs: 0.60, Obliques: 0.20, 'Lower Back': 0.20 } },
  'Crunch':                   { weights: { Abs: 0.90, Obliques: 0.10 } },
  'Sit-Up':                   { weights: { Abs: 0.85, Obliques: 0.10, 'Front Delt': 0.05 } },
  'Cable Crunch':             { weights: { Abs: 0.85, Obliques: 0.15 } },
  'Hanging Knee Raise':       { weights: { Abs: 0.65, Obliques: 0.20, Forearms: 0.10, Lats: 0.05 } },
  'Hanging Leg Raise':        { weights: { Abs: 0.60, Obliques: 0.20, Forearms: 0.15, Lats: 0.05 } },
  'Leg Raise':                { weights: { Abs: 0.75, Obliques: 0.20, 'Lower Back': 0.05 } },
  'Ab Wheel Rollout':         { weights: { Abs: 0.55, Obliques: 0.20, Lats: 0.15, 'Lower Back': 0.10 } },
  'Russian Twist':            { weights: { Obliques: 0.75, Abs: 0.20, 'Lower Back': 0.05 } },
  'Landmine Twist':           { weights: { Obliques: 0.65, Abs: 0.20, 'Lateral Delt': 0.10, 'Lower Back': 0.05 } },
  'Pallof Press':             { weights: { Obliques: 0.55, Abs: 0.30, 'Lower Back': 0.15 } },

  // ─── Power / explosive (cardio bucket) ────────────────────────────────────
  // These contribute primarily to the Power axis. We split weight across the
  // power-flavored muscles so they cluster correctly in muscleHierarchy.
  'Kettlebell Swing':         { weights: { 'Hip Power': 0.50, Glutes: 0.25, Hamstrings: 0.15, Erectors: 0.10 } },
};

/**
 * Quick lookup: does this canonical lift have a muscle attribution defined?
 * Used by scoring service to skip lifts that aren't mapped (rather than
 * silently producing a meaningless score).
 */
export function hasAttribution(canonicalName: string): boolean {
  return canonicalName in LIFT_MUSCLE_MAP;
}

/**
 * Return the muscle weight map for a canonical lift, or an empty object.
 * Callers should treat empty as "no contribution" and continue.
 */
export function muscleWeightsFor(canonicalName: string): Partial<Record<MuscleGroup, number>> {
  return LIFT_MUSCLE_MAP[canonicalName]?.weights ?? {};
}
