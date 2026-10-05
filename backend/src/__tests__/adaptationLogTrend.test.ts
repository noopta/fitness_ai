// Log-trend detectors, rules and the next-session suggestion — pure, with
// synthetic histories for every signal (Freestyle release, contracts 1 + 5).
import { describe, it, expect } from 'vitest';
import { buildExposures, makeKeyFn } from '../adaptation/history.js';
import {
  detectLiftSignal, detectSystemicFatigue, detectVolumeBalance, weeklySetsByMuscle, wellnessFlags,
} from '../adaptation/detectors.js';
import { planForSignal, buildLogTrendDrafts, variationFor } from '../adaptation/rules/logTrend.js';
import { computeSuggestion, pendingStale } from '../adaptation/suggestion.js';
import type { Exposure, PlannedExercise } from '../adaptation/types.js';

const NOW = new Date('2026-10-05T12:00:00Z');
const d = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * 86400000).toISOString().slice(0, 10);

type S = [number | null, number, number?]; // weightKg, reps, rpe
let seq = 0;
function ex(name: string, sets: S[]) {
  return { name, sets: sets.length, reps: String(sets[0][1]), setEntries: sets.map(([w, r, rpe]) => ({ weightKg: w, reps: r, rpe: rpe ?? null })) };
}
function workouts(sessions: Array<{ ago: number; ex: ReturnType<typeof ex>[] }>) {
  return sessions.map(s => ({ id: `w${++seq}`, date: d(s.ago), exercises: JSON.stringify(s.ex) }));
}
function exposures(sessions: Array<{ ago: number; ex: ReturnType<typeof ex>[] }>) {
  return buildExposures(workouts(sessions), makeKeyFn());
}
const sets = (n: number, w: number | null, r: number, rpe?: number): S[] => Array.from({ length: n }, () => [w, r, rpe] as S);
function one(name: string, rows: Array<[number, S[]]>): Exposure[] {
  const m = exposures(rows.map(([ago, s]) => ({ ago, ex: [ex(name, s)] })));
  return [...m.values()][0];
}

