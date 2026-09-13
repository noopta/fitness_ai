// Pure target math: parsing the plan, seeding loads from history, writing
// targets into a program copy (and undoing it).
import { describe, it, expect } from 'vitest';
import {
  parseRepRange, parseTargetRPE, loadIncrementKg, roundToIncrement, nextLoad,
  seedTargetFromExposures, extractPlannedExercises, applyTargetsToProgram, classifyLoad, loadForReps,
} from '../adaptation/targets.js';
import { makeKeyFn } from '../adaptation/history.js';
import type { Exposure } from '../adaptation/types.js';

function exposure(date: string, weightKg: number, reps: number, rpe: number | null = null, sets = 3): Exposure {
  const s = Array.from({ length: sets }, () => ({ weightKg, reps, rpe }));
  const eff = Math.min(reps + (rpe != null ? 10 - rpe : reps <= 5 ? 2 : reps <= 10 ? 2.5 : 3), 12);
  return {
    key: 'bench press', displayName: 'Bench Press', date, workoutId: 'w' + date, sets: s,
    top: s[0], minReps: reps, maxWeightKg: weightKg, e1rmKg: Math.round(weightKg * (1 + eff / 30)),
    confidence: rpe != null ? 0.9 : 0.6, rpeLogged: rpe != null, programDayRef: null,
  };
}

describe('parseRepRange / parseTargetRPE', () => {
  it('parses ranges, singles, numbers and dashes', () => {
    expect(parseRepRange('6-8')).toEqual({ min: 6, max: 8 });
    expect(parseRepRange('8–10')).toEqual({ min: 8, max: 10 });
    expect(parseRepRange('5')).toEqual({ min: 5, max: 5 });
    expect(parseRepRange(12)).toEqual({ min: 12, max: 12 });
    expect(parseRepRange('AMRAP')).toEqual({ min: 8, max: 8 });
  });
  it('reads RPE, RPE ranges, @-notation, RIR and %1RM', () => {
    expect(parseTargetRPE('RPE 7')).toBe(7);
    expect(parseTargetRPE('RPE 7-8')).toBe(7.5);
    expect(parseTargetRPE('@8')).toBe(8);
    expect(parseTargetRPE('RIR 2')).toBe(8);
    expect(parseTargetRPE('80%')).toBe(8);
    expect(parseTargetRPE('moderate')).toBeNull();
    expect(parseTargetRPE(null)).toBeNull();
  });
});

describe('load increments', () => {
  it('classifies implements', () => {
    expect(classifyLoad('Bench Press')).toBe('barbell');
    expect(classifyLoad('DB Lateral Raise')).toBe('dumbbell');
    expect(classifyLoad('Leg Press')).toBe('machine');
    expect(classifyLoad('Push-Up')).toBe('bodyweight');
    expect(classifyLoad('Weighted Dips')).toBe('barbell');
  });
  it('metric: 2.5 kg upper barbell, 5 kg lower, 2 kg dumbbell, 5 kg machine', () => {
    expect(loadIncrementKg('Bench Press', 'metric')).toBe(2.5);
    expect(loadIncrementKg('Back Squat', 'metric')).toBe(5);
    expect(loadIncrementKg('DB Row', 'metric')).toBe(2);
    expect(loadIncrementKg('Lat Pulldown', 'metric')).toBe(5);
  });
  it('imperial: rounds to 5 lb steps and bumps by one step', () => {
    const kg80 = 80;
    const rounded = roundToIncrement(kg80, 'Bench Press', 'imperial');
    expect(Math.round(rounded / 0.45359237)).toBe(175);
    const next = nextLoad(kg80, 'Bench Press', 'imperial');
    expect(Math.round(next / 0.45359237)).toBe(180);
  });
  it('metric bump: 80 → 82.5 for bench, 100 → 105 for squat', () => {
    expect(nextLoad(80, 'Bench Press', 'metric')).toBe(82.5);
    expect(nextLoad(100, 'Back Squat', 'metric')).toBe(105);
  });
});

describe('seedTargetFromExposures', () => {
  it('uses the LOWER-middle median of top-set weights when reps are in range', () => {
    const ex = [exposure('2026-08-20', 85, 8), exposure('2026-08-15', 80, 8), exposure('2026-08-10', 80, 7), exposure('2026-08-05', 77.5, 8)];
    const seed = seedTargetFromExposures(ex, { min: 6, max: 8 }, 8, 'Bench Press', 'metric')!;
    expect(seed.basis).toBe('history');
    expect(seed.targetWeightKg).toBe(80); // sorted 77.5,80,80,85 → lower-middle = 80
    expect(seed.confidence).toBeCloseTo(0.6, 1);
  });
  it('derives from e1RM when the lifter has been working a different rep range', () => {
    // 3 sessions of 100 × 3 — plan wants 8-10. Target must be lighter than 100.
    const ex = [exposure('2026-08-20', 100, 3), exposure('2026-08-15', 100, 3), exposure('2026-08-10', 100, 3)];
    const seed = seedTargetFromExposures(ex, { min: 8, max: 10 }, 8, 'Bench Press', 'metric')!;
    expect(seed.basis).toBe('e1rm');
    expect(seed.targetWeightKg).toBeLessThan(100);
    expect(seed.targetWeightKg).toBeGreaterThan(70);
    expect(seed.targetWeightKg % 2.5).toBe(0);
  });
  it('confidence scales with exposure count and RPE presence', () => {
    const one = seedTargetFromExposures([exposure('2026-08-20', 80, 8)], { min: 6, max: 8 }, 8, 'Bench Press', 'metric')!;
    const three = seedTargetFromExposures([exposure('2026-08-20', 80, 8, 7), exposure('2026-08-15', 80, 8, 7), exposure('2026-08-10', 80, 8, 7)], { min: 6, max: 8 }, 8, 'Bench Press', 'metric')!;
    expect(one.confidence).toBeLessThan(three.confidence);
    expect(three.confidence).toBeCloseTo(0.9, 1);
  });
  it('returns null with no loaded history', () => {
    expect(seedTargetFromExposures([], { min: 6, max: 8 }, 8, 'Bench Press', 'metric')).toBeNull();
  });
  it('loadForReps inverts Epley sensibly', () => {
    // e1RM 100, want 8 reps @ RPE 8 (2 RIR) → 10 effective reps → 100 / (1 + 10/30) = 75
    expect(loadForReps(100, 8, 8)).toBeCloseTo(75, 1);
  });
});

