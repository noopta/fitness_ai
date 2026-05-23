/**
 * Workout calorie-burn estimator.
 *
 * Estimates kcal expenditure from a logged workout's exercises + the user's
 * bodyweight. Uses Ainsworth Compendium of Physical Activities MET values
 * (the de-facto reference in exercise science). Honest about the limits:
 * these are population averages, not individualised metabolics — the result
 * is "good enough to nudge the day's calorie target", not a clinical figure.
 *
 * Formula: kcal = MET × bodyweight_kg × hours
 * Hours come from either the workout's logged `duration` (preferred) or an
 * estimate `sets × seconds_per_set / 3600` per exercise (fallback).
 */

export interface ExerciseInput {
  name: string;
  /** Number of sets performed (count, not an array). */
  sets?: number | null;
  /** Rep target as a string (e.g. "8", "8-10") or a number; ignored for cardio. */
  reps?: string | number | null;
  /** Working weight in kg. Not used for MET; reserved for future intensity tuning. */
  weightKg?: number | null;
  rpe?: string | number | null;
}

/** Used when the user hasn't set their bodyweight — Ainsworth's reference weight. */
const DEFAULT_BODYWEIGHT_KG = 75;

/** Time-on-task per set, in seconds. Includes typical inter-set rest. */
const DEFAULT_SECONDS_PER_SET_COMPOUND = 180;  // 3 min — bigger compound lifts get longer rests
const DEFAULT_SECONDS_PER_SET_ISOLATION = 120; // 2 min
const DEFAULT_SECONDS_PER_SET_CARDIO    = 60;  // 1 min — sets are short bursts when set-counted
const DEFAULT_SECONDS_PER_SET_CIRCUIT   = 90;  // 1.5 min — minimal rest

/**
 * Per-keyword MET table. First match wins. Ordered roughly most-specific →
 * least-specific so the catch-all "isolation strength" default doesn't shadow
 * a more accurate cardio bucket. Values come from the 2011 Ainsworth
 * Compendium (codes 02xxx for conditioning, 04xxx for stretching, etc.).
 */
interface MetRule {
  /** Regex against the lowercased exercise name. */
  match: RegExp;
  /** Ainsworth MET. */
  met: number;
  /** Default secs/set when caller doesn't provide a duration override. */
  secsPerSet: number;
  /** Loose category for logging/debug only. */
  kind: 'compound' | 'isolation' | 'cardio' | 'circuit' | 'flexibility';
}

const MET_RULES: MetRule[] = [
  // ── Cardio (time-dominant; sets here mean intervals) ─────────────────────
  { match: /\b(burpee|jumping jack|mountain climber|jump rope|skipping)\b/i,
    met: 8.0, secsPerSet: DEFAULT_SECONDS_PER_SET_CIRCUIT, kind: 'circuit' },
  { match: /\b(run|jog|sprint|treadmill)\b/i,
    met: 9.8, secsPerSet: DEFAULT_SECONDS_PER_SET_CARDIO, kind: 'cardio' },
  { match: /\b(row(ing)?|erg)\b/i,
    met: 7.0, secsPerSet: DEFAULT_SECONDS_PER_SET_CARDIO, kind: 'cardio' },
  { match: /\b(bike|cycl|spin|stationary)\b/i,
    met: 6.8, secsPerSet: DEFAULT_SECONDS_PER_SET_CARDIO, kind: 'cardio' },
  { match: /\b(swim)\b/i,
    met: 6.0, secsPerSet: DEFAULT_SECONDS_PER_SET_CARDIO, kind: 'cardio' },
  { match: /\b(elliptical|stair|stairmaster|step ?mill)\b/i,
    met: 7.0, secsPerSet: DEFAULT_SECONDS_PER_SET_CARDIO, kind: 'cardio' },
  { match: /\b(hiit|tabata|interval|circuit|metcon)\b/i,
    met: 8.0, secsPerSet: DEFAULT_SECONDS_PER_SET_CIRCUIT, kind: 'circuit' },

  // ── Heavy compound lifts (Ainsworth "vigorous weightlifting") ────────────
  { match: /\b(deadlift|barbell row|romanian|rdl)\b/i,
    met: 6.0, secsPerSet: DEFAULT_SECONDS_PER_SET_COMPOUND, kind: 'compound' },
  { match: /\b(squat|front squat|back squat|hack squat|leg press)\b/i,
    met: 6.0, secsPerSet: DEFAULT_SECONDS_PER_SET_COMPOUND, kind: 'compound' },
  { match: /\b(bench press|overhead press|ohp|incline press|push press)\b/i,
    met: 5.5, secsPerSet: DEFAULT_SECONDS_PER_SET_COMPOUND, kind: 'compound' },
  { match: /\b(pull[- ]?up|chin[- ]?up|muscle[- ]?up|weighted pull)\b/i,
    met: 6.0, secsPerSet: DEFAULT_SECONDS_PER_SET_COMPOUND, kind: 'compound' },
  { match: /\b(clean|snatch|jerk|olympic)\b/i,
    met: 6.0, secsPerSet: DEFAULT_SECONDS_PER_SET_COMPOUND, kind: 'compound' },

  // ── Light compound / accessory big lifts ─────────────────────────────────
  { match: /\b(lunge|step[- ]?up|split squat|bulgarian)\b/i,
    met: 5.0, secsPerSet: DEFAULT_SECONDS_PER_SET_COMPOUND, kind: 'compound' },
  { match: /\b(dip|push[- ]?up)\b/i,
    met: 4.5, secsPerSet: DEFAULT_SECONDS_PER_SET_ISOLATION, kind: 'isolation' },

  // ── Stretching / yoga / mobility ─────────────────────────────────────────
  { match: /\b(stretch|yoga|mobility|pilates)\b/i,
    met: 2.5, secsPerSet: DEFAULT_SECONDS_PER_SET_ISOLATION, kind: 'flexibility' },
];

