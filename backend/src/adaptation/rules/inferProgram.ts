// Rule: Cohort C — infer the program a lifter has *actually* been running from
// their logs, and propose formalizing it so Axiom can progress it.
//
// "Here's the program you've been running. Want us to make it official?"
// Pure. Reads exposures over a trailing window, labels each session by the
// muscle categories it trained, groups sessions into day types, keeps the
// exercises that recur, and seeds a target per lift from the loads used.
// The user decides; nothing is saved here.

import { canonicalizeSync } from '../../services/exerciseCanonical.js';
import { classifyMuscleGroups } from '../../services/weekRebalance.js';
import { isoWeekKey } from '../../services/muscleLedgerService.js';
import { seedTargetFromExposures } from '../targets.js';
import { formatWeight, type UnitPreference } from '../../services/weightUnits.js';
import type { AdaptationContext, Exposure, ProposalDraft } from '../types.js';

export type SessionLabel = 'push' | 'pull' | 'legs' | 'upper' | 'lower' | 'full';

const WINDOW_WEEKS = 8;
const MIN_SESSIONS = 6;
const MIN_WEEKS = 3;
const RECURRENCE = 0.4;       // an exercise must appear in ≥40% of a day type's sessions
const MAX_EXERCISES_PER_DAY = 8;

const FOCUS: Record<SessionLabel, string> = {
  push: 'Chest · shoulders · triceps',
  pull: 'Back · biceps · rear delts',
  legs: 'Quads · hamstrings · glutes',
  upper: 'Upper body',
  lower: 'Lower body',
  full: 'Full body',
};
const DAY_NAME: Record<SessionLabel, string> = {
  push: 'Push', pull: 'Pull', legs: 'Legs', upper: 'Upper', lower: 'Lower', full: 'Full Body',
};

interface SessionView {
  workoutId: string;
  date: string;
  exercises: Exposure[];
  label: SessionLabel;
}

function categoryOf(name: string): 'push' | 'pull' | 'legs' | 'core' | 'upper' | 'lower' | 'unknown' {
  const c = canonicalizeSync(name)?.category;
  if (c === 'hinge') return 'legs';
  if (c) return c;
  const g = classifyMuscleGroups(name);
  if (g.has('upper') && !g.has('lower')) return 'upper';
  if (g.has('lower') && !g.has('upper')) return 'lower';
  return 'unknown';
}

/** Label one session by the share of its exercises per category. */
export function labelSession(names: string[]): SessionLabel {
  let push = 0, pull = 0, legs = 0, n = 0;
  for (const name of names) {
    const c = categoryOf(name);
    if (c === 'core' || c === 'unknown') continue;
    n += 1;
    if (c === 'push') push += 1;
    else if (c === 'pull') pull += 1;
    else if (c === 'legs' || c === 'lower') legs += 1;
    else if (c === 'upper') { push += 0.5; pull += 0.5; }
  }
  if (n === 0) return 'full';
  const p = push / n, q = pull / n, l = legs / n;
  if (l >= 0.6) return 'legs';
  if (p >= 0.6) return 'push';
  if (q >= 0.6) return 'pull';
  if (l <= 0.25 && p + q >= 0.7) return 'upper';
  if (l >= 0.5 && p + q <= 0.4) return 'lower';
  return 'full';
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : s[m - 1];
}
function mode(xs: number[]): number {
  const counts = new Map<number, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  let best = xs[0] ?? 0, bestN = 0;
  for (const [v, c] of counts) if (c > bestN || (c === bestN && v > best)) { best = v; bestN = c; }
  return best;
}

function isoDateDaysAgo(now: Date, days: number): string {
  const d = new Date(now.getTime() - days * 86400000);
  return d.toISOString().slice(0, 10);
}

export function splitName(labels: SessionLabel[]): string {
  const set = new Set(labels);
  if (set.has('push') && set.has('pull') && set.has('legs')) return 'Push / Pull / Legs';
  if (set.has('upper') && set.has('lower')) return 'Upper / Lower';
  if (set.size === 1 && set.has('full')) return 'Full body';
  return [...set].map(l => DAY_NAME[l]).join(' / ');
}

export interface ObservedDay {
  label: SessionLabel;
  day: string;
  sessions: number;
  exercises: Array<{ exercise: string; sets: number; reps: number; weightKg: number | null; frequency: number }>;
}

export interface InferredProgram {
  program: any;
  observed: {
    windowWeeks: number;
    sessions: number;
    weeks: number;
    sessionsPerWeek: number;
    split: string;
    goal: string;
    medianReps: number;
    days: ObservedDay[];
  };
  confidence: number;
}

/**
 * Build the program a lifter has been running from their trailing-window
 * exposures. Null when there isn't enough loaded history to say anything.
 */