describe('detectLiftSignal', () => {
  it('needs ≥2 exposures — never a single session', () => {
    expect(detectLiftSignal(one('Bench Press', [[0, sets(3, 80, 8, 7)]]), NOW).kind).toBe('insufficient');
  });

  it('getting easier: same load × reps, RPE falling ≥1 over ≥2 weeks', () => {
    const s = detectLiftSignal(one('Bench Press', [[14, sets(3, 80, 8, 9)], [7, sets(3, 80, 8, 8)], [0, sets(3, 80, 8, 7.5)]]), NOW);
    expect(s.kind).toBe('easier');
    expect(s.rpeBased).toBe(true);
    expect(s.rpeDelta).toBe(-1.5);
    expect(s.confidence).toBeGreaterThan(0.8);
  });

  it('getting easier without RPE: more reps at the same load → lower confidence', () => {
    const s = detectLiftSignal(one('Dumbbell Bench Press', [[14, sets(3, 30, 8)], [7, sets(3, 30, 9)], [0, sets(3, 30, 10)]]), NOW);
    expect(s.kind).toBe('easier');
    expect(s.rpeBased).toBe(false);
    expect(s.repsDelta).toBe(2);
    expect(s.confidence).toBeLessThan(0.7);
  });

  it('three sessions inside a week is not "over ≥2 weeks"', () => {
    const s = detectLiftSignal(one('Bench Press', [[5, sets(3, 80, 8, 9)], [3, sets(3, 80, 8, 8)], [0, sets(3, 80, 8, 7.5)]]), NOW);
    expect(s.kind).not.toBe('easier');
  });

  it('steady: load × reps held at RPE 7–8', () => {
    const s = detectLiftSignal(one('Barbell Row', [[7, sets(3, 70, 8, 8)], [0, sets(3, 70, 8, 7.5)]]), NOW);
    expect(s.kind).toBe('steady');
    expect(s.chainLength).toBe(2);
  });

  it('plateau: weekly best flat ≥4 weeks with regular exposure', () => {
    const rows: Array<[number, S[]]> = [35, 28, 21, 14, 7, 0].map(a => [a, sets(3, 100, 5, 8)]);
    const s = detectLiftSignal(one('Back Squat', rows), NOW);
    expect(s.kind).toBe('plateau');
    expect(s.weeklySets).toBeLessThan(6);
    expect(s.spark.length).toBeGreaterThanOrEqual(4);
  });

  it('decline: weekly best falling 2–3 weeks, ≥3% under the peak', () => {
    const s = detectLiftSignal(one('Bench Press', [[21, sets(3, 100, 5)], [14, sets(3, 97.5, 5)], [7, sets(3, 95, 5)], [0, sets(3, 92.5, 5)]]), NOW);
    expect(s.kind).toBe('decline');
    expect(s.dropPct!).toBeGreaterThan(0.03);
    expect(s.rpeBased).toBe(false);
  });

  it('detraining: ≥14 days off then lower numbers — never plateau or decline', () => {
    const rows: Array<[number, S[]]> = [[51, sets(3, 140, 5)], [44, sets(3, 140, 5)], [37, sets(3, 140, 5)], [30, sets(3, 140, 5)], [0, sets(3, 120, 5)]];
    const s = detectLiftSignal(one('Back Squat', rows), NOW);
    expect(s.kind).toBe('detraining');
    expect(s.gapDays).toBe(30);
    expect(s.refLoadKg).toBe(140);
    expect(s.postGapSessions).toBe(1);
  });

  it('back at full strength after a gap → nothing to say (not plateau)', () => {
    const rows: Array<[number, S[]]> = [[51, sets(3, 140, 5)], [44, sets(3, 140, 5)], [37, sets(3, 140, 5)], [30, sets(3, 140, 5)], [0, sets(3, 140, 5)]];
    expect(detectLiftSignal(one('Back Squat', rows), NOW).kind).toBe('insufficient');
  });

  it('early fatigue: RPE rising ≥1 at the same load over 2+ weeks (not a decline)', () => {
    const s = detectLiftSignal(one('Bench Press', [[14, sets(3, 80, 8, 7)], [7, sets(3, 80, 8, 7.5)], [0, sets(3, 80, 8, 8.5)]]), NOW);
    expect(s.kind).toBe('early_fatigue');
    expect(s.rpeBased).toBe(true);
  });

  it('early fatigue: growing rep drop-off across sets', () => {
    const s = detectLiftSignal(one('Overhead Press', [
      [21, [[50, 8], [50, 8], [50, 8]]], [14, [[50, 8], [50, 8], [50, 8]]],
      [7, [[50, 9], [50, 7], [50, 6]]], [0, [[50, 9], [50, 7], [50, 5]]],
    ]), NOW);
    expect(s.kind).toBe('early_fatigue');
    expect(s.rpeBased).toBe(false);
  });
});

