// Exercise catalog for swaps (Oct 2026). Every exercise — lifts, cardio,
// mobility — is described by the same fields, so a swap can keep the job the
// exercise was doing instead of matching on its name:
//
//   pattern   the movement (squat, hinge, h_push, elbow_ext, run, mobility …)
//   m         muscle regions it trains, weights summing to 1
//   prof      where it's hardest: 0 shortened / 1 mid-range / 2 stretched
//   load      how heavy it can be loaded and progressed (1–5)
//   demand    systemic fatigue (1–5)        skill  technique needed (1–5)
//   joints    stress per joint (1–3; absent = negligible)
//   energy    what it trains: strength, hypertrophy, power, endurance,
//             aerobic, anaerobic, mobility
//   eq        equipment it needs; uni = one side at a time
//
// Hand-authored from standard exercise-science references (NSCA Essentials,
// the lengthened-partials / stretch-position hypertrophy literature for
// `prof`). Unknown exercises get the same fields from classify.ts, cached.

export type Modality = 'strength' | 'power' | 'cardio' | 'mobility';
export type Region =
  | 'quads' | 'glutes' | 'hamstrings' | 'adductors' | 'calves' | 'hip_flexors'
  | 'chest_upper' | 'chest_mid' | 'chest_lower'
  | 'delt_front' | 'delt_side' | 'delt_rear'
  | 'lats' | 'upper_back' | 'traps' | 'lower_back'
  | 'biceps' | 'brachialis' | 'forearms'
  | 'triceps_long' | 'triceps_lat'
  | 'abs' | 'obliques';
export type Joint = 'shoulder' | 'elbow' | 'wrist' | 'knee' | 'lower_back' | 'hip' | 'ankle' | 'neck';
export type Energy = 'strength' | 'hypertrophy' | 'power' | 'endurance' | 'aerobic' | 'anaerobic' | 'mobility';
export type Equipment =
  | 'barbell' | 'dumbbell' | 'cable' | 'machine' | 'smith' | 'bodyweight' | 'kettlebell' | 'band'
  | 'ez_bar' | 'trap_bar' | 'landmine' | 'cardio_machine' | 'none' | 'pool' | 'rope' | 'sled' | 'ball' | 'wall';
export type Pattern =
  | 'squat' | 'lunge' | 'hinge' | 'hip_ext' | 'hip_abd' | 'hip_add' | 'knee_flex' | 'knee_ext' | 'calf'
  | 'h_push' | 'v_push' | 'dip' | 'fly' | 'shoulder_abd' | 'shoulder_flex' | 'rear_delt'
  | 'h_pull' | 'v_pull' | 'shoulder_ext' | 'shrug' | 'elbow_flex' | 'elbow_ext'
  | 'core_flex' | 'anti_ext' | 'anti_rot' | 'rotation' | 'carry'
  | 'jump' | 'olympic' | 'throw' | 'sled'
  | 'run' | 'walk' | 'bike' | 'row_erg' | 'elliptical' | 'stair' | 'swim' | 'jump_rope' | 'climb'
  | 'mobility';

export interface ExerciseProfile {
  name: string;
  aka?: string[];
  mod: Modality;
  pattern: Pattern;
  m: Partial<Record<Region, number>>;
  prof: 0 | 1 | 2 | null;
  load: number;
  demand: number;
  skill: number;
  joints: Partial<Record<Joint, number>>;
  energy: Energy[];
  eq: Equipment;
  uni?: boolean;
}

const LIFT: Energy[] = ['strength', 'hypertrophy'];
const HYP: Energy[] = ['hypertrophy'];
const HYP_END: Energy[] = ['hypertrophy', 'endurance'];
const POWER: Energy[] = ['power', 'strength'];
const AER: Energy[] = ['aerobic'];
const AER_ANA: Energy[] = ['aerobic', 'anaerobic'];
const MOB: Energy[] = ['mobility'];

type Opts = Omit<ExerciseProfile, 'name' | 'mod' | 'pattern' | 'm'>;
const s = (name: string, pattern: Pattern, m: ExerciseProfile['m'], o: Opts): ExerciseProfile => ({ name, mod: 'strength', pattern, m, ...o });
const p = (name: string, pattern: Pattern, m: ExerciseProfile['m'], o: Opts): ExerciseProfile => ({ name, mod: 'power', pattern, m, ...o });
const c = (name: string, pattern: Pattern, m: ExerciseProfile['m'], o: Omit<Opts, 'prof' | 'load'> & { load?: number }): ExerciseProfile => ({ name, mod: 'cardio', pattern, m, prof: null, load: 1, ...o });
const mob = (name: string, m: ExerciseProfile['m'], o: Partial<Opts> = {}): ExerciseProfile => ({ name, mod: 'mobility', pattern: 'mobility', m, prof: null, load: 1, demand: 1, skill: 1, joints: {}, energy: MOB, eq: 'none', ...o });

