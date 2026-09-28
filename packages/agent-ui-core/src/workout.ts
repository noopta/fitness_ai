// The live workout — overview → set → rest → done.
//
// Pure state machine. The RN screen renders it and supplies the clock. The
// adaptation rules are the prototype's defaults, kept as data so the program
// engine can replace them later:
//   hard, not the last set      → rest +30 s      (Adjusted)
//   missed, not the last set    → next set −step  (Adjusted)
//   easy on the last set        → +step next week (Noted)
// Every within-session adjustment is auto-applied WITH a receipt and can be
// reverted from the rest screen — that is the D9 decision (2026-09-28):
// in-session micro-adjustments are a distinct class from program adaptation,
// which stays confirm-first.

import type { ReceiptVerb } from './receipts';

export interface PlanExercise {
  name: string;
  sets: number;
  reps: number | string;
  /** Working load in the user's display unit; 0 or null = bodyweight. */
  load: number | null;
  /** Rest between sets, seconds. */
  rest: number;
  cue: string | null;
}

export type Rating = 'easy' | 'hard' | 'miss';

export interface SetLog { ex: number; set: number; load: number | null; reps: number | string; rating: Rating; at: number }

export interface SessionReceipt { verb: ReceiptVerb; text: string; revert?: { ex: number; load: number } }

export interface WorkoutState {
  step: 'overview' | 'set' | 'rest' | 'done';
  ex: number;
  set: number;
  loads: (number | null)[];
  log: SetLog[];
  /** ms epoch when the current rest ends; rest duration in seconds. */
  restEnd: number;
  restDur: number;
  lastReceipt: SessionReceipt | null;
  /** Receipts to carry into the summary turn (write verbs only). */
  receipts: SessionReceipt[];
  /** ms epoch the session began (first Begin) and ended. */
  t0: number | null;
  end: number | null;
  /** Paused elapsed accounting: total ms spent paused. */
  pausedMs: number;
  pausedAt: number | null;
  /** Next-week notes (easy on last set). */
  nextWeek: { ex: number; delta: number }[];
}

export interface WorkoutRules {
  /** Load step in the display unit (5 lb or 2.5 kg). */
  step: number;
  restBumpSec: number;
  /** Rest fallback by rep range when the plan has none. */
  restForReps: (reps: number | string) => number;
}

export const defaultRules = (unit: 'lbs' | 'kg'): WorkoutRules => ({
  step: unit === 'kg' ? 2.5 : 5,
  restBumpSec: 30,
  restForReps: (reps) => {
    const n = typeof reps === 'number' ? reps : parseInt(String(reps), 10) || 8;
    if (n <= 3) return 150;
    if (n <= 6) return 120;
    if (n <= 10) return 90;
    return 60;
  },
});

export function initialWorkout(plan: PlanExercise[]): WorkoutState {
  return {
    step: 'overview', ex: 0, set: 0,
    loads: plan.map((p) => p.load),
    log: [], restEnd: 0, restDur: 0, lastReceipt: null, receipts: [],
    t0: null, end: null, pausedMs: 0, pausedAt: null, nextWeek: [],
  };
}

export type WorkoutAction =
  | { type: 'begin'; now: number }
  | { type: 'adjust_load'; delta: number }
  | { type: 'rate'; rating: Rating; now: number; plan: PlanExercise[]; rules: WorkoutRules }
  | { type: 'rest_add'; seconds: number }
  | { type: 'rest_skip' }
  | { type: 'rest_elapsed' }
  | { type: 'revert_last' }
  | { type: 'pause'; now: number }
  | { type: 'resume'; now: number }
  | { type: 'finish'; now: number };

const fmtLoad = (load: number | null, reps: number | string, name: string) =>
  load ? `${name} · ${load} × ${reps}` : `${name} · ${reps} reps`;

