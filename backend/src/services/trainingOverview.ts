// Training · Focus bands (RN spec, 3 Oct 2026) — the one payload behind the
// Training tab: GOAL, PROGRAM, THIS WEEK and ARCHIVE. Pure: the route loads
// the rows, this shapes them, so the shaping is unit-tested without a DB.

import { kgToLb, type UnitPreference } from './weightUnits.js';
import { sessionMinutes } from './sessionMinutes.js';

export type Pace = 'ahead' | 'on' | 'behind';
export type DayStatus = 'done' | 'today' | 'planned' | 'rest';

export interface OverviewLift {
  /** Canonical lift name — the key the Lift history page looks up. */
  name: string;
  start: number;
  current: number;
  target: number;
  /** Rep spec shown after the target ("e1RM", or "× 5" when the goal named reps). */
  reps: string;
  pace: Pace;
  /** 0..1 of the way from start to target, measured on e1RM (so a rep goal fills correctly). */
  progress: number;
  /** 'goal' = parsed from the program goal; 'projected' = estimated from the program length. */
  targetSource: 'goal' | 'projected';
}

export interface OverviewPhase {
  name: string;
  focus: string;
  weeks: number;
  /** First week of the phase, 1-based. */
  from: number;
  why: string;
  sessions: string;
  effort: string;
  focusLine: string;
}

export interface OverviewDay {
  dow: string;
  date: string;
  name: string;
  minutes: number | null;
  status: DayStatus;
  exercises: { name: string; spec: string }[];
}

export interface OverviewArchiveItem {
  kind: 'program' | 'diagnostic';
  title: string;
  sub: string;
  value: string;
  id: string;
  /** Diagnostics only — which screen opens it. */
  source?: 'form' | 'lift';
  flow?: 'conversation' | 'wizard';
  done?: boolean;
}

export interface TrainingOverview {
  unit: 'lb' | 'kg';
  goal: { text: string | null; lifts: OverviewLift[]; pct: number };
  program: { week: number; totalWeeks: number; currentPhase: number; phases: OverviewPhase[] } | null;
  week: { done: number; planned: number; days: OverviewDay[] };
  archive: { count: number; items: OverviewArchiveItem[] };
}

export interface StrengthLiftInput {
  canonicalName: string;
  current1RMkg: number;
  sessionCount?: number;
  weekSeries?: { week: string; rm: number }[];
}

export interface ScheduleDayInput {
  date: string;
  isToday: boolean;
  isLogged?: boolean;
  session: any | null;
}

export interface OverviewInput {
  program: any | null;
  weekNumber: number;
  phaseIndex: number;
  totalWeeks: number;
  /** ISO-ish week key of the program start, same format as weekSeries keys. */
  startWeekKey: string | null;
  /** Mon → Sun. */
  weekDays: ScheduleDayInput[];
  lifts: StrengthLiftInput[];
  unitPref: UnitPreference;
  completed: { id: string; goal: string | null; startDate: Date | string; endDate: Date | string; durationWeeks: number | null; reason: string | null }[];
  formAnalyses: { id: string; exercise: string; status: string; formScore?: number | null; createdAt: Date | string }[];
  liftDiagnostics: { id: string; lift: string; flow: 'conversation' | 'wizard'; status: string; updatedAt: Date | string }[];
}

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MAIN_LIFTS = ['squat', 'bench', 'deadlift', 'overhead press', 'press', 'row', 'pull'];

// ─── Units ──────────────────────────────────────────────────────────────────

const isKg = (pref: UnitPreference) => String(pref).toLowerCase().startsWith('kg');
/** Display a kg load in the user's unit, rounded to the plate step (5 lb / 2.5 kg). */
export function displayLoad(kg: number, pref: UnitPreference): number {
  if (isKg(pref)) return Math.round(kg / 2.5) * 2.5;
  return Math.round(kgToLb(kg) / 5) * 5;
}
const toKg = (v: number, unit: 'lb' | 'kg') => (unit === 'kg' ? v : v / 2.2046226218);

// ─── Copy helpers ───────────────────────────────────────────────────────────

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** "Upper Body — Arms/Chest Emphasis" → "Upper". */
export function sessionTitle(raw?: string | null): string {
  if (!raw) return 'Session';
  const head = String(raw).split(/[—–·/]/)[0].trim().replace(/\s+body$/i, '').trim();
  return cap(head.split(/\s+/)[0] || head);
}

/** "Build" from "Build/Hypertrophy" or "Build — hypertrophy". */
const phaseHead = (s: string) => String(s).split(/[/·—–-]/)[0].trim();