export const CATALOG: ExerciseProfile[] = [
  // ── Squat ──────────────────────────────────────────────────────────────────
  s('Squat', 'squat', { quads: 0.5, glutes: 0.3, adductors: 0.15, lower_back: 0.05 }, { aka: ['back squat', 'barbell squat', 'high bar squat', 'low bar squat', 'barbell back squat'], prof: 2, load: 5, demand: 5, skill: 4, joints: { knee: 2, lower_back: 2, hip: 1 }, energy: LIFT, eq: 'barbell' }),
  s('Front Squat', 'squat', { quads: 0.6, glutes: 0.25, adductors: 0.1, upper_back: 0.05 }, { aka: ['barbell front squat'], prof: 2, load: 4, demand: 5, skill: 4, joints: { knee: 2, wrist: 1, lower_back: 1 }, energy: LIFT, eq: 'barbell' }),
  s('Safety Bar Squat', 'squat', { quads: 0.55, glutes: 0.3, adductors: 0.1, upper_back: 0.05 }, { aka: ['ssb squat', 'safety squat bar squat'], prof: 2, load: 5, demand: 5, skill: 3, joints: { knee: 2, lower_back: 2 }, energy: LIFT, eq: 'barbell' }),
  s('Box Squat', 'squat', { quads: 0.4, glutes: 0.35, hamstrings: 0.1, adductors: 0.15 }, { prof: 1, load: 5, demand: 4, skill: 3, joints: { knee: 1, lower_back: 2 }, energy: LIFT, eq: 'barbell' }),
  s('Hack Squat', 'squat', { quads: 0.7, glutes: 0.2, adductors: 0.1 }, { aka: ['machine hack squat'], prof: 2, load: 4, demand: 4, skill: 2, joints: { knee: 2 }, energy: LIFT, eq: 'machine' }),
  s('Leg Press', 'squat', { quads: 0.6, glutes: 0.3, adductors: 0.1 }, { aka: ['machine leg press', '45 degree leg press'], prof: 1, load: 5, demand: 3, skill: 1, joints: { knee: 2, lower_back: 1 }, energy: LIFT, eq: 'machine' }),
  s('Smith Machine Squat', 'squat', { quads: 0.6, glutes: 0.3, adductors: 0.1 }, { aka: ['smith squat'], prof: 2, load: 4, demand: 4, skill: 2, joints: { knee: 2, lower_back: 1 }, energy: LIFT, eq: 'smith' }),
  s('Belt Squat', 'squat', { quads: 0.6, glutes: 0.3, adductors: 0.1 }, { prof: 2, load: 4, demand: 4, skill: 2, joints: { knee: 2 }, energy: LIFT, eq: 'machine' }),
  s('Pendulum Squat', 'squat', { quads: 0.75, glutes: 0.2, adductors: 0.05 }, { prof: 2, load: 4, demand: 4, skill: 1, joints: { knee: 2 }, energy: LIFT, eq: 'machine' }),
  s('Goblet Squat', 'squat', { quads: 0.6, glutes: 0.25, adductors: 0.1, abs: 0.05 }, { aka: ['dumbbell goblet squat', 'kettlebell goblet squat'], prof: 2, load: 2, demand: 3, skill: 2, joints: { knee: 1 }, energy: HYP, eq: 'dumbbell' }),
  s('Air Squat', 'squat', { quads: 0.6, glutes: 0.3, adductors: 0.1 }, { aka: ['bodyweight squat'], prof: 2, load: 1, demand: 2, skill: 1, joints: { knee: 1 }, energy: HYP_END, eq: 'bodyweight' }),

  // ── Lunge / single leg ─────────────────────────────────────────────────────
  s('Bulgarian Split Squat', 'lunge', { quads: 0.5, glutes: 0.35, adductors: 0.15 }, { aka: ['rear foot elevated split squat', 'rfess', 'bss'], prof: 2, load: 3, demand: 4, skill: 3, joints: { knee: 2, hip: 1 }, energy: LIFT, eq: 'dumbbell', uni: true }),
  s('Split Squat', 'lunge', { quads: 0.55, glutes: 0.3, adductors: 0.15 }, { prof: 2, load: 3, demand: 3, skill: 2, joints: { knee: 2 }, energy: LIFT, eq: 'dumbbell', uni: true }),
  s('Lunge', 'lunge', { quads: 0.5, glutes: 0.35, adductors: 0.15 }, { aka: ['walking lunge', 'forward lunge', 'dumbbell lunge'], prof: 2, load: 3, demand: 4, skill: 2, joints: { knee: 2 }, energy: LIFT, eq: 'dumbbell', uni: true }),
  s('Reverse Lunge', 'lunge', { quads: 0.45, glutes: 0.4, adductors: 0.15 }, { prof: 2, load: 3, demand: 3, skill: 2, joints: { knee: 1 }, energy: LIFT, eq: 'dumbbell', uni: true }),
  s('Step Up', 'lunge', { quads: 0.5, glutes: 0.4, adductors: 0.1 }, { aka: ['box step up', 'dumbbell step up'], prof: 1, load: 2, demand: 3, skill: 2, joints: { knee: 1 }, energy: LIFT, eq: 'dumbbell', uni: true }),

  // ── Hinge ──────────────────────────────────────────────────────────────────
  s('Deadlift', 'hinge', { glutes: 0.3, hamstrings: 0.25, lower_back: 0.2, quads: 0.1, upper_back: 0.1, traps: 0.05 }, { aka: ['conventional deadlift', 'barbell deadlift'], prof: 1, load: 5, demand: 5, skill: 4, joints: { lower_back: 3, hip: 1 }, energy: ['strength'], eq: 'barbell' }),
  s('Sumo Deadlift', 'hinge', { glutes: 0.3, adductors: 0.2, quads: 0.15, hamstrings: 0.15, lower_back: 0.15, traps: 0.05 }, { prof: 1, load: 5, demand: 5, skill: 4, joints: { lower_back: 2, hip: 2 }, energy: ['strength'], eq: 'barbell' }),
  s('Trap Bar Deadlift', 'hinge', { glutes: 0.3, quads: 0.25, hamstrings: 0.15, lower_back: 0.15, traps: 0.15 }, { aka: ['hex bar deadlift'], prof: 1, load: 5, demand: 5, skill: 2, joints: { lower_back: 2, knee: 1 }, energy: ['strength'], eq: 'trap_bar' }),
  s('Romanian Deadlift', 'hinge', { hamstrings: 0.5, glutes: 0.35, lower_back: 0.15 }, { aka: ['rdl', 'barbell rdl', 'barbell romanian deadlift'], prof: 2, load: 4, demand: 4, skill: 3, joints: { lower_back: 2 }, energy: LIFT, eq: 'barbell' }),
  s('Dumbbell Romanian Deadlift', 'hinge', { hamstrings: 0.5, glutes: 0.35, lower_back: 0.15 }, { aka: ['dumbbell rdl', 'db rdl'], prof: 2, load: 3, demand: 3, skill: 2, joints: { lower_back: 1 }, energy: LIFT, eq: 'dumbbell' }),
  s('Single Leg Romanian Deadlift', 'hinge', { hamstrings: 0.45, glutes: 0.45, lower_back: 0.1 }, { aka: ['single leg rdl'], prof: 2, load: 2, demand: 3, skill: 4, joints: { lower_back: 1, ankle: 1 }, energy: HYP, eq: 'dumbbell', uni: true }),
  s('Stiff Leg Deadlift', 'hinge', { hamstrings: 0.55, glutes: 0.3, lower_back: 0.15 }, { aka: ['stiff legged deadlift', 'sldl'], prof: 2, load: 4, demand: 4, skill: 3, joints: { lower_back: 2 }, energy: LIFT, eq: 'barbell' }),
  s('Good Morning', 'hinge', { hamstrings: 0.45, glutes: 0.3, lower_back: 0.25 }, { prof: 2, load: 3, demand: 4, skill: 4, joints: { lower_back: 3 }, energy: LIFT, eq: 'barbell' }),
  s('Rack Pull', 'hinge', { glutes: 0.25, lower_back: 0.25, traps: 0.25, upper_back: 0.15, hamstrings: 0.1 }, { prof: 0, load: 5, demand: 4, skill: 2, joints: { lower_back: 2 }, energy: ['strength'], eq: 'barbell' }),
  s('Back Extension', 'hinge', { glutes: 0.35, hamstrings: 0.3, lower_back: 0.35 }, { aka: ['hyperextension', '45 degree back extension'], prof: 0, load: 2, demand: 2, skill: 1, joints: { lower_back: 1 }, energy: HYP, eq: 'bodyweight' }),
  s('Cable Pull Through', 'hinge', { glutes: 0.55, hamstrings: 0.35, lower_back: 0.1 }, { aka: ['pull through'], prof: 0, load: 2, demand: 2, skill: 1, joints: {}, energy: HYP, eq: 'cable' }),
  p('Kettlebell Swing', 'hinge', { glutes: 0.5, hamstrings: 0.35, lower_back: 0.1, abs: 0.05 }, { aka: ['kb swing', 'russian swing'], prof: 0, load: 2, demand: 3, skill: 3, joints: { lower_back: 1 }, energy: ['power', 'anaerobic'], eq: 'kettlebell' }),

  // ── Hip extension / abduction / adduction ──────────────────────────────────
  s('Hip Thrust', 'hip_ext', { glutes: 0.75, hamstrings: 0.15, quads: 0.1 }, { aka: ['barbell hip thrust'], prof: 0, load: 4, demand: 3, skill: 2, joints: { hip: 1 }, energy: LIFT, eq: 'barbell' }),
  s('Machine Hip Thrust', 'hip_ext', { glutes: 0.75, hamstrings: 0.15, quads: 0.1 }, { aka: ['glute drive'], prof: 0, load: 4, demand: 2, skill: 1, joints: {}, energy: LIFT, eq: 'machine' }),
  s('Glute Bridge', 'hip_ext', { glutes: 0.7, hamstrings: 0.2, quads: 0.1 }, { prof: 0, load: 2, demand: 2, skill: 1, joints: {}, energy: HYP, eq: 'bodyweight' }),
  s('Cable Glute Kickback', 'hip_ext', { glutes: 0.85, hamstrings: 0.15 }, { aka: ['glute kickback', 'cable kickback'], prof: 0, load: 1, demand: 1, skill: 1, joints: {}, energy: HYP, eq: 'cable', uni: true }),
  s('Reverse Hyper', 'hip_ext', { glutes: 0.45, hamstrings: 0.3, lower_back: 0.25 }, { prof: 0, load: 2, demand: 2, skill: 2, joints: {}, energy: HYP, eq: 'machine' }),
  s('Hip Abduction', 'hip_abd', { glutes: 1 }, { aka: ['hip abductor machine', 'abductor machine', 'seated hip abduction'], prof: 0, load: 2, demand: 1, skill: 1, joints: {}, energy: HYP, eq: 'machine' }),
  s('Hip Adduction', 'hip_add', { adductors: 1 }, { aka: ['hip adductor machine', 'adductor machine'], prof: 1, load: 2, demand: 1, skill: 1, joints: {}, energy: HYP, eq: 'machine' }),

  // ── Knee flexion / extension / calves ──────────────────────────────────────
  s('Leg Curl', 'knee_flex', { hamstrings: 1 }, { aka: ['lying leg curl', 'hamstring curl', 'prone leg curl'], prof: 1, load: 2, demand: 2, skill: 1, joints: { knee: 1 }, energy: HYP, eq: 'machine' }),
  s('Seated Leg Curl', 'knee_flex', { hamstrings: 1 }, { prof: 2, load: 2, demand: 2, skill: 1, joints: { knee: 1 }, energy: HYP, eq: 'machine' }),
  s('Nordic Curl', 'knee_flex', { hamstrings: 0.9, glutes: 0.1 }, { aka: ['nordic hamstring curl'], prof: 2, load: 3, demand: 3, skill: 3, joints: { knee: 2 }, energy: LIFT, eq: 'bodyweight' }),
  s('Glute Ham Raise', 'knee_flex', { hamstrings: 0.6, glutes: 0.3, lower_back: 0.1 }, { aka: ['ghr'], prof: 1, load: 3, demand: 3, skill: 3, joints: { knee: 1 }, energy: LIFT, eq: 'machine' }),
  s('Stability Ball Leg Curl', 'knee_flex', { hamstrings: 0.8, glutes: 0.2 }, { aka: ['swiss ball leg curl'], prof: 1, load: 1, demand: 2, skill: 2, joints: {}, energy: HYP, eq: 'ball' }),
  s('Leg Extension', 'knee_ext', { quads: 1 }, { aka: ['quad extension', 'machine leg extension'], prof: 0, load: 2, demand: 2, skill: 1, joints: { knee: 2 }, energy: HYP, eq: 'machine' }),
  s('Sissy Squat', 'knee_ext', { quads: 1 }, { prof: 2, load: 1, demand: 2, skill: 3, joints: { knee: 3 }, energy: HYP, eq: 'bodyweight' }),
  s('Reverse Nordic', 'knee_ext', { quads: 0.9, hip_flexors: 0.1 }, { prof: 2, load: 1, demand: 2, skill: 3, joints: { knee: 2 }, energy: HYP, eq: 'bodyweight' }),
  s('Calf Raise', 'calf', { calves: 1 }, { aka: ['standing calf raise', 'machine calf raise'], prof: 2, load: 3, demand: 1, skill: 1, joints: { ankle: 1 }, energy: HYP, eq: 'machine' }),
  s('Seated Calf Raise', 'calf', { calves: 1 }, { prof: 2, load: 3, demand: 1, skill: 1, joints: { ankle: 1 }, energy: HYP, eq: 'machine' }),
  s('Single Leg Calf Raise', 'calf', { calves: 1 }, { prof: 2, load: 1, demand: 1, skill: 1, joints: { ankle: 1 }, energy: HYP, eq: 'bodyweight', uni: true }),
  s('Leg Press Calf Raise', 'calf', { calves: 1 }, { aka: ['calf press'], prof: 2, load: 3, demand: 1, skill: 1, joints: { ankle: 1 }, energy: HYP, eq: 'machine' }),

  // ── Horizontal push / dips / flys ──────────────────────────────────────────
  s('Bench Press', 'h_push', { chest_mid: 0.45, chest_upper: 0.1, chest_lower: 0.1, delt_front: 0.15, triceps_lat: 0.1, triceps_long: 0.1 }, { aka: ['barbell bench press', 'flat bench press', 'flat bench', 'bench'], prof: 1, load: 5, demand: 4, skill: 3, joints: { shoulder: 2, elbow: 1, wrist: 1 }, energy: LIFT, eq: 'barbell' }),
  s('Incline Bench Press', 'h_push', { chest_upper: 0.45, chest_mid: 0.1, delt_front: 0.25, triceps_lat: 0.1, triceps_long: 0.1 }, { aka: ['incline barbell press', 'incline barbell bench press'], prof: 1, load: 4, demand: 4, skill: 3, joints: { shoulder: 2, elbow: 1 }, energy: LIFT, eq: 'barbell' }),
  s('Decline Bench Press', 'h_push', { chest_lower: 0.4, chest_mid: 0.3, delt_front: 0.05, triceps_lat: 0.15, triceps_long: 0.1 }, { prof: 1, load: 5, demand: 4, skill: 3, joints: { shoulder: 1, elbow: 1 }, energy: LIFT, eq: 'barbell' }),
  s('Dumbbell Bench Press', 'h_push', { chest_mid: 0.5, chest_upper: 0.1, chest_lower: 0.1, delt_front: 0.15, triceps_lat: 0.1, triceps_long: 0.05 }, { aka: ['db bench press', 'dumbbell press', 'flat dumbbell press'], prof: 2, load: 4, demand: 3, skill: 2, joints: { shoulder: 1 }, energy: LIFT, eq: 'dumbbell' }),
  s('Incline Dumbbell Press', 'h_push', { chest_upper: 0.5, chest_mid: 0.1, delt_front: 0.25, triceps_lat: 0.1, triceps_long: 0.05 }, { aka: ['incline db press', 'incline dumbbell bench press'], prof: 2, load: 3, demand: 3, skill: 2, joints: { shoulder: 1 }, energy: LIFT, eq: 'dumbbell' }),
  s('Machine Chest Press', 'h_push', { chest_mid: 0.55, chest_upper: 0.1, chest_lower: 0.1, delt_front: 0.1, triceps_lat: 0.1, triceps_long: 0.05 }, { aka: ['chest press', 'seated chest press', 'hammer strength chest press'], prof: 1, load: 4, demand: 2, skill: 1, joints: { shoulder: 1 }, energy: LIFT, eq: 'machine' }),
  s('Smith Machine Bench Press', 'h_push', { chest_mid: 0.45, chest_upper: 0.1, chest_lower: 0.1, delt_front: 0.15, triceps_lat: 0.1, triceps_long: 0.1 }, { aka: ['smith bench press'], prof: 1, load: 4, demand: 3, skill: 2, joints: { shoulder: 2, elbow: 1 }, energy: LIFT, eq: 'smith' }),
  s('Floor Press', 'h_push', { chest_mid: 0.35, chest_upper: 0.1, delt_front: 0.15, triceps_lat: 0.25, triceps_long: 0.15 }, { prof: 0, load: 4, demand: 3, skill: 2, joints: { shoulder: 1, elbow: 1 }, energy: LIFT, eq: 'barbell' }),
  s('Close Grip Bench Press', 'h_push', { triceps_lat: 0.3, triceps_long: 0.2, chest_mid: 0.3, delt_front: 0.15, chest_upper: 0.05 }, { aka: ['cgbp', 'close grip bench'], prof: 1, load: 4, demand: 4, skill: 3, joints: { elbow: 2, wrist: 2, shoulder: 1 }, energy: LIFT, eq: 'barbell' }),
  s('Push-Up', 'h_push', { chest_mid: 0.45, delt_front: 0.2, triceps_lat: 0.15, triceps_long: 0.1, abs: 0.1 }, { aka: ['pushup', 'press up'], prof: 2, load: 1, demand: 2, skill: 1, joints: { wrist: 1, shoulder: 1 }, energy: HYP_END, eq: 'bodyweight' }),
  s('Diamond Push-Up', 'h_push', { triceps_lat: 0.3, triceps_long: 0.15, chest_mid: 0.35, delt_front: 0.15, abs: 0.05 }, { aka: ['close grip push up', 'triangle push up'], prof: 2, load: 1, demand: 2, skill: 1, joints: { wrist: 2, elbow: 1 }, energy: HYP_END, eq: 'bodyweight' }),
  s('Dips', 'dip', { chest_lower: 0.45, triceps_lat: 0.2, triceps_long: 0.1, delt_front: 0.25 }, { aka: ['chest dip', 'parallel bar dip', 'weighted dip'], prof: 2, load: 3, demand: 3, skill: 2, joints: { shoulder: 3, elbow: 1 }, energy: LIFT, eq: 'bodyweight' }),
  s('Assisted Dip', 'dip', { chest_lower: 0.45, triceps_lat: 0.2, triceps_long: 0.1, delt_front: 0.25 }, { aka: ['machine dip', 'assisted dip machine'], prof: 2, load: 2, demand: 2, skill: 1, joints: { shoulder: 2, elbow: 1 }, energy: HYP, eq: 'machine' }),
  s('Bench Dip', 'dip', { triceps_lat: 0.45, triceps_long: 0.25, delt_front: 0.3 }, { prof: 2, load: 1, demand: 1, skill: 1, joints: { shoulder: 3 }, energy: HYP_END, eq: 'bodyweight' }),
  s('Cable Fly', 'fly', { chest_mid: 0.7, chest_upper: 0.1, chest_lower: 0.1, delt_front: 0.1 }, { aka: ['cable flye', 'cable crossover', 'standing cable fly'], prof: 1, load: 1, demand: 1, skill: 1, joints: { shoulder: 1 }, energy: HYP, eq: 'cable' }),
  s('Low to High Cable Fly', 'fly', { chest_upper: 0.7, chest_mid: 0.15, delt_front: 0.15 }, { aka: ['low cable fly', 'incline cable fly'], prof: 1, load: 1, demand: 1, skill: 1, joints: { shoulder: 1 }, energy: HYP, eq: 'cable' }),
  s('High to Low Cable Fly', 'fly', { chest_lower: 0.6, chest_mid: 0.35, delt_front: 0.05 }, { aka: ['high cable fly', 'decline cable fly'], prof: 1, load: 1, demand: 1, skill: 1, joints: { shoulder: 1 }, energy: HYP, eq: 'cable' }),
  s('Pec Deck', 'fly', { chest_mid: 0.8, chest_upper: 0.05, chest_lower: 0.05, delt_front: 0.1 }, { aka: ['pec fly machine', 'machine fly', 'machine chest fly'], prof: 0, load: 2, demand: 1, skill: 1, joints: { shoulder: 1 }, energy: HYP, eq: 'machine' }),
  s('Chest Fly', 'fly', { chest_mid: 0.7, chest_upper: 0.1, chest_lower: 0.1, delt_front: 0.1 }, { aka: ['dumbbell fly', 'db fly', 'dumbbell chest fly', 'flat dumbbell fly'], prof: 2, load: 1, demand: 1, skill: 2, joints: { shoulder: 2 }, energy: HYP, eq: 'dumbbell' }),

  // ── Vertical push / shoulders ──────────────────────────────────────────────
  s('Overhead Press', 'v_push', { delt_front: 0.5, delt_side: 0.15, triceps_lat: 0.1, triceps_long: 0.1, chest_upper: 0.1, abs: 0.05 }, { aka: ['ohp', 'military press', 'standing barbell press', 'barbell overhead press', 'standing overhead press', 'strict press'], prof: 1, load: 4, demand: 4, skill: 4, joints: { shoulder: 2, lower_back: 1 }, energy: LIFT, eq: 'barbell' }),
  s('Seated Overhead Press', 'v_push', { delt_front: 0.55, delt_side: 0.15, triceps_lat: 0.1, triceps_long: 0.1, chest_upper: 0.1 }, { aka: ['seated barbell press', 'seated military press'], prof: 1, load: 4, demand: 3, skill: 3, joints: { shoulder: 2 }, energy: LIFT, eq: 'barbell' }),
  s('Dumbbell Shoulder Press', 'v_push', { delt_front: 0.5, delt_side: 0.2, triceps_lat: 0.1, triceps_long: 0.1, chest_upper: 0.1 }, { aka: ['db shoulder press', 'seated dumbbell press', 'dumbbell overhead press', 'shoulder press'], prof: 2, load: 3, demand: 3, skill: 2, joints: { shoulder: 2 }, energy: LIFT, eq: 'dumbbell' }),
  s('Arnold Press', 'v_push', { delt_front: 0.5, delt_side: 0.25, triceps_lat: 0.1, triceps_long: 0.05, chest_upper: 0.1 }, { prof: 2, load: 2, demand: 3, skill: 3, joints: { shoulder: 2 }, energy: LIFT, eq: 'dumbbell' }),
  s('Machine Shoulder Press', 'v_push', { delt_front: 0.55, delt_side: 0.15, triceps_lat: 0.1, triceps_long: 0.1, chest_upper: 0.1 }, { aka: ['shoulder press machine'], prof: 1, load: 3, demand: 2, skill: 1, joints: { shoulder: 1 }, energy: LIFT, eq: 'machine' }),
  s('Landmine Press', 'v_push', { delt_front: 0.4, chest_upper: 0.3, triceps_lat: 0.1, triceps_long: 0.1, abs: 0.1 }, { aka: ['single arm landmine press'], prof: 1, load: 2, demand: 2, skill: 2, joints: { shoulder: 1 }, energy: LIFT, eq: 'landmine', uni: true }),
  s('Pike Push-Up', 'v_push', { delt_front: 0.55, triceps_lat: 0.15, triceps_long: 0.15, chest_upper: 0.15 }, { prof: 1, load: 1, demand: 2, skill: 2, joints: { shoulder: 2, wrist: 2 }, energy: HYP, eq: 'bodyweight' }),
  s('Handstand Push-Up', 'v_push', { delt_front: 0.55, triceps_lat: 0.15, triceps_long: 0.15, traps: 0.15 }, { aka: ['hspu'], prof: 1, load: 2, demand: 3, skill: 5, joints: { shoulder: 2, wrist: 2, neck: 1 }, energy: LIFT, eq: 'bodyweight' }),
  p('Push Press', 'v_push', { delt_front: 0.4, triceps_lat: 0.1, triceps_long: 0.1, quads: 0.2, delt_side: 0.1, glutes: 0.1 }, { prof: 1, load: 5, demand: 5, skill: 4, joints: { shoulder: 2 }, energy: POWER, eq: 'barbell' }),
  s('Lateral Raise', 'shoulder_abd', { delt_side: 0.85, traps: 0.1, delt_front: 0.05 }, { aka: ['dumbbell lateral raise', 'side raise', 'side lateral raise', 'lat raise'], prof: 0, load: 1, demand: 1, skill: 1, joints: { shoulder: 1 }, energy: HYP, eq: 'dumbbell' }),
  s('Cable Lateral Raise', 'shoulder_abd', { delt_side: 0.9, traps: 0.05, delt_front: 0.05 }, { aka: ['single arm cable lateral raise'], prof: 2, load: 1, demand: 1, skill: 1, joints: { shoulder: 1 }, energy: HYP, eq: 'cable', uni: true }),
  s('Machine Lateral Raise', 'shoulder_abd', { delt_side: 0.9, traps: 0.05, delt_front: 0.05 }, { aka: ['lateral raise machine'], prof: 1, load: 2, demand: 1, skill: 1, joints: { shoulder: 1 }, energy: HYP, eq: 'machine' }),
  s('Upright Row', 'shoulder_abd', { delt_side: 0.5, traps: 0.35, biceps: 0.15 }, { aka: ['barbell upright row', 'cable upright row'], prof: 0, load: 3, demand: 2, skill: 2, joints: { shoulder: 3, wrist: 1 }, energy: HYP, eq: 'barbell' }),
  s('Front Raise', 'shoulder_flex', { delt_front: 0.85, chest_upper: 0.1, delt_side: 0.05 }, { aka: ['dumbbell front raise', 'plate front raise'], prof: 0, load: 1, demand: 1, skill: 1, joints: { shoulder: 1 }, energy: HYP, eq: 'dumbbell' }),
  s('Cable Front Raise', 'shoulder_flex', { delt_front: 0.85, chest_upper: 0.1, delt_side: 0.05 }, { prof: 1, load: 1, demand: 1, skill: 1, joints: { shoulder: 1 }, energy: HYP, eq: 'cable' }),
  s('Face Pull', 'rear_delt', { delt_rear: 0.5, upper_back: 0.3, traps: 0.2 }, { aka: ['cable face pull', 'rope face pull'], prof: 0, load: 1, demand: 1, skill: 1, joints: {}, energy: HYP, eq: 'cable' }),
  s('Reverse Fly', 'rear_delt', { delt_rear: 0.65, upper_back: 0.3, traps: 0.05 }, { aka: ['rear delt fly', 'bent over reverse fly', 'dumbbell reverse fly', 'rear delt raise'], prof: 0, load: 1, demand: 1, skill: 2, joints: { lower_back: 1 }, energy: HYP, eq: 'dumbbell' }),
  s('Reverse Pec Deck', 'rear_delt', { delt_rear: 0.7, upper_back: 0.3 }, { aka: ['rear delt machine', 'machine reverse fly', 'reverse machine fly'], prof: 0, load: 2, demand: 1, skill: 1, joints: {}, energy: HYP, eq: 'machine' }),
  s('Cable Rear Delt Fly', 'rear_delt', { delt_rear: 0.7, upper_back: 0.3 }, { aka: ['cable reverse fly'], prof: 1, load: 1, demand: 1, skill: 1, joints: {}, energy: HYP, eq: 'cable' }),
  s('Band Pull Apart', 'rear_delt', { delt_rear: 0.5, upper_back: 0.4, traps: 0.1 }, { prof: 0, load: 1, demand: 1, skill: 1, joints: {}, energy: HYP_END, eq: 'band' }),

  // ── Horizontal pull ────────────────────────────────────────────────────────
  s('Barbell Row', 'h_pull', { upper_back: 0.3, lats: 0.3, delt_rear: 0.1, biceps: 0.1, traps: 0.1, lower_back: 0.1 }, { aka: ['bent over row', 'pendlay row', 'bent over barbell row'], prof: 0, load: 4, demand: 4, skill: 3, joints: { lower_back: 2, elbow: 1 }, energy: LIFT, eq: 'barbell' }),
  s('Dumbbell Row', 'h_pull', { lats: 0.45, upper_back: 0.3, delt_rear: 0.1, biceps: 0.15 }, { aka: ['one arm dumbbell row', 'single arm dumbbell row', 'db row', 'one arm row'], prof: 2, load: 3, demand: 3, skill: 2, joints: { lower_back: 1 }, energy: LIFT, eq: 'dumbbell', uni: true }),
  s('Cable Row', 'h_pull', { upper_back: 0.4, lats: 0.3, delt_rear: 0.1, biceps: 0.15, traps: 0.05 }, { aka: ['seated cable row', 'seated row', 'low row'], prof: 2, load: 3, demand: 2, skill: 1, joints: { lower_back: 1 }, energy: LIFT, eq: 'cable' }),
  s('Single Arm Cable Row', 'h_pull', { lats: 0.45, upper_back: 0.3, biceps: 0.15, delt_rear: 0.1 }, { prof: 2, load: 2, demand: 2, skill: 1, joints: {}, energy: HYP, eq: 'cable', uni: true }),
  s('Chest Supported Row', 'h_pull', { upper_back: 0.45, lats: 0.25, delt_rear: 0.15, biceps: 0.15 }, { aka: ['incline dumbbell row', 'chest supported dumbbell row', 'incline row'], prof: 1, load: 3, demand: 2, skill: 1, joints: {}, energy: LIFT, eq: 'dumbbell' }),
  s('Seal Row', 'h_pull', { upper_back: 0.45, lats: 0.3, delt_rear: 0.1, biceps: 0.15 }, { prof: 0, load: 4, demand: 2, skill: 2, joints: {}, energy: LIFT, eq: 'barbell' }),
  s('T-Bar Row', 'h_pull', { upper_back: 0.35, lats: 0.35, delt_rear: 0.1, biceps: 0.1, traps: 0.1 }, { aka: ['t bar row', 'landmine row'], prof: 1, load: 4, demand: 4, skill: 2, joints: { lower_back: 2 }, energy: LIFT, eq: 'landmine' }),
  s('Machine Row', 'h_pull', { upper_back: 0.4, lats: 0.35, delt_rear: 0.1, biceps: 0.15 }, { aka: ['seated machine row', 'hammer strength row', 'iso lateral row'], prof: 1, load: 3, demand: 2, skill: 1, joints: {}, energy: LIFT, eq: 'machine' }),
  s('Meadows Row', 'h_pull', { lats: 0.45, upper_back: 0.3, delt_rear: 0.1, biceps: 0.15 }, { prof: 2, load: 3, demand: 3, skill: 3, joints: { lower_back: 1 }, energy: LIFT, eq: 'landmine', uni: true }),
  s('Inverted Row', 'h_pull', { upper_back: 0.4, lats: 0.3, biceps: 0.15, delt_rear: 0.1, abs: 0.05 }, { aka: ['bodyweight row', 'australian pull up', 'ring row', 'trx row'], prof: 0, load: 1, demand: 2, skill: 1, joints: {}, energy: HYP_END, eq: 'bodyweight' }),

  // ── Vertical pull / lats ───────────────────────────────────────────────────
  s('Pull-Up', 'v_pull', { lats: 0.55, upper_back: 0.15, biceps: 0.2, brachialis: 0.05, abs: 0.05 }, { aka: ['pullup', 'wide grip pull up', 'weighted pull up'], prof: 2, load: 3, demand: 4, skill: 3, joints: { shoulder: 1, elbow: 1 }, energy: LIFT, eq: 'bodyweight' }),
  s('Chin-Up', 'v_pull', { lats: 0.45, biceps: 0.3, upper_back: 0.15, brachialis: 0.05, abs: 0.05 }, { aka: ['chinup', 'weighted chin up'], prof: 2, load: 3, demand: 4, skill: 3, joints: { elbow: 1 }, energy: LIFT, eq: 'bodyweight' }),
  s('Assisted Pull-Up', 'v_pull', { lats: 0.55, upper_back: 0.15, biceps: 0.25, abs: 0.05 }, { aka: ['assisted pull up machine', 'machine assisted pull up', 'band assisted pull up'], prof: 2, load: 2, demand: 2, skill: 1, joints: {}, energy: HYP, eq: 'machine' }),
  s('Lat Pulldown', 'v_pull', { lats: 0.6, upper_back: 0.15, biceps: 0.2, delt_rear: 0.05 }, { aka: ['wide grip lat pulldown', 'pulldown', 'cable pulldown'], prof: 2, load: 3, demand: 2, skill: 1, joints: { shoulder: 1 }, energy: LIFT, eq: 'cable' }),
  s('Close Grip Pulldown', 'v_pull', { lats: 0.6, upper_back: 0.1, biceps: 0.25, brachialis: 0.05 }, { aka: ['neutral grip pulldown', 'v bar pulldown', 'close grip lat pulldown'], prof: 2, load: 3, demand: 2, skill: 1, joints: {}, energy: LIFT, eq: 'cable' }),
  s('Single Arm Lat Pulldown', 'v_pull', { lats: 0.7, biceps: 0.2, upper_back: 0.1 }, { aka: ['single arm pulldown'], prof: 2, load: 2, demand: 2, skill: 1, joints: {}, energy: HYP, eq: 'cable', uni: true }),
  s('Straight Arm Pulldown', 'shoulder_ext', { lats: 0.8, triceps_long: 0.1, delt_rear: 0.1 }, { aka: ['straight arm cable pulldown', 'lat prayer', 'cable pullover'], prof: 2, load: 1, demand: 1, skill: 1, joints: {}, energy: HYP, eq: 'cable' }),
  s('Dumbbell Pullover', 'shoulder_ext', { lats: 0.5, chest_mid: 0.3, triceps_long: 0.2 }, { aka: ['pullover'], prof: 2, load: 2, demand: 2, skill: 2, joints: { shoulder: 2 }, energy: HYP, eq: 'dumbbell' }),
  s('Shrug', 'shrug', { traps: 1 }, { aka: ['barbell shrug'], prof: 0, load: 4, demand: 2, skill: 1, joints: { neck: 1 }, energy: HYP, eq: 'barbell' }),
  s('Dumbbell Shrug', 'shrug', { traps: 1 }, { aka: ['db shrug'], prof: 0, load: 3, demand: 1, skill: 1, joints: { neck: 1 }, energy: HYP, eq: 'dumbbell' }),

  // ── Arms: elbow flexion ────────────────────────────────────────────────────
  s('Barbell Curl', 'elbow_flex', { biceps: 0.8, brachialis: 0.1, forearms: 0.1 }, { aka: ['standing barbell curl', 'bicep curl barbell'], prof: 1, load: 2, demand: 1, skill: 1, joints: { elbow: 1, wrist: 1 }, energy: HYP, eq: 'barbell' }),
  s('EZ Bar Curl', 'elbow_flex', { biceps: 0.75, brachialis: 0.15, forearms: 0.1 }, { aka: ['ez curl', 'ez-bar curl'], prof: 1, load: 2, demand: 1, skill: 1, joints: { elbow: 1 }, energy: HYP, eq: 'ez_bar' }),
  s('Dumbbell Curl', 'elbow_flex', { biceps: 0.8, brachialis: 0.1, forearms: 0.1 }, { aka: ['bicep curl', 'biceps curl', 'db curl', 'alternating dumbbell curl', 'standing dumbbell curl'], prof: 1, load: 1, demand: 1, skill: 1, joints: { elbow: 1 }, energy: HYP, eq: 'dumbbell' }),
  s('Hammer Curl', 'elbow_flex', { brachialis: 0.45, forearms: 0.3, biceps: 0.25 }, { aka: ['dumbbell hammer curl', 'rope hammer curl'], prof: 1, load: 2, demand: 1, skill: 1, joints: {}, energy: HYP, eq: 'dumbbell' }),
  s('Incline Dumbbell Curl', 'elbow_flex', { biceps: 0.9, brachialis: 0.05, forearms: 0.05 }, { aka: ['incline curl'], prof: 2, load: 1, demand: 1, skill: 1, joints: { elbow: 1, shoulder: 1 }, energy: HYP, eq: 'dumbbell' }),
  s('Preacher Curl', 'elbow_flex', { biceps: 0.75, brachialis: 0.2, forearms: 0.05 }, { aka: ['ez bar preacher curl', 'dumbbell preacher curl', 'machine preacher curl'], prof: 2, load: 2, demand: 1, skill: 1, joints: { elbow: 2 }, energy: HYP, eq: 'ez_bar' }),
  s('Cable Curl', 'elbow_flex', { biceps: 0.8, brachialis: 0.1, forearms: 0.1 }, { aka: ['cable bicep curl', 'straight bar cable curl'], prof: 1, load: 2, demand: 1, skill: 1, joints: {}, energy: HYP, eq: 'cable' }),
  s('Bayesian Curl', 'elbow_flex', { biceps: 0.9, brachialis: 0.05, forearms: 0.05 }, { aka: ['behind the body cable curl', 'bayesian cable curl'], prof: 2, load: 1, demand: 1, skill: 1, joints: { shoulder: 1 }, energy: HYP, eq: 'cable', uni: true }),
  s('Concentration Curl', 'elbow_flex', { biceps: 0.85, brachialis: 0.1, forearms: 0.05 }, { prof: 0, load: 1, demand: 1, skill: 1, joints: {}, energy: HYP, eq: 'dumbbell', uni: true }),
  s('Spider Curl', 'elbow_flex', { biceps: 0.85, brachialis: 0.1, forearms: 0.05 }, { prof: 0, load: 1, demand: 1, skill: 1, joints: {}, energy: HYP, eq: 'dumbbell' }),
  s('Machine Curl', 'elbow_flex', { biceps: 0.8, brachialis: 0.15, forearms: 0.05 }, { aka: ['bicep curl machine'], prof: 1, load: 2, demand: 1, skill: 1, joints: {}, energy: HYP, eq: 'machine' }),
  s('Reverse Curl', 'elbow_flex', { forearms: 0.45, brachialis: 0.4, biceps: 0.15 }, { aka: ['reverse grip curl', 'ez bar reverse curl'], prof: 1, load: 1, demand: 1, skill: 1, joints: { wrist: 1 }, energy: HYP, eq: 'ez_bar' }),

  // ── Arms: elbow extension ──────────────────────────────────────────────────
  s('Triceps Pressdown', 'elbow_ext', { triceps_lat: 0.65, triceps_long: 0.35 }, { aka: ['tricep pushdown', 'triceps pushdown', 'cable pushdown', 'straight bar pushdown', 'tricep pressdown', 'cable tricep pushdown', 'v bar pushdown'], prof: 0, load: 2, demand: 1, skill: 1, joints: { elbow: 1 }, energy: HYP, eq: 'cable' }),
  s('Rope Tricep Pushdown', 'elbow_ext', { triceps_lat: 0.65, triceps_long: 0.35 }, { aka: ['rope pushdown', 'rope pressdown', 'tricep rope pushdown'], prof: 0, load: 2, demand: 1, skill: 1, joints: { elbow: 1 }, energy: HYP, eq: 'cable' }),
  s('Single Arm Tricep Pushdown', 'elbow_ext', { triceps_lat: 0.7, triceps_long: 0.3 }, { aka: ['single arm cable pushdown', 'one arm tricep pushdown', 'single arm pressdown'], prof: 0, load: 1, demand: 1, skill: 1, joints: { elbow: 1 }, energy: HYP, eq: 'cable', uni: true }),
  s('Reverse Grip Pushdown', 'elbow_ext', { triceps_lat: 0.7, triceps_long: 0.3 }, { aka: ['underhand pushdown', 'reverse grip tricep pushdown'], prof: 0, load: 1, demand: 1, skill: 1, joints: { elbow: 1, wrist: 1 }, energy: HYP, eq: 'cable' }),
  s('Overhead Triceps Extension', 'elbow_ext', { triceps_long: 0.75, triceps_lat: 0.25 }, { aka: ['overhead tricep extension', 'dumbbell overhead extension', 'seated overhead extension', 'french press'], prof: 2, load: 2, demand: 1, skill: 1, joints: { elbow: 2, shoulder: 1 }, energy: HYP, eq: 'dumbbell' }),
  s('Cable Overhead Triceps Extension', 'elbow_ext', { triceps_long: 0.75, triceps_lat: 0.25 }, { aka: ['overhead cable extension', 'rope overhead extension', 'cable overhead tricep extension', 'overhead rope extension'], prof: 2, load: 2, demand: 1, skill: 1, joints: { elbow: 2, shoulder: 1 }, energy: HYP, eq: 'cable' }),
  s('Skullcrusher', 'elbow_ext', { triceps_long: 0.55, triceps_lat: 0.45 }, { aka: ['skull crusher', 'lying triceps extension', 'ez bar skullcrusher', 'lying tricep extension'], prof: 2, load: 2, demand: 1, skill: 2, joints: { elbow: 3 }, energy: HYP, eq: 'ez_bar' }),
  s('Dumbbell Skullcrusher', 'elbow_ext', { triceps_long: 0.55, triceps_lat: 0.45 }, { aka: ['dumbbell lying triceps extension'], prof: 2, load: 1, demand: 1, skill: 1, joints: { elbow: 2 }, energy: HYP, eq: 'dumbbell' }),
  s('JM Press', 'elbow_ext', { triceps_lat: 0.5, triceps_long: 0.3, chest_mid: 0.2 }, { prof: 2, load: 3, demand: 2, skill: 4, joints: { elbow: 3 }, energy: LIFT, eq: 'barbell' }),
  s('Tricep Kickback', 'elbow_ext', { triceps_lat: 0.6, triceps_long: 0.4 }, { aka: ['dumbbell kickback', 'triceps kickback'], prof: 0, load: 1, demand: 1, skill: 1, joints: {}, energy: HYP, eq: 'dumbbell', uni: true }),
  s('Cable Tricep Kickback', 'elbow_ext', { triceps_lat: 0.6, triceps_long: 0.4 }, { aka: ['cable triceps kickback'], prof: 1, load: 1, demand: 1, skill: 1, joints: {}, energy: HYP, eq: 'cable', uni: true }),
  s('Machine Triceps Extension', 'elbow_ext', { triceps_lat: 0.6, triceps_long: 0.4 }, { aka: ['tricep extension machine', 'machine tricep extension', 'machine dip press'], prof: 1, load: 2, demand: 1, skill: 1, joints: { elbow: 1 }, energy: HYP, eq: 'machine' }),

  // ── Core / carries ─────────────────────────────────────────────────────────
  s('Plank', 'anti_ext', { abs: 0.7, obliques: 0.2, delt_front: 0.1 }, { aka: ['front plank', 'forearm plank'], prof: 1, load: 1, demand: 1, skill: 1, joints: {}, energy: ['endurance'], eq: 'bodyweight' }),
  s('Ab Wheel Rollout', 'anti_ext', { abs: 0.75, obliques: 0.1, lats: 0.15 }, { aka: ['ab wheel', 'ab rollout', 'barbell rollout'], prof: 2, load: 2, demand: 2, skill: 3, joints: { lower_back: 2, shoulder: 1 }, energy: HYP, eq: 'bodyweight' }),
  s('Dead Bug', 'anti_ext', { abs: 0.8, obliques: 0.1, hip_flexors: 0.1 }, { prof: 1, load: 1, demand: 1, skill: 1, joints: {}, energy: ['endurance'], eq: 'bodyweight' }),
  s('Hollow Hold', 'anti_ext', { abs: 0.8, hip_flexors: 0.2 }, { aka: ['hollow body hold'], prof: 1, load: 1, demand: 1, skill: 2, joints: {}, energy: ['endurance'], eq: 'bodyweight' }),
  s('Crunch', 'core_flex', { abs: 0.9, obliques: 0.1 }, { prof: 0, load: 1, demand: 1, skill: 1, joints: { neck: 1 }, energy: HYP_END, eq: 'bodyweight' }),
  s('Cable Crunch', 'core_flex', { abs: 0.9, obliques: 0.1 }, { aka: ['kneeling cable crunch', 'rope crunch'], prof: 1, load: 2, demand: 1, skill: 1, joints: {}, energy: HYP, eq: 'cable' }),
  s('Sit-Up', 'core_flex', { abs: 0.6, hip_flexors: 0.3, obliques: 0.1 }, { aka: ['situp', 'decline sit up'], prof: 1, load: 1, demand: 1, skill: 1, joints: { lower_back: 1 }, energy: HYP_END, eq: 'bodyweight' }),
  s('Hanging Leg Raise', 'core_flex', { abs: 0.55, hip_flexors: 0.35, obliques: 0.1 }, { aka: ['toes to bar'], prof: 1, load: 2, demand: 2, skill: 3, joints: { shoulder: 1 }, energy: HYP, eq: 'bodyweight' }),
  s('Hanging Knee Raise', 'core_flex', { abs: 0.55, hip_flexors: 0.35, obliques: 0.1 }, { aka: ['captain chair knee raise', 'captains chair leg raise'], prof: 1, load: 1, demand: 1, skill: 2, joints: {}, energy: HYP, eq: 'bodyweight' }),
  s('Leg Raise', 'core_flex', { abs: 0.55, hip_flexors: 0.4, obliques: 0.05 }, { aka: ['lying leg raise'], prof: 1, load: 1, demand: 1, skill: 1, joints: { lower_back: 1 }, energy: HYP_END, eq: 'bodyweight' }),
  s('Pallof Press', 'anti_rot', { obliques: 0.6, abs: 0.4 }, { prof: 1, load: 1, demand: 1, skill: 1, joints: {}, energy: ['endurance', 'strength'], eq: 'cable' }),
  s('Side Plank', 'anti_rot', { obliques: 0.8, abs: 0.2 }, { prof: 1, load: 1, demand: 1, skill: 1, joints: { shoulder: 1 }, energy: ['endurance'], eq: 'bodyweight' }),
  s('Russian Twist', 'rotation', { obliques: 0.7, abs: 0.3 }, { prof: 1, load: 1, demand: 1, skill: 1, joints: { lower_back: 1 }, energy: HYP_END, eq: 'bodyweight' }),
  s('Landmine Twist', 'rotation', { obliques: 0.6, abs: 0.3, delt_front: 0.1 }, { aka: ['landmine rotation'], prof: 1, load: 2, demand: 2, skill: 2, joints: { lower_back: 1 }, energy: HYP, eq: 'landmine' }),
  s('Cable Woodchop', 'rotation', { obliques: 0.7, abs: 0.3 }, { aka: ['woodchop', 'wood chop'], prof: 1, load: 1, demand: 1, skill: 1, joints: {}, energy: HYP, eq: 'cable' }),
  s("Farmer's Carry", 'carry', { forearms: 0.35, traps: 0.3, obliques: 0.15, abs: 0.1, glutes: 0.1 }, { aka: ['farmers walk', 'farmer walk', 'farmers carry'], prof: 1, load: 4, demand: 3, skill: 1, joints: { lower_back: 1 }, energy: ['strength', 'endurance'], eq: 'dumbbell' }),
  s('Suitcase Carry', 'carry', { obliques: 0.4, forearms: 0.3, traps: 0.2, abs: 0.1 }, { prof: 1, load: 3, demand: 2, skill: 1, joints: {}, energy: ['strength', 'endurance'], eq: 'dumbbell', uni: true }),

  // ── Power ──────────────────────────────────────────────────────────────────
  p('Power Clean', 'olympic', { glutes: 0.25, hamstrings: 0.2, quads: 0.2, traps: 0.2, upper_back: 0.1, calves: 0.05 }, { aka: ['hang clean', 'clean', 'hang power clean'], prof: 1, load: 4, demand: 5, skill: 5, joints: { wrist: 2, lower_back: 2 }, energy: ['power'], eq: 'barbell' }),
  p('Box Jump', 'jump', { quads: 0.45, glutes: 0.35, calves: 0.2 }, { prof: 1, load: 1, demand: 3, skill: 2, joints: { knee: 2, ankle: 1 }, energy: ['power'], eq: 'bodyweight' }),
  p('Broad Jump', 'jump', { glutes: 0.4, quads: 0.35, hamstrings: 0.1, calves: 0.15 }, { prof: 1, load: 1, demand: 3, skill: 2, joints: { knee: 2, ankle: 1 }, energy: ['power'], eq: 'bodyweight' }),
  p('Medicine Ball Slam', 'throw', { lats: 0.35, abs: 0.35, delt_front: 0.15, triceps_long: 0.15 }, { aka: ['ball slam', 'slam ball'], prof: 1, load: 1, demand: 3, skill: 1, joints: {}, energy: ['power', 'anaerobic'], eq: 'ball' }),
  p('Sled Push', 'sled', { quads: 0.5, glutes: 0.3, calves: 0.2 }, { aka: ['prowler push', 'sled drag'], prof: 1, load: 4, demand: 4, skill: 1, joints: { knee: 1 }, energy: ['anaerobic', 'power'], eq: 'sled' }),

  // ── Cardio ─────────────────────────────────────────────────────────────────
  c('Running', 'run', { quads: 0.3, hamstrings: 0.2, glutes: 0.2, calves: 0.3 }, { aka: ['run', 'jog', 'jogging', 'treadmill run', 'outdoor run', 'treadmill'], demand: 3, skill: 1, joints: { knee: 2, ankle: 2, hip: 1 }, energy: AER_ANA, eq: 'none' }),
  c('Sprints', 'run', { hamstrings: 0.3, glutes: 0.3, quads: 0.2, calves: 0.2 }, { aka: ['sprint', 'sprint intervals', 'hill sprints'], demand: 5, skill: 2, joints: { knee: 2, ankle: 2, hip: 1 }, energy: ['anaerobic', 'power'], eq: 'none' }),
  c('Walking', 'walk', { glutes: 0.3, calves: 0.3, hamstrings: 0.2, quads: 0.2 }, { aka: ['walk', 'brisk walk', 'hiking', 'hike'], demand: 1, skill: 1, joints: {}, energy: AER, eq: 'none' }),
  c('Incline Treadmill Walk', 'walk', { glutes: 0.35, calves: 0.3, hamstrings: 0.2, quads: 0.15 }, { aka: ['incline walk', '12 3 30', 'treadmill incline walk'], demand: 2, skill: 1, joints: { ankle: 1 }, energy: AER, eq: 'cardio_machine' }),
  c('Cycling', 'bike', { quads: 0.55, glutes: 0.25, hamstrings: 0.1, calves: 0.1 }, { aka: ['bike', 'stationary bike', 'spin', 'spin class', 'outdoor cycling', 'cycle', 'peloton'], demand: 2, skill: 1, joints: { knee: 1 }, energy: AER_ANA, eq: 'cardio_machine' }),
  c('Assault Bike', 'bike', { quads: 0.35, glutes: 0.15, hamstrings: 0.1, delt_front: 0.15, lats: 0.15, triceps_lat: 0.1 }, { aka: ['air bike', 'echo bike', 'fan bike'], demand: 4, skill: 1, joints: {}, energy: ['anaerobic', 'aerobic'], eq: 'cardio_machine' }),
  c('Rowing Machine', 'row_erg', { lats: 0.25, upper_back: 0.15, quads: 0.25, glutes: 0.15, hamstrings: 0.1, biceps: 0.1 }, { aka: ['rower', 'erg', 'concept2', 'rowing', 'row erg'], demand: 3, skill: 2, joints: { lower_back: 1 }, energy: AER_ANA, eq: 'cardio_machine' }),
  c('Elliptical', 'elliptical', { quads: 0.35, glutes: 0.3, hamstrings: 0.15, calves: 0.1, delt_front: 0.1 }, { aka: ['cross trainer', 'elliptical trainer'], demand: 2, skill: 1, joints: {}, energy: AER, eq: 'cardio_machine' }),
  c('Stair Climber', 'stair', { glutes: 0.4, quads: 0.35, calves: 0.25 }, { aka: ['stairmaster', 'stair stepper', 'stairs', 'stair climb'], demand: 3, skill: 1, joints: { knee: 1 }, energy: AER_ANA, eq: 'cardio_machine' }),
  c('Swimming', 'swim', { lats: 0.3, delt_front: 0.2, upper_back: 0.15, triceps_lat: 0.1, quads: 0.1, abs: 0.15 }, { aka: ['swim', 'laps', 'lap swimming'], demand: 3, skill: 3, joints: { shoulder: 1 }, energy: AER_ANA, eq: 'pool' }),
  c('Jump Rope', 'jump_rope', { calves: 0.6, quads: 0.2, delt_side: 0.2 }, { aka: ['skipping', 'skipping rope', 'double unders'], demand: 3, skill: 2, joints: { ankle: 2, knee: 1 }, energy: ['anaerobic', 'aerobic'], eq: 'rope' }),
  c('Rock Climbing', 'climb', { lats: 0.3, forearms: 0.3, biceps: 0.15, upper_back: 0.15, abs: 0.1 }, { aka: ['climbing', 'bouldering', 'climb', 'indoor climbing'], demand: 4, skill: 4, joints: { shoulder: 2, elbow: 2, wrist: 1 }, energy: ['anaerobic', 'strength'], eq: 'wall' }),

  // ── Mobility ───────────────────────────────────────────────────────────────
  mob('Hip Flexor Stretch', { hip_flexors: 0.8, quads: 0.2 }, { aka: ['couch stretch', 'kneeling hip flexor stretch'] }),
  mob('Pigeon Stretch', { glutes: 0.7, hip_flexors: 0.15, adductors: 0.15 }, { aka: ['pigeon pose'] }),
  mob('90/90 Hip Switch', { glutes: 0.5, adductors: 0.3, hip_flexors: 0.2 }, { aka: ['90 90 stretch', '90/90'] }),
  mob("World's Greatest Stretch", { hip_flexors: 0.3, hamstrings: 0.25, upper_back: 0.25, glutes: 0.2 }, { aka: ['worlds greatest stretch'] }),
  mob('Cat Cow', { lower_back: 0.5, upper_back: 0.5 }, { aka: ['cat camel'] }),
  mob('Thoracic Rotation', { upper_back: 0.7, obliques: 0.3 }, { aka: ['open book', 't spine rotation', 'thoracic spine rotation'] }),
  mob('Hamstring Stretch', { hamstrings: 1 }, { aka: ['standing hamstring stretch'] }),
  mob('Doorway Pec Stretch', { chest_mid: 0.7, delt_front: 0.3 }, { aka: ['chest stretch', 'pec stretch'] }),
  mob('Band Shoulder Dislocate', { delt_front: 0.3, delt_rear: 0.3, chest_mid: 0.2, upper_back: 0.2 }, { aka: ['shoulder pass through', 'shoulder dislocates'], eq: 'band' }),
  mob('Knee to Wall Ankle Stretch', { calves: 1 }, { aka: ['ankle mobility', 'knee to wall'] }),
  mob("Child's Pose", { lats: 0.5, lower_back: 0.5 }, { aka: ['childs pose'] }),
  mob('Deep Squat Hold', { adductors: 0.4, glutes: 0.3, calves: 0.3 }, { aka: ['squat hold', 'deep squat'] }),
  mob('Yoga', { hamstrings: 0.2, hip_flexors: 0.2, upper_back: 0.2, glutes: 0.2, chest_mid: 0.2 }, { aka: ['yoga flow', 'vinyasa'], demand: 2 }),
];

