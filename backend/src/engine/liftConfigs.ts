/**
 * liftConfigs.ts — data-only rules for the diagnostic engine.
 * Version: 1.0.0
 *
 * To change diagnosis behavior, edit rules here — no logic changes needed.
 * Each lift config defines:
 *   - phaseRules:      condition → points for phase scoring
 *   - hypothesisRules: condition → points + category + evidence template
 *   - indexMappings:   which proxy exercises feed which index
 *   - validationTests: lookup table keyed by (phase, hypothesis, trainingAge, equipment)
 */

export const LIFT_CONFIG_VERSION = '1.0.0';

// ─── Shared types ────────────────────────────────────────────────────────────

export type HypothesisCategory =
  | 'muscle'
  | 'mechanical'
  | 'stability'
  | 'mobility'
  | 'technique'
  | 'programming';

export type TrainingAge = 'beginner' | 'intermediate' | 'advanced';
export type Equipment = 'commercial' | 'limited' | 'home';

export interface PhaseRule {
  /** Human-readable description of this rule for debugging */
  description: string;
  /** Which snapshot flag or ratio triggers this rule. Evaluated by the engine. */
  condition: PhaseCondition;
  /** Points added to the named phase when condition is true */
  phase_id: string;
  points: number;
}

export interface PhaseCondition {
  type: 'flag' | 'ratio_below' | 'ratio_above' | 'index_below' | 'e1rm_gap';
  /** For flag conditions: the boolean flag name from session */
  flag?: string;
  /** For ratio conditions: exerciseId_A / exerciseId_B */
  numerator_exercise?: string;
  denominator_exercise?: string;
  threshold?: number;
  /** For index conditions */
  index?: string;
}

export interface HypothesisRule {
  description: string;
  condition: PhaseCondition;
  hypothesis_key: string;
  hypothesis_label: string;
  category: HypothesisCategory;
  points: number;
  /** Template for human-readable evidence string. Use {value}, {expected}, {exercise} as placeholders. */
  evidence_template: string;
}

export interface IndexMapping {
  /** Which index this proxy contributes to */
  index: 'quad_index' | 'posterior_index' | 'back_tension_index' | 'triceps_index' | 'shoulder_index';
  proxy_exercise_id: string;
  /** Expected ratio vs primary lift (midpoint used for 0–100 mapping) */
  expected_ratio_low: number;
  expected_ratio_high: number;
  /** Weight in the composite index if multiple sources (should sum to 1.0 per index) */
  weight: number;
}

export interface ValidationTestEntry {
  phase_id: string;
  hypothesis_key: string;
  training_age: TrainingAge | 'any';
  equipment: Equipment | 'any';
  description: string;
  how_to_run: string;
  hypothesis_tested: string;
  equipment_required: string[];
  training_age_minimum: TrainingAge;
  /** Fallback test to use if equipment/age constraints don't match primary */
  fallback?: Omit<ValidationTestEntry, 'phase_id' | 'hypothesis_key' | 'training_age' | 'equipment' | 'fallback' | 'fallback_used'> & { fallback_used: false };
}

export interface LiftConfig {
  lift_id: string;
  phaseRules: PhaseRule[];
  hypothesisRules: HypothesisRule[];
  indexMappings: IndexMapping[];
  validationTests: ValidationTestEntry[];
}

// ─── Flat Bench Press ────────────────────────────────────────────────────────

export const flatBenchConfig: LiftConfig = {
  lift_id: 'flat_bench_press',

  phaseRules: [
    {
      description: 'User reports hardest point off chest',
      condition: { type: 'flag', flag: 'hard_off_chest' },
      phase_id: 'bottom',
      points: 30
    },
    {
      description: 'Pause reps feel significantly harder than touch-and-go',
      condition: { type: 'flag', flag: 'pause_much_harder' },
      phase_id: 'bottom',
      points: 20
    },
    {
      description: 'Touch point inconsistent',
      condition: { type: 'flag', flag: 'touch_point_inconsistent' },
      phase_id: 'bottom',
      points: 15
    },
    {
      description: 'Shoulder discomfort reported',
      condition: { type: 'flag', flag: 'shoulder_discomfort' },
      phase_id: 'bottom',
      points: 15
    },
    {
      description: 'Bar slows at mid-range (2–5 inches)',
      condition: { type: 'flag', flag: 'hard_mid_range' },
      phase_id: 'ascent',
      points: 30
    },
    {
      description: 'Bar drifts from straight path',
      condition: { type: 'flag', flag: 'bar_drifts' },
      phase_id: 'ascent',
      points: 15
    },
    {
      description: 'Lockout is hardest part',
      condition: { type: 'flag', flag: 'hard_at_lockout' },
      phase_id: 'lockout',
      points: 30
    },
    {
      description: 'Elbows flare early in press',
      condition: { type: 'flag', flag: 'elbows_flare_early' },
      phase_id: 'lockout',
      points: 15
    },
    {
      description: 'Close-grip bench well below expected (< 0.80 of flat)',
      condition: {
        type: 'ratio_below',
        numerator_exercise: 'close_grip_bench_press',
        denominator_exercise: 'flat_bench_press',
        threshold: 0.80
      },
      phase_id: 'lockout',
      points: 25
    },
    {
      description: 'Row weak relative to bench (< 0.65) — stability issues → ascent',
      condition: {
        type: 'ratio_below',
        numerator_exercise: 'barbell_row',
        denominator_exercise: 'flat_bench_press',
        threshold: 0.65
      },
      phase_id: 'ascent',
      points: 20
    }
  ],

  hypothesisRules: [
    {
      description: 'Triceps deficit — close-grip below 0.80',
      condition: {
        type: 'ratio_below',
        numerator_exercise: 'close_grip_bench_press',
        denominator_exercise: 'flat_bench_press',
        threshold: 0.80
      },
      hypothesis_key: 'triceps_deficit',
      hypothesis_label: 'Triceps Lockout Deficit',
      category: 'muscle',
      points: 40,
      evidence_template: 'Close-grip bench at {value}% of flat bench (expected 85–95%) — indicates triceps are limiting the lockout phase.'
    },
    {
      description: 'Triceps deficit confirmed by flag',
      condition: { type: 'flag', flag: 'hard_at_lockout' },
      hypothesis_key: 'triceps_deficit',
      hypothesis_label: 'Triceps Lockout Deficit',
      category: 'muscle',
      points: 25,
      evidence_template: 'User reports lockout as hardest point — consistent with triceps being the primary limiter.'
    },
    {
      description: 'Pec/off-chest deficit — flag',
      condition: { type: 'flag', flag: 'hard_off_chest' },
      hypothesis_key: 'pec_off_chest_deficit',
      hypothesis_label: 'Pec Strength Off Chest',
      category: 'muscle',
      points: 35,
      evidence_template: 'User reports bar is hardest immediately off chest — implicates pec reversal strength and stretch-shortening cycle.'
    },
    {
      description: 'Pec deficit — pause much harder',
      condition: { type: 'flag', flag: 'pause_much_harder' },
      hypothesis_key: 'pec_off_chest_deficit',
      hypothesis_label: 'Pec Strength Off Chest',
      category: 'muscle',
      points: 25,
      evidence_template: 'Pause reps significantly harder than touch-and-go — confirms reliance on stretch reflex and underlying pec weakness.'
    },
    {
      description: 'Scapular/upper-back stability — row weak',
      condition: {
        type: 'ratio_below',
        numerator_exercise: 'barbell_row',
        denominator_exercise: 'flat_bench_press',
        threshold: 0.65
      },
      hypothesis_key: 'scap_stability_deficit',
      hypothesis_label: 'Scapular / Upper-Back Stability Deficit',
      category: 'stability',
      points: 35,
      evidence_template: 'Row at {value}% of bench (expected 70–80%) — insufficient upper-back strength to maintain a stable pressing base.'
    },
    {
      description: 'Scapular stability — bar drifts',
      condition: { type: 'flag', flag: 'bar_drifts' },
      hypothesis_key: 'scap_stability_deficit',
      hypothesis_label: 'Scapular / Upper-Back Stability Deficit',
      category: 'stability',
      points: 20,
      evidence_template: 'Bar path deviates during press — suggests unstable shoulder/scapular platform.'
    },
    {
      description: 'Technique — elbow flare timing',
      condition: { type: 'flag', flag: 'elbows_flare_early' },
      hypothesis_key: 'elbow_flare_technique',
      hypothesis_label: 'Elbow Flare Timing Fault',
      category: 'technique',
      points: 30,
      evidence_template: 'Elbows flare prematurely — reduces triceps mechanical advantage and stresses shoulder in vulnerable position.'
    },
    {
      description: 'Touch point inconsistency — technique',
      condition: { type: 'flag', flag: 'touch_point_inconsistent' },
      hypothesis_key: 'touch_point_technique',
      hypothesis_label: 'Inconsistent Touch Point / Setup',
      category: 'technique',
      points: 25,
      evidence_template: 'Inconsistent bar path to chest — setup or lat tension varies rep-to-rep, reducing force production.'
    },
    {
      description: 'Shoulder health — discomfort reported',
      condition: { type: 'flag', flag: 'shoulder_discomfort' },
      hypothesis_key: 'shoulder_health',
      hypothesis_label: 'Shoulder Health / Rotator Cuff',
      category: 'stability',
      points: 35,
      evidence_template: 'Shoulder discomfort reported — may limit load, ROM, or setup quality independent of strength.'
    }
  ],

  indexMappings: [
    {
      index: 'triceps_index',
      proxy_exercise_id: 'close_grip_bench_press',
      expected_ratio_low: 0.85,
      expected_ratio_high: 0.95,
      weight: 1.0
    },
    {
      index: 'shoulder_index',
      proxy_exercise_id: 'overhead_press',
      expected_ratio_low: 0.60,
      expected_ratio_high: 0.70,
      weight: 1.0
    },
    {
      index: 'back_tension_index',
      proxy_exercise_id: 'barbell_row',
      expected_ratio_low: 0.70,
      expected_ratio_high: 0.80,
      weight: 0.6
    },
    {
      index: 'back_tension_index',
      proxy_exercise_id: 'chest_supported_row',
      expected_ratio_low: 0.65,
      expected_ratio_high: 0.75,
      weight: 0.4
    }
  ],

  validationTests: [
    {
      phase_id: 'lockout',
      hypothesis_key: 'triceps_deficit',
      training_age: 'any',
      equipment: 'any',
      description: 'Paused close-grip bench test',
      how_to_run: 'Perform 3×3 close-grip bench at ~75–80% of your flat bench 1RM. Use a 1-second pause at the chest. Track RPE and where bar slows. If lockout speed is significantly slower than comparable flat bench, triceps are confirmed as the limiter.',
      hypothesis_tested: 'Triceps Lockout Deficit',
      equipment_required: ['barbell', 'bench'],
      training_age_minimum: 'beginner'
    },
    {
      phase_id: 'bottom',
      hypothesis_key: 'pec_off_chest_deficit',
      training_age: 'any',
      equipment: 'any',
      description: 'Spoto press / pause bench test',
      how_to_run: 'Perform 3×3 Spoto press (bar stops 1 inch above chest) or full pause bench at ~75% 1RM. If these feel dramatically harder than touch-and-go at the same load, reversal strength off the chest is confirmed as the limiter.',
      hypothesis_tested: 'Pec Strength Off Chest',
      equipment_required: ['barbell', 'bench'],
      training_age_minimum: 'beginner'
    },
    {
      phase_id: 'ascent',
      hypothesis_key: 'scap_stability_deficit',
      training_age: 'any',
      equipment: 'any',
      description: 'Upper-back fatigue observation',
      how_to_run: 'Superset 3 sets of chest-supported rows (moderate load, 8 reps) immediately followed by bench press at ~80%. Observe whether bar path becomes less stable and RPE increases disproportionately. If so, upper-back stability is confirmed as the limiting factor.',
      hypothesis_tested: 'Scapular / Upper-Back Stability Deficit',
      equipment_required: ['barbell', 'bench', 'dumbbells'],
      training_age_minimum: 'intermediate',
      fallback: {
        description: 'Band pull-apart pre-activation test',
        how_to_run: 'Perform 2×20 band pull-aparts before your bench sets. Note whether bar path feels more stable. Improvement suggests upper-back activation is limiting your pressing base.',
        hypothesis_tested: 'Scapular / Upper-Back Stability Deficit',
        equipment_required: ['barbell', 'bench', 'band'],
        training_age_minimum: 'beginner',
        fallback_used: false
      }
    }
  ]
};