/** Most common day focus in a phase, lower-cased: "Hypertrophy". */
function phaseFocus(phase: any): string {
  const name = String(phase?.phaseName ?? phase?.name ?? '');
  const tail = name.split(/[/·—–-]/).slice(1).join(' ').trim();
  if (tail) return tail.toLowerCase();
  const counts = new Map<string, number>();
  for (const d of phase?.trainingDays ?? phase?.days ?? []) {
    const f = String(d?.focus ?? '').trim().toLowerCase();
    if (f) counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}

/** "RPE 7–8" from the exercises' intensity strings, or "" when none say. */
function phaseEffort(phase: any): string {
  const rpes: number[] = [];
  for (const d of phase?.trainingDays ?? phase?.days ?? []) {
    for (const e of d?.exercises ?? []) {
      if (typeof e?.targetRPE === 'number') rpes.push(e.targetRPE);
      const m = String(e?.intensity ?? '').match(/RPE\s*(\d+(?:\.\d)?)(?:\s*[-–]\s*(\d+(?:\.\d)?))?/i);
      if (m) { rpes.push(Number(m[1])); if (m[2]) rpes.push(Number(m[2])); }
    }
  }
  if (!rpes.length) return '';
  const lo = Math.min(...rpes), hi = Math.max(...rpes);
  return lo === hi ? `RPE ${lo}` : `RPE ${lo}–${hi}`;
}

/** "Upper · lower · full" — the distinct day titles, in order. */
function phaseFocusLine(phase: any): string {
  const seen: string[] = [];
  for (const d of phase?.trainingDays ?? phase?.days ?? []) {
    const t = sessionTitle(d?.day ?? d?.name);
    if (!seen.includes(t)) seen.push(t);
  }
  return seen.map((t, i) => (i ? t.toLowerCase() : t)).join(' · ');
}

/** "4 × 6 · 225 lb" — the load when there's a target, otherwise the RPE. `unit: false` drops the unit. */
export function exerciseSpec(e: any, pref: UnitPreference, opts: { unit?: boolean } = {}): string {
  const sr = `${e?.sets ?? '—'} × ${e?.reps ?? '—'}`;
  if (typeof e?.targetWeightKg === 'number' && e.targetWeightKg > 0) {
    const load = displayLoad(e.targetWeightKg, pref);
    return opts.unit === false ? `${sr} · ${load}` : `${sr} · ${load} ${isKg(pref) ? 'kg' : 'lb'}`;
  }
  const rpe = String(e?.intensity ?? '').match(/RPE\s*[\d.–-]+/i)?.[0];
  return rpe ? `${sr} · ${rpe.replace(/\s+/, ' ')}` : sr;
}

const exName = (e: any) => String(e?.exercise ?? e?.name ?? e?.exerciseName ?? 'Exercise');

/** "Close-Grip Bench Press" → "Close-grip bench press". Short all-caps words (RDL, DB, OHP) stay. */
export function sentenceCase(raw: string): string {
  const words = String(raw).trim().split(/\s+/);
  return words.map((w, i) => {
    if (/^[A-Z0-9]{2,4}s?$/.test(w)) return w;
    const lower = w.toLowerCase();
    return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
  }).join(' ');
}

const month = (d: Date | string) => new Date(d).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
const day = (d: Date | string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const ms = (d: Date | string) => new Date(d).getTime();

// ─── Goal ───────────────────────────────────────────────────────────────────

const LIFT_WORDS: [RegExp, string][] = [
  [/squat/i, 'squat'], [/bench/i, 'bench'], [/dead\s*lift/i, 'deadlift'],
  [/overhead|ohp|military/i, 'overhead press'],
];

/** "Deadlift 350 by spring, bench 225x5" → { deadlift: {350, lb, 1}, bench: {225, lb, 5} }. */
export function parseGoalTargets(goal: string | null | undefined, defaultUnit: 'lb' | 'kg'): Map<string, { value: number; unit: 'lb' | 'kg'; reps: number | null }> {
  const out = new Map<string, { value: number; unit: 'lb' | 'kg'; reps: number | null }>();
  if (!goal) return out;
  for (const [re, key] of LIFT_WORDS) {
    const m = goal.match(new RegExp(`(?:${re.source})[^\\d,;.]{0,24}(\\d{2,4}(?:\\.\\d)?)\\s*(kg|kgs|lb|lbs|pounds)?(?:\\s*[x×]\\s*(\\d{1,2}))?`, 'i'));
    if (!m) continue;
    const unit = m[2] ? (m[2].toLowerCase().startsWith('k') ? 'kg' : 'lb') : defaultUnit;
    out.set(key, { value: Number(m[1]), unit, reps: m[3] ? Number(m[3]) : null });
  }
  return out;
}

/** Epley inverse: the 1RM-equivalent of `value` for `reps`. */
const e1rmOf = (value: number, reps: number | null) => (reps && reps > 1 ? value * (1 + reps / 30) : value);

function pickLifts(lifts: StrengthLiftInput[], program: any): StrengthLiftInput[] {
  const planned = new Set<string>();
  for (const ph of program?.phases ?? []) for (const d of ph?.trainingDays ?? ph?.days ?? []) for (const e of d?.exercises ?? []) planned.add(exName(e).toLowerCase());
  const rank = (l: StrengthLiftInput) => {
    const n = l.canonicalName.toLowerCase();
    const main = MAIN_LIFTS.findIndex((w) => n.includes(w));
    const inPlan = [...planned].some((p) => p.includes(n) || n.includes(p));
    return (inPlan ? 0 : 1000) + (main >= 0 ? main * 10 : 500) - Math.min(9, (l.sessionCount ?? 0) / 10);
  };
  return lifts.filter((l) => l.current1RMkg > 0).sort((a, b) => rank(a) - rank(b)).slice(0, 3);
}

function buildGoal(input: OverviewInput, unit: 'lb' | 'kg'): TrainingOverview['goal'] {
  const goalText: string | null = input.program?.goal ?? null;
  const parsed = parseGoalTargets(goalText, unit);
  const totalWeeks = Math.max(1, input.totalWeeks);
  const expected = totalWeeks > 1 ? (input.weekNumber - 1) / (totalWeeks - 1) : 1;
  const lifts: OverviewLift[] = pickLifts(input.lifts, input.program).map((l) => {
    const series = (l.weekSeries ?? []).filter((p) => p.rm > 0);
    const atStart = input.startWeekKey ? [...series].reverse().find((p) => p.week <= input.startWeekKey!) ?? series[0] : series[0];
    const startKg = atStart?.rm ?? l.current1RMkg;
    // `current1RMkg` is the last session's e1RM, but start is a weekly best —
    // one light day put current under start and every lift read 0%. Measure
    // current the same way: the best week since the program started.
    const since = input.startWeekKey ? series.filter((p) => p.week >= input.startWeekKey!) : series.slice(-1);
    const currentKg = Math.max(l.current1RMkg, ...since.map((p) => p.rm));
    const key = LIFT_WORDS.find(([re]) => re.test(l.canonicalName))?.[1];
    const g = key ? parsed.get(key) : undefined;
    let targetKg: number;
    let reps = 'e1RM';
    let targetSource: OverviewLift['targetSource'] = 'projected';
    if (g) {
      targetKg = e1rmOf(toKg(g.value, g.unit), g.reps);
      if (g.reps && g.reps > 1) reps = `× ${g.reps}`;
      targetSource = 'goal';
    } else {
      // No number in the goal: a conservative projection, ~0.6% e1RM a week.
      targetKg = startKg * (1 + 0.006 * totalWeeks);
    }
    const start = displayLoad(startKg, input.unitPref);
    const current = displayLoad(currentKg, input.unitPref);
    // A rep target is shown at its working weight, not its 1RM equivalent.
    const shownTarget = g?.reps && g.reps > 1 ? g.value : displayLoad(targetKg, input.unitPref);
    const target = Math.max(shownTarget, start + (unit === 'kg' ? 2.5 : 5));
    // (current − start) / (target − start), on e1RM so a rep goal compares like with like.
    const raw = (currentKg - startKg) / Math.max(1e-6, targetKg - startKg);
    const pace: Pace = raw >= expected + 0.08 ? 'ahead' : raw < expected - 0.08 ? 'behind' : 'on';
    const progress = Math.round(Math.max(0, Math.min(1, raw)) * 1000) / 1000;
    return { name: l.canonicalName, start, current, target, reps, pace, progress, targetSource };
  });
  // Goal % = the mean, over lifts, of each lift's share of its start → target distance.
  const pct = lifts.length ? Math.round((lifts.reduce((s, l) => s + l.progress, 0) / lifts.length) * 100) : 0;
  return { text: goalText, lifts, pct };
}

// ─── Program ────────────────────────────────────────────────────────────────

function buildProgram(input: OverviewInput): TrainingOverview['program'] {
  const phases: any[] = input.program?.phases ?? [];
  if (!input.program) return null;
  let from = 1;
  const out: OverviewPhase[] = phases.map((p, i) => {
    const weeks = Number(p?.durationWeeks ?? p?.weeks ?? 1) || 1;
    const days: any[] = p?.trainingDays ?? p?.days ?? [];
    const ph: OverviewPhase = {
      name: phaseHead(String(p?.phaseName ?? p?.name ?? `Phase ${i + 1}`)),
      focus: phaseFocus(p),
      weeks,
      from,
      why: String(p?.rationale ?? p?.description ?? p?.focus ?? '').trim(),
      sessions: days.length ? `${days.length} a week` : '',
      effort: phaseEffort(p),
      focusLine: phaseFocusLine(p),
    };
    from += weeks;
    return ph;
  });
  return { week: input.weekNumber, totalWeeks: input.totalWeeks, currentPhase: Math.min(Math.max(0, input.phaseIndex), Math.max(0, out.length - 1)), phases: out };
}

// ─── Week ───────────────────────────────────────────────────────────────────

function buildWeek(input: OverviewInput): TrainingOverview['week'] {
  // Every load on the page is in the user's unit; for lb users the unit is implied and dropped.
  const unit = isKg(input.unitPref);
  const days: OverviewDay[] = input.weekDays.slice(0, 7).map((d, i) => {
    const s = d.session;
    const exercises: any[] = s?.exercises ?? [];
    const status: DayStatus = !s ? 'rest' : d.isLogged ? 'done' : d.isToday ? 'today' : 'planned';
    return {
      dow: DOW[i],
      date: String(d.date).slice(0, 10),
      name: s ? sessionTitle(s.day ?? s.name) : 'Rest',
      minutes: s ? sessionMinutes(s) : null,
      status,
      exercises: exercises.map((e) => ({ name: sentenceCase(exName(e)), spec: exerciseSpec(e, input.unitPref, { unit }) })),
    };
  });
  return { done: days.filter((d) => d.status === 'done').length, planned: days.filter((d) => d.status !== 'rest').length, days };
}

// ─── Archive ────────────────────────────────────────────────────────────────

function buildArchive(input: OverviewInput): TrainingOverview['archive'] {
  const programs: OverviewArchiveItem[] = [...input.completed]
    .sort((a, b) => ms(b.endDate) - ms(a.endDate))
    .map((c) => ({
      kind: 'program', id: c.id,
      title: c.goal || 'Program',
      sub: `${month(c.startDate)} – ${month(c.endDate)}${c.durationWeeks ? ` · ${c.durationWeeks} wk` : ''}`,
      value: c.reason === 'completed' ? 'Done' : 'Replaced',
    }));
  const diags = [
    ...input.formAnalyses.filter((f) => f.status !== 'failed').map((f) => ({
      at: ms(f.createdAt),
      item: {
        kind: 'diagnostic' as const, id: f.id, source: 'form' as const, done: f.status === 'complete',
        title: `${cap(f.exercise && f.exercise !== 'unknown' && f.exercise !== 'pending' ? f.exercise : 'Lift')} · form`,
        sub: day(f.createdAt),
        value: f.status === 'complete' ? (typeof f.formScore === 'number' ? `${Math.round(f.formScore)}` : 'Report') : '…',
      },
    })),
    ...input.liftDiagnostics.map((s) => ({
      at: ms(s.updatedAt),
      item: {
        kind: 'diagnostic' as const, id: s.id, source: 'lift' as const, flow: s.flow, done: s.status === 'complete',
        title: `${cap(String(s.lift).replace(/_/g, ' '))} · diagnostic`,
        sub: day(s.updatedAt),
        value: s.status === 'complete' ? 'Report' : 'Resume',
      },
    })),
  ].sort((a, b) => b.at - a.at).map((x) => x.item);
  const items = [...programs, ...diags];
  return { count: items.length, items };
}

export function buildTrainingOverview(input: OverviewInput): TrainingOverview {
  const unit: 'lb' | 'kg' = isKg(input.unitPref) ? 'kg' : 'lb';
  return {
    unit,
    goal: input.program ? buildGoal(input, unit) : { text: null, lifts: [], pct: 0 },
    program: buildProgram(input),
    week: buildWeek(input),
    archive: buildArchive(input),
  };
}

// ─── Program finished (v2 handoff T-09) ─────────────────────────────────────
// The Training tab is taken over the day the last session is logged: past the
// final week, or in it with nothing left to do this week. It stays until the
// user picks what's next (a new program replaces the saved one).

export function programFinished(p: { isComplete: boolean; weekNumber: number; totalWeeks: number; days: { status: DayStatus }[] }): boolean {
  if (p.totalWeeks <= 0) return false;
  if (p.isComplete) return true;
  if (p.weekNumber < p.totalWeeks) return false;
  const sessions = p.days.filter((d) => d.status !== 'rest');
  return sessions.length > 0 && sessions.every((d) => d.status === 'done');
}
