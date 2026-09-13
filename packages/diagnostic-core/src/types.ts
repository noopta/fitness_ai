// Shared types for the conversational lift diagnostic.
//
// Spec: "Axiom form diagnostic flow" engineering handoff v1.0. The whole
// diagnostic is one message thread with Anakin; every input lives in the
// composer, and the composer's control set is driven by a single `stage`.

export type LiftId =
  | 'flat_bench_press'
  | 'incline_bench_press'
  | 'deadlift'
  | 'barbell_back_squat'
  | 'barbell_front_squat'
  | 'clean_and_jerk'
  | 'snatch'
  | 'power_clean'
  | 'hang_clean';

/** The 12 stage values (§4). q0/q1/q2 share one row in the spec table. */
export type Stage =
  | 'lift'
  | 'numbers'
  | 'acc'
  | 'video'
  | 'analyzing'
  | 'q0'
  | 'q1'
  | 'q2'
  | 'ready'
  | 'generating'
  | 'verdict'
  | 'blocked';

/** The 9 composer modes (§4). Every stage maps to exactly one. */
export type ComposerMode =
  | 'chips'
  | 'typing'
  | 'numbers'
  | 'accessory'
  | 'video'
  | 'generate'
  | 'waiting'
  | 'done'
  | 'blocked';

export type QuestionId = 'q0' | 'q1' | 'q2';

export type WeightUnit = 'lb' | 'kg';

export interface SetEntry {
  weight: number;
  sets: number;
  reps: number;
  unit: WeightUnit;
}

export type AccessoryStatus = 'logged' | 'untrained' | 'skipped';

export interface AccessoryRecord {
  exerciseId: string;
  status: AccessoryStatus;
  set?: SetEntry;
}

export interface Answer {
  /** 'video' when a successful clip settled the phase question (§6). */
  source: 'chip' | 'text' | 'video';
  optionId?: string;
  text: string;
  flags: string[];
}

// ─── Server payloads ─────────────────────────────────────────────────────────

export interface VideoResult {
  /** Phase id from the lift config where the bar stalls, e.g. "lockout". */
  stickingPhase: string | null;
  /** How long the bar spends near-stalled, in seconds. */
  stickingPointSec: number | null;
  elbowFlareDeg: number | null;
  barDriftCm: number | null;
  /** Frame still as a data URI or URL; null when stills aren't allowed. */
  frameUrl: string | null;
}

export type EvidenceTag = 'RATIO' | 'VIDEO' | 'YOU' | 'GAP';

export interface EvidenceRow {
  tag: EvidenceTag;
  text: string;
}

export type CandidateRank = 'primary' | 'secondary' | 'ruled_out' | 'leading' | 'open';

export interface Candidate {
  key: string;
  label: string;
  score: number | null;
  rank: CandidateRank;
}

export interface RadarIndices {
  quad_index?: number;
  posterior_index?: number;
  back_tension_index?: number;
  triceps_index?: number;
  shoulder_index?: number;
}

export interface ProtocolAccessory {
  exerciseId: string;
  name: string;
  sets: number;
  reps: string;
  why: string;
}

export type Fix =
  | { locked: true; accessoryCount: number }
  | {
      locked: false;
      primary: { name: string; sets: number; reps: string; intensity: string; restMinutes: number };
      accessories: ProtocolAccessory[];
      progression: string[];
    };

/**
 * The graded output of one diagnosis (§7, §10 "Graded output"). The engine
 * produces confidence, candidate ranks and the tagged evidence list; the UI
 * never invents reasons.
 */
export interface Verdict {
  sessionId: string;
  lift: LiftId;
  grade: 0 | 1 | 2;
  confidence: number;
  ratiosLogged: number;
  hasVideo: boolean;
  answersGiven: number;
  limiter: { phase: string; hypothesisKey: string | null; hypothesisLabel: string | null };
  evidence: EvidenceRow[];
  candidates: Candidate[];
  /** Null below 2 ratios — charts are suppressed (§11). */
  charts: { indices: RadarIndices; efficiency: number } | null;
  video: VideoResult | null;
  validationTest: { description: string; howToRun: string } | null;
  fix: Fix;
  trackNextTime: string[];
  /** Ladder lifts not yet logged — drives "Add the missing numbers". */
  missingLifts: string[];
  createdAt: string;
}

// ─── Thread ──────────────────────────────────────────────────────────────────

export type ThreadItem =
  | { kind: 'anakin'; id: string; text: string }
  | { kind: 'user'; id: string; turnId: string; text: string; status: 'sending' | 'sent' | 'failed' }
  | { kind: 'video'; id: string; result: VideoResult }
  | { kind: 'verdict'; id: string; verdict: Verdict }
  | { kind: 'limit'; id: string };

// ─── Turns ───────────────────────────────────────────────────────────────────

/** Everything a user can do. Each one produces exactly one user bubble (§1a). */
export type TurnInput =
  | { type: 'lift'; lift: LiftId }
  | { type: 'main'; set: SetEntry }
  | { type: 'accessory'; exerciseId: string; set: SetEntry }
  | { type: 'untrained'; exerciseId: string }
  | { type: 'skip'; exerciseId: string }
  | { type: 'change'; exerciseId: string }
  | { type: 'moveOn' }
  | { type: 'video'; durationSec: number | null; file?: unknown }
  | { type: 'skipVideo' }
  | { type: 'answer'; question: QuestionId; optionId?: string; text: string; flags: string[] }
  | { type: 'verdict' }
  | { type: 'addNumbers' };

export type TurnType = TurnInput['type'];

export interface Turn {
  id: string;
  input: TurnInput;
}

/** What the server hands back for a turn. Shape depends on the turn type. */
export interface TurnResult {
  limitReached?: boolean;
  verdict?: Verdict;
  video?: { status: 'pending' | 'complete' | 'failed'; result?: VideoResult | null };
}

/** A turn as persisted server-side — the transcript of record. */
export interface TurnRecord {
  clientTurnId: string;
  seq: number;
  input: TurnInput;
  result: TurnResult;
  createdAt: string;
}

export interface LoadResponse {
  session: { id: string; lift: LiftId; flow: string; createdAt: string };
  turns: TurnRecord[];
  limit: { reached: boolean };
  unit?: WeightUnit;
}

export interface DiagnosticListRow {
  id: string;
  lift: LiftId | string;
  flow: 'conversation' | 'wizard';
  status: 'in_progress' | 'complete';
  grade: 0 | 1 | 2 | null;
  confidence: number | null;
  limiter: Verdict['limiter'] | null;
  updatedAt: string;
}