// ─── Incline Bench Press ─────────────────────────────────────────────────────

export const inclineBenchConfig: LiftConfig = {
  lift_id: 'incline_bench_press',

  phaseRules: [
    {
      description: 'Hard off upper chest on incline',
      condition: { type: 'flag', flag: 'hard_off_chest' },
      phase_id: 'bottom',
      points: 30
    },
    {
      description: 'Shoulder discomfort on incline',
      condition: { type: 'flag', flag: 'shoulder_discomfort' },
      phase_id: 'bottom',
      points: 20
    },
    {
      description: 'Incline significantly weaker vs flat (< 0.78)',
      condition: {
        type: 'ratio_below',
        numerator_exercise: 'incline_bench_press',
        denominator_exercise: 'flat_bench_press',
        threshold: 0.78
      },
      phase_id: 'bottom',
      points: 25
    },
    {
      description: 'OHP weak vs incline (< 0.60) — front delt limiting mid-range',
      condition: {
        type: 'ratio_below',
        numerator_exercise: 'overhead_press',
        denominator_exercise: 'incline_bench_press',
        threshold: 0.60
      },
      phase_id: 'ascent',
      points: 30
    },
    {
      description: 'Hard mid-range on incline — shoulder fatigue',
      condition: { type: 'flag', flag: 'hard_mid_range' },
      phase_id: 'ascent',
      points: 25
    },
    {
      description: 'Elbows flare early',
      condition: { type: 'flag', flag: 'elbows_flare_early' },
      phase_id: 'ascent',
      points: 15
    },
    {
      description: 'Lockout is hardest — triceps',
      condition: { type: 'flag', flag: 'hard_at_lockout' },
      phase_id: 'lockout',
      points: 30
    },
    {
      description: 'Close-grip weak (< 0.80 of incline) — triceps limiting lockout',
      condition: {
        type: 'ratio_below',
        numerator_exercise: 'close_grip_bench_press',
        denominator_exercise: 'incline_bench_press',
        threshold: 0.80
      },
      phase_id: 'lockout',
      points: 20
    }
  ],

  hypothesisRules: [
    {
      description: 'Upper chest / anterior delt deficit — incline far below flat',
      condition: {
        type: 'ratio_below',
        numerator_exercise: 'incline_bench_press',
        denominator_exercise: 'flat_bench_press',
        threshold: 0.78
      },
      hypothesis_key: 'upper_chest_deficit',
      hypothesis_label: 'Upper Chest / Anterior Delt Deficit',
      category: 'muscle',
      points: 40,
      evidence_template: 'Incline at {value}% of flat bench (expected 80–90%) — gap indicates upper pec or anterior delt is the primary limiter.'
    },
    {
      description: 'Anterior delt deficit — OHP weak vs incline',
      condition: {
        type: 'ratio_below',
        numerator_exercise: 'overhead_press',
        denominator_exercise: 'incline_bench_press',
        threshold: 0.60
      },
      hypothesis_key: 'anterior_delt_deficit',
      hypothesis_label: 'Anterior Deltoid Deficit',
      category: 'muscle',
      points: 35,
      evidence_template: 'Overhead press at {value}% of incline (expected 65–75%) — weak OHP confirms anterior deltoid is limiting the incline mid-range and press drive.'
    },
    {
      description: 'Anterior delt — hard mid-range flag',
      condition: { type: 'flag', flag: 'hard_mid_range' },
      hypothesis_key: 'anterior_delt_deficit',
      hypothesis_label: 'Anterior Deltoid Deficit',
      category: 'muscle',
      points: 25,
      evidence_template: 'User reports mid-range as hardest point — anterior deltoid is the primary mover in the incline mid-range and is likely fatiguing first.'
    },
    {
      description: 'Triceps deficit — lockout flag',
      condition: { type: 'flag', flag: 'hard_at_lockout' },
      hypothesis_key: 'triceps_deficit',
      hypothesis_label: 'Triceps Lockout Deficit',
      category: 'muscle',
      points: 30,
      evidence_template: 'User reports lockout as hardest point on incline — triceps are required for final elbow extension and are the likely limiter.'
    },
    {
      description: 'Triceps — close-grip weak vs incline',
      condition: {
        type: 'ratio_below',
        numerator_exercise: 'close_grip_bench_press',
        denominator_exercise: 'incline_bench_press',
        threshold: 0.80
      },
      hypothesis_key: 'triceps_deficit',
      hypothesis_label: 'Triceps Lockout Deficit',
      category: 'muscle',
      points: 30,
      evidence_template: 'Close-grip bench at {value}% of incline — triceps strength deficit corroborated by proxy ratio.'
    },
    {
      description: 'Shoulder health — discomfort on incline',
      condition: { type: 'flag', flag: 'shoulder_discomfort' },
      hypothesis_key: 'shoulder_health',
      hypothesis_label: 'Shoulder Health / Rotator Cuff',
      category: 'stability',
      points: 40,
      evidence_template: 'Shoulder discomfort on incline — the increased shoulder flexion angle makes incline more rotator-cuff demanding than flat bench.'
    },
    {
      description: 'Elbow flare — technique on incline',
      condition: { type: 'flag', flag: 'elbows_flare_early' },
      hypothesis_key: 'elbow_flare_technique',
      hypothesis_label: 'Elbow Flare / Technique Timing Fault',
      category: 'technique',
      points: 25,
      evidence_template: 'Elbows flare early on incline — reduces anterior delt mechanical advantage and places excess load on shoulder.'
    }
  ],

  indexMappings: [
    {
      index: 'shoulder_index',
      proxy_exercise_id: 'overhead_press',
      expected_ratio_low: 0.65,
      expected_ratio_high: 0.75,
      weight: 0.7
    },
    {
      index: 'shoulder_index',
      proxy_exercise_id: 'flat_bench_press',
      expected_ratio_low: 0.80,
      expected_ratio_high: 0.90,
      weight: 0.3
    },
    {
      index: 'triceps_index',
      proxy_exercise_id: 'close_grip_bench_press',
      expected_ratio_low: 0.80,
      expected_ratio_high: 0.90,
      weight: 1.0
    },
    {
      index: 'back_tension_index',
      proxy_exercise_id: 'barbell_row',
      expected_ratio_low: 0.65,
      expected_ratio_high: 0.75,
      weight: 1.0
    }
  ],

  validationTests: [
    {
      phase_id: 'bottom',
      hypothesis_key: 'upper_chest_deficit',
      training_age: 'any',
      equipment: 'any',
      description: 'DB incline press comparison test',
      how_to_run: 'Perform 3×8 dumbbell incline press at a moderate load. If you can press DBs with substantially better control and feel more pec activation than barbell incline, the barbell setup may be positioning-limited. If strength gap remains, upper chest is truly weak.',
      hypothesis_tested: 'Upper Chest / Anterior Delt Deficit',
      equipment_required: ['dumbbells', 'adjustable_bench'],
      training_age_minimum: 'beginner'
    },
    {
      phase_id: 'ascent',
      hypothesis_key: 'anterior_delt_deficit',
      training_age: 'any',
      equipment: 'any',
      description: 'Overhead press progression check',
      how_to_run: 'Track OHP for 3 weeks with 3×5 at RPE 8. If OHP stalls while incline struggles, anterior deltoid is confirmed as the shared limiting factor. If OHP moves well, the incline issue is more positional.',
      hypothesis_tested: 'Anterior Deltoid Deficit',
      equipment_required: ['barbell'],
      training_age_minimum: 'beginner'
    },
    {
      phase_id: 'lockout',
      hypothesis_key: 'triceps_deficit',
      training_age: 'any',
      equipment: 'any',
      description: 'Close-grip incline press test',
      how_to_run: 'Perform 3×5 close-grip incline bench at ~75% of your incline 1RM. Note where bar slows. If lockout remains the sticking point, triceps are confirmed as the limiter on incline.',
      hypothesis_tested: 'Triceps Lockout Deficit',
      equipment_required: ['barbell', 'adjustable_bench'],
      training_age_minimum: 'beginner'
    }
  ]
};