export function workoutReducer(s: WorkoutState, a: WorkoutAction): WorkoutState {
  switch (a.type) {
    case 'begin':
      return { ...s, step: 'set', t0: s.t0 ?? a.now };
    case 'adjust_load': {
      const loads = [...s.loads];
      const cur = loads[s.ex];
      if (cur == null) return s;
      loads[s.ex] = Math.max(0, cur + a.delta);
      return { ...s, loads };
    }
    case 'rate': {
      const { plan, rules, rating, now } = a;
      const P = plan[s.ex];
      if (!P) return s;
      const load = s.loads[s.ex];
      const last = s.set === P.sets - 1;
      const lastEx = s.ex === plan.length - 1;
      const log = [...s.log, { ex: s.ex, set: s.set, load, reps: P.reps, rating, at: now }];
      const loads = [...s.loads];
      let rest = P.rest || rules.restForReps(P.reps);
      let rec: SessionReceipt;
      const nextWeek = [...s.nextWeek];
      const what = fmtLoad(load, P.reps, P.name);
      if (rating === 'easy') {
        if (last && load) { rec = { verb: 'Noted', text: `${P.name} moved well — +${rules.step} next week.` }; nextWeek.push({ ex: s.ex, delta: rules.step }); }
        else rec = { verb: 'Logged', text: what };
      } else if (rating === 'hard') {
        if (last) rec = { verb: 'Logged', text: `${what} — hard` };
        else { rest += rules.restBumpSec; rec = { verb: 'Adjusted', text: `Rest +${rules.restBumpSec} s — that one was hard.` }; }
      } else {
        if (!last && load) {
          const next = Math.max(0, load - rules.step * 2);
          loads[s.ex] = next;
          rec = { verb: 'Adjusted', text: `Next set −${rules.step * 2} → ${next}. Same reps.`, revert: { ex: s.ex, load } };
        } else rec = { verb: 'Logged', text: `${what} — missed a rep` };
      }
      const receipts = rec.verb === 'Logged' ? s.receipts : [...s.receipts, rec];
      if (last && lastEx) {
        return { ...s, step: 'done', log, loads, lastReceipt: rec, receipts, end: now, nextWeek };
      }
      const nx = last ? { ex: s.ex + 1, set: 0 } : { ex: s.ex, set: s.set + 1 };
      return { ...s, step: 'rest', log, loads, lastReceipt: rec, receipts, restDur: rest, restEnd: now + rest * 1000, nextWeek, ...nx };
    }
    case 'rest_add':
      return { ...s, restEnd: s.restEnd + a.seconds * 1000, restDur: s.restDur + a.seconds };
    case 'rest_skip':
    case 'rest_elapsed':
      return s.step === 'rest' ? { ...s, step: 'set' } : s;
    case 'revert_last': {
      const r = s.lastReceipt?.revert;
      if (!r) return s;
      const loads = [...s.loads];
      loads[r.ex] = r.load;
      const receipts = s.receipts.filter((x) => x !== s.lastReceipt);
      return { ...s, loads, receipts, lastReceipt: { verb: 'Noted', text: `Kept ${r.load}.` } };
    }
    case 'pause':
      return s.pausedAt ? s : { ...s, pausedAt: a.now };
    case 'resume':
      return s.pausedAt ? { ...s, pausedMs: s.pausedMs + (a.now - s.pausedAt), pausedAt: null, restEnd: s.restEnd ? s.restEnd + (a.now - s.pausedAt) : s.restEnd } : s;
    case 'finish':
      return { ...s, step: 'done', end: s.end ?? a.now };
    default:
      return s;
  }
}

/** Elapsed seconds excluding pauses. */
export function elapsedSec(s: WorkoutState, now: number): number {
  if (!s.t0) return 0;
  const end = s.end ?? now;
  const paused = s.pausedMs + (s.pausedAt ? end - s.pausedAt : 0);
  return Math.max(0, Math.round((end - s.t0 - paused) / 1000));
}

export function mmss(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Per-exercise progress fraction for the four 2pt bars. */
export function exerciseProgress(s: WorkoutState, plan: PlanExercise[]): number[] {
  return plan.map((p, i) => Math.min(1, s.log.filter((l) => l.ex === i).length / Math.max(1, p.sets)));
}

export interface SessionSummary {
  minutes: number;
  sets: number;
  totalSets: number;
  topSet: string;
  volume: number;
  hardShare: number;
}

export function summarize(s: WorkoutState, plan: PlanExercise[], now: number): SessionSummary {
  const minutes = Math.max(1, Math.round(elapsedSec(s, now) / 60));
  const totalSets = plan.reduce((a, p) => a + p.sets, 0);
  const first = plan[0];
  const top = first ? Math.max(0, ...s.log.filter((l) => l.ex === 0 && l.load).map((l) => l.load as number)) : 0;
  const topSet = first ? (top ? `${first.name} ${top} × ${first.reps}` : `${first.name} ${first.reps}`) : '—';
  const volume = s.log.reduce((a, l) => {
    const reps = typeof l.reps === 'number' ? l.reps : parseInt(String(l.reps), 10) || 0;
    return a + (l.load ?? 0) * reps;
  }, 0);
  const hardShare = s.log.length ? s.log.filter((l) => l.rating !== 'easy').length / s.log.length : 0;
  return { minutes, sets: s.log.length, totalSets, topSet, volume: Math.round(volume), hardShare };
}

/** Shape a finished session into the POST /workouts body the backend accepts. */
export function toWorkoutLogBody(s: WorkoutState, plan: PlanExercise[], title: string, date: string, now: number) {
  const exercises = plan.map((p, i) => {
    const sets = s.log.filter((l) => l.ex === i);
    return {
      name: p.name,
      sets: sets.length,
      reps: String(p.reps),
      weight: sets.length ? Math.max(...sets.map((l) => l.load ?? 0)) : (s.loads[i] ?? 0),
      rpe: sets.length ? Math.round(sets.reduce((a, l) => a + (l.rating === 'easy' ? 7 : l.rating === 'hard' ? 9 : 10), 0) / sets.length) : undefined,
      notes: sets.some((l) => l.rating === 'miss') ? 'Missed a rep' : undefined,
    };
  }).filter((e) => e.sets > 0);
  return { title, date, duration: summarize(s, plan, now).minutes, exercises };
}