export function inferProgramFromContext(ctx: AdaptationContext): InferredProgram | null {
  const cutoff = isoDateDaysAgo(ctx.now, WINDOW_WEEKS * 7);
  const byWorkout = new Map<string, SessionView>();
  for (const list of ctx.exposuresByKey.values()) {
    for (const e of list) {
      if (e.date < cutoff) continue;
      const s = byWorkout.get(e.workoutId) ?? { workoutId: e.workoutId, date: e.date, exercises: [], label: 'full' as SessionLabel };
      s.exercises.push(e);
      byWorkout.set(e.workoutId, s);
    }
  }
  const sessions = [...byWorkout.values()].filter(s => s.exercises.some(e => e.e1rmKg > 0));
  const weeks = new Set(sessions.map(s => isoWeekKey(s.date))).size;
  if (sessions.length < MIN_SESSIONS || weeks < MIN_WEEKS) return null;

  for (const s of sessions) s.label = labelSession(s.exercises.map(e => e.displayName));
  const sessionsPerWeek = Math.max(2, Math.min(6, Math.round(sessions.length / weeks)));

  // Group by label, most frequent first; keep types seen at least twice.
  const groups = new Map<SessionLabel, SessionView[]>();
  for (const s of sessions) groups.set(s.label, [...(groups.get(s.label) ?? []), s]);
  let dayTypes = [...groups.entries()].filter(([, v]) => v.length >= 2).sort((a, b) => b[1].length - a[1].length);
  if (dayTypes.length === 0) dayTypes = [[sessions[0].label, sessions]];
  dayTypes = dayTypes.slice(0, sessionsPerWeek);

  const pref: UnitPreference = ctx.unitPref;
  const allTopReps: number[] = [];
  const observedDays: ObservedDay[] = [];
  const confidences: number[] = [];

  for (const [label, views] of dayTypes) {
    // Exercise recurrence within this day type.
    const perKey = new Map<string, { name: string; count: number; sets: number[]; reps: number[]; weights: number[]; exposures: Exposure[] }>();
    for (const v of views) {
      const seen = new Set<string>();
      for (const e of v.exercises) {
        if (seen.has(e.key)) continue;
        seen.add(e.key);
        const rec = perKey.get(e.key) ?? { name: e.displayName, count: 0, sets: [], reps: [], weights: [], exposures: [] };
        rec.count += 1;
        rec.sets.push(e.sets.length);
        if (e.top) { rec.reps.push(e.top.reps); if (e.top.weightKg != null) rec.weights.push(e.top.weightKg); }
        rec.exposures.push(e);
        // Prefer the most recent spelling as the display name.
        if (e.date >= (rec.exposures[0]?.date ?? '')) rec.name = e.displayName;
        perKey.set(e.key, rec);
      }
    }
    const kept = [...perKey.entries()]
      .filter(([, r]) => r.count >= Math.max(1, Math.ceil(views.length * RECURRENCE)))
      .sort((a, b) => {
        const ca = canonicalizeSync(a[1].name)?.isCompound ? 1 : 0;
        const cb = canonicalizeSync(b[1].name)?.isCompound ? 1 : 0;
        return (b[1].count - a[1].count) || (cb - ca);
      })
      .slice(0, MAX_EXERCISES_PER_DAY);
    if (kept.length === 0) continue;

    const exercises: ObservedDay['exercises'] = [];
    const planned: any[] = [];
    for (const [, r] of kept) {
      const sets = Math.max(1, Math.round(median(r.sets)));
      const reps = r.reps.length ? mode(r.reps) : 8;
      allTopReps.push(...r.reps);
      const loaded = r.exposures.filter(e => e.top && e.e1rmKg > 0).sort((a, b) => (a.date < b.date ? 1 : -1));
      const seed = loaded.length ? seedTargetFromExposures(loaded, { min: reps, max: reps }, 8, r.name, pref) : null;
      if (seed) confidences.push(seed.confidence);
      exercises.push({ exercise: r.name, sets, reps, weightKg: seed?.targetWeightKg ?? null, frequency: Math.round((r.count / views.length) * 100) / 100 });
      planned.push({
        exercise: r.name,
        sets,
        reps: String(reps),
        intensity: 'RPE 8',
        targetRPE: 8,
        ...(seed ? { targetWeightKg: seed.targetWeightKg, targetConfidence: seed.confidence, targetBasis: seed.basis, targetSetAt: ctx.now.toISOString() } : {}),
      });
    }
    observedDays.push({ label, day: DAY_NAME[label], sessions: views.length, exercises });
    (observedDays[observedDays.length - 1] as any)._planned = planned;
  }
  if (observedDays.length === 0) return null;

  const medianReps = Math.round(median(allTopReps)) || 8;
  const goal = medianReps <= 5 ? 'strength' : medianReps <= 12 ? 'hypertrophy' : 'muscular endurance';
  const split = splitName(observedDays.map(d => d.label));

  // Fill the week: cycle day types until we have sessionsPerWeek training days.
  const trainingDays: any[] = [];
  const nameCount = new Map<string, number>();
  for (let i = 0; i < sessionsPerWeek; i++) {
    const src = observedDays[i % observedDays.length];
    const n = (nameCount.get(src.day) ?? 0) + 1;
    nameCount.set(src.day, n);
    const suffix = observedDays.length < sessionsPerWeek ? ` ${String.fromCharCode(64 + n)}` : '';
    trainingDays.push({
      day: `${src.day}${suffix}`,
      focus: FOCUS[src.label],
      warmup: ['5 min easy cardio', 'Movement prep for the first lift', '2 ramp-up sets'],
      exercises: JSON.parse(JSON.stringify((src as any)._planned)),
      cooldown: ['Stretch the muscles trained', '2 min easy breathing'],
    });
  }
  for (const d of observedDays) delete (d as any)._planned;

  const confidence = confidences.length ? Math.round((confidences.reduce((s, c) => s + c, 0) / confidences.length) * 100) / 100 : 0.5;
  const program = {
    goal,
    daysPerWeek: sessionsPerWeek,
    durationWeeks: 8,
    inferredFromLogs: true,
    inferredAt: ctx.now.toISOString(),
    phases: [{
      phaseNumber: 1,
      phaseName: 'Your current split',
      rationale: `Built from the ${sessions.length} sessions you logged over the last ${weeks} weeks — same days, same lifts, with targets set from the loads you actually used.`,
      durationWeeks: 8,
      weeksLabel: 'Weeks 1–8',
      trainingDays,
      progressionNotes: ['Add reps until every set hits the target, then add load', 'Axiom will propose each step — nothing changes without your OK'],
      deloadProtocol: 'Every 5th week: cut sets by 40%, keep the load.',
    }],
    autoregulationRules: ['Energy under 5/10: drop one set per exercise', 'RPE 9+ on a working set: hold the load next session'],
    trackingMetrics: ['Weight, reps and RPE per set', 'Which sets hit the top of the range'],
  };

  return {
    program,
    observed: { windowWeeks: WINDOW_WEEKS, sessions: sessions.length, weeks, sessionsPerWeek, split, goal, medianReps, days: observedDays },
    confidence,
  };
}