// ─── Deadlift ────────────────────────────────────────────────────────────────

export const deadliftConfig: LiftConfig = {
  lift_id: 'deadlift',

  phaseRules: [
    {
      description: 'Hard off the floor — floor phase',
      condition: { type: 'flag', flag: 'hard_off_floor' },
      phase_id: 'initial_pull',
      points: 35
    },
    {
      description: 'Hips shoot up — quad/positional floor issue',
      condition: { type: 'flag', flag: 'hips_shoot_up' },
      phase_id: 'initial_pull',
      points: 30
    },
    {
      description: 'Rack pull >> deadlift (> 1.15) — floor is the bottleneck',
      condition: {
        type: 'ratio_above',
        numerator_exercise: 'rack_pull',
        denominator_exercise: 'deadlift',
        threshold: 1.15
      },
      phase_id: 'initial_pull',
      points: 30
    },
    {
      description: 'Deficit deadlift weak (< 0.88) — floor range is limiting',
      condition: {
        type: 'ratio_below',
        numerator_exercise: 'deficit_deadlift',
        denominator_exercise: 'deadlift',
        threshold: 0.88
      },
      phase_id: 'initial_pull',
      points: 20
    },
    {
      description: 'Squat weak vs deadlift (< 0.70) — quad contribution floor issue',
      condition: {
        type: 'ratio_below',
        numerator_exercise: 'barbell_back_squat',
        denominator_exercise: 'deadlift',
        threshold: 0.70
      },
      phase_id: 'initial_pull',
      points: 20
    },
    {
      description: 'Back rounds or chest drops during pull',
      condition: { type: 'flag', flag: 'back_rounds' },
      phase_id: 'knee_level',
      points: 30
    },
    {
      description: 'Bar drifts forward from body',
      condition: { type: 'flag', flag: 'bar_drifts_forward' },
      phase_id: 'knee_level',
      points: 25
    },
    {
      description: 'Feel it mostly in lower back',
      condition: { type: 'flag', flag: 'feel_lower_back' },
      phase_id: 'knee_level',
      points: 20
    },
    {
      description: 'Slow lockout / hard at top',
      condition: { type: 'flag', flag: 'hard_at_lockout' },
      phase_id: 'lockout',
      points: 35
    },
    {
      description: 'Rack pull only slightly stronger (< 1.10) — lockout weak',
      condition: {
        type: 'ratio_below',
        numerator_exercise: 'rack_pull',
        denominator_exercise: 'deadlift',
        threshold: 1.10
      },
      phase_id: 'lockout',
      points: 25
    },
    {
      description: 'Hip thrust strong (> 1.5 of DL) — issue is elsewhere; but RDL weak — posterior mid-pull weak',
      condition: {
        type: 'ratio_below',
        numerator_exercise: 'romanian_deadlift',
        denominator_exercise: 'deadlift',
        threshold: 0.62
      },
      phase_id: 'lockout',
      points: 20
    },
    {
      description: 'Grip failing — grip phase',
      condition: { type: 'flag', flag: 'grip_limiting' },
      phase_id: 'lockout',
      points: 25
    }
  ],

  hypothesisRules: [
    {
      description: 'Quad/floor contribution deficit — hips shoot up',
      condition: { type: 'flag', flag: 'hips_shoot_up' },
      hypothesis_key: 'quad_floor_deficit',
      hypothesis_label: 'Quad / Floor Contribution Deficit',
      category: 'muscle',
      points: 35,
      evidence_template: 'Hips shoot up on the initial pull — indicates quads are insufficient to maintain the starting position and push the floor away.'
    },
    {
      description: 'Quad deficit — squat far below DL',
      condition: {
        type: 'ratio_below',
        numerator_exercise: 'barbell_back_squat',
        denominator_exercise: 'deadlift',
        threshold: 0.70
      },
      hypothesis_key: 'quad_floor_deficit',
      hypothesis_label: 'Quad / Floor Contribution Deficit',
      category: 'muscle',
      points: 30,
      evidence_template: 'Back squat at {value}% of deadlift (expected 75–90%) — low squat-to-DL ratio indicates quads are undercontributing to the initial drive off the floor.'
    },
    {
      description: 'Lat/tension deficit — bar drifts',
      condition: { type: 'flag', flag: 'bar_drifts_forward' },
      hypothesis_key: 'lat_tension_deficit',
      hypothesis_label: 'Lat / Bar Tension Deficit',
      category: 'mechanical',
      points: 35,
      evidence_template: 'Bar drifts forward from the body — lats are not maintaining bar proximity, increasing moment arm and mechanical disadvantage.'
    },
    {
      description: 'Lat tension — row weak vs DL',
      condition: {
        type: 'ratio_below',
        numerator_exercise: 'barbell_row',
        denominator_exercise: 'deadlift',
        threshold: 0.50
      },
      hypothesis_key: 'lat_tension_deficit',
      hypothesis_label: 'Lat / Bar Tension Deficit',
      category: 'mechanical',
      points: 25,
      evidence_template: 'Barbell row at {value}% of deadlift (expected 50–65%) — lower-back and lat tension proxies indicate inability to maintain bar path.'
    },
    {
      description: 'Bracing/trunk stiffness deficit — back rounds',
      condition: { type: 'flag', flag: 'back_rounds' },
      hypothesis_key: 'bracing_deficit',
      hypothesis_label: 'Bracing / Trunk Stiffness Deficit',
      category: 'stability',
      points: 40,
      evidence_template: 'Back rounds during the pull — insufficient intra-abdominal pressure or erector strength to maintain spinal neutrality under load.'
    },
    {
      description: 'Bracing — feel it in lower back',
      condition: { type: 'flag', flag: 'feel_lower_back' },
      hypothesis_key: 'bracing_deficit',
      hypothesis_label: 'Bracing / Trunk Stiffness Deficit',
      category: 'stability',
      points: 20,
      evidence_template: 'Lower back is the primary fatigue point — suggests erectors and bracing are absorbing excess load that should be distributed across the posterior chain.'
    },
    {
      description: 'Posterior chain lockout deficit — slow lockout',
      condition: { type: 'flag', flag: 'hard_at_lockout' },
      hypothesis_key: 'posterior_lockout_deficit',
      hypothesis_label: 'Posterior Chain Lockout Deficit',
      category: 'muscle',
      points: 35,
      evidence_template: 'Lockout is the hardest point — glutes and upper erectors are responsible for final hip extension and are the likely limiter.'
    },
    {
      description: 'Posterior lockout — RDL weak vs DL',
      condition: {
        type: 'ratio_below',
        numerator_exercise: 'romanian_deadlift',
        denominator_exercise: 'deadlift',
        threshold: 0.62
      },
      hypothesis_key: 'posterior_lockout_deficit',
      hypothesis_label: 'Posterior Chain Lockout Deficit',
      category: 'muscle',
      points: 30,
      evidence_template: 'RDL at {value}% of deadlift (expected 65–75%) — hamstring and hip hinge strength is disproportionately low, limiting lockout power.'
    },
    {
      description: 'Grip limiter — grip flag',
      condition: { type: 'flag', flag: 'grip_limiting' },
      hypothesis_key: 'grip_limiter',
      hypothesis_label: 'Grip Strength Limiter',
      category: 'technique',
      points: 45,
      evidence_template: 'User identifies grip as the limiting factor — bar is slipping before posterior chain is exhausted. Address with grip training or chalk before attributing to other limiters.'
    },
    {
      description: 'Insufficient wedge/slack — mechanical floor setup',
      condition: { type: 'flag', flag: 'hard_off_floor' },
      hypothesis_key: 'wedge_setup_deficit',
      hypothesis_label: 'Insufficient Wedge / Slack Pull Setup',
      category: 'mechanical',
      points: 20,
      evidence_template: 'Hard off the floor — may indicate insufficient pre-tension (slack pull) and hip position before initiating the pull, separate from raw strength.'
    }
  ],

  indexMappings: [
    {
      index: 'quad_index',
      proxy_exercise_id: 'barbell_back_squat',
      expected_ratio_low: 0.75,
      expected_ratio_high: 0.90,
      weight: 0.7
    },
    {
      index: 'quad_index',
      proxy_exercise_id: 'barbell_front_squat',
      expected_ratio_low: 0.60,
      expected_ratio_high: 0.75,
      weight: 0.3
    },
    {
      index: 'posterior_index',
      proxy_exercise_id: 'romanian_deadlift',
      expected_ratio_low: 0.65,
      expected_ratio_high: 0.75,
      weight: 0.5
    },
    {
      index: 'posterior_index',
      proxy_exercise_id: 'hip_thrust',
      expected_ratio_low: 1.20,
      expected_ratio_high: 1.60,
      weight: 0.3
    },
    {
      index: 'posterior_index',
      proxy_exercise_id: 'good_morning',
      expected_ratio_low: 0.35,
      expected_ratio_high: 0.50,
      weight: 0.2
    },
    {
      index: 'back_tension_index',
      proxy_exercise_id: 'barbell_row',
      expected_ratio_low: 0.50,
      expected_ratio_high: 0.65,
      weight: 1.0
    }
  ],

  validationTests: [
    {
      phase_id: 'initial_pull',
      hypothesis_key: 'quad_floor_deficit',
      training_age: 'any',
      equipment: 'any',
      description: 'Pause deadlift off floor test',
      how_to_run: 'Perform 3×2 at ~80% with a 1-second pause 1 inch off the floor. If the pause version collapses noticeably more than your regular pull (hips rise, back rounds), quad contribution and floor mechanics are confirmed as the limiter.',
      hypothesis_tested: 'Quad / Floor Contribution Deficit',
      equipment_required: ['barbell'],
      training_age_minimum: 'intermediate',
      fallback: {
        description: 'Tempo deadlift floor observation',
        how_to_run: 'Perform 3×3 at ~70% with a 3-second lowering phase. On the way up, observe at what point your hips begin to rise faster than the bar. Hips rising before the bar clears mid-shin confirms floor phase breakdown.',
        hypothesis_tested: 'Quad / Floor Contribution Deficit',
        equipment_required: ['barbell'],
        training_age_minimum: 'beginner',
        fallback_used: false
      }
    },
    {
      phase_id: 'knee_level',
      hypothesis_key: 'lat_tension_deficit',
      training_age: 'any',
      equipment: 'any',
      description: 'Bar proximity observation test',
      how_to_run: 'Film a set at ~85% from the side. Watch whether the bar stays in contact with or within 1cm of your shins from floor to knee. Bar floating forward before knees confirms lat tension deficit. Also perform 3×8 lat pulldowns before your next DL session and note if bar path improves.',
      hypothesis_tested: 'Lat / Bar Tension Deficit',
      equipment_required: ['barbell'],
      training_age_minimum: 'beginner'
    },
    {
      phase_id: 'lockout',
      hypothesis_key: 'posterior_lockout_deficit',
      training_age: 'any',
      equipment: 'any',
      description: 'Rack pull lockout test',
      how_to_run: 'Perform rack pulls from knee height: 3×3 at ~90–95% of your deadlift. If these are only marginally stronger than your full deadlift (within 5%), lockout strength is confirmed as the bottleneck. Expected: rack pulls should be 15–30% stronger.',
      hypothesis_tested: 'Posterior Chain Lockout Deficit',
      equipment_required: ['barbell', 'rack'],
      training_age_minimum: 'intermediate',
      fallback: {
        description: 'Hip thrust RPE comparison',
        how_to_run: 'Perform hip thrusts at a load equal to ~80% of your deadlift for 5 reps. Note RPE. If hip thrusts feel very easy at this load, glutes are not the lockout limiter — focus shifts to erectors or technique. If hard, glute strength is confirmed as limiting.',
        hypothesis_tested: 'Posterior Chain Lockout Deficit',
        equipment_required: ['barbell', 'bench'],
        training_age_minimum: 'beginner',
        fallback_used: false
      }
    },
    {
      phase_id: 'lockout',
      hypothesis_key: 'grip_limiter',
      training_age: 'any',
      equipment: 'any',
      description: 'Straps comparison test',
      how_to_run: 'On your next heavy DL session, perform your working sets with straps. If your e1RM or top-set performance improves by more than 5%, grip is confirmed as the primary limiter rather than posterior chain strength.',
      hypothesis_tested: 'Grip Strength Limiter',
      equipment_required: ['barbell', 'straps'],
      training_age_minimum: 'beginner'
    }
  ]
};

