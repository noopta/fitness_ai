// The live workout — overview → set → rest → done.
//
// Pure state machine. The RN screen renders it and supplies the clock. The
// adaptation rules are the prototype's defaults, kept as data so the program
// engine can replace them later:
//   hard, not the last set      → rest +30 s      (Adjusted)
//   missed, not the last set    → next set −step  (Adjusted)
//   easy on the last set        → +step next week (Noted)
// What they actually did wins over the plan: weight and reps are editable on
// every set, bodyweight lifts take added weight ("dips BW +10"), and each set
// is saved with its own reps (Oct 2026: a user couldn't log heavier dips or
// extra reps — the screen only offered easy / hard / missed).
// Every within-session adjustment is auto-applied WITH a receipt and can be
// reverted from the rest screen — that is the D9 decision (2026-09-28):
// in-session micro-adjustments are a distinct class from program adaptation,
// which stays confirm-first.

import type { ReceiptVerb } from './receipts';

export interface PlanExercise {
  name: string;
  sets: number;
  reps: number | string;
  /** Working load in the user's display unit; null = not known yet (or bodyweight, see kind). */
  load: number | null;
  /** Rest between sets, seconds. */
  rest: number;
  cue: string | null;
  /** Whether the lift takes a weight (loadKind). Missing on drafts saved before Oct 26 2026. */
  kind?: LoadKind;
}

/**
 * Whether a lift takes a weight (Oct 2026). 'weighted' needs one before a set
 * counts; 'bodyweight' is bodyweight, where a weight means added weight;
 * 'either' asks which. The session used to call any lift with no known weight
 * bodyweight, so a new user's bench press and deadlift showed "BW" and saved
 * with no weight.
 */
export type LoadKind = 'weighted' | 'bodyweight' | 'either';
const BODYWEIGHT_LIFT = /\b(pull[- ]?ups?|chin[- ]?ups?|push[- ]?ups?|press[- ]?ups?|dips?|planks?|side planks?|sit[- ]?ups?|crunch(es)?|burpees?|mountain climbers?|jumping jacks?|(hanging )?(leg|knee) raises?|inverted rows?|pistols?( squats?)?|muscle[- ]?ups?|handstands?( push[- ]?ups?)?|bird dogs?|dead bugs?|hollow (body|holds?)|supermans?|air squats?|bodyweight [a-z ]+|jump squats?|box jumps?|nordic( hamstring)? curls?|l[- ]?sits?|bear crawls?|flutter kicks?|v[- ]?ups?|toes[- ]to[- ]bar)\b/i;
const EITHER_LIFT = /\b(lunges?|split squats?|step[- ]?ups?|calf raises?|back extensions?|hyperextensions?|glute bridges?|russian twists?|sissy squats?|reverse hypers?|bulgarian)\b/i;
const EQUIPMENT = /\b(barbell|dumbbells?|db|bb|kettlebells?|kb|cable|machine|smith|goblet|trap[- ]bar|ez[- ]?bar|landmine|plate|sled|banded)\b/i;
export function loadKind(name: string, serverBodyweight?: boolean | null): LoadKind {
  const n = String(name ?? '');
  if (serverBodyweight) return 'bodyweight';
  // "Cable crunch", "machine dip", "dumbbell lunge": the equipment decides. "Weighted pull-up" stays bodyweight + added weight.
  if (EQUIPMENT.test(n)) return 'weighted';
  if (BODYWEIGHT_LIFT.test(n)) return 'bodyweight';
  if (EITHER_LIFT.test(n)) return 'either';
  return 'weighted';
}

export type Rating = 'easy' | 'hard' | 'miss';

export interface SetLog { ex: number; set: number; load: number | null; reps: number | string; rating: Rating; at: number }

export interface SessionReceipt { verb: ReceiptVerb; text: string; revert?: { ex: number; load: number } }

export interface WorkoutState {
  step: 'overview' | 'set' | 'rest' | 'done';
  ex: number;
  set: number;
  loads: (number | null)[];
  /** Reps for the current set of each exercise — the plan's until they change it. */
  reps?: (number | string)[];
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
    reps: plan.map((p) => p.reps),
    log: [], restEnd: 0, restDur: 0, lastReceipt: null, receipts: [],
    t0: null, end: null, pausedMs: 0, pausedAt: null, nextWeek: [],
  };
}