const program = () => ({
  goal: 'strength',
  phases: [
    { trainingDays: [
      { day: 'Upper A', exercises: [{ exercise: 'Barbell Bench Press', sets: 4, reps: '6-8', intensity: 'RPE 8' }, { exercise: 'Standing calf raise', sets: 3, reps: '12', intensity: 'RPE 7' }] },
      { day: 'Upper B', exercises: [{ exercise: 'Bench Press', sets: 3, reps: '8-10', intensity: 'RPE 7' }] },
    ] },
    { trainingDays: [
      { day: 'Upper A', exercises: [{ name: 'Standing Calf Raise', sets: 4, reps: '10', intensity: 'RPE 8' }] },
    ] },
  ],
});

describe('extractPlannedExercises', () => {
  it('dedupes by canonical key across phases/days and case variants, keeping every location', () => {
    const planned = extractPlannedExercises(program(), makeKeyFn());
    const keys = planned.map(p => p.key).sort();
    // The seed dictionary strips position qualifiers ("standing"), so both
    // casings of the calf raise collapse to one key.
    expect(keys).toEqual(['bench press', 'calf raise']);
    const bench = planned.find(p => p.key === 'bench press')!;
    expect(bench.locations).toHaveLength(2);
    expect(bench.repRange).toEqual({ min: 6, max: 8 });
    expect(bench.targetRPE).toBe(8);
    expect(bench.targetWeightKg).toBeNull();
    const calf = planned.find(p => p.key === 'calf raise')!;
    expect(calf.locations).toHaveLength(2); // phase 1 + phase 2, different casing
  });
});

describe('applyTargetsToProgram', () => {
  it('writes targets onto every matching exercise, returns previous for undo, never mutates input', () => {
    const p = program();
    const keyFn = makeKeyFn();
    const { program: next, previous, touched } = applyTargetsToProgram(p, [{ key: 'bench press', targetWeightKg: 80, confidence: 0.7, basis: 'history' }], keyFn, '2026-08-26T00:00:00Z');
    expect(touched).toBe(2);
    expect(p.phases[0].trainingDays[0].exercises[0]).not.toHaveProperty('targetWeightKg'); // input untouched
    expect(next.phases[0].trainingDays[0].exercises[0].targetWeightKg).toBe(80);
    expect(next.phases[0].trainingDays[1].exercises[0].targetWeightKg).toBe(80);
    expect(next.phases[0].trainingDays[0].exercises[0].targetBasis).toBe('history');
    expect(next.phases[0].trainingDays[0].exercises[1]).not.toHaveProperty('targetWeightKg');
    expect(previous).toEqual([{ key: 'bench press', targetWeightKg: null, targetRPE: null, confidence: null, basis: null }]);

    // Undo round-trip: applying `previous` clears the target again.
    const { program: back } = applyTargetsToProgram(next, previous, keyFn, '2026-08-27T00:00:00Z');
    expect(back.phases[0].trainingDays[0].exercises[0]).not.toHaveProperty('targetWeightKg');
    expect(back.phases[0].trainingDays[1].exercises[0]).not.toHaveProperty('targetSetAt');
  });
  it('also writes the legacy weeks view (old clients render it)', () => {
    const keyFn = makeKeyFn();
    const p: any = program();
    p.weeks = [{ weekNumber: 1, days: [{ day: 'Upper A', sessions: [{ exercise: 'Bench Press', sets: 4, reps: '6-8' }] }] }];
    const { program: next } = applyTargetsToProgram(p, [{ key: 'bench press', targetWeightKg: 80 }], keyFn, 't0');
    expect(next.weeks[0].days[0].sessions[0].targetWeightKg).toBe(80);
  });
  it('a load_change on an exercise already carrying a target records the old load as previous', () => {
    const keyFn = makeKeyFn();
    const { program: seeded } = applyTargetsToProgram(program(), [{ key: 'bench press', targetWeightKg: 80 }], keyFn, 't0');
    const { previous } = applyTargetsToProgram(seeded, [{ key: 'bench press', targetWeightKg: 82.5 }], keyFn, 't1');
    expect(previous[0].targetWeightKg).toBe(80);
  });
});