// ─── Barbell Back Squat ──────────────────────────────────────────────────────

export const backSquatConfig: LiftConfig = {
  lift_id: 'barbell_back_squat',

  phaseRules: [
    {
      description: 'Hard out of the hole — bottom phase',
      condition: { type: 'flag', flag: 'hard_off_floor' },
      phase_id: 'bottom',
      points: 35
    },
    {
      description: 'Ankles/hips restrict depth — bottom',
      condition: { type: 'flag', flag: 'mobility_restriction' },
      phase_id: 'bottom',
      points: 25
    },
    {
      description: 'Front squat far below back squat (< 0.75) — quad/bracing bottom issue',
      condition: {
        type: 'ratio_below',
        numerator_exercise: 'barbell_front_squat',
        denominator_exercise: 'barbell_back_squat',
        threshold: 0.75
      },
      phase_id: 'bottom',
      points: 25
    },
    {
      description: 'Pause squat much weaker (< 0.85) — stretch reflex reliance / bottom weakness',
      condition: {
        type: 'ratio_below',
        numerator_exercise: 'pause_squat',
        denominator_exercise: 'barbell_back_squat',
        threshold: 0.85
      },
      phase_id: 'bottom',
      points: 20
    },
    {
      description: 'Hips shoot up faster than chest in ascent',
      condition: { type: 'flag', flag: 'hips_shoot_up' },
      phase_id: 'ascent',
      points: 30
    },
    {
      description: 'Chest/torso drops forward (good-morning squat)',
      condition: { type: 'flag', flag: 'chest_drops' },
      phase_id: 'ascent',
      points: 30
    },
    {
      description: 'Sticking point in mid-ascent',
      condition: { type: 'flag', flag: 'hard_mid_range' },
      phase_id: 'ascent',
      points: 25
    },
    {
      description: 'Squat/DL ratio low (< 0.72) — quad is limiter',
      condition: {
        type: 'ratio_below',
        numerator_exercise: 'barbell_back_squat',
        denominator_exercise: 'deadlift',
        threshold: 0.72
      },
      phase_id: 'ascent',
      points: 20
    }
  ],

  hypothesisRules: [
    {
      description: 'Quad deficit — front squat far below back squat',
      condition: {
        type: 'ratio_below',
        numerator_exercise: 'barbell_front_squat',
        denominator_exercise: 'barbell_back_squat',
        threshold: 0.75
      },
      hypothesis_key: 'quad_deficit',
      hypothesis_label: 'Quad Strength Deficit',
      category: 'muscle',
      points: 40,
      evidence_template: 'Front squat at {value}% of back squat (expected 80–90%) — larger than expected gap indicates quads or upper back are disproportionately weak.'
    },
    {
      description: 'Quad deficit — hips shoot up',
      condition: { type: 'flag', flag: 'hips_shoot_up' },
      hypothesis_key: 'quad_deficit',
      hypothesis_label: 'Quad Strength Deficit',
      category: 'muscle',
      points: 30,
      evidence_template: 'Hips rise faster than chest in ascent — classic sign that quads are fatiguing and the lifter is converting to a hip-dominant (good morning) pattern.'
    },
    {
      description: 'Quad deficit — hard out of hole',
      condition: { type: 'flag', flag: 'hard_off_floor' },
      hypothesis_key: 'quad_deficit',
      hypothesis_label: 'Quad Strength Deficit',
      category: 'muscle',
      points: 25,
      evidence_template: 'Hardest point is out of the hole — quads are the primary driver in this phase and are the likely limiter.'
    },
    {
      description: 'Bracing/trunk deficit — chest drops',
      condition: { type: 'flag', flag: 'chest_drops' },
      hypothesis_key: 'bracing_deficit',
      hypothesis_label: 'Bracing / Trunk Stiffness Deficit',
      category: 'stability',
      points: 40,
      evidence_template: 'Torso collapses forward (good-morning squat pattern) — trunk stiffness and bracing are insufficient to maintain bar position over mid-foot during ascent.'
    },
    {
      description: 'Bracing deficit — mid-range sticking point',
      condition: { type: 'flag', flag: 'hard_mid_range' },
      hypothesis_key: 'bracing_deficit',
      hypothesis_label: 'Bracing / Trunk Stiffness Deficit',
      category: 'stability',
      points: 20,
      evidence_template: 'Mid-ascent sticking point — often driven by energy leak through the trunk rather than pure leg strength failure.'
    },
    {
      description: 'Mobility restriction — depth/ankle issue',
      condition: { type: 'flag', flag: 'mobility_restriction' },
      hypothesis_key: 'mobility_restriction',
      hypothesis_label: 'Mobility / Position Restriction',
      category: 'mobility',
      points: 45,
      evidence_template: 'Ankle or hip mobility limits depth — positional restriction means strength work alone will not solve the sticking point.'
    },
    {
      description: 'Glute/hip extension deficit — squat/DL ratio low',
      condition: {
        type: 'ratio_below',
        numerator_exercise: 'barbell_back_squat',
        denominator_exercise: 'deadlift',
        threshold: 0.72
      },
      hypothesis_key: 'glute_hip_deficit',
      hypothesis_label: 'Glute / Hip Extension Deficit',
      category: 'muscle',
      points: 25,
      evidence_template: 'Squat at {value}% of deadlift (expected 75–90%) — disproportionately low squat relative to deadlift suggests quad or overall leg drive is the limiter rather than posterior chain.'
    },
    {
      description: 'Stretch reflex reliance — pause squat much weaker',
      condition: {
        type: 'ratio_below',
        numerator_exercise: 'pause_squat',
        denominator_exercise: 'barbell_back_squat',
        threshold: 0.85
      },
      hypothesis_key: 'stretch_reflex_reliance',
      hypothesis_label: 'Stretch Reflex Reliance / True Bottom Weakness',
      category: 'technique',
      points: 30,
      evidence_template: 'Pause squat at {value}% of back squat (expected 85–95%) — large drop with pause indicates over-reliance on bounce at bottom rather than true muscular strength out of hole.'
    }
  ],

  indexMappings: [
    {
      index: 'quad_index',
      proxy_exercise_id: 'barbell_front_squat',
      expected_ratio_low: 0.80,
      expected_ratio_high: 0.90,
      weight: 0.5
    },
    {
      index: 'quad_index',
      proxy_exercise_id: 'leg_press',
      expected_ratio_low: 1.50,
      expected_ratio_high: 2.00,
      weight: 0.3
    },
    {
      index: 'quad_index',
      proxy_exercise_id: 'bulgarian_split_squat',
      expected_ratio_low: 0.30,
      expected_ratio_high: 0.40,
      weight: 0.2
    },
    {
      index: 'posterior_index',
      proxy_exercise_id: 'romanian_deadlift',
      expected_ratio_low: 0.55,
      expected_ratio_high: 0.70,
      weight: 0.5
    },
    {
      index: 'posterior_index',
      proxy_exercise_id: 'hip_thrust',
      expected_ratio_low: 1.10,
      expected_ratio_high: 1.50,
      weight: 0.5
    },
    {
      index: 'back_tension_index',
      proxy_exercise_id: 'barbell_row',
      expected_ratio_low: 0.60,
      expected_ratio_high: 0.75,
      weight: 1.0
    }
  ],

  validationTests: [
    {
      phase_id: 'bottom',
      hypothesis_key: 'quad_deficit',
      training_age: 'any',
      equipment: 'any',
      description: 'Pause squat comparison test',
      how_to_run: 'Perform 3×3 pause squats (2-second pause at bottom) at ~75–80% of your back squat 1RM. If these feel dramatically harder than regular squats at similar load, quad strength out of the hole is confirmed as the primary limiter (reliance on bounce/stretch reflex).',
      hypothesis_tested: 'Quad Strength Deficit',
      equipment_required: ['barbell', 'rack'],
      training_age_minimum: 'beginner'
    },
    {
      phase_id: 'bottom',
      hypothesis_key: 'mobility_restriction',
      training_age: 'any',
      equipment: 'any',
      description: 'Heel elevation squat test',
      how_to_run: 'Squat with 5–10lb plates under your heels at a moderate load. If your form, depth, and strength noticeably improve, ankle dorsiflexion is confirmed as the mobility limiter. Follow up with targeted ankle mobility work.',
      hypothesis_tested: 'Mobility / Position Restriction',
      equipment_required: ['barbell', 'rack', 'plates'],
      training_age_minimum: 'beginner'
    },
    {
      phase_id: 'ascent',
      hypothesis_key: 'bracing_deficit',
      training_age: 'any',
      equipment: 'any',
      description: 'Belt vs no-belt observation',
      how_to_run: 'Perform 2 sets at ~85% — one with belt, one without. If the beltless set shows significantly more torso lean or forward collapse, intra-abdominal pressure and bracing are confirmed as the limiting factor. Belt improvement of > 5% e1RM suggests bracing rather than raw strength is the bottleneck.',
      hypothesis_tested: 'Bracing / Trunk Stiffness Deficit',
      equipment_required: ['barbell', 'rack', 'belt'],
      training_age_minimum: 'intermediate',
      fallback: {
        description: 'Brace observation — unloaded squat pattern',
        how_to_run: 'Squat to depth without weight while deliberately focusing on maximum brace (big breath + max abdominal tension before descent). Compare your body position at bottom vs your normal loaded sets. If the unloaded position is markedly better, bracing execution under load is the issue.',
        hypothesis_tested: 'Bracing / Trunk Stiffness Deficit',
        equipment_required: [],
        training_age_minimum: 'beginner',
        fallback_used: false
      }
    }
  ]
};