// ─── Groups (the "primary target" a swap must keep) ──────────────────────────

export type Group = 'chest' | 'front_delts' | 'side_delts' | 'rear_delts' | 'back' | 'traps' | 'lower_back' | 'biceps' | 'forearms' | 'triceps' | 'quads' | 'glutes' | 'hamstrings' | 'adductors' | 'calves' | 'core';
export const GROUP: Record<Region, Group> = {
  quads: 'quads', glutes: 'glutes', hamstrings: 'hamstrings', adductors: 'adductors', calves: 'calves', hip_flexors: 'core',
  chest_upper: 'chest', chest_mid: 'chest', chest_lower: 'chest',
  delt_front: 'front_delts', delt_side: 'side_delts', delt_rear: 'rear_delts',
  lats: 'back', upper_back: 'back', traps: 'traps', lower_back: 'lower_back',
  biceps: 'biceps', brachialis: 'biceps', forearms: 'forearms',
  triceps_long: 'triceps', triceps_lat: 'triceps',
  abs: 'core', obliques: 'core',
};

export const REGION_LABEL: Record<Region, string> = {
  quads: 'quads', glutes: 'glutes', hamstrings: 'hamstrings', adductors: 'adductors', calves: 'calves', hip_flexors: 'hip flexors',
  chest_upper: 'upper chest', chest_mid: 'chest', chest_lower: 'lower chest',
  delt_front: 'front delts', delt_side: 'side delts', delt_rear: 'rear delts',
  lats: 'lats', upper_back: 'upper back', traps: 'traps', lower_back: 'lower back',
  biceps: 'biceps', brachialis: 'brachialis', forearms: 'forearms',
  triceps_long: 'triceps long head', triceps_lat: 'triceps lateral head',
  abs: 'abs', obliques: 'obliques',
};

