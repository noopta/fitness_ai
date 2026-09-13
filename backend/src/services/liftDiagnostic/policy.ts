// Server-side policy for the conversational lift diagnostic.
//
// Mirrors packages/diagnostic-core (the client's shared stage machine) for
// the few facts the server must own itself: the accessory ladders it accepts
// sets for, the ratio norms that turn a set into evidence, and the flags a
// video-measured phase stands in for. The backend compiles on its own
// (rootDir ./src), so these are restated rather than imported — keep the
// ladder order in lockstep with packages/diagnostic-core/src/lifts.ts.

export const CONVERSATION_LIFTS = [
  'flat_bench_press',
  'incline_bench_press',
  'deadlift',
  'barbell_back_squat',
  'barbell_front_squat',
  'clean_and_jerk',
  'snatch',
  'power_clean',
  'hang_clean',
] as const;

export type ConversationLift = (typeof CONVERSATION_LIFTS)[number];

export function isConversationLift(v: unknown): v is ConversationLift {
  return typeof v === 'string' && (CONVERSATION_LIFTS as readonly string[]).includes(v);
}

export const LIFT_NAMES: Record<ConversationLift, string> = {
  flat_bench_press: 'Flat Bench Press',
  incline_bench_press: 'Incline Bench Press',
  deadlift: 'Deadlift',
  barbell_back_squat: 'Back Squat',
  barbell_front_squat: 'Front Squat',
  clean_and_jerk: 'Clean & Jerk',
  snatch: 'Snatch',
  power_clean: 'Power Clean',
  hang_clean: 'Hang Clean',
};

const LIFT_SHORT: Record<ConversationLift, string> = {
  flat_bench_press: 'bench',
  incline_bench_press: 'incline',
  deadlift: 'deadlift',
  barbell_back_squat: 'squat',
  barbell_front_squat: 'front squat',
  clean_and_jerk: 'clean & jerk',
  snatch: 'snatch',
  power_clean: 'power clean',
  hang_clean: 'hang clean',
};

export const EXERCISE_NAMES: Record<string, string> = {
  close_grip_bench_press: 'Close Grip Bench Press',
  paused_bench_press: 'Paused Bench Press',
  overhead_press: 'Overhead Press',
  tricep_pushdown: 'Tricep Pushdown',
  flat_bench_press: 'Flat Bench Press',
  barbell_row: 'Barbell Row',
  romanian_deadlift: 'Romanian Deadlift',
  barbell_back_squat: 'Back Squat',
  barbell_front_squat: 'Front Squat',
  rack_pull: 'Rack Pull',
  deficit_deadlift: 'Deficit Deadlift',
  pause_squat: 'Pause Squat',
  leg_press: 'Leg Press',
  hip_thrust: 'Hip Thrust',
  power_clean: 'Power Clean',
  hang_clean: 'Hang Clean',
  push_press: 'Push Press',
  deadlift: 'Deadlift',
  overhead_squat: 'Overhead Squat',
  snatch_pull: 'Snatch Pull',
};

export function exerciseName(id: string): string {
  return EXERCISE_NAMES[id] ?? LIFT_NAMES[id as ConversationLift] ?? id;
}

/**
 * A ratio norm: accessory e1RM ÷ main-lift e1RM. `region` is what the ratio
 * speaks for; a logged in-range ratio rules that region out, a missing one
 * leaves it open.
 *
 * Flat bench close-grip / overhead press come straight from the engine's
 * indexMappings. The rest are coaching-literature ranges pending the science
 * team's ranking (open question 1 in the design handoff).
 */
interface RatioNorm {
  low: number;
  high: number;
  region: string;
  /** Adjective form for the GAP row: "No shoulder ratio logged". */
  adj: string;
  plural: boolean;
}

const N = (low: number, high: number, region: string, adj: string, plural = false): RatioNorm => ({ low, high, region, adj, plural });