// ─── Barbell Front Squat ─────────────────────────────────────────────────────

export const frontSquatConfig: LiftConfig = {
  lift_id: 'barbell_front_squat',

  phaseRules: [
    {
      description: 'Hard out of the hole — bottom phase',
      condition: { type: 'flag', flag: 'hard_off_floor' },
      phase_id: 'bottom',
      points: 35
    },
    {
      description: 'Elbows drop in bottom / during ascent',
      condition: { type: 'flag', flag: 'elbows_drop' },
      phase_id: 'bottom',
      points: 30
    },
    {
      description: 'Mobility restriction — rack position or depth',
      condition: { type: 'flag', flag: 'mobility_restriction' },
      phase_id: 'bottom',
      points: 25
    },
    {
      description: 'Front squat far below back squat (< 0.75) — quad or upper back is limiting bottom',
      condition: {
        type: 'ratio_below',
        numerator_exercise: 'barbell_front_squat',
        denominator_exercise: 'barbell_back_squat',
        threshold: 0.75
      },
      phase_id: 'bottom',
      points: 20
    },
    {
      description: 'Torso collapses forward during ascent',
      condition: { type: 'flag', flag: 'chest_drops' },
      phase_id: 'ascent',
      points: 35
    },
    {
      description: 'Hard mid-range ascent',
      condition: { type: 'flag', flag: 'hard_mid_range' },
      phase_id: 'ascent',
      points: 25
    },
    {
      description: 'Row weak vs front squat (< 0.55) — upper back limiting torso position',
      condition: {
        type: 'ratio_below',
        numerator_exercise: 'barbell_row',
        denominator_exercise: 'barbell_front_squat',
        threshold: 0.55
      },
      phase_id: 'ascent',
      points: 25
    },
    {
      description: 'Leg press not much stronger (< 1.30 of FS) — true quad is limiting',
      condition: {
        type: 'ratio_below',
        numerator_exercise: 'leg_press',
        denominator_exercise: 'barbell_front_squat',
        threshold: 1.30
      },
      phase_id: 'ascent',
      points: 20
    }
  ],

  hypothesisRules: [
    {
      description: 'Quad deficit — hard out of hole',
      condition: { type: 'flag', flag: 'hard_off_floor' },
      hypothesis_key: 'quad_deficit',
      hypothesis_label: 'Quad Strength Deficit',
      category: 'muscle',
      points: 35,
      evidence_template: 'Hardest point is out of the hole — front squat places maximum quad demand at the bottom and is the likely limiting factor.'
    },
    {
      description: 'Quad deficit — leg press not far ahead of FS',
      condition: {
        type: 'ratio_below',
        numerator_exercise: 'leg_press',
        denominator_exercise: 'barbell_front_squat',
        threshold: 1.30
      },
      hypothesis_key: 'quad_deficit',
      hypothesis_label: 'Quad Strength Deficit',
      category: 'muscle',
      points: 35,
      evidence_template: 'Leg press at {value}% of front squat (expected 130–170%) — leg press not significantly stronger confirms true quad strength (not just positioning) is the limiter.'
    },
    {
      description: 'Upper back / rack stability deficit — elbows drop',
      condition: { type: 'flag', flag: 'elbows_drop' },
      hypothesis_key: 'upper_back_rack_deficit',
      hypothesis_label: 'Upper Back / Rack Stability Deficit',
      category: 'stability',
      points: 45,
      evidence_template: 'Elbows drop during the lift — upper back fatigue is dumping the bar forward, which is the primary technical failure mode in front squats.'
    },
    {
      description: 'Upper back deficit — torso collapses forward',
      condition: { type: 'flag', flag: 'chest_drops' },
      hypothesis_key: 'upper_back_rack_deficit',
      hypothesis_label: 'Upper Back / Rack Stability Deficit',
      category: 'stability',
      points: 35,
      evidence_template: 'Torso collapses forward during ascent — upper back cannot maintain the upright position required by front squat bar placement.'
    },
    {
      description: 'Upper back — row weak vs front squat',
      condition: {
        type: 'ratio_below',
        numerator_exercise: 'barbell_row',
        denominator_exercise: 'barbell_front_squat',
        threshold: 0.55
      },
      hypothesis_key: 'upper_back_rack_deficit',
      hypothesis_label: 'Upper Back / Rack Stability Deficit',
      category: 'stability',
      points: 30,
      evidence_template: 'Barbell row at {value}% of front squat (expected 50–70%) — upper back strength proxy is below expected, corroborating torso stability as the limiter.'
    },
    {
      description: 'Core stability deficit — bracing breakdown',
      condition: { type: 'flag', flag: 'hard_mid_range' },
      hypothesis_key: 'core_bracing_deficit',
      hypothesis_label: 'Core / Anterior Bracing Deficit',
      category: 'stability',
      points: 25,
      evidence_template: 'Mid-range sticking point on front squat — anterior core strength is critical for transferring force upward while maintaining torso angle, and may be the limiting factor.'
    },
    {
      description: 'Mobility restriction — rack or depth',
      condition: { type: 'flag', flag: 'mobility_restriction' },
      hypothesis_key: 'mobility_restriction',
      hypothesis_label: 'Mobility Restriction (Ankle / Wrist / Thoracic)',
      category: 'mobility',
      points: 45,
      evidence_template: 'Mobility restriction reported (ankle, wrist, or thoracic) — front squat is highly mobility-demanding and positional failure will override strength gains.'
    },
    {
      description: 'FS/BS gap too large — combined quad + upper back',
      condition: {
        type: 'ratio_below',
        numerator_exercise: 'barbell_front_squat',
        denominator_exercise: 'barbell_back_squat',
        threshold: 0.75
      },
      hypothesis_key: 'quad_deficit',
      hypothesis_label: 'Quad Strength Deficit',
      category: 'muscle',
      points: 20,
      evidence_template: 'Front squat at {value}% of back squat (expected 80–90%) — gap larger than 25% implicates quad or upper back as specific front squat limiters beyond general leg strength.'
    }
  ],

  indexMappings: [
    {
      index: 'quad_index',
      proxy_exercise_id: 'leg_press',
      expected_ratio_low: 1.30,
      expected_ratio_high: 1.70,
      weight: 0.5
    },
    {
      index: 'quad_index',
      proxy_exercise_id: 'barbell_back_squat',
      expected_ratio_low: 1.10,
      expected_ratio_high: 1.25,
      weight: 0.5
    },
    {
      index: 'back_tension_index',
      proxy_exercise_id: 'barbell_row',
      expected_ratio_low: 0.50,
      expected_ratio_high: 0.70,
      weight: 0.7
    },
    {
      index: 'back_tension_index',
      proxy_exercise_id: 'tbar_row',
      expected_ratio_low: 0.45,
      expected_ratio_high: 0.65,
      weight: 0.3
    },
    {
      index: 'posterior_index',
      proxy_exercise_id: 'romanian_deadlift',
      expected_ratio_low: 0.50,
      expected_ratio_high: 0.65,
      weight: 1.0
    }
  ],

  validationTests: [
    {
      phase_id: 'bottom',
      hypothesis_key: 'quad_deficit',
      training_age: 'any',
      equipment: 'any',
      description: 'Leg press vs front squat strength comparison',
      how_to_run: 'Perform leg press at ~150% of your front squat load for 5 reps and note RPE. If leg press at that load is near-maximal effort, true quad strength is the limiter. If leg press feels easy, positioning and upper back stability are more likely the issue.',
      hypothesis_tested: 'Quad Strength Deficit',
      equipment_required: ['leg_press_machine'],
      training_age_minimum: 'beginner',
      fallback: {
        description: 'Goblet squat comparison',
        how_to_run: 'Perform goblet squats to depth with a heavy dumbbell. If you can squat deeper and with a more upright torso than barbell front squat, the front rack position (not quad strength) is limiting you. If goblet squat also feels very hard out of hole, quad strength is confirmed as the limiter.',
        hypothesis_tested: 'Quad Strength Deficit',
        equipment_required: ['dumbbells'],
        training_age_minimum: 'beginner',
        fallback_used: false
      }
    },
    {
      phase_id: 'bottom',
      hypothesis_key: 'upper_back_rack_deficit',
      training_age: 'any',
      equipment: 'any',
      description: 'Elbows and torso position test',
      how_to_run: 'Perform 3×5 front squats at ~70% and actively focus on keeping elbows as high as possible throughout the entire rep. If performance improves and elbows staying up feels effortful but the bar stays in place, upper back endurance is confirmed as the limiter.',
      hypothesis_tested: 'Upper Back / Rack Stability Deficit',
      equipment_required: ['barbell', 'rack'],
      training_age_minimum: 'beginner'
    },
    {
      phase_id: 'bottom',
      hypothesis_key: 'mobility_restriction',
      training_age: 'any',
      equipment: 'any',
      description: 'Heel elevation + wrist flexibility test',
      how_to_run: 'Attempt front squats with 5–10lb plates under heels and assess if depth and upright position improve (tests ankle). Separately test front rack with empty bar — if wrists or shoulders are the restriction, use a cross-arm grip to isolate. Improvement confirms positional mobility as the limiter.',
      hypothesis_tested: 'Mobility Restriction (Ankle / Wrist / Thoracic)',
      equipment_required: ['barbell', 'rack', 'plates'],
      training_age_minimum: 'beginner'
    }
  ]
};

