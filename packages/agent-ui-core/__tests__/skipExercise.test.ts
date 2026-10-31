// Moving past a lift mid-session (Oct 2026): for later, or for today.
import { describe, it, expect } from 'vitest';
import { initialWorkout, workoutReducer, defaultRules, skipExercise, summarize, toWorkoutLogBody, exerciseProgress, type PlanExercise, type WorkoutState } from '../src/workout';

const plan: PlanExercise[] = [
  { name: 'Bench Press', sets: 3, reps: 5, load: 185, rest: 120, cue: null, kind: 'weighted' },
  { name: 'Tricep Pushdown', sets: 2, reps: 12, load: 50, rest: 60, cue: null, kind: 'weighted' },
  { name: 'Lateral Raise', sets: 2, reps: 15, load: 20, rest: 60, cue: null, kind: 'weighted' },
];
const rules = defaultRules('lbs');
const began = (p = plan) => workoutReducer(initialWorkout(p), { type: 'begin', now: 0 });
const doSet = (s: WorkoutState, p: PlanExercise[], now = 1) => {
  const a = workoutReducer(s, { type: 'rate', rating: 'easy', now, plan: p, rules });
  return a.step === 'rest' ? workoutReducer(a, { type: 'rest_skip' }) : a;
};
const names = (p: PlanExercise[]) => p.map((x) => x.name);

describe('skip for later', () => {
  it('moves the lift to the end and goes straight to the next one, no rest', () => {
    const r = skipExercise(plan, began(), 0, 'later', 5);
    expect(names(r.plan)).toEqual(['Tricep Pushdown', 'Lateral Raise', 'Bench Press']);
    expect(r.state.step).toBe('set');
    expect(r.state.ex).toBe(0);
    expect(r.state.set).toBe(0);
    expect(r.state.loads).toEqual([50, 20, 185]);
    expect(r.state.reps).toEqual([12, 15, 5]);
    expect(r.state.log).toHaveLength(0);
  });

  it('logs nothing and ends the session only after the moved lift is done', () => {
    let { plan: p, state: s } = skipExercise(plan, began(), 0, 'later', 5);
    for (let i = 0; i < 4; i++) s = doSet(s, p);
    expect(s.step).toBe('set');
    expect(p[s.ex].name).toBe('Bench Press');
    expect(s.set).toBe(0);
    for (let i = 0; i < 3; i++) s = doSet(s, p);
    expect(s.step).toBe('done');
    expect(summarize(s, p, 9).sets).toBe(7);
    expect(summarize(s, p, 9).totalSets).toBe(7);
    const body = toWorkoutLogBody(s, p, 'Push', '2026-10-31', 9);
    expect(body.exercises.find((e) => e.name === 'Bench Press')?.sets).toBe(3);
    expect(body.exercises.find((e) => e.name === 'Bench Press')?.weight).toBe(185);
  });

  it('a lift left part way resumes at the set it stopped on, and keeps its sets', () => {
    let s = doSet(began(), plan);
    expect(s.set).toBe(1);
    const r = skipExercise(plan, s, 0, 'later', 5);
    let p = r.plan;
    s = r.state;
    expect(s.log[0].ex).toBe(2);
    expect(exerciseProgress(s, p)[2]).toBeCloseTo(1 / 3);
    for (let i = 0; i < 4; i++) s = doSet(s, p);
    expect(p[s.ex].name).toBe('Bench Press');
    expect(s.set).toBe(1);
    for (let i = 0; i < 2; i++) s = doSet(s, p);
    expect(s.step).toBe('done');
    expect(s.log.filter((l) => l.ex === 2)).toHaveLength(3);
  });

  it('can be put off more than once without losing anything', () => {
    let { plan: p, state: s } = skipExercise(plan, began(), 0, 'later', 5);
    ({ plan: p, state: s } = skipExercise(p, s, 0, 'later', 6));
    expect(names(p)).toEqual(['Lateral Raise', 'Bench Press', 'Tricep Pushdown']);
    expect(s.loads).toEqual([20, 185, 50]);
  });

  it('does nothing on the last lift, since there is nothing to go ahead of', () => {
    const s = { ...began(), ex: 2 };
    expect(skipExercise(plan, s, 2, 'later', 5)).toEqual({ plan, state: s });
  });

  it('keeps next-week notes on the right lift', () => {
    let s = began();
    for (let i = 0; i < 3; i++) s = doSet(s, plan);
    expect(s.nextWeek).toEqual([{ ex: 0, delta: 5 }]);
    const r = skipExercise(plan, s, 1, 'later', 5);
    expect(r.state.nextWeek).toEqual([{ ex: 0, delta: 5 }]);
    expect(names(r.plan)[0]).toBe('Bench Press');
  });
});