export type WorkoutAction =
  | { type: 'begin'; now: number }
  | { type: 'adjust_load'; delta: number }
  /** Exact weight (display unit); 0 or null = bodyweight / no added weight. */
  | { type: 'set_load'; load: number | null }
  /** `base`: the reps on screen, for drafts saved before per-set reps existed. */
  | { type: 'adjust_reps'; delta: number; base?: number | string }
  | { type: 'set_reps'; reps: number }
  | { type: 'rate'; rating: Rating; now: number; plan: PlanExercise[]; rules: WorkoutRules }
  | { type: 'rest_add'; seconds: number }
  | { type: 'rest_skip' }
  | { type: 'rest_elapsed' }
  | { type: 'revert_last' }
  | { type: 'pause'; now: number }
  | { type: 'resume'; now: number }
  | { type: 'finish'; now: number }
  /** Put a saved draft back, paused — the clock resumes on the next 'resume'. */
  | { type: 'restore'; state: WorkoutState; now: number }
  /** The plan arrived (it's built async): take its loads. Ignored once a set is logged. */
  | { type: 'load_plan'; plan: PlanExercise[] };

const fmtLoad = (load: number | null, reps: number | string, name: string) =>
  load ? `${name} · ${load} × ${reps}` : `${name} · ${reps} reps`;

