// Shared types for the adaptive-progression engine.
//
// The engine is deterministic and pure: it reads logged sets + the saved
// program and emits ProposalDrafts. Nothing here mutates a program — that only
// happens in proposalService when a user explicitly applies a proposal.

import type { UnitPreference } from '../services/weightUnits.js';

/** Which planned program day a workout log fulfilled. Stored as JSON on
 *  WorkoutLog.programDayRef. */
export interface ProgramDayRef {
  phaseIndex: number;
  dayIndex: number;
  weekNumber: number;
  /** Day label as shown to the user ("Upper — Horizontal Push/Pull"). */
  day?: string;
}

/** One working set as logged. Canonical kg. */
export interface LoggedSet {
  weightKg: number | null;
  reps: number;
  rpe: number | null;
}

/** One exposure = one exercise performed in one workout. */
export interface Exposure {
  key: string;
  displayName: string;
  date: string;          // YYYY-MM-DD
  workoutId: string;
  sets: LoggedSet[];
  /** The set with the highest e1RM (weight > 0). Null for unloaded work. */
  top: LoggedSet | null;
  /** Lowest reps across loaded working sets — "did every set hit the range?" */
  minReps: number;
  /** Highest load across working sets. */
  maxWeightKg: number;
  /** Estimated 1RM from the top set, kg. 0 when unloaded. */
  e1rmKg: number;
  /** 0-1, from e1rmConfidence of the top set. */
  confidence: number;
  /** Whether RPE was logged on the top set. */
  rpeLogged: boolean;
  programDayRef: ProgramDayRef | null;
}

export interface RepRange { min: number; max: number }

/** A planned exercise as the engine sees it (parsed from the program). */
export interface PlannedExercise {
  key: string;
  exercise: string;
  sets: number;
  repRange: RepRange;
  repsRaw: string;
  /** Parsed from `intensity` ("RPE 7") — null when unparseable. */
  targetRPE: number | null;
  targetWeightKg: number | null;
  /** Where the exercise appears in the program. */
  locations: Array<{ phaseIndex: number; dayIndex: number; day: string }>;
}

export type ProposalKind =
  | 'retrofit'
  | 'load_change'
  | 'calibration'
  | 'program_from_logs'  // Cohort C — formalize the program the logs describe
  | 'set_targets'        // internal — the inverse of retrofit / load_change
  | 'restore_program';   // internal — the inverse of program_from_logs

export interface EvidenceLine {
  label: string;
  value: string;
}

/** A proposed change, before it's persisted. */
export interface ProposalDraft {
  kind: ProposalKind;
  dedupeKey: string;
  title: string;
  evidence: EvidenceLine[];
  reasoning: string;
  proposal: ProposalPayload;
  confidence: number;
  /** Higher surfaces first. */
  priority: number;
}

export interface TargetSeed {
  key: string;
  exercise: string;
  targetWeightKg: number | null;
  targetRPE: number | null;
  repRange: RepRange;
  confidence: number;
  basis: 'history' | 'e1rm' | 'none' | 'user';
  /** Retrofit finding for this lift. */
  finding: 'progressing' | 'plateau' | 'declining' | 'ready_to_bump' | 'insufficient' | 'calibrate';
  exposures: number;
  /** Human summary of the finding, e.g. "80 kg × 8 · steady 6 wks". */
  summary: string;
  /** Weekly best e1RM, oldest → newest, for a sparkline. */
  spark: number[];
}

export type ProposalPayload =
  | { kind: 'retrofit'; targets: TargetSeed[] }
  | { kind: 'load_change'; key: string; exercise: string; fromWeightKg: number | null; toWeightKg: number; scope: 'program' }
  | { kind: 'calibration'; key: string; exercise: string; targetWeightKg: number; targetRPE: number | null }
  | { kind: 'set_targets'; targets: Array<{ key: string; targetWeightKg: number | null; targetRPE?: number | null; confidence?: number | null; basis?: string | null }> }
  | { kind: 'program_from_logs'; program: any; observed: any; reason: 'no_program' | 'abandoned' }
  | { kind: 'restore_program'; savedProgram: string | null; programStartDate: string | null; splitLabel: string | null };

/** Everything the rules need, loaded once per run. */
export interface AdaptationContext {
  userId: string;
  program: any | null;
  unitPref: UnitPreference;
  planned: PlannedExercise[];
  /** Exposures per lift key, newest first. */
  exposuresByKey: Map<string, Exposure[]>;
  /** Total workouts with at least one loaded set. */
  workoutCount: number;
  firstWorkoutDate: string | null;
  now: Date;
}
