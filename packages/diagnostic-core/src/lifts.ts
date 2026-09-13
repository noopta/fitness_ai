import type { LiftId } from './types';

export interface LiftInfo {
  id: LiftId;
  name: string;
  /** Lower-case noun used mid-sentence: "Finish your bench diagnostic". */
  short: string;
}

/** Chip order in the `lift` stage — 9 lifts (§4). */
export const LIFTS: LiftInfo[] = [
  { id: 'flat_bench_press', name: 'Flat Bench Press', short: 'bench' },
  { id: 'incline_bench_press', name: 'Incline Bench Press', short: 'incline bench' },
  { id: 'deadlift', name: 'Deadlift', short: 'deadlift' },
  { id: 'barbell_back_squat', name: 'Back Squat', short: 'squat' },
  { id: 'barbell_front_squat', name: 'Front Squat', short: 'front squat' },
  { id: 'clean_and_jerk', name: 'Clean & Jerk', short: 'clean & jerk' },
  { id: 'snatch', name: 'Snatch', short: 'snatch' },
  { id: 'power_clean', name: 'Power Clean', short: 'power clean' },
  { id: 'hang_clean', name: 'Hang Clean', short: 'hang clean' },
];

export function isLiftId(value: unknown): value is LiftId {
  return typeof value === 'string' && LIFTS.some((l) => l.id === value);
}

export function liftInfo(id: string): LiftInfo {
  return (
    LIFTS.find((l) => l.id === id) ?? {
      id: id as LiftId,
      name: titleCase(id),
      short: titleCase(id).toLowerCase(),
    }
  );
}

/**
 * Accessory ladders, ordered by diagnostic value (§5).
 *
 * Flat Bench is the only ladder the design spec pins down. The other eight
 * are ranked from the engine's own configs (index-mapping weights first, then
 * the ratio rules) and are OPEN QUESTION (1) for the science team — change
 * the order here and both apps follow.
 */
export const ACCESSORY_LADDERS: Record<LiftId, string[]> = {
  flat_bench_press: ['close_grip_bench_press', 'paused_bench_press', 'overhead_press', 'tricep_pushdown'],
  incline_bench_press: ['close_grip_bench_press', 'overhead_press', 'flat_bench_press', 'barbell_row'],
  deadlift: ['romanian_deadlift', 'barbell_back_squat', 'rack_pull', 'barbell_row', 'deficit_deadlift'],
  barbell_back_squat: ['barbell_front_squat', 'romanian_deadlift', 'pause_squat', 'leg_press', 'hip_thrust'],
  barbell_front_squat: ['barbell_back_squat', 'leg_press', 'barbell_row', 'romanian_deadlift'],
  clean_and_jerk: ['power_clean', 'barbell_front_squat', 'push_press', 'deadlift'],
  snatch: ['overhead_squat', 'snatch_pull', 'barbell_back_squat', 'power_clean'],
  power_clean: ['barbell_front_squat', 'deadlift', 'hang_clean', 'push_press'],
  hang_clean: ['power_clean', 'barbell_front_squat', 'deadlift', 'push_press'],
};

const EXERCISE_NAMES: Record<string, string> = {
  close_grip_bench_press: 'Close Grip Bench Press',
  paused_bench_press: 'Paused Bench Press',
  overhead_press: 'Overhead Press',
  tricep_pushdown: 'Tricep Pushdown',
  flat_bench_press: 'Flat Bench Press',
  incline_bench_press: 'Incline Bench Press',
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
  return EXERCISE_NAMES[id] ?? liftInfo(id).name;
}

export function ladderFor(lift: LiftId): string[] {
  return ACCESSORY_LADDERS[lift] ?? [];
}

/**
 * Human names for each lift's movement phases (phase ids come from the
 * engine's liftConfigs). `label` heads a confident verdict ("Lockout
 * strength."); `short` fits the hedged one ("Probably lockout — untested.").
 */
const PHASES: Record<string, Record<string, { label: string; short: string }>> = {
  press: {
    bottom: { label: 'Off-chest strength', short: 'off the chest' },
    ascent: { label: 'Mid-range strength', short: 'mid-range' },
    lockout: { label: 'Lockout strength', short: 'lockout' },
  },
  deadlift: {
    initial_pull: { label: 'Floor strength', short: 'off the floor' },
    knee_level: { label: 'Mid-pull strength', short: 'at the knees' },
    lockout: { label: 'Lockout strength', short: 'lockout' },
  },
  squat: {
    bottom: { label: 'Strength out of the hole', short: 'out of the hole' },
    ascent: { label: 'Mid-range drive', short: 'mid-range' },
  },
  olympic: {
    first_pull: { label: 'First-pull position', short: 'first pull' },
    second_pull: { label: 'Second-pull power', short: 'second pull' },
    catch: { label: 'Catch position', short: 'the catch' },
    catch_clean: { label: 'Catch position', short: 'the catch' },
    jerk: { label: 'Jerk lockout', short: 'the jerk' },
    hang_position: { label: 'Hang position', short: 'the hang' },
    transition: { label: 'Turnover speed', short: 'the turnover' },
    overhead_squat: { label: 'Overhead stability', short: 'overhead' },
  },
};

export type LiftFamily = 'press' | 'deadlift' | 'squat' | 'olympic';

export function liftFamily(lift: string): LiftFamily {
  if (lift === 'flat_bench_press' || lift === 'incline_bench_press') return 'press';
  if (lift === 'deadlift') return 'deadlift';
  if (lift === 'barbell_back_squat' || lift === 'barbell_front_squat') return 'squat';
  return 'olympic';
}

export function phaseCopy(lift: string, phase: string): { label: string; short: string } | null {
  return PHASES[liftFamily(lift)]?.[phase] ?? null;
}

function titleCase(id: string): string {
  return id
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}