describe('cross-lift detectors', () => {
  const creep = (name: string, w: number) => [[14, sets(3, w, 8, 7)], [7, sets(3, w, 8, 7.5)], [0, sets(3, w, 8, 8.5)]] as Array<[number, S[]]>;
  const sigs = (names: Array<[string, number]>) => names.map(([n, w]) => detectLiftSignal(one(n, creep(n, w)), NOW));
  const poorSleep = [0, 2, 4, 6].map(a => ({ date: d(a), sleepHours: 5.5, stress: 4 }));

  it('systemic fatigue: ≥3 lifts at once', () => {
    const f = detectSystemicFatigue(sigs([['Bench Press', 80], ['Back Squat', 120], ['Barbell Row', 70]]), [], NOW);
    expect(f?.lifts.length).toBe(3);
  });
  it('systemic fatigue: 2 lifts + poor sleep; 2 lifts alone is single-lift territory', () => {
    const two = sigs([['Bench Press', 80], ['Back Squat', 120]]);
    expect(detectSystemicFatigue(two, [], NOW)).toBeNull();
    const f = detectSystemicFatigue(two, poorSleep, NOW);
    expect(f?.wellnessFlags[0]).toMatch(/sleep averaging 5.5/);
  });
  it('wellness flags need ≥3 check-ins and use the 1–10 stress scale', () => {
    expect(wellnessFlags(poorSleep.slice(0, 2), NOW)).toEqual([]);
    expect(wellnessFlags([0, 1, 2].map(a => ({ date: d(a), sleepHours: 8, stress: 8 })), NOW)[0]).toMatch(/stress/);
  });

  it('volume: low weekly sets for a major muscle → add; push ≫ pull → rebalance', () => {
    const rows = [20, 17, 13, 10, 6, 3].map(a => ({ ago: a, ex: [ex('Bench Press', sets(3, 80, 8))] }));
    const low = detectVolumeBalance(weeklySetsByMuscle(exposures(rows), NOW));
    expect(low[0]).toMatchObject({ muscle: 'chest', direction: 'add', suggestedSets: 10 });

    const skew = [20, 17, 13, 10, 6, 3].map(a => ({ ago: a, ex: [ex('Bench Press', sets(5, 80, 8)), ...(a % 2 ? [] : [ex('Barbell Row', sets(2, 60, 10))])] }));
    const f = detectVolumeBalance(weeklySetsByMuscle(exposures(skew), NOW));
    expect(f.some(x => x.direction === 'rebalance' && x.muscle === 'back')).toBe(true);
  });
  it('volume: under 2 weeks of history says nothing', () => {
    const rows = [6, 3, 0].map(a => ({ ago: a, ex: [ex('Bench Press', sets(3, 80, 8))] }));
    expect(weeklySetsByMuscle(exposures(rows), NOW)).toEqual([]);
  });
});

