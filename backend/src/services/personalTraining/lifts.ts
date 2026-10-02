// Lift progress: which logged exercise counts as which main lift, a weekly
// estimated-1RM series, and the plateau rule. Pure functions over workout
// rows — used by Progress, the briefing, Ask Anakin and notifications, so
// they can never disagree about who is on a plateau.

import { e1rmWithRpe, parseRPE } from '../../engine/e1rm.js';
import type { LiftKey, ProgressStatus } from './types.js';

const DAY_MS = 86_400_000;

export const LIFTS: { key: LiftKey; label: string; match: RegExp; exclude?: RegExp }[] = [
  { key: 'squat', label: 'Squat', match: /\bsquat\b/i, exclude: /split|goblet|hack|bulgarian|pistol|jump|overhead/i },
  { key: 'bench', label: 'Bench press', match: /\bbench( press)?\b/i, exclude: /dumbbell|\bdb\b|incline|decline|close[- ]grip/i },
  { key: 'deadlift', label: 'Deadlift', match: /\bdeadlift\b/i, exclude: /romanian|\brdl\b|stiff|single[- ]leg/i },
  { key: 'ohp', label: 'Overhead press', match: /\boverhead press\b|\bohp\b|\bmilitary press\b/i, exclude: /dumbbell|\bdb\b/i },
];

export const LIFT_LABEL: Record<LiftKey, string> = Object.fromEntries(LIFTS.map((l) => [l.key, l.label])) as Record<LiftKey, string>;

export function isLiftKey(v: unknown): v is LiftKey {
  return typeof v === 'string' && LIFTS.some((l) => l.key === v);
}

export function liftKeyOf(exerciseName: string): LiftKey | null {
  const name = exerciseName.trim();
  for (const l of LIFTS) if (l.match.test(name) && !l.exclude?.test(name)) return l.key;
  return null;
}

/** The main lift a free-text title or sentence is about, if any ("Hold back squat load"). */
export function liftMentioned(text: string): LiftKey | null {
  return liftKeyOf(text);
}

export interface WorkoutLite { id: string; createdAt: Date; exercises: string; notes?: string | null; title?: string | null }
export interface LiftSession { logId: string; at: Date; e1rm: number }

interface LoggedExercise { name?: string; reps?: string | number; weightKg?: number | null; rpe?: string | number | null }

export function parseExercises(json: string): LoggedExercise[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function lowerReps(reps: unknown): number {
  const m = String(reps ?? '').match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

/** Best estimated 1RM (kg) for `lift` in each session that trained it, oldest first. */
export function liftHistory(logs: WorkoutLite[], lift: LiftKey): LiftSession[] {
  const out: LiftSession[] = [];
  for (const log of logs) {
    let best = 0;
    for (const ex of parseExercises(log.exercises)) {
      if (!ex.name || !ex.weightKg || ex.weightKg <= 0 || liftKeyOf(ex.name) !== lift) continue;
      best = Math.max(best, e1rmWithRpe(ex.weightKg, lowerReps(ex.reps), parseRPE(ex.rpe)));
    }
    if (best > 0) out.push({ logId: log.id, at: log.createdAt, e1rm: best });
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Best e1RM in each of the trailing `weeks` 7-day windows, oldest first; null where the lift wasn't trained. */
export function weeklyBest(history: LiftSession[], weeks: number, now: Date): (number | null)[] {
  const out: (number | null)[] = Array(weeks).fill(null);
  for (const s of history) {
    const ago = Math.floor((now.getTime() - s.at.getTime()) / DAY_MS);
    if (ago < 0 || ago >= weeks * 7) continue;
    const i = weeks - 1 - Math.floor(ago / 7);
    out[i] = Math.max(out[i] ?? 0, s.e1rm);
  }
  return out;
}

/** Carry the last known value across untrained weeks so a sparkline has no holes. */
export function fillForward(series: (number | null)[]): number[] {
  const first = series.find((v): v is number => v !== null);
  if (first === undefined) return [];
  let last = first;
  return series.map((v) => (last = v ?? last));
}

/** Minimum weekly exposures before a trend is called (rule PLAT-03). */
export const PLATEAU_MIN_EXPOSURES = 3;
/** e1RM must move at least this much (kg) across the window to count as progress. */
export const PLATEAU_MIN_CHANGE_KG = 1;
export const REGRESSION_KG = 2.5;

export interface Trend { status: ProgressStatus; changeKg: number | null; exposures: number; latestKg: number | null }

/**
 * PLAT-03: with at least three weekly exposures in the window, an e1RM change
 * under 1 kg is a plateau. A drop of 2.5 kg or more is a regression. Fewer
 * exposures say nothing either way.
 */
export function liftTrend(weekly: (number | null)[]): Trend {
  const values = weekly.filter((v): v is number => v !== null);
  if (values.length === 0) return { status: 'noData', changeKg: null, exposures: 0, latestKg: null };
  const latestKg = values[values.length - 1];
  if (values.length < PLATEAU_MIN_EXPOSURES) return { status: 'noData', changeKg: null, exposures: values.length, latestKg };
  const changeKg = latestKg - values[0];
  const status: ProgressStatus =
    changeKg <= -REGRESSION_KG ? 'regressing' : changeKg < PLATEAU_MIN_CHANGE_KG ? 'plateau' : 'progressing';
  return { status, changeKg, exposures: values.length, latestKg };
}

export interface PrEvent { logId: string; at: Date; lift: string; e1rm: number }

/** Every session that beat a lift's previous best estimated 1RM. A lift's first appearance is a baseline, not a PR. */
export function prEvents(logsOldestFirst: WorkoutLite[]): PrEvent[] {
  const best = new Map<string, number>();
  const out: PrEvent[] = [];
  for (const log of logsOldestFirst) {
    const session = new Map<string, { name: string; e1rm: number }>();
    for (const ex of parseExercises(log.exercises)) {
      if (!ex.name || !ex.weightKg || ex.weightKg <= 0) continue;
      const e1rm = e1rmWithRpe(ex.weightKg, lowerReps(ex.reps), parseRPE(ex.rpe));
      if (e1rm <= 0) continue;
      const key = ex.name.trim().toLowerCase();
      if (e1rm > (session.get(key)?.e1rm ?? 0)) session.set(key, { name: ex.name.trim(), e1rm });
    }
    for (const [key, { name, e1rm }] of session) {
      const prior = best.get(key);
      if (prior !== undefined && e1rm > prior) out.push({ logId: log.id, at: log.createdAt, lift: name, e1rm });
      if (prior === undefined || e1rm > prior) best.set(key, e1rm);
    }
  }
  return out;
}