export function buildInferredProgramProposal(ctx: AdaptationContext, reason: 'no_program' | 'abandoned'): ProposalDraft | null {
  const inferred = inferProgramFromContext(ctx);
  if (!inferred) return null;
  const { observed } = inferred;
  const pref = ctx.unitPref;
  const fmt = (kg: number | null) => (kg == null ? '—' : formatWeight(kg, pref, pref === 'metric' ? 1 : 0) ?? '—');
  const evidence = [
    { label: `Workouts in the last ${observed.windowWeeks} weeks`, value: `${observed.sessions} across ${observed.weeks} weeks` },
    { label: 'Sessions per week', value: `${observed.sessionsPerWeek}` },
    { label: 'Split you\'ve been running', value: observed.split },
    { label: 'Typical top-set reps', value: `${observed.medianReps} → ${observed.goal}` },
    ...observed.days.slice(0, 3).map(d => ({
      label: `${d.day} (${d.sessions}×)`,
      value: d.exercises.slice(0, 3).map(e => `${e.exercise} ${fmt(e.weightKg)}`).join(', ') + (d.exercises.length > 3 ? '…' : ''),
    })),
  ];
  const opener = reason === 'abandoned'
    ? 'Your logged sessions haven\'t matched your saved program for a few weeks — that\'s fine, the training you\'re actually doing is what matters.'
    : 'You\'ve been training without a program on file.';
  const reasoning = `${opener} Here's the program your logs describe: ${observed.split}, ${observed.sessionsPerWeek}×/week, built from the lifts you keep coming back to, with targets set from the loads you've been using. Making it official doesn't change what you do — it lets Axiom notice when you're ahead, behind, or stuck, and propose the next step. Ask the coach if you'd rather build something different.`;
  return {
    kind: 'program_from_logs',
    dedupeKey: 'program_from_logs',
    title: reason === 'abandoned' ? 'Here\'s the program you\'ve actually been running' : 'Here\'s the program your training describes',
    evidence,
    reasoning,
    proposal: { kind: 'program_from_logs', program: inferred.program, observed, reason },
    confidence: inferred.confidence,
    priority: 95,
  };
}

/** True when the lifter has a program but their recent sessions don't use it. */
export function programLooksAbandoned(ctx: AdaptationContext, minSessions = 3, windowDays = 21, maxOverlap = 0.3): boolean {
  if (!ctx.program || ctx.planned.length === 0) return false;
  const cutoff = isoDateDaysAgo(ctx.now, windowDays);
  const plannedKeys = new Set(ctx.planned.map(p => p.key));
  const byWorkout = new Map<string, Set<string>>();
  for (const [key, list] of ctx.exposuresByKey) {
    for (const e of list) {
      if (e.date < cutoff || e.e1rmKg <= 0) continue;
      byWorkout.set(e.workoutId, (byWorkout.get(e.workoutId) ?? new Set()).add(key));
    }
  }
  if (byWorkout.size < minSessions) return false;
  let matched = 0, total = 0;
  for (const keys of byWorkout.values()) for (const k of keys) { total += 1; if (plannedKeys.has(k)) matched += 1; }
  return total > 0 && matched / total < maxOverlap;
}