describe('skip for today', () => {
  it('with no sets done, drops the lift and moves to the next', () => {
    const r = skipExercise(plan, began(), 0, 'today', 5);
    expect(names(r.plan)).toEqual(['Tricep Pushdown', 'Lateral Raise']);
    expect(r.state.ex).toBe(0);
    expect(r.state.set).toBe(0);
    expect(r.state.loads).toEqual([50, 20]);
    expect(r.state.skipped).toEqual([{ name: 'Bench Press', sets: 3 }]);
    expect(r.state.receipts.at(-1)?.text).toBe('Skipped Bench Press today.');
  });

  it('with sets done, keeps them logged and counts only what was left as skipped', () => {
    const s = doSet(began(), plan);
    const r = skipExercise(plan, s, 0, 'today', 5);
    expect(r.plan[0]).toMatchObject({ name: 'Bench Press', sets: 1 });
    expect(r.state.ex).toBe(1);
    expect(r.state.set).toBe(0);
    expect(r.state.log).toHaveLength(1);
    expect(r.state.skipped).toEqual([{ name: 'Bench Press', sets: 2 }]);
    const body = toWorkoutLogBody(r.state, r.plan, 'Push', '2026-10-31', 9);
    expect(body.exercises.map((e) => [e.name, e.sets])).toEqual([['Bench Press', 1]]);
  });

  it('never saves a set for the skipped lift, and the summary stays honest', () => {
    let { plan: p, state: s } = skipExercise(plan, began(), 1, 'today', 5);
    s = { ...s, ex: 0 };
    for (let i = 0; i < 5; i++) s = doSet(s, p);
    expect(s.step).toBe('done');
    const sum = summarize(s, p, 9);
    expect(sum.sets).toBe(5);
    expect(sum.totalSets).toBe(7);
    expect(toWorkoutLogBody(s, p, 'Push', '2026-10-31', 9).exercises.map((e) => e.name)).toEqual(['Bench Press', 'Lateral Raise']);
  });

  it('skipping the last lift ends the session and saves what was done', () => {
    let s = began();
    for (let i = 0; i < 5; i++) s = doSet(s, plan);
    expect(plan[s.ex].name).toBe('Lateral Raise');
    const r = skipExercise(plan, s, 2, 'today', 50);
    expect(r.state.step).toBe('done');
    expect(r.state.end).toBe(50);
    expect(r.plan).toHaveLength(2);
    expect(summarize(r.state, r.plan, 60).totalSets).toBe(7);
  });

  it('skipping the last lift part way through ends the session with those sets kept', () => {
    let s = began();
    for (let i = 0; i < 6; i++) s = doSet(s, plan);
    const r = skipExercise(plan, s, 2, 'today', 50);
    expect(r.state.step).toBe('done');
    expect(r.plan[2].sets).toBe(1);
    expect(r.state.log).toHaveLength(6);
  });

  it('refuses to end an empty session, which would save a workout with nothing in it', () => {
    const only = [plan[0]];
    const s = began(only);
    expect(skipExercise(only, s, 0, 'today', 5)).toEqual({ plan: only, state: s });
  });

  it('a moved lift can then be skipped for today', () => {
    let { plan: p, state: s } = skipExercise(plan, began(), 0, 'later', 5);
    for (let i = 0; i < 4; i++) s = doSet(s, p);
    const r = skipExercise(p, s, s.ex, 'today', 9);
    expect(r.state.step).toBe('done');
    expect(r.state.skipped).toEqual([{ name: 'Bench Press', sets: 3 }]);
    expect(summarize(r.state, r.plan, 10)).toMatchObject({ sets: 4, totalSets: 7 });
  });

  it('a draft saved before skipping existed still summarises', () => {
    const s = began();
    delete (s as Partial<WorkoutState>).skipped;
    expect(summarize(s, plan, 1).totalSets).toBe(7);
  });
});
