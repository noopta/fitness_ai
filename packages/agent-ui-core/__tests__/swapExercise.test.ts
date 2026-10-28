// Mid-session swap (Oct 2026): only the name/load change; done sets stay under the old name.
import { describe, it, expect } from 'vitest';
import { initialWorkout, workoutReducer, defaultRules, swapExercise, toWorkoutLogBody, type PlanExercise } from '../src/workout';

const plan: PlanExercise[] = [
  { name: 'Bench Press', sets: 3, reps: 5, load: 185, rest: 120, cue: null, kind: 'weighted' },
  { name: 'Tricep Pushdown', sets: 3, reps: 12, load: 50, rest: 60, cue: 'elbows in', kind: 'weighted' },
  { name: 'Lateral Raise', sets: 3, reps: 15, load: 20, rest: 60, cue: null, kind: 'weighted' },
];
const rules = defaultRules('lbs');

describe('swapExercise', () => {
  it('replaces a lift with no sets done in place, keeping sets, reps, rest and cue', () => {
    const s = initialWorkout(plan);
    const r = swapExercise(plan, s, 1, { name: 'Single Arm Tricep Pushdown', load: 25 });
    expect(r.plan[1]).toEqual({ name: 'Single Arm Tricep Pushdown', sets: 3, reps: 12, load: 25, rest: 60, cue: 'elbows in', kind: 'weighted' });
    expect(r.plan).toHaveLength(3);
    expect(r.state.loads[1]).toBe(25);
  });

  it('a first-time lift has no load, so the session asks for it', () => {
    const r = swapExercise(plan, initialWorkout(plan), 1, { name: 'Cable Overhead Triceps Extension', load: null });
    expect(r.plan[1].load).toBeNull();
    expect(r.state.loads[1]).toBeNull();
  });

  it('with sets done, keeps them under the old name and inserts the new lift with the rest', () => {
    let s = workoutReducer(initialWorkout(plan), { type: 'begin', now: 0 });
    for (let i = 0; i < 3; i++) s = workoutReducer(s, { type: 'rate', rating: 'easy', now: 1, plan, rules });
    s = workoutReducer(s, { type: 'rest_skip' });
    s = workoutReducer(s, { type: 'rate', rating: 'easy', now: 2, plan, rules }); // one set of pushdowns
    expect(s.ex).toBe(1);
    const r = swapExercise(plan, s, 1, { name: 'Single Arm Tricep Pushdown', load: 25 });
    expect(r.plan.map((p) => [p.name, p.sets])).toEqual([['Bench Press', 3], ['Tricep Pushdown', 1], ['Single Arm Tricep Pushdown', 2], ['Lateral Raise', 3]]);
    expect(r.state.ex).toBe(2);
    expect(r.state.set).toBe(0);
    expect(r.state.loads[2]).toBe(25);
    expect(r.state.log.filter((l) => l.ex === 1)).toHaveLength(1);
    expect(r.state.log.filter((l) => l.ex === 0)).toHaveLength(3);
    // What gets saved: the pushdown set under its own name, the new lift under its own.
    const body = toWorkoutLogBody(r.state, r.plan, 'Push', '2026-10-28', 10);
    const names = (body.exercises as any[]).map((e) => e.name);
    expect(names).toContain('Tricep Pushdown');
  });

  it('a bodyweight swap carries no load', () => {
    const r = swapExercise(plan, initialWorkout(plan), 1, { name: 'Diamond Push-Up', load: 40, kind: 'bodyweight' });
    expect(r.plan[1].load).toBeNull();
    expect(r.plan[1].kind).toBe('bodyweight');
  });
});