export function workoutReducer(s: WorkoutState, a: WorkoutAction): WorkoutState {
  switch (a.type) {
    case 'begin':
      return { ...s, step: 'set', t0: s.t0 ?? a.now };
    case 'adjust_load': {
      // Bodyweight starts at 0: "+5" makes it weighted (added load).
      const loads = [...s.loads];
      const next = Math.max(0, (loads[s.ex] ?? 0) + a.delta);
      loads[s.ex] = next > 0 ? next : null;
      return { ...s, loads };
    }
    case 'set_load': {
      const loads = [...s.loads];
      const v = a.load != null && Number.isFinite(a.load) ? Math.max(0, Math.round(a.load * 10) / 10) : 0;
      loads[s.ex] = v > 0 ? v : null;
      return { ...s, loads };
    }
    case 'adjust_reps':
    case 'set_reps': {
      const reps = [...(s.reps ?? [])];
      const cur = repCount(reps[s.ex] ?? (a.type === 'adjust_reps' ? a.base ?? 0 : 0));
      const next = a.type === 'set_reps' ? Math.round(a.reps) : cur + a.delta;
      if (!Number.isFinite(next) || next < 1 || next > 100) return s;
      reps[s.ex] = next;
      return { ...s, reps };
    }
    case 'rate': {
      const { plan, rules, rating, now } = a;
      const P = plan[s.ex];
      if (!P) return s;
      const load = s.loads[s.ex];
      const done = s.reps?.[s.ex] ?? P.reps;
      const last = s.set === P.sets - 1;
      const lastEx = s.ex === plan.length - 1;
      const log = [...s.log, { ex: s.ex, set: s.set, load, reps: done, rating, at: now }];
      const loads = [...s.loads];
      let rest = P.rest || rules.restForReps(P.reps);
      let rec: SessionReceipt;
      const nextWeek = [...s.nextWeek];
      const what = fmtLoad(load, done, P.name);
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
    case 'restore':
      return { ...a.state, pausedAt: a.state.pausedAt ?? a.now };  // drafts from before per-set reps fall back to the plan's
    // The screen starts from an empty plan while loads are looked up; without
    // this, loads stayed [] and every set was saved with no weight (Oct 2026:
    // 12 of 12 guided sessions logged as bodyweight).
    case 'load_plan':
      return s.log.length ? s : { ...s, loads: a.plan.map((p) => p.load), reps: a.plan.map((p) => p.reps) };
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
  const topLog = first ? s.log.filter((l) => l.ex === 0 && l.load === top && top)[0] : undefined;
  const topSet = first ? (top ? `${first.name} ${top} × ${topLog?.reps ?? first.reps}` : `${first.name} ${first.reps}`) : '—';
  const volume = s.log.reduce((a, l) => {
    const reps = typeof l.reps === 'number' ? l.reps : parseInt(String(l.reps), 10) || 0;
    return a + (l.load ?? 0) * reps;
  }, 0);
  const hardShare = s.log.length ? s.log.filter((l) => l.rating !== 'easy').length / s.log.length : 0;
  return { minutes, sets: s.log.length, totalSets, topSet, volume: Math.round(volume), hardShare };
}

/** Shape a finished session into the POST /workouts body the backend accepts. */
/** RPE implied by a set's rating — the session asks "easy / hard / missed", not a number. */
const ratingRpe = (r: Rating) => (r === 'easy' ? 7 : r === 'hard' ? 9 : 10);
const mostCommon = (xs: number[]) => xs.slice().sort((a, b) => xs.filter((x) => x === b).length - xs.filter((x) => x === a).length)[0];
const repCount = (reps: number | string) => { const n = typeof reps === 'number' ? reps : parseInt(String(reps), 10); return Number.isFinite(n) && n > 0 ? n : 0; };

/**
 * The log body for what was actually done. Each set is kept as its own entry
 * (its load, its reps — one short when a rep was missed — and the RPE its
 * rating implies), so the e1RM and progression engines see every set, not one
 * row per exercise at the top weight. The top-level weight is the top set.
 */
export function toWorkoutLogBody(s: WorkoutState, plan: PlanExercise[], title: string, date: string, now: number) {
  const exercises = plan.map((p, i) => {
    const sets = s.log.filter((l) => l.ex === i);
    return {
      name: p.name,
      sets: sets.length,
      // The reps they did most often (the plan's when every set matched it).
      reps: String(sets.length ? mostCommon(sets.map((l) => repCount(l.reps))) : p.reps),
      weight: sets.length ? Math.max(...sets.map((l) => l.load ?? 0)) : (s.loads[i] ?? 0),
      rpe: sets.length ? Math.round(sets.reduce((a, l) => a + ratingRpe(l.rating), 0) / sets.length) : undefined,
      notes: sets.some((l) => l.rating === 'miss') ? 'Missed a rep' : undefined,
      setEntries: sets.map((l) => ({
        weight: l.load,
        reps: l.rating === 'miss' ? Math.max(0, repCount(l.reps) - 1) : repCount(l.reps),
        rpe: ratingRpe(l.rating),
      })),
    };
  }).filter((e) => e.sets > 0);
  return { title, date, duration: summarize(s, plan, now).minutes, exercises };
}

// ── Drafts: a session in progress survives leaving the screen ────────────────

export interface WorkoutDraft {
  v: 1;
  date: string;
  title: string;
  plan: PlanExercise[];
  state: WorkoutState;
  savedAt: number;
}

/** Sets done, not yet saved. Nothing to keep before the first set. */
export const hasProgress = (s: WorkoutState) => s.log.length > 0;

/** A draft worth offering back: same day, under 12 hours old, with sets in it, not finished-and-saved. */
export function resumableDraft(d: unknown, today: string, now: number): WorkoutDraft | null {
  const x = d as WorkoutDraft | null;
  if (!x || x.v !== 1 || x.date !== today || !x.state || !Array.isArray(x.plan)) return null;
  if (now - x.savedAt > 12 * 3600_000) return null;
  if (!hasProgress(x.state)) return null;
  return x;
}

/**
 * Swap the lift at `index` mid-session (Oct 2026). Only the name, load and
 * kind change; sets, reps, rest and cue stay — a swap keeps the job. With no
 * sets done on it the lift is replaced in place. With sets done, those sets
 * stay under the old name (they happened) and the new lift is inserted after
 * it with the remaining sets; the session moves on to it. Pure.
 */
export function swapExercise(plan: PlanExercise[], s: WorkoutState, index: number, next: { name: string; load: number | null; kind?: LoadKind }): { plan: PlanExercise[]; state: WorkoutState } {
  const cur = plan[index];
  if (!cur) return { plan, state: s };
  const done = s.log.filter((l) => l.ex === index).length;
  const swapped: PlanExercise = { ...cur, name: next.name, load: next.kind === 'bodyweight' ? null : next.load, kind: next.kind ?? loadKind(next.name) };
  if (!done) {
    const p = plan.map((x, i) => (i === index ? swapped : x));
    const loads = [...s.loads]; loads[index] = swapped.load;
    const reps = [...(s.reps ?? plan.map((x) => x.reps))]; reps[index] = cur.reps;
    return { plan: p, state: { ...s, loads, reps } };
  }
  const remaining = Math.max(1, cur.sets - done);
  const p = [...plan.slice(0, index), { ...cur, sets: done }, { ...swapped, sets: remaining }, ...plan.slice(index + 1)];
  const shift = (ex: number) => (ex > index ? ex + 1 : ex);
  const loads = [...s.loads.slice(0, index + 1), swapped.load, ...s.loads.slice(index + 1)];
  const r0 = s.reps ?? plan.map((x) => x.reps);
  const reps = [...r0.slice(0, index + 1), cur.reps, ...r0.slice(index + 1)];
  return {
    plan: p,
    state: {
      ...s, loads, reps,
      log: s.log.map((l) => ({ ...l, ex: shift(l.ex) })),
      nextWeek: s.nextWeek.map((n) => ({ ...n, ex: shift(n.ex) })),
      lastReceipt: s.lastReceipt?.revert ? { ...s.lastReceipt, revert: { ...s.lastReceipt.revert, ex: shift(s.lastReceipt.revert.ex) } } : s.lastReceipt,
      // On the swapped lift now (from the rest screen or mid-set: the next set is its first).
      ex: s.ex === index ? index + 1 : shift(s.ex), set: s.ex === index ? 0 : s.set,
    },
  };
}
