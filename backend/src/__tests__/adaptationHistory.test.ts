// Raw WorkoutLog rows → per-lift exposures. The name-matching here is what
// makes the feature work for existing users.
import { describe, it, expect } from 'vitest';
import { buildExposures, makeKeyFn, workingSets, parseProgramDayRef, weeklyBestSeries } from '../adaptation/history.js';
import { isoWeekKey } from '../services/muscleLedgerService.js';

describe('makeKeyFn', () => {
  it('collapses seed-dictionary variants to one key', () => {
    const k = makeKeyFn();
    expect(k('Bench Press')).toBe(k('barbell bench press'));
    expect(k('Bench Press')).toBe(k('Flat Bench Press'));
    expect(k('OHP')).toBe(k('Overhead Press'));
    expect(k('RDL')).toBe(k('Romanian Deadlift'));
  });
  it('is case/whitespace-insensitive for names outside the seed', () => {
    const k = makeKeyFn();
    expect(k('Standing calf raise')).toBe(k('Standing Calf Raise'));
    expect(k('  Cable  Crunch ')).toBe(k('cable crunch'));
  });
  it('honours the DB normalization map over the seed', () => {
    const k = makeKeyFn(new Map([['Weird Machine Thing', 'Leg Press']]));
    expect(k('Weird Machine Thing')).toBe(k('Leg Press'));
  });
});

describe('workingSets', () => {
  it('expands legacy uniform logs into N identical sets', () => {
    const sets = workingSets({ name: 'Bench Press', sets: 3, reps: '8', weightKg: 80, rpe: 7 });
    expect(sets).toHaveLength(3);
    expect(sets[0]).toEqual({ weightKg: 80, reps: 8, rpe: 7 });
  });
  it('uses setEntries as the source of truth when present', () => {
    const sets = workingSets({ name: 'Bench Press', sets: 3, reps: '8', weightKg: 80, setEntries: [{ weightKg: 80, reps: 8, rpe: 7 }, { weightKg: 75, reps: 10, rpe: null }] });
    expect(sets).toHaveLength(2);
    expect(sets[1]).toEqual({ weightKg: 75, reps: 10, rpe: null });
  });
  it('treats bodyweight / zero-load as unloaded sets', () => {
    expect(workingSets({ name: 'Push-Up', sets: 3, reps: '15', weightKg: null, bodyweight: true })[0].weightKg).toBeNull();
    expect(workingSets({ name: 'Pistol Squat', sets: 1, reps: '7', setEntries: [{ weightKg: 0, reps: 10 }] })[0].weightKg).toBeNull();
  });
});

describe('buildExposures', () => {
  const workouts = [
    { id: 'w1', date: '2026-08-01', exercises: JSON.stringify([{ name: 'Bench Press', sets: 3, reps: '8', weightKg: 80 }]) },
    { id: 'w2', date: '2026-08-08', exercises: JSON.stringify([{ name: 'barbell bench press', sets: 3, reps: '8', weightKg: 82.5, setEntries: [{ weightKg: 82.5, reps: 8, rpe: 8 }, { weightKg: 82.5, reps: 7, rpe: 9 }, { weightKg: 80, reps: 8, rpe: 8 }] }, { name: 'Push-Up', sets: 3, reps: '15', bodyweight: true }]), programDayRef: JSON.stringify({ phaseIndex: 0, dayIndex: 1, weekNumber: 2, day: 'Upper B' }) },
    { id: 'w3', date: '2026-08-05', exercises: 'not json' },
  ];
  it('groups by canonical key, newest first, with top set / minReps / e1RM / confidence', () => {
    const map = buildExposures(workouts, makeKeyFn());
    const bench = map.get('bench press')!;
    expect(bench).toHaveLength(2);
    expect(bench[0].date).toBe('2026-08-08');
    expect(bench[0].top).toEqual({ weightKg: 82.5, reps: 8, rpe: 8 });
    expect(bench[0].minReps).toBe(7);
    expect(bench[0].maxWeightKg).toBe(82.5);
    expect(bench[0].e1rmKg).toBeGreaterThan(bench[1].e1rmKg);
    expect(bench[0].rpeLogged).toBe(true);
    expect(bench[0].confidence).toBeCloseTo(0.9, 1);
    expect(bench[0].programDayRef).toEqual({ phaseIndex: 0, dayIndex: 1, weekNumber: 2, day: 'Upper B' });
    expect(bench[1].rpeLogged).toBe(false);
    expect(bench[1].confidence).toBeCloseTo(0.6, 1);
  });
  it('keeps unloaded lifts as exposures with no top set', () => {
    const map = buildExposures(workouts, makeKeyFn());
    const pushups = map.get('push-up')!;
    expect(pushups).toHaveLength(1);
    expect(pushups[0].top).toBeNull();
    expect(pushups[0].e1rmKg).toBe(0);
  });
  it('skips unparseable rows without throwing', () => {
    expect(() => buildExposures(workouts, makeKeyFn())).not.toThrow();
  });
});

describe('parseProgramDayRef / weeklyBestSeries', () => {
  it('parses valid refs and rejects junk', () => {
    expect(parseProgramDayRef('{"phaseIndex":1,"dayIndex":2}')).toEqual({ phaseIndex: 1, dayIndex: 2, weekNumber: 1, day: undefined });
    expect(parseProgramDayRef('{"phaseIndex":"x"}')).toBeNull();
    expect(parseProgramDayRef('nope')).toBeNull();
    expect(parseProgramDayRef(null)).toBeNull();
  });
  it('buckets best e1RM per ISO week, oldest first', () => {
    const map = buildExposures([
      { id: 'a', date: '2026-08-03', exercises: JSON.stringify([{ name: 'Bench Press', sets: 1, reps: '5', weightKg: 100 }]) },
      { id: 'b', date: '2026-08-05', exercises: JSON.stringify([{ name: 'Bench Press', sets: 1, reps: '5', weightKg: 90 }]) },
      { id: 'c', date: '2026-08-12', exercises: JSON.stringify([{ name: 'Bench Press', sets: 1, reps: '5', weightKg: 102.5 }]) },
    ], makeKeyFn());
    const series = weeklyBestSeries(map.get('bench press')!, isoWeekKey);
    expect(series).toHaveLength(2);
    expect(series[1]).toBeGreaterThan(series[0]);
  });
});