describe('planForSignal (rules)', () => {
  const easierBench = () => detectLiftSignal(one('Bench Press', [[14, sets(3, 80, 8, 9)], [7, sets(3, 80, 8, 8)], [0, sets(3, 80, 8, 7.5)]]), NOW);

  it('easier barbell → add_load by the smallest increment, citing progressive overload', () => {
    const p = planForSignal(easierBench(), 'metric');
    expect(p).toMatchObject({ action: 'add_load', toWeightKg: 82.5, reps: '8', sets: 3, worthy: true });
    expect(p.reasoning).toMatch(/Progressive overload/i);
    expect(p.note).toMatch(/82\.5 kg/);
  });
  it('uses the imperial step and label for imperial users', () => {
    const p = planForSignal(easierBench(), 'imperial');
    expect(p.note).toMatch(/lbs/);
    // 80 kg ≈ 176 lb → nearest 5 lb is 175, +5 lb step = 180 lb.
    expect(p.toWeightKg!).toBeCloseTo(180 * 0.45359237, 1);
  });
  it('easier dumbbell with +1 rep → add_rep (double progression); +2 reps → add_load', () => {
    const plus1 = detectLiftSignal(one('Dumbbell Bench Press', [[14, sets(3, 30, 8)], [7, sets(3, 30, 8)], [0, sets(3, 30, 9)]]), NOW);
    expect(planForSignal(plus1, 'metric')).toMatchObject({ action: 'add_rep', reps: '10', toWeightKg: 30 });
    const plus2 = detectLiftSignal(one('Dumbbell Bench Press', [[14, sets(3, 30, 8)], [7, sets(3, 30, 9)], [0, sets(3, 30, 10)]]), NOW);
    const p = planForSignal(plus2, 'metric');
    expect(p).toMatchObject({ action: 'add_load', toWeightKg: 32, reps: '8' });
    expect(p.reasoning).toMatch(/double progression/i);
  });

  it('plateau ladder: low volume → +2 sets', () => {
    const s = detectLiftSignal(one('Back Squat', [35, 28, 21, 14, 7, 0].map(a => [a, sets(3, 100, 5, 8)] as [number, S[]])), NOW);
    expect(planForSignal(s, 'metric')).toMatchObject({ action: 'add_set', sets: 5, strategy: 'volume', worthy: true });
  });
  it('plateau ladder: high volume + high RPE → deload', () => {
    const rows: Array<[number, S[]]> = [38, 35, 31, 28, 24, 21, 17, 14, 10, 7, 3, 0].map(a => [a, sets(5, 100, 5, 9)]);
    const s = detectLiftSignal(one('Back Squat', rows), NOW);
    expect(s.kind).toBe('plateau');
    const p = planForSignal(s, 'metric');
    expect(p.deload).toEqual({ reason: 'plateau_high_volume', volumeCutPct: 50 });
  });
  it('plateau ladder: mid volume → rep range, then frequency (if <1.5×/wk), then variation', () => {
    const rows: Array<[number, S[]]> = [35, 28, 21, 14, 7, 0].map(a => [a, sets(7, 100, 8, 8)]);
    const s = detectLiftSignal(one('Bench Press', rows), NOW);
    expect(s.kind).toBe('plateau');
    expect(planForSignal(s, 'metric', { plateauStep: 0 })).toMatchObject({ strategy: 'rep_range', reps: '4-6', action: 'add_load' });
    expect(planForSignal(s, 'metric', { plateauStep: 1 }).strategy).toBe('frequency');
    const v = planForSignal(s, 'metric', { plateauStep: 2 });
    expect(v.strategy).toBe('variation');
    expect(v.note).toMatch(/paused or close-grip/);
  });
  it('single-lift decline → reset ~10% and suggests a form check', () => {
    const s = detectLiftSignal(one('Bench Press', [[21, sets(3, 100, 5)], [14, sets(3, 97.5, 5)], [7, sets(3, 95, 5)], [0, sets(3, 92.5, 5)]]), NOW);
    const p = planForSignal(s, 'metric');
    expect(p).toMatchObject({ action: 'reset', toWeightKg: 82.5 });
    expect(p.reasoning).toMatch(/form check/);
  });
  it('detraining → resume ~90% of the old load, ramping', () => {
    const rows: Array<[number, S[]]> = [[51, sets(3, 140, 5)], [44, sets(3, 140, 5)], [37, sets(3, 140, 5)], [30, sets(3, 140, 5)], [0, sets(3, 120, 5)]];
    const p = planForSignal(detectLiftSignal(one('Back Squat', rows), NOW), 'metric');
    expect(p).toMatchObject({ action: 'resume', toWeightKg: 125, worthy: true });
    expect(p.reasoning).toMatch(/detraining/);
  });
  it('early fatigue → drop a set, keep the load', () => {
    const s = detectLiftSignal(one('Bench Press', [[14, sets(3, 80, 8, 7)], [7, sets(3, 80, 8, 7.5)], [0, sets(3, 80, 8, 8.5)]]), NOW);
    expect(planForSignal(s, 'metric')).toMatchObject({ action: 'drop_set', sets: 2, toWeightKg: 80 });
  });
  it('steady: building_strength → add_load; building_muscle → add_set; 2-session steady is sheet-only', () => {
    const steady3 = detectLiftSignal(one('Barbell Row', [[14, sets(3, 70, 8, 8)], [7, sets(3, 70, 8, 8)], [0, sets(3, 70, 8, 8)]]), NOW);
    expect(planForSignal(steady3, 'metric', { phase: 'building_strength' })).toMatchObject({ action: 'add_load', toWeightKg: 72.5, worthy: true });
    expect(planForSignal(steady3, 'metric', { phase: 'building_muscle' })).toMatchObject({ action: 'add_set', sets: 4, worthy: true });
    const steady2 = detectLiftSignal(one('Barbell Row', [[7, sets(3, 70, 8, 8)], [0, sets(3, 70, 8, 8)]]), NOW);
    expect(planForSignal(steady2, 'metric').worthy).toBe(false);
  });

  describe('phase-aware', () => {
    const plateau = () => detectLiftSignal(one('Back Squat', [35, 28, 21, 14, 7, 0].map(a => [a, sets(3, 100, 5, 8)] as [number, S[]])), NOW);
    it('cutting: flat strength is a win — positive hold, never a plateau push', () => {
      const p = planForSignal(plateau(), 'metric', { phase: 'cutting' });
      expect(p.action).toBe('hold');
      expect(p.worthy).toBe(true);
      expect(p.reasoning).toMatch(/keeping strength IS progress/);
    });
    it('cutting: no load increase unless clearly easier', () => {
      const weak = detectLiftSignal(one('Bench Press', [[14, sets(3, 80, 8)], [7, sets(3, 80, 8)], [0, sets(3, 80, 9)]]), NOW);
      expect(weak.kind).toBe('easier');
      expect(planForSignal(weak, 'metric', { phase: 'cutting' })).toMatchObject({ action: 'hold', worthy: false });
      expect(planForSignal(easierBench(), 'metric', { phase: 'cutting' }).action).toBe('add_load');
    });
    it('cut too aggressive: decline → hold (the calorie card carries it)', () => {
      const s = detectLiftSignal(one('Bench Press', [[21, sets(3, 100, 5)], [14, sets(3, 97.5, 5)], [7, sets(3, 95, 5)], [0, sets(3, 92.5, 5)]]), NOW);
      expect(planForSignal(s, 'metric', { phase: 'cut_too_aggressive' })).toMatchObject({ action: 'hold', worthy: false });
    });
    it('building muscle favours reps; rebuilding consistency only resumes', () => {
      expect(planForSignal(easierBench(), 'metric', { phase: 'building_muscle' }).action).toBe('add_rep');
      expect(planForSignal(easierBench(), 'metric', { phase: 'rebuilding_consistency' }).worthy).toBe(false);
    });
  });

  it('variationFor has a generic fallback', () => {
    expect(variationFor('Zercher Carry')).toMatch(/close variation/);
  });
});