// ─── Clean & Jerk ─────────────────────────────────────────────────────────────

export const cleanAndJerkConfig: LiftConfig = {
  lift_id: 'clean_and_jerk',

  phaseRules: [
    {
      description: 'Hips rise before bar clears knee',
      condition: { type: 'flag', flag: 'hips_rise_first' },
      phase_id: 'first_pull',
      points: 30
    },
    {
      description: 'Bar drifts forward off the floor',
      condition: { type: 'flag', flag: 'bar_drifts_forward' },
      phase_id: 'first_pull',
      points: 20
    },
    {
      description: 'Back rounds under load',
      condition: { type: 'flag', flag: 'back_rounds' },
      phase_id: 'first_pull',
      points: 25
    },
    {
      description: 'Insufficient triple extension at second pull',
      condition: { type: 'flag', flag: 'insufficient_extension' },
      phase_id: 'second_pull',
      points: 35
    },
    {
      description: 'Early arm pull before hip extension',
      condition: { type: 'flag', flag: 'early_arm_pull' },
      phase_id: 'second_pull',
      points: 25
    },
    {
      description: 'Front rack mobility limits catch',
      condition: { type: 'flag', flag: 'front_rack_limited' },
      phase_id: 'catch_clean',
      points: 35
    },
    {
      description: 'Elbows drop in the catch',
      condition: { type: 'flag', flag: 'elbows_drop' },
      phase_id: 'catch_clean',
      points: 25
    },
    {
      description: 'Footwork inconsistent on jerk',
      condition: { type: 'flag', flag: 'footwork_inconsistent' },
      phase_id: 'jerk',
      points: 30
    },
    {
      description: 'Bar drifts out front overhead',
      condition: { type: 'flag', flag: 'bar_out_front' },
      phase_id: 'jerk',
      points: 20
    },
    {
      description: 'Elbow lockout incomplete overhead',
      condition: { type: 'flag', flag: 'elbow_lockout_incomplete' },
      phase_id: 'jerk',
      points: 20
    }
  ],

  hypothesisRules: [
    {
      description: 'Hip drive / triple extension deficit',
      condition: { type: 'flag', flag: 'insufficient_extension' },
      hypothesis_key: 'hip_drive_deficit',
      hypothesis_label: 'Insufficient Hip Drive (Second Pull)',
      category: 'muscle',
      points: 40,
      evidence_template: 'User reports incomplete triple extension in second pull — glutes/hamstrings failing to produce adequate power for bar height.'
    },
    {
      description: 'Early arm pull suggests technique flaw or hip drive deficit',
      condition: { type: 'flag', flag: 'early_arm_pull' },
      hypothesis_key: 'hip_drive_deficit',
      hypothesis_label: 'Insufficient Hip Drive (Second Pull)',
      category: 'technique',
      points: 20,
      evidence_template: 'Early arm pull indicates athlete is compensating for insufficient leg drive — consistent with hip drive as primary limiter.'
    },
    {
      description: 'Front rack mobility limits clean catch',
      condition: { type: 'flag', flag: 'front_rack_limited' },
      hypothesis_key: 'front_rack_mobility_deficit',
      hypothesis_label: 'Front Rack Mobility Restriction',
      category: 'mobility',
      points: 40,
      evidence_template: 'Restricted front rack position limits catch depth and security — wrist, elbow, or thoracic mobility is the primary constraint.'
    },
    {
      description: 'Elbows drop reinforces rack mobility issue',
      condition: { type: 'flag', flag: 'elbows_drop' },
      hypothesis_key: 'front_rack_mobility_deficit',
      hypothesis_label: 'Front Rack Mobility Restriction',
      category: 'mobility',
      points: 25,
      evidence_template: 'Elbows dropping in the catch position indicates insufficient thoracic extension or wrist flexibility to maintain proper front rack.'
    },
    {
      description: 'Poor first pull mechanics from back rounding',
      condition: { type: 'flag', flag: 'back_rounds' },
      hypothesis_key: 'posterior_chain_weakness',
      hypothesis_label: 'Posterior Chain / Positional Weakness',
      category: 'muscle',
      points: 30,
      evidence_template: 'Back rounding in first pull indicates erectors and posterior chain lack the strength to maintain position under load.'
    }
  ],

  indexMappings: [],

  validationTests: [
    {
      phase_id: 'second_pull',
      hypothesis_key: 'hip_drive_deficit',
      training_age: 'any',
      equipment: 'any',
      description: 'Hang clean power test',
      how_to_run: 'Perform 3 hang cleans from mid-thigh at 85% of clean max. Focus on achieving full triple extension (ankle, knee, hip) before pulling under. If bar height is insufficient for a comfortable catch, posterior chain power is confirmed as the limiter.',
      hypothesis_tested: 'Insufficient Hip Drive',
      equipment_required: ['barbell', 'rack'],
      training_age_minimum: 'beginner'
    },
    {
      phase_id: 'catch_clean',
      hypothesis_key: 'front_rack_mobility_deficit',
      training_age: 'any',
      equipment: 'any',
      description: 'Front rack mobility assessment',
      how_to_run: 'With an empty bar, hold the front rack position (elbows high, bar resting on delts) for 30 seconds. Note where discomfort occurs — wrist, elbow, or thoracic spine. If you cannot get elbows parallel to floor, mobility is the confirmed limiter.',
      hypothesis_tested: 'Front Rack Mobility Restriction',
      equipment_required: ['barbell'],
      training_age_minimum: 'beginner'
    }
  ]
};