export const LADDERS: Record<ConversationLift, { id: string; norm: RatioNorm }[]> = {
  flat_bench_press: [
    { id: 'close_grip_bench_press', norm: N(0.85, 0.95, 'triceps', 'triceps', true) },
    { id: 'paused_bench_press', norm: N(0.88, 0.95, 'strength off the chest', 'off-chest') },
    { id: 'overhead_press', norm: N(0.6, 0.7, 'shoulders', 'shoulder', true) },
    { id: 'tricep_pushdown', norm: N(0.3, 0.45, 'triceps', 'triceps', true) },
  ],
  incline_bench_press: [
    { id: 'close_grip_bench_press', norm: N(0.95, 1.08, 'triceps', 'triceps', true) },
    { id: 'overhead_press', norm: N(0.7, 0.8, 'shoulders', 'shoulder', true) },
    { id: 'flat_bench_press', norm: N(1.12, 1.25, 'upper chest', 'upper-chest') },
    { id: 'barbell_row', norm: N(0.75, 0.9, 'upper back', 'upper-back') },
  ],
  deadlift: [
    { id: 'romanian_deadlift', norm: N(0.6, 0.75, 'posterior chain', 'posterior-chain') },
    { id: 'barbell_back_squat', norm: N(0.75, 0.9, 'quads', 'quad', true) },
    { id: 'rack_pull', norm: N(1.05, 1.2, 'lockout', 'lockout') },
    { id: 'barbell_row', norm: N(0.45, 0.6, 'upper back', 'upper-back') },
    { id: 'deficit_deadlift', norm: N(0.85, 0.92, 'strength off the floor', 'off-the-floor') },
  ],
  barbell_back_squat: [
    { id: 'barbell_front_squat', norm: N(0.8, 0.88, 'quads', 'quad', true) },
    { id: 'romanian_deadlift', norm: N(0.55, 0.7, 'posterior chain', 'posterior-chain') },
    { id: 'pause_squat', norm: N(0.8, 0.9, 'strength out of the hole', 'out-of-the-hole') },
    { id: 'leg_press', norm: N(1.6, 2.4, 'quads', 'quad', true) },
    { id: 'hip_thrust', norm: N(1.0, 1.3, 'glutes', 'glute', true) },
  ],
  barbell_front_squat: [
    { id: 'barbell_back_squat', norm: N(1.14, 1.25, 'overall leg strength', 'leg-strength') },
    { id: 'leg_press', norm: N(1.9, 2.6, 'quads', 'quad', true) },
    { id: 'barbell_row', norm: N(0.55, 0.7, 'upper back', 'upper-back') },
    { id: 'romanian_deadlift', norm: N(0.65, 0.85, 'posterior chain', 'posterior-chain') },
  ],
  clean_and_jerk: [
    { id: 'power_clean', norm: N(0.8, 0.9, 'pulling power', 'pulling-power') },
    { id: 'barbell_front_squat', norm: N(1.15, 1.3, 'leg strength', 'leg-strength') },
    { id: 'push_press', norm: N(0.85, 1.0, 'overhead drive', 'overhead-drive') },
    { id: 'deadlift', norm: N(1.6, 2.0, 'base strength', 'base-strength') },
  ],
  snatch: [
    { id: 'overhead_squat', norm: N(1.1, 1.3, 'overhead stability', 'overhead-stability') },
    { id: 'snatch_pull', norm: N(1.1, 1.25, 'pulling strength', 'pulling-strength') },
    { id: 'barbell_back_squat', norm: N(1.6, 1.9, 'leg strength', 'leg-strength') },
    { id: 'power_clean', norm: N(1.25, 1.4, 'pulling power', 'pulling-power') },
  ],
  power_clean: [
    { id: 'barbell_front_squat', norm: N(1.25, 1.45, 'leg strength', 'leg-strength') },
    { id: 'deadlift', norm: N(1.7, 2.1, 'base strength', 'base-strength') },
    { id: 'hang_clean', norm: N(0.9, 0.98, 'hang position', 'hang-position') },
    { id: 'push_press', norm: N(0.75, 0.9, 'overhead drive', 'overhead-drive') },
  ],
  hang_clean: [
    { id: 'power_clean', norm: N(1.0, 1.1, 'pull from the floor', 'floor-pull') },
    { id: 'barbell_front_squat', norm: N(1.2, 1.4, 'leg strength', 'leg-strength') },
    { id: 'deadlift', norm: N(1.7, 2.1, 'base strength', 'base-strength') },
    { id: 'push_press', norm: N(0.75, 0.9, 'overhead drive', 'overhead-drive') },
  ],
};

export function ladderIds(lift: ConversationLift): string[] {
  return LADDERS[lift].map((l) => l.id);
}

export function liftShort(lift: ConversationLift): string {
  return LIFT_SHORT[lift];
}

export type LiftFamily = 'press' | 'deadlift' | 'squat' | 'olympic';

export function liftFamily(lift: string): LiftFamily {
  if (lift === 'flat_bench_press' || lift === 'incline_bench_press') return 'press';
  if (lift === 'deadlift') return 'deadlift';
  if (lift === 'barbell_back_squat' || lift === 'barbell_front_squat') return 'squat';
  return 'olympic';
}

export const VOLUME_CANDIDATE: Record<LiftFamily, { key: string; label: string; noun: string }> = {
  press: { key: 'pressing_volume', label: 'Pressing volume', noun: 'pressing volume' },
  deadlift: { key: 'pulling_volume', label: 'Pulling volume', noun: 'pulling volume' },
  squat: { key: 'leg_volume', label: 'Leg volume', noun: 'leg volume' },
  olympic: { key: 'strength_base', label: 'Strength base', noun: 'strength base' },
};

/** Where a phase sits, in words, for VIDEO rows: "in the lockout". */
export const PHASE_WORDS: Record<string, string> = {
  bottom: 'off the bottom',
  ascent: 'mid-range',
  lockout: 'at lockout',
  initial_pull: 'off the floor',
  knee_level: 'at the knees',
  first_pull: 'in the first pull',
  second_pull: 'in the second pull',
  catch: 'in the catch',
  catch_clean: 'in the catch',
  jerk: 'in the jerk',
  hang_position: 'from the hang',
  transition: 'in the turnover',
  overhead_squat: 'overhead',
};