describe('buildLogTrendDrafts', () => {
  const sessions = [
    { ago: 14, ex: [ex('Bench Press', sets(3, 80, 8, 9)), ex('Back Squat', sets(3, 120, 5, 7))] },
    { ago: 7, ex: [ex('Bench Press', sets(3, 80, 8, 8)), ex('Back Squat', sets(3, 120, 5, 7.5))] },
    { ago: 0, ex: [ex('Bench Press', sets(3, 80, 8, 7.5)), ex('Back Squat', sets(3, 120, 5, 8.5))] },
  ];
  const base = { unitPref: 'metric' as const, now: NOW, phase: 'unknown' as const, wellness: [] };

  it('per-lift drafts for the logged keys only, one per lift', () => {
    const m = exposures(sessions);
    const drafts = buildLogTrendDrafts({ ...base, exposuresByKey: m, keys: new Set(['bench press']) });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ kind: 'next_session', dedupeKey: 'lift:bench press' });
    expect((drafts[0].proposal as any)).toMatchObject({ action: 'add_load', fromWeightKg: 80, toWeightKg: 82.5, signal: 'easier' });
  });
  it('skipKeys (covered by double progression) are not double-proposed', () => {
    const drafts = buildLogTrendDrafts({ ...base, exposuresByKey: exposures(sessions), skipKeys: new Set(['bench press', 'squat']) });
    expect(drafts).toEqual([]);
  });
  it('systemic fatigue → one deload card covering the lifts, no per-lift cards for them', () => {
    const creep = [14, 7, 0].map((a, i) => ({ ago: a, ex: ['Bench Press', 'Back Squat', 'Barbell Row'].map((n, j) => ex(n, sets(3, 60 + j * 20, 8, 7 + i * 0.75))) }));
    const drafts = buildLogTrendDrafts({ ...base, exposuresByKey: exposures(creep) });
    expect(drafts[0]).toMatchObject({ kind: 'deload', dedupeKey: 'deload:systemic', priority: 90 });
    expect((drafts[0].proposal as any)).toMatchObject({ reason: 'systemic_fatigue', volumeCutPct: 40, weeks: 1 });
    expect((drafts[0].proposal as any).keys.sort()).toEqual(['barbell row', 'bench press', 'squat']);
    expect(drafts.filter(d => d.kind === 'next_session')).toEqual([]);
  });
  it('weekly mode: liftKinds limits to plateau; volume adds one volume_balance card', () => {
    const rows = [20, 17, 13, 10, 6, 3].map(a => ({ ago: a, ex: [ex('Bench Press', sets(3, 80, 8))] }));
    const drafts = buildLogTrendDrafts({ ...base, exposuresByKey: exposures(rows), liftKinds: new Set(['plateau']), volume: true });
    expect(drafts.map(d => d.kind)).toEqual(['volume_balance']);
    expect(drafts[0].proposal).toMatchObject({ muscle: 'chest', direction: 'add' });
  });
});

