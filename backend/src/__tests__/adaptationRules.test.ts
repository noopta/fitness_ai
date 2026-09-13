// Engine rules: double progression + retrofit. Pure fixtures, no DB.
import { describe, it, expect } from 'vitest';
import { doubleProgressionRule } from '../adaptation/rules/doubleProgression.js';
import { buildRetrofitProposal, classifyTrend } from '../adaptation/rules/retrofit.js';
import { runPostWorkoutRules, runBootstrapRules } from '../adaptation/engine.js';
import { scoreExposure } from '../adaptation/score.js';
import { buildExposures, makeKeyFn } from '../adaptation/history.js';
import { extractPlannedExercises } from '../adaptation/targets.js';
import type { AdaptationContext, Exposure, PlannedExercise } from '../adaptation/types.js';

function exp(date: string, weightKg: number, reps: number[], rpe: number | null = null, key = 'bench press'): Exposure {
  const sets = reps.map(r => ({ weightKg, reps: r, rpe }));
  const topReps = Math.max(...reps);
  const eff = Math.min(topReps + (rpe != null ? 10 - rpe : topReps <= 5 ? 2 : topReps <= 10 ? 2.5 : 3), 12);
  return {
    key, displayName: key, date, workoutId: 'w' + date, sets, top: { weightKg, reps: topReps, rpe },
    minReps: Math.min(...reps), maxWeightKg: weightKg, e1rmKg: Math.round(weightKg * (1 + eff / 30)),
    confidence: rpe != null ? 0.9 : 0.6, rpeLogged: rpe != null, programDayRef: null,
  };
}

const bench: PlannedExercise = {
  key: 'bench press', exercise: 'Bench Press', sets: 3, repRange: { min: 6, max: 8 }, repsRaw: '6-8',
  targetRPE: 8, targetWeightKg: 80, locations: [{ phaseIndex: 0, dayIndex: 0, day: 'Upper A' }],
};

describe('scoreExposure', () => {
  it('exceeded when every set tops the range at/above target without grinding', () => {
    expect(scoreExposure(bench, exp('2026-08-20', 80, [8, 8, 8])).result).toBe('exceeded');
    expect(scoreExposure(bench, exp('2026-08-20', 82.5, [8, 8, 8], 7)).result).toBe('exceeded');
  });
  it('hit when in range but not all at the top, or when grinding at RPE ≥ target+1', () => {
    expect(scoreExposure(bench, exp('2026-08-20', 80, [8, 7, 6])).result).toBe('hit');
    const grinding = scoreExposure(bench, exp('2026-08-20', 80, [8, 8, 8], 9.5));
    expect(grinding.result).toBe('hit');
    expect(grinding.rpeDelta).toBe(1.5);
  });
  it('missed below range or below target load', () => {
    expect(scoreExposure(bench, exp('2026-08-20', 80, [8, 5, 5])).result).toBe('missed');
    expect(scoreExposure(bench, exp('2026-08-20', 75, [8, 8, 8])).result).toBe('missed');
  });
  it('unloaded when nothing has weight', () => {
    const e = exp('2026-08-20', 0, [15]); e.top = null; e.sets = e.sets.map(s => ({ ...s, weightKg: null }));
    expect(scoreExposure(bench, e).result).toBe('unloaded');
  });
});