export const PATTERN_LABEL: Partial<Record<Pattern, string>> = {
  squat: 'squat pattern', lunge: 'single-leg pattern', hinge: 'hip hinge', hip_ext: 'hip extension', knee_flex: 'leg curl pattern', knee_ext: 'knee extension',
  h_push: 'horizontal press', v_push: 'overhead press', dip: 'dip pattern', fly: 'fly pattern', shoulder_abd: 'raise', rear_delt: 'rear-delt pull',
  h_pull: 'row pattern', v_pull: 'vertical pull', shoulder_ext: 'lat isolation', elbow_flex: 'curl', elbow_ext: 'triceps extension',
  core_flex: 'trunk flexion', anti_ext: 'anti-extension core', anti_rot: 'anti-rotation core', carry: 'loaded carry',
};

export const ALL_REGIONS = Object.keys(GROUP) as Region[];
export const ALL_PATTERNS: Pattern[] = ['squat', 'lunge', 'hinge', 'hip_ext', 'hip_abd', 'hip_add', 'knee_flex', 'knee_ext', 'calf', 'h_push', 'v_push', 'dip', 'fly', 'shoulder_abd', 'shoulder_flex', 'rear_delt', 'h_pull', 'v_pull', 'shoulder_ext', 'shrug', 'elbow_flex', 'elbow_ext', 'core_flex', 'anti_ext', 'anti_rot', 'rotation', 'carry', 'jump', 'olympic', 'throw', 'sled', 'run', 'walk', 'bike', 'row_erg', 'elliptical', 'stair', 'swim', 'jump_rope', 'climb', 'mobility'];
export const ALL_JOINTS: Joint[] = ['shoulder', 'elbow', 'wrist', 'knee', 'lower_back', 'hip', 'ankle', 'neck'];
export const ALL_ENERGY: Energy[] = ['strength', 'hypertrophy', 'power', 'endurance', 'aerobic', 'anaerobic', 'mobility'];
export const ALL_EQUIPMENT: Equipment[] = ['barbell', 'dumbbell', 'cable', 'machine', 'smith', 'bodyweight', 'kettlebell', 'band', 'ez_bar', 'trap_bar', 'landmine', 'cardio_machine', 'none', 'pool', 'rope', 'sled', 'ball', 'wall'];
