import { describe, it, expect } from 'vitest';
import { emptyLogger, loggerReducer, loggerToLogBody, loggerHasWork, exerciseCategory, whenLabel, resumableLogger, type LoggerState } from '../src/logger';

const kg = (lb: number) => Math.round(lb * 0.4536 * 10) / 10;
const run = (s: LoggerState, ...as: Parameters<typeof loggerReducer>[1][]) => as.reduce(loggerReducer, s);

describe('logger', () => {
  it('prefills sets grey from last time and takes those numbers when a blank set is ticked', () => {
    let s = run(emptyLogger('2026-10-07', 'Push'), { type: 'add_exercise', name: 'Bench press', prev: [{ weight: 185, reps: 5 }, { weight: 185, reps: 5 }, { weight: 190, reps: 4 }] });
    expect(s.exercises[0].sets).toHaveLength(3);
    expect(s.exercises[0].sets[2].prev).toEqual({ weight: 190, reps: 4 });
    s = run(s, { type: 'toggle_done', ex: 0, set: 0 }, { type: 'set_value', ex: 0, set: 1, field: 'weight', value: 195 }, { type: 'toggle_done', ex: 0, set: 1 });
    expect(s.exercises[0].sets[0]).toMatchObject({ weight: 185, reps: 5, done: true });
    expect(s.exercises[0].sets[1]).toMatchObject({ weight: 195, reps: 5, done: true });
  });

  it('logs only ticked sets, top set first, per-set entries in kg', () => {
    const s = run(emptyLogger('2026-10-06', ' Push '),
      { type: 'add_exercise', name: 'Bench press', prev: [{ weight: 185, reps: 5 }, { weight: 185, reps: 5 }] },
      { type: 'toggle_done', ex: 0, set: 0 },
      { type: 'set_value', ex: 0, set: 1, field: 'weight', value: 190 }, { type: 'set_value', ex: 0, set: 1, field: 'reps', value: 4 }, { type: 'toggle_done', ex: 0, set: 1 },
      { type: 'add_exercise', name: 'Dips' },
      { type: 'set_value', ex: 1, set: 0, field: 'reps', value: 10 }, { type: 'toggle_done', ex: 1, set: 0 },
      { type: 'note', note: ' felt strong ' });
    const b = loggerToLogBody(s, kg);
    expect(b).toMatchObject({ date: '2026-10-06', title: 'Push', notes: 'felt strong' });
    expect(b.exercises).toHaveLength(2);
    expect(b.exercises[0]).toMatchObject({ name: 'Bench press', sets: 2, reps: '4', weightKg: kg(190), bodyweight: false });
    expect(b.exercises[0].setEntries).toEqual([{ weightKg: kg(185), reps: 5, rpe: null }, { weightKg: kg(190), reps: 4, rpe: null }]);
    expect(b.exercises[1]).toMatchObject({ name: 'Dips', sets: 1, reps: '10', weightKg: null, bodyweight: true });
  });

  it('a new set starts from the one above; an exercise with nothing ticked is left out', () => {
    let s = run(emptyLogger('2026-10-07'), { type: 'add_exercise', name: 'Row', prev: [{ weight: 155, reps: 8 }] }, { type: 'add_set', ex: 0 });
    // A new set suggests the one above as its hint; ticking it takes those numbers.
    expect(s.exercises[0].sets[1]).toMatchObject({ weight: null, reps: null, done: false, prev: { weight: 155, reps: 8 } });
    expect(run(s, { type: 'toggle_done', ex: 0, set: 1 }).exercises[0].sets[1]).toMatchObject({ weight: 155, reps: 8, done: true });
    expect(loggerHasWork(s)).toBe(false);
    expect(loggerToLogBody(s, kg).exercises).toHaveLength(0);
    s = run(s, { type: 'remove_set', ex: 0, set: 1 }, { type: 'remove_exercise', ex: 0 });
    expect(s.exercises).toHaveLength(0);
  });
});

describe('exerciseCategory', () => {
  it('sorts names into the search tabs', () => {
    expect(exerciseCategory('Incline dumbbell press')).toBe('chest');
    expect(exerciseCategory('Close-grip bench')).toBe('chest');
    expect(exerciseCategory('Overhead press')).toBe('shoulders');
    expect(exerciseCategory('Leg press')).toBe('legs');
    expect(exerciseCategory('Romanian deadlift')).toBe('legs');
    expect(exerciseCategory('Chest-supported row')).toBe('back');
    expect(exerciseCategory('Hammer curl')).toBe('arms');
    expect(exerciseCategory('Plank')).toBe('core');
    expect(exerciseCategory('Sled push')).toBe('other');
  });
});

describe('whenLabel', () => {
  it('says Today, Yesterday, then the date', () => {
    expect(whenLabel('2026-10-07', '2026-10-07')).toBe('Today');
    expect(whenLabel('2026-10-06', '2026-10-07')).toBe('Yesterday');
    expect(whenLabel('2026-10-04', '2026-10-07')).toBe('Sun 4 Oct');
  });
});

describe('resumableLogger', () => {
  const st = run(emptyLogger('2026-10-07'), { type: 'add_exercise', name: 'Row' });
  it('offers back a recent draft with exercises in it', () => {
    expect(resumableLogger({ v: 1, state: st, savedAt: 1000 }, 1000 + 3600_000)?.state).toBe(st);
    expect(resumableLogger({ v: 1, state: st, savedAt: 1000 }, 1000 + 4 * 86_400_000)).toBeNull();
    expect(resumableLogger({ v: 1, state: emptyLogger('2026-10-07'), savedAt: 1000 }, 2000)).toBeNull();
    expect(resumableLogger(null, 0)).toBeNull();
  });
});