describe('doubleProgressionRule', () => {
  it('fires after two consecutive topped sessions at the target load (no RPE → confidence 0.65)', () => {
    const d = doubleProgressionRule(bench, [exp('2026-08-20', 80, [8, 8, 8]), exp('2026-08-15', 80, [8, 8, 8]), exp('2026-08-10', 80, [7, 7, 6])], 'metric')!;
    expect(d).not.toBeNull();
    expect(d.kind).toBe('load_change');
    expect(d.dedupeKey).toBe('load_change:bench press');
    expect(d.proposal).toMatchObject({ kind: 'load_change', fromWeightKg: 80, toWeightKg: 82.5 });
    expect(d.confidence).toBe(0.65);
    expect(d.evidence.some(e => e.label === 'Program target')).toBe(true);
    expect(d.reasoning).toMatch(/reps first, then load/);
  });
  it('is more confident with RPE logged on both sessions', () => {
    const d = doubleProgressionRule(bench, [exp('2026-08-20', 80, [8, 8, 8], 7), exp('2026-08-15', 80, [8, 8, 8], 7)], 'metric')!;
    expect(d.confidence).toBe(0.9);
    expect(d.reasoning).toMatch(/RPE 7 and 7/);
  });
  it('does NOT fire on one session, on a grinding session, on a below-target load, or on mixed loads', () => {
    expect(doubleProgressionRule(bench, [exp('2026-08-20', 80, [8, 8, 8])], 'metric')).toBeNull();
    expect(doubleProgressionRule(bench, [exp('2026-08-20', 80, [8, 8, 8], 9.5), exp('2026-08-15', 80, [8, 8, 8])], 'metric')).toBeNull();
    expect(doubleProgressionRule(bench, [exp('2026-08-20', 77.5, [8, 8, 8]), exp('2026-08-15', 77.5, [8, 8, 8])], 'metric')).toBeNull();
    expect(doubleProgressionRule({ ...bench, targetWeightKg: null }, [exp('2026-08-20', 82.5, [8, 8, 8]), exp('2026-08-15', 80, [8, 8, 8])], 'metric')).toBeNull();
  });
  it('without a program target, progresses from the load actually used', () => {
    const d = doubleProgressionRule({ ...bench, targetWeightKg: null }, [exp('2026-08-20', 85, [8, 8, 8]), exp('2026-08-15', 85, [8, 8, 8])], 'metric')!;
    expect(d.proposal).toMatchObject({ fromWeightKg: 85, toWeightKg: 87.5 });
  });
  it('imperial users get a 5 lb step', () => {
    const d = doubleProgressionRule(bench, [exp('2026-08-20', 80, [8, 8, 8]), exp('2026-08-15', 80, [8, 8, 8])], 'imperial')!;
    const p: any = d.proposal;
    expect(Math.round(p.toWeightKg / 0.45359237)).toBe(180);
  });
});

describe('classifyTrend', () => {
  it('needs 4 weekly points; classifies by relative slope', () => {
    expect(classifyTrend([100, 101, 102]).trend).toBe('insufficient');
    expect(classifyTrend([100, 101, 102, 103, 104, 105]).trend).toBe('progressing');
    expect(classifyTrend([100, 100, 100.5, 100, 100, 100]).trend).toBe('plateau');
    expect(classifyTrend([100, 99, 98, 97, 96]).trend).toBe('declining');
  });
});

function ctxFrom(program: any, workouts: Array<{ id: string; date: string; exercises: any[] }>, unitPref: 'metric' | 'imperial' = 'metric'): AdaptationContext {
  const keyFn = makeKeyFn();
  return {
    userId: 'u1', program, unitPref,
    planned: extractPlannedExercises(program, keyFn),
    exposuresByKey: buildExposures(workouts.map(w => ({ ...w, exercises: JSON.stringify(w.exercises) })), keyFn),
    workoutCount: workouts.length, firstWorkoutDate: workouts[0]?.date ?? null, now: new Date('2026-08-26T12:00:00Z'),
  };
}

const program = () => ({
  goal: 'strength',
  phases: [{ trainingDays: [
    { day: 'Upper A', exercises: [{ exercise: 'Bench Press', sets: 3, reps: '6-8', intensity: 'RPE 8' }, { exercise: 'Overhead Press', sets: 3, reps: '8', intensity: 'RPE 7' }] },
    { day: 'Lower', exercises: [{ exercise: 'Back Squat', sets: 4, reps: '5', intensity: 'RPE 8' }, { exercise: 'Romanian Deadlift', sets: 3, reps: '8-10', intensity: 'RPE 7' }] },
  ] }],
});

function weeks(n: number, start = '2026-05-04'): string[] {
  const out: string[] = [];
  const d = new Date(start + 'T00:00:00Z');
  for (let i = 0; i < n; i++) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 7); }
  return out;
}

