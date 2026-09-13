import type { LiftId } from './types';

export interface LiftInfo {
  id: LiftId;
  name: string;
  /** Lower-case noun used mid-sentence: "Finish your bench diagnostic". */
  short: string;
}

/**
 * Chip order in the `lift` stage. The prototype showed 9 lifts; the Olympic
 * lifts are left out here (product decision 2026-09-13) — these five are the
 * lifts the engine's configs cover with accessory ratios.
 */
export const LIFTS: LiftInfo[] = [
  { id: 'flat_bench_press', name: 'Flat Bench Press', short: 'bench' },
  { id: 'incline_bench_press', name: 'Incline Bench Press', short: 'incline bench' },
  { id: 'deadlift', name: 'Deadlift', short: 'deadlift' },
  { id: 'barbell_back_squat', name: 'Back Squat', short: 'squat' },
  { id: 'barbell_front_squat', name: 'Front Squat', short: 'front squat' },
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
 * Flat Bench is the only ladder the design spec pins down. The other four
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
  deadlift: 'Deadlift',
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
};

export type LiftFamily = 'press' | 'deadlift' | 'squat';

export function liftFamily(lift: string): LiftFamily {
  if (lift === 'flat_bench_press' || lift === 'incline_bench_press') return 'press';
  if (lift === 'deadlift') return 'deadlift';
  return 'squat';
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
