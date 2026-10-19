// Shareable progress cards (design spec "Progress Moments", 19 Oct 2026).
// Approved set: cards 3a · 3b · 3d, photo overlays 3e · 3f · 3g · 2f.
// Every number comes from the user's data (the server's `data`); the scene
// builders only lay it out.

export type ShareableKind = '3a' | '3b' | '3d' | '3e' | '3f' | '3g' | '2f';
export const CARD_KINDS: ShareableKind[] = ['3a', '3b', '3d'];
export const OVERLAY_KINDS: ShareableKind[] = ['3e', '3f', '3g', '2f'];
export const isOverlay = (k: ShareableKind) => OVERLAY_KINDS.includes(k);

export type ShareUnit = 'lb' | 'kg';

/** 3a (card) and 3e (overlay): a lift's climb. */
export interface ClimbData {
  lift: string;
  unit: ShareUnit;
  /** "315 × 3" */
  repMax: string;
  /** Change in the shown rep-max weight vs the previous best, user unit; null when first. */
  delta: number | null;
  /** Weekly best estimated max, oldest first, ≥ 2 points. date = YYYY-MM-DD. */
  series: { date: string; e1rm: number }[];
  /** The next milestone; label e.g. "350 single". */
  goal: { value: number; label: string } | null;
  /** At most one marker, e.g. the program start. */
  events: { date: string; label: string; sub?: string }[];
  stats: { gained: number; bw: number | null; weeksToGoal: number | null; weeks: number };
}

/** 3b (card) and 3f (overlay): how the day added up. */
export interface DayData {
  /** YYYY-MM-DD */
  date: string;
  protein: { total: number; target: number; meals: { name: string; g: number }[] };
  calories: { n: number; target: number };
  carbs: { n: number; target: number };
  fat: { n: number; target: number };
  fiber?: { n: number; target: number } | null;
  /** Protein goal hit per day this week, oldest first; todayIndex marks today. */
  week: boolean[];
  todayIndex: number;
}

/** 3d (card): fat down, strength kept. Never an absolute bodyweight. */
export interface CutData {
  unit: ShareUnit;
  weeks: number;
  /** Change in the 7-day average since the start (negative = down). */
  change: number;
  /** "AUG" — the month the window starts, for the eyebrow. */
  since: string;
  series: { week: number; delta: number }[];
  /** Safe loss range per week, positive numbers. */
  safe: { min: number; max: number };
  lifts: { name: string; start: number; now: number }[];
}

/** 3g (overlay): one session. */
export interface SessionData {
  name: string;
  minutes: number | null;
  unit: ShareUnit;
  volume: number;
  /** Replaces "{unit} moved" when the session had no loaded sets ("reps"). */
  volumeUnit?: string;
  /** ≤ 4, sorted by volume share; share 0..1; top "315 × 3" or "BW × 8". */
  lifts: { name: string; top: string; share: number; isPR: boolean }[];
}

/** 2f (overlay): the line across the photo. */
export interface LineData {
  lift: string;
  unit: ShareUnit;
  series: { date: string; e1rm: number }[];
  now: number;
  start: { label: string; value: number };
  weeks: number;
}

export type ShareableData =
  | { kind: '3a'; data: ClimbData }
  | { kind: '3e'; data: ClimbData }
  | { kind: '3b'; data: DayData }
  | { kind: '3f'; data: DayData }
  | { kind: '3d'; data: CutData }
  | { kind: '3g'; data: SessionData }
  | { kind: '2f'; data: LineData };

export type ProgressMomentType = 'pr' | 'session' | 'nutrition' | 'cut';

/** What GET /moments/:id returns (and what a chat Moment card carries). */
export interface ProgressMoment {
  id: string;
  type: ProgressMomentType;
  /** Meta line, e.g. "New PR · Deadlift". */
  label: string;
  /** "315 × 3. A new best." */
  title: string;
  /** 2–3 warm, specific sentences, from the server. */
  praise: string;
  why: string[];
  /** First is the default. */
  shareables: ShareableData[];
  sharedAt?: string | null;
  /** Whether the user allows the Share action (Preferences → Share cards). */
  canShare: boolean;
}