describe('buildRetrofitProposal', () => {
  it('classifies each program lift from history: plateau / progressing / ready_to_bump / calibrate', () => {
    const ws = weeks(8).map((date, i) => ({
      id: 'w' + i, date,
      exercises: [
        { name: 'bench press', sets: 3, reps: '7', weightKg: 80 },                       // flat 8 weeks, in-range but not topped → plateau
        { name: 'Back Squat', sets: 4, reps: '5', weightKg: 100 + i * 2.5 },             // climbing → progressing
        { name: 'RDL', sets: 3, reps: '10', weightKg: 90, setEntries: [{ weightKg: 90, reps: 10 }, { weightKg: 90, reps: 10 }, { weightKg: 90, reps: 10 }] }, // topped → ready_to_bump
      ],
    }));
    const ctx = ctxFrom(program(), ws);
    const d = buildRetrofitProposal(ctx)!;
    expect(d.kind).toBe('retrofit');
    expect(d.title).toBe('We looked back at your 8 workouts since May');
    const p: any = d.proposal;
    const byKey = Object.fromEntries(p.targets.map((t: any) => [t.key, t]));
    expect(byKey['bench press'].finding).toBe('plateau');
    expect(byKey['bench press'].targetWeightKg).toBe(80);
    expect(byKey['squat'].finding).toBe('progressing'); // seed canonicalizes "Back Squat" → "Squat"
    expect(byKey['squat'].targetWeightKg).toBeGreaterThanOrEqual(110);
    expect(byKey['romanian deadlift'].finding).toBe('ready_to_bump');
    expect(byKey['overhead press'].finding).toBe('calibrate');
    expect(byKey['overhead press'].targetWeightKg).toBeNull();
    expect(d.evidence.find(e => e.label === 'Lifts matched to your program')!.value).toBe('3 of 4');
    expect(d.reasoning).toMatch(/1 lift is ready for more weight/);
    expect(d.reasoning).toMatch(/1 has stalled/);
    expect(d.reasoning).toMatch(/Logging RPE/);
    expect(d.confidence).toBeGreaterThan(0.5);
    expect(d.confidence).toBeLessThan(0.7);
  });
  it('returns null below 3 loaded sessions — a thin history never earns a card', () => {
    const two = weeks(2).map((date, i) => ({ id: 'w' + i, date, exercises: [{ name: 'Bench Press', sets: 3, reps: '8', weightKg: 80 }] }));
    expect(buildRetrofitProposal(ctxFrom(program(), two))).toBeNull();
    const three = weeks(3).map((date, i) => ({ id: 'w' + i, date, exercises: [{ name: 'Bench Press', sets: 3, reps: '8', weightKg: 80 }] }));
    expect(buildRetrofitProposal(ctxFrom(program(), three))).not.toBeNull();
  });
  it('returns null when no program lift has loaded history', () => {
    const ctx = ctxFrom(program(), [{ id: 'w', date: '2026-08-01', exercises: [{ name: 'Push-Up', sets: 3, reps: '15', bodyweight: true }] }]);
    expect(buildRetrofitProposal(ctx)).toBeNull();
    expect(runBootstrapRules(ctx)).toEqual([]);
  });
  it('returns null without a program', () => {
    expect(buildRetrofitProposal({ ...ctxFrom(program(), []), program: null, planned: [] })).toBeNull();
  });
});

describe('runPostWorkoutRules', () => {
  it('only evaluates the lifts in the logged workout', () => {
    const ws = weeks(3).map((date, i) => ({
      id: 'w' + i, date,
      exercises: [
        { name: 'Bench Press', sets: 3, reps: '8', weightKg: 80, setEntries: [{ weightKg: 80, reps: 8 }, { weightKg: 80, reps: 8 }, { weightKg: 80, reps: 8 }] },
        { name: 'RDL', sets: 3, reps: '10', weightKg: 90, setEntries: [{ weightKg: 90, reps: 10 }, { weightKg: 90, reps: 10 }, { weightKg: 90, reps: 10 }] },
      ],
    }));
    const ctx = ctxFrom(program(), ws);
    const all = runPostWorkoutRules(ctx);
    expect(all.map(d => d.dedupeKey).sort()).toEqual(['load_change:bench press', 'load_change:romanian deadlift']);
    const benchOnly = runPostWorkoutRules(ctx, new Set(['bench press']));
    expect(benchOnly.map(d => d.dedupeKey)).toEqual(['load_change:bench press']);
    expect(runPostWorkoutRules({ ...ctx, program: null })).toEqual([]);
  });
});