/** Default for anything that doesn't match a rule above — treated as isolation strength. */
const DEFAULT_MET = 3.5;

function lookupMetRule(name: string): MetRule {
  for (const rule of MET_RULES) {
    if (rule.match.test(name)) return rule;
  }
  return {
    match: /./, met: DEFAULT_MET,
    secsPerSet: DEFAULT_SECONDS_PER_SET_ISOLATION,
    kind: 'isolation',
  };
}

export interface EstimateOptions {
  /** Bodyweight in kg. Falls back to 75 kg when missing. */
  bodyweightKg?: number | null;
  /**
   * If the workout was logged with a wall-clock duration, prefer it over the
   * sets-based estimate. Splits the total time proportionally across
   * exercises by their sets-count so per-exercise MET still matters.
   */
  totalDurationMinutes?: number | null;
}

/**
 * Estimate kcal burned across a workout. Returns the rounded total — fine
 * granularity isn't useful when the inputs are this loose.
 */
export function estimateWorkoutCalories(
  exercises: ExerciseInput[],
  opts: EstimateOptions = {},
): number {
  if (!Array.isArray(exercises) || exercises.length === 0) return 0;

  const bodyweightKg = opts.bodyweightKg ?? DEFAULT_BODYWEIGHT_KG;
  if (bodyweightKg <= 0) return 0;

  // Each exercise's estimated minutes — either proportional to sets within
  // the user-provided total duration, or derived from MET-rule default times.
  const setCounts = exercises.map(e => Math.max(1, Number(e?.sets ?? 1)));
  const totalSets = setCounts.reduce((a, b) => a + b, 0);
  const hasUserDuration = !!opts.totalDurationMinutes && opts.totalDurationMinutes > 0;

  let totalKcal = 0;
  for (let i = 0; i < exercises.length; i++) {
    const ex = exercises[i];
    const name = String(ex?.name ?? '');
    if (!name) continue;
    const rule = lookupMetRule(name);
    const sets = setCounts[i];

    let minutes: number;
    if (hasUserDuration) {
      // Split the wall-clock duration by share of total sets — so a 60-min
      // workout with 2/3 of its sets on cardio doesn't get attributed at
      // strength MET.
      minutes = (opts.totalDurationMinutes! * (sets / totalSets));
    } else {
      minutes = (sets * rule.secsPerSet) / 60;
    }

    // kcal = MET × kg × hours
    totalKcal += rule.met * bodyweightKg * (minutes / 60);
  }
  return Math.round(totalKcal);
}

/**
 * Tiny report variant — useful when we want to show the user a per-exercise
 * breakdown ("squat ≈ 80 kcal · bench ≈ 50 kcal · …"). Not wired in yet but
 * cheap to expose now so the UI can grow into it later.
 */
export function estimateWorkoutCaloriesBreakdown(
  exercises: ExerciseInput[],
  opts: EstimateOptions = {},
): Array<{ name: string; met: number; kcal: number }> {
  const bodyweightKg = opts.bodyweightKg ?? DEFAULT_BODYWEIGHT_KG;
  if (bodyweightKg <= 0) return [];

  const setCounts = exercises.map(e => Math.max(1, Number(e?.sets ?? 1)));
  const totalSets = setCounts.reduce((a, b) => a + b, 0);
  const hasUserDuration = !!opts.totalDurationMinutes && opts.totalDurationMinutes > 0;

  return exercises.map((ex, i) => {
    const name = String(ex?.name ?? '');
    const rule = lookupMetRule(name);
    const sets = setCounts[i];
    const minutes = hasUserDuration
      ? opts.totalDurationMinutes! * (sets / totalSets)
      : (sets * rule.secsPerSet) / 60;
    const kcal = Math.round(rule.met * bodyweightKg * (minutes / 60));
    return { name, met: rule.met, kcal };
  });
}