/** Movement phases per lift (phase ids from engine/liftConfigs.ts). */
export const LIFT_PHASES: Record<ConversationLift, string[]> = {
  flat_bench_press: ['bottom', 'ascent', 'lockout'],
  incline_bench_press: ['bottom', 'ascent', 'lockout'],
  deadlift: ['initial_pull', 'knee_level', 'lockout'],
  barbell_back_squat: ['bottom', 'ascent'],
  barbell_front_squat: ['bottom', 'ascent'],
  clean_and_jerk: ['first_pull', 'second_pull', 'catch_clean', 'jerk'],
  snatch: ['first_pull', 'second_pull', 'transition', 'overhead_squat'],
  power_clean: ['first_pull', 'second_pull', 'catch'],
  hang_clean: ['hang_position', 'second_pull', 'catch'],
};

/**
 * The flags a video-measured sticking phase stands in for — identical to the
 * q0 chip it replaces (packages/diagnostic-core/src/questions.ts), because
 * "the phase answer is stored as if given".
 */
const PHASE_FLAGS: Record<ConversationLift, Record<string, string[]>> = {
  flat_bench_press: { bottom: ['hard_off_chest'], ascent: ['hard_mid_range'], lockout: ['hard_at_lockout'] },
  incline_bench_press: { bottom: ['hard_off_chest'], ascent: ['hard_mid_range'], lockout: ['hard_at_lockout'] },
  deadlift: { initial_pull: ['hard_off_floor'], knee_level: ['hard_mid_range'], lockout: ['hard_at_lockout'] },
  barbell_back_squat: { bottom: ['hard_off_floor'], ascent: ['hard_mid_range'] },
  barbell_front_squat: { bottom: ['hard_off_floor'], ascent: ['hard_mid_range'] },
  clean_and_jerk: {
    first_pull: ['hips_rise_first'], second_pull: ['insufficient_extension'],
    catch_clean: ['front_rack_limited'], jerk: ['elbow_lockout_incomplete'],
  },
  snatch: {
    first_pull: ['back_rounds'], second_pull: ['insufficient_bar_height'],
    transition: ['no_scoop'], overhead_squat: ['overhead_unstable'],
  },
  power_clean: { first_pull: ['hips_rise_first'], second_pull: ['no_shrug'], catch: ['elbows_drop'] },
  hang_clean: { hang_position: ['forward_lean'], second_pull: ['insufficient_extension'], catch: ['elbows_drop'] },
};

export function flagsForPhase(lift: ConversationLift, phase: string | null): string[] {
  return phase ? PHASE_FLAGS[lift][phase] ?? [] : [];
}

/**
 * Flags a client may set from a chip. Answers are self-report, so the only
 * thing to guard is that they name a real engine flag.
 */
export const KNOWN_FLAGS = new Set([
  'hard_off_chest', 'hard_off_floor', 'hard_mid_range', 'hard_at_lockout', 'bar_drifts', 'bar_drifts_forward',
  'hips_shoot_up', 'chest_drops', 'back_rounds', 'feel_lower_back', 'elbows_flare_early', 'elbows_drop',
  'touch_point_inconsistent', 'shoulder_discomfort', 'mobility_restriction', 'grip_limiting', 'pause_much_harder',
  'hips_rise_first', 'insufficient_extension', 'front_rack_limited', 'elbow_lockout_incomplete', 'early_arm_pull',
  'bar_out_front', 'footwork_inconsistent', 'insufficient_bar_height', 'no_scoop', 'overhead_unstable', 'heels_rise',
  'no_shrug', 'wrist_pain', 'forward_lean', 'too_upright',
]);

/** What each interview question was about, for YOU evidence rows. */
export const QUESTION_TOPICS: Record<LiftFamily, Record<'q0' | 'q1' | 'q2', string>> = {
  press: { q0: 'where the bar slows', q1: 'what the bar does when it gets heavy', q2: 'paused reps' },
  deadlift: { q0: 'where the pull gets hard', q1: 'what breaks first', q2: 'where you feel it the next day' },
  squat: { q0: 'where the squat gets hard', q1: 'your position under load', q2: 'depth' },
  olympic: { q0: 'where the lift breaks down', q1: 'the pull', q2: 'the catch' },
};

/** §7 stand-in scorer — same shape as packages/diagnostic-core computeConfidence. */
export function computeConfidence(ratiosLogged: number, hasVideo: boolean, answersGiven: number): number {
  return Math.min(84, 46 + 12 * ratiosLogged + 11 * (hasVideo ? 1 : 0) + 3 * answersGiven);
}

export function gradeFor(ratiosLogged: number): 0 | 1 | 2 {
  return ratiosLogged >= 2 ? 2 : ratiosLogged === 1 ? 1 : 0;
}