// ─── Snatch ────────────────────────────────────────────────────────────────────

export const snatchConfig: LiftConfig = {
  lift_id: 'snatch',

  phaseRules: [
    {
      description: 'Bar drifts away from body off the floor',
      condition: { type: 'flag', flag: 'bar_drifts_forward' },
      phase_id: 'first_pull',
      points: 25
    },
    {
      description: 'Back rounds in first pull',
      condition: { type: 'flag', flag: 'back_rounds' },
      phase_id: 'first_pull',
      points: 25
    },
    {
      description: 'No scoop / transition into second pull',
      condition: { type: 'flag', flag: 'no_scoop' },
      phase_id: 'transition',
      points: 30
    },
    {
      description: 'Early arm pull before full extension',
      condition: { type: 'flag', flag: 'early_arm_pull' },
      phase_id: 'second_pull',
      points: 30
    },
    {
      description: 'Bar does not reach sufficient height for catch',
      condition: { type: 'flag', flag: 'insufficient_bar_height' },
      phase_id: 'second_pull',
      points: 35
    },
    {
      description: 'Overhead instability in catch',
      condition: { type: 'flag', flag: 'overhead_unstable' },
      phase_id: 'overhead_squat',
      points: 35
    },
    {
      description: 'Heels rise in overhead squat catch',
      condition: { type: 'flag', flag: 'heels_rise' },
      phase_id: 'overhead_squat',
      points: 25
    }
  ],

  hypothesisRules: [
    {
      description: 'Overhead instability — bar drifts or collapses in catch',
      condition: { type: 'flag', flag: 'overhead_unstable' },
      hypothesis_key: 'overhead_stability_deficit',
      hypothesis_label: 'Overhead Stability Deficit',
      category: 'stability',
      points: 45,
      evidence_template: 'Bar movement or collapse in the overhead squat catch indicates rotator cuff, trap, or serratus weakness preventing a stable lockout position.'
    },
    {
      description: 'Insufficient bar height indicates hip drive deficit',
      condition: { type: 'flag', flag: 'insufficient_bar_height' },
      hypothesis_key: 'hip_drive_deficit',
      hypothesis_label: 'Insufficient Hip Drive / Power',
      category: 'muscle',
      points: 40,
      evidence_template: 'Bar does not reach sufficient height for a comfortable catch — glutes and hamstrings are not producing adequate power in the second pull.'
    },
    {
      description: 'Early arm pull compensates for insufficient extension',
      condition: { type: 'flag', flag: 'early_arm_pull' },
      hypothesis_key: 'hip_drive_deficit',
      hypothesis_label: 'Insufficient Hip Drive / Power',
      category: 'technique',
      points: 20,
      evidence_template: 'Early arm pull is typically a compensation for insufficient leg drive — confirms hip extension power as primary limiter.'
    },
    {
      description: 'Ankle mobility limits overhead squat depth',
      condition: { type: 'flag', flag: 'heels_rise' },
      hypothesis_key: 'mobility_restriction',
      hypothesis_label: 'Ankle / Thoracic Mobility Restriction',
      category: 'mobility',
      points: 35,
      evidence_template: 'Heels rising in the catch indicates ankle dorsiflexion restriction, limiting the ability to receive the bar in a stable squat position.'
    }
  ],

  indexMappings: [],

  validationTests: [
    {
      phase_id: 'overhead_squat',
      hypothesis_key: 'overhead_stability_deficit',
      training_age: 'any',
      equipment: 'any',
      description: 'Overhead squat stability test',
      how_to_run: 'Perform 5 overhead squats with empty bar (wide snatch grip). Note any bar movement forward or backward, shoulder instability, or inability to reach depth. If empty bar is unstable, shoulder girdle weakness (rotator cuff / serratus) is the confirmed limiter.',
      hypothesis_tested: 'Overhead Stability Deficit',
      equipment_required: ['barbell'],
      training_age_minimum: 'beginner'
    },
    {
      phase_id: 'second_pull',
      hypothesis_key: 'hip_drive_deficit',
      training_age: 'any',
      equipment: 'any',
      description: 'Snatch pull height assessment',
      how_to_run: 'Perform 3 snatch pulls at 100–105% of snatch max. Focus on full triple extension and shrug. If bar does not reach navel height with full extension, posterior chain power is the confirmed limiter.',
      hypothesis_tested: 'Insufficient Hip Drive',
      equipment_required: ['barbell', 'plates'],
      training_age_minimum: 'intermediate'
    }
  ]
};

// ─── Power Clean ───────────────────────────────────────────────────────────────