describe('computeSuggestion (contract 1)', () => {
  const benchList = () => one('Bench Press', [[14, sets(3, 80, 8, 9)], [7, sets(3, 80, 8, 8)], [0, sets(3, 80, 8, 7.5)]]);
  const base = { key: 'bench press', name: 'Bench Press', planned: null, applied: [], pending: [], unitPref: 'metric' as const, phase: 'unknown' as const, now: NOW };
  const planned: PlannedExercise = { key: 'bench press', exercise: 'Bench Press', sets: 4, repRange: { min: 6, max: 8 }, repsRaw: '6-8', targetRPE: 8, targetWeightKg: 85, locations: [] };
  const appliedRow = (over: any = {}) => ({
    id: 'a1', kind: 'next_session', dedupeKey: 'lift:bench press', status: 'applied', decidedAt: new Date(NOW.getTime() - 86400000),
    proposal: { kind: 'next_session', key: 'bench press', exercise: 'Bench Press', action: 'add_load', fromWeightKg: 80, toWeightKg: 82.5, reps: '8', sets: 3, rpe: 8, note: 'Try 82.5 kg', ...over },
  });

  it('null with < 2 exposures', () => {
    expect(computeSuggestion({ ...base, exposures: benchList().slice(0, 1) })).toBeNull();
  });
  it('program target wins', () => {
    const s = computeSuggestion({ ...base, exposures: benchList(), planned, applied: [appliedRow() as any] })!;
    expect(s).toMatchObject({ basis: 'program_target', weightKg: 85, reps: '6-8', sets: 4, action: 'add_load' });
  });
  it('then the latest applied next_session', () => {
    const s = computeSuggestion({ ...base, exposures: benchList(), applied: [appliedRow() as any] })!;
    expect(s).toMatchObject({ basis: 'applied_target', weightKg: 82.5, action: 'add_load', note: 'Try 82.5 kg' });
  });
  it('an applied target older than 21 days, or already reached, falls back to the trend', () => {
    const old = appliedRow(); old.decidedAt = new Date(NOW.getTime() - 25 * 86400000);
    expect(computeSuggestion({ ...base, exposures: benchList(), applied: [old as any] })!.basis).toBe('trend');
    const reached = appliedRow({ toWeightKg: 80 }); reached.decidedAt = new Date(NOW.getTime() - 3 * 86400000);
    expect(computeSuggestion({ ...base, exposures: benchList(), applied: [reached as any] })!.basis).toBe('trend');
  });
  it('trend-derived otherwise — same numbers as the card would carry', () => {
    const s = computeSuggestion({ ...base, exposures: benchList() })!;
    expect(s).toMatchObject({ basis: 'trend', action: 'add_load', weightKg: 82.5, proposalId: null });
    expect(s.note).toMatch(/felt easier at 80 kg × 8 — try 82\.5 kg/);
  });
  it('a pending card backs the suggestion verbatim', () => {
    const pending = { ...appliedRow({ toWeightKg: 85, note: 'pending note' }), id: 'p9', status: 'pending', decidedAt: null };
    expect(computeSuggestion({ ...base, exposures: benchList(), pending: [pending as any] })).toMatchObject({ proposalId: 'p9', weightKg: 85, note: 'pending note' });
  });
  it('a pending card goes stale once a later session of the lift is logged, or after 14 days', () => {
    const card = (createdAgoDays: number) => ({ ...appliedRow({ toWeightKg: 85, note: 'pending note' }), id: 'p9', status: 'pending', decidedAt: null, createdAt: new Date(NOW.getTime() - createdAgoDays * 86400000) });
    // Created 3 days ago; bench was logged today → stale, the trend wins.
    expect(computeSuggestion({ ...base, exposures: benchList(), pending: [card(3) as any] })).toMatchObject({ basis: 'trend', weightKg: 82.5, proposalId: null });
    // Created today (by today's session) → still current, used verbatim.
    expect(computeSuggestion({ ...base, exposures: benchList(), pending: [card(0) as any] })).toMatchObject({ proposalId: 'p9', weightKg: 85 });
    // Older than 14 days even with no later session → stale.
    const quiet = one('Bench Press', [[30, sets(3, 80, 8, 8)], [20, sets(3, 80, 8, 8)]]);
    expect(pendingStale(new Date(NOW.getTime() - 15 * 86400000), quiet, NOW)).toBe(true);
    expect(pendingStale(new Date(NOW.getTime() - 13 * 86400000), quiet, NOW)).toBe(false);
    // A stale card no longer lends its id to a program-target suggestion either.
    expect(computeSuggestion({ ...base, exposures: benchList(), planned, pending: [card(3) as any] })!.proposalId).toBeNull();
  });
  it("judges 'later' and 'today' on the user's local calendar", () => {
    // Card created 23:30 on Oct 4 in New York (03:30 UTC Oct 5); a session
    // logged Oct 5 (local) is the next day — the UTC date calls it the same day.
    const created = new Date('2026-10-05T03:30:00Z');
    const list = one('Bench Press', [[7, sets(3, 80, 8)], [0, sets(3, 80, 8)]]); // d(0) = 2026-10-05
    expect(pendingStale(created, list, NOW)).toBe(false);
    expect(pendingStale(created, list, NOW, (x) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(x))).toBe(true);
    // Resume gap: 14 days by the UTC date, 13 by a local today one day behind.
    const away = one('Bench Press', [[27, sets(3, 100, 5)], [14, sets(3, 100, 5)]]);
    expect(computeSuggestion({ ...base, exposures: away })!.action).toBe('resume');
    expect(computeSuggestion({ ...base, exposures: away, today: d(1) })!.action).not.toBe('resume');
  });
  it('an applied deload (7 days) turns it into a deload session — same weight, fewer sets', () => {
    const deload = { id: 'd1', kind: 'deload', dedupeKey: 'deload:systemic', status: 'applied', decidedAt: new Date(NOW.getTime() - 2 * 86400000), proposal: { kind: 'deload', keys: ['bench press'], exercises: ['Bench Press'], volumeCutPct: 50, weeks: 1, reason: 'systemic_fatigue' } };
    const s = computeSuggestion({ ...base, exposures: benchList(), applied: [deload as any] })!;
    expect(s).toMatchObject({ action: 'deload', sets: 2, weightKg: 82.5 });
  });
  it('after ≥14 days away → resume at ~90%', () => {
    const list = one('Bench Press', [[30, sets(3, 100, 5)], [20, sets(3, 100, 5)]]);
    expect(computeSuggestion({ ...base, exposures: list })).toMatchObject({ action: 'resume', weightKg: 90, basis: 'trend' });
  });
  it('accepted volume_balance adds a set for that muscle', () => {
    const list = one('Bench Press', [[7, sets(3, 80, 8)], [0, sets(3, 80, 8)]]);
    const vb = { id: 'v1', kind: 'volume_balance', dedupeKey: 'volume:chest:add', status: 'applied', decidedAt: new Date(NOW.getTime() - 86400000), proposal: { kind: 'volume_balance', muscle: 'chest', currentSets: 6, suggestedSets: 10, direction: 'add', note: '' } };
    const s = computeSuggestion({ ...base, exposures: list, applied: [vb as any] })!;
    expect(s).toMatchObject({ action: 'add_set', sets: 4 });
  });
});