export const powerCleanConfig: LiftConfig = {
  lift_id: 'power_clean',

  phaseRules: [
    {
      description: 'Back rounds in first pull',
      condition: { type: 'flag', flag: 'back_rounds' },
      phase_id: 'first_pull',
      points: 30
    },
    {
      description: 'Hips rise before bar clears knee',
      condition: { type: 'flag', flag: 'hips_rise_first' },
      phase_id: 'first_pull',
      points: 25
    },
    {
      description: 'Bar drifts away from body',
      condition: { type: 'flag', flag: 'bar_drifts_forward' },
      phase_id: 'first_pull',
      points: 20
    },
    {
      description: 'Early arm pull in second pull',
      condition: { type: 'flag', flag: 'early_arm_pull' },
      phase_id: 'second_pull',
      points: 30
    },
    {
      description: 'No shrug at top of pull',
      condition: { type: 'flag', flag: 'no_shrug' },
      phase_id: 'second_pull',
      points: 20
    },
    {
      description: 'Elbows drop in rack catch position',
      condition: { type: 'flag', flag: 'elbows_drop' },
      phase_id: 'catch',
      points: 30
    },
    {
      description: 'Wrist pain in catch',
      condition: { type: 'flag', flag: 'wrist_pain' },
      phase_id: 'catch',
      points: 20
    }
  ],

  hypothesisRules: [
    {
      description: 'Posterior chain weakness — back rounds under load',
      condition: { type: 'flag', flag: 'back_rounds' },
      hypothesis_key: 'posterior_chain_weakness',
      hypothesis_label: 'Posterior Chain Weakness',
      category: 'muscle',
      points: 40,
      evidence_template: 'Back rounding in the first pull indicates erectors and hamstrings lack the strength to maintain a neutral spine position during the initial drive.'
    },
    {
      description: 'Hips rise first — posterior chain cannot maintain position',
      condition: { type: 'flag', flag: 'hips_rise_first' },
      hypothesis_key: 'posterior_chain_weakness',
      hypothesis_label: 'Posterior Chain Weakness',
      category: 'technique',
      points: 25,
      evidence_template: 'Hips rising before the bar clears the knee is a compensation pattern indicating the posterior chain cannot generate enough force to maintain the hip-to-shoulder angle.'
    },
    {
      description: 'Front rack mobility limits catch',
      condition: { type: 'flag', flag: 'elbows_drop' },
      hypothesis_key: 'front_rack_mobility_deficit',
      hypothesis_label: 'Front Rack Mobility Restriction',
      category: 'mobility',
      points: 35,
      evidence_template: 'Elbows dropping in the power clean catch indicates restricted wrist extension or thoracic mobility limiting the front rack position.'
    },
    {
      description: 'Wrist pain indicates mobility or technique issue in catch',
      condition: { type: 'flag', flag: 'wrist_pain' },
      hypothesis_key: 'front_rack_mobility_deficit',
      hypothesis_label: 'Front Rack Mobility Restriction',
      category: 'mobility',
      points: 25,
      evidence_template: 'Wrist pain in the catch is a strong indicator of inadequate wrist flexibility — bar is being held by wrist extension rather than resting on the delts.'
    }
  ],

  indexMappings: [],

  validationTests: [
    {
      phase_id: 'first_pull',
      hypothesis_key: 'posterior_chain_weakness',
      training_age: 'any',
      equipment: 'any',
      description: 'Romanian deadlift strength comparison',
      how_to_run: 'Perform 5 RDLs at 110% of your power clean max while maintaining a neutral spine. If this is near-maximal effort, posterior chain strength is confirmed as the limiting factor. If it feels manageable, technique and bar path are the primary issues to address.',
      hypothesis_tested: 'Posterior Chain Weakness',
      equipment_required: ['barbell', 'plates'],
      training_age_minimum: 'beginner'
    },
    {
      phase_id: 'catch',
      hypothesis_key: 'front_rack_mobility_deficit',
      training_age: 'any',
      equipment: 'any',
      description: 'Front rack position test',
      how_to_run: 'With an empty bar, practice the front rack position: bar resting on finger tips, elbows driven high. Hold for 30 seconds. If you cannot get elbows to shoulder height or feel restriction in wrists/forearms, mobility is the confirmed limiter. Practice wrist curls and rack stretch.',
      hypothesis_tested: 'Front Rack Mobility Restriction',
      equipment_required: ['barbell'],
      training_age_minimum: 'beginner'
    }
  ]
};

// ─── Hang Clean ────────────────────────────────────────────────────────────────

export const hangCleanConfig: LiftConfig = {
  lift_id: 'hang_clean',

  phaseRules: [
    {
      description: 'Torso too upright in hang position (not enough hip hinge)',
      condition: { type: 'flag', flag: 'too_upright' },
      phase_id: 'hang_position',
      points: 25
    },
    {
      description: 'Bar too far from body in hang',
      condition: { type: 'flag', flag: 'bar_drifts_forward' },
      phase_id: 'hang_position',
      points: 20
    },
    {
      description: 'Insufficient hip extension from hang',
      condition: { type: 'flag', flag: 'insufficient_extension' },
      phase_id: 'second_pull',
      points: 35
    },
    {
      description: 'Early arm pull in second pull',
      condition: { type: 'flag', flag: 'early_arm_pull' },
      phase_id: 'second_pull',
      points: 25
    },
    {
      description: 'Elbows drop in front rack catch',
      condition: { type: 'flag', flag: 'elbows_drop' },
      phase_id: 'catch',
      points: 30
    },
    {
      description: 'Upper back rounds or cannot hold position',
      condition: { type: 'flag', flag: 'back_rounds' },
      phase_id: 'hang_position',
      points: 30
    },
    {
      description: 'Forward lean in catch / under-squatting',
      condition: { type: 'flag', flag: 'forward_lean' },
      phase_id: 'catch',
      points: 20
    }
  ],

  hypothesisRules: [
    {
      description: 'Insufficient hip drive from hang position',
      condition: { type: 'flag', flag: 'insufficient_extension' },
      hypothesis_key: 'hip_drive_deficit',
      hypothesis_label: 'Hip Drive Deficit',
      category: 'muscle',
      points: 45,
      evidence_template: 'Incomplete hip extension from the hang position indicates glutes and hamstrings are not generating sufficient explosive power for bar height in the catch.'
    },
    {
      description: 'Early arm pull compensates for insufficient hip extension',
      condition: { type: 'flag', flag: 'early_arm_pull' },
      hypothesis_key: 'hip_drive_deficit',
      hypothesis_label: 'Hip Drive Deficit',
      category: 'technique',
      points: 20,
      evidence_template: 'Pulling with arms before full hip extension is a compensation for insufficient posterior chain power — hip drive is the primary limiter.'
    },
    {
      description: 'Upper back weakness — cannot maintain position or rounds',
      condition: { type: 'flag', flag: 'back_rounds' },
      hypothesis_key: 'upper_back_weakness',
      hypothesis_label: 'Upper Back Strength Deficit',
      category: 'muscle',
      points: 40,
      evidence_template: 'Rounding through the upper back in the hang position or catch indicates traps, rhomboids, and erectors cannot support the load in the required position.'
    },
    {
      description: 'Front rack mobility limits catch quality',
      condition: { type: 'flag', flag: 'elbows_drop' },
      hypothesis_key: 'front_rack_mobility_deficit',
      hypothesis_label: 'Front Rack Mobility Restriction',
      category: 'mobility',
      points: 35,
      evidence_template: 'Elbows dropping in the hang clean catch indicates wrist or thoracic restriction — bar cannot rest securely on the anterior delts.'
    }
  ],

  indexMappings: [],

  validationTests: [
    {
      phase_id: 'second_pull',
      hypothesis_key: 'hip_drive_deficit',
      training_age: 'any',
      equipment: 'any',
      description: 'Hip extension power test from hang',
      how_to_run: 'Perform 3 hang high pulls from mid-thigh at 90% of hang clean max. Focus on aggressive hip snap and full triple extension before shrugging. If bar does not reach chest height with good extension, glute/hamstring power is confirmed as the limiter.',
      hypothesis_tested: 'Hip Drive Deficit',
      equipment_required: ['barbell', 'plates'],
      training_age_minimum: 'beginner'
    },
    {
      phase_id: 'hang_position',
      hypothesis_key: 'upper_back_weakness',
      training_age: 'any',
      equipment: 'any',
      description: 'Barbell row strength test',
      how_to_run: 'Perform 5 heavy barbell rows at 80% of hang clean max. If maintaining a rigid back angle throughout is very difficult, upper back endurance and strength is confirmed as the primary positional limiter.',
      hypothesis_tested: 'Upper Back Strength Deficit',
      equipment_required: ['barbell', 'plates'],
      training_age_minimum: 'beginner'
    }
  ]
};

// ─── Config lookup ────────────────────────────────────────────────────────────

export const liftConfigs: Record<string, LiftConfig> = {
  flat_bench_press: flatBenchConfig,
  incline_bench_press: inclineBenchConfig,
  deadlift: deadliftConfig,
  barbell_back_squat: backSquatConfig,
  barbell_front_squat: frontSquatConfig,
  clean_and_jerk: cleanAndJerkConfig,
  snatch: snatchConfig,
  power_clean: powerCleanConfig,
  hang_clean: hangCleanConfig
};

export function getLiftConfig(liftId: string): LiftConfig | undefined {
  return liftConfigs[liftId];
}
