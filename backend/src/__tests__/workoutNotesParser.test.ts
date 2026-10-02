// Reading workouts pasted from a notes app. The model's reply is faked; what
// is tested is that whatever it says is checked before the app sees it.

import { describe, it, expect } from 'vitest';
import { coerceParsedNotes, parseWorkoutNotes, recentCalendar } from '../services/workoutNotesParser.js';

const TODAY = '2026-10-02';

describe('coerceParsedNotes', () => {
  it('keeps what was written, in the user\'s unit', () => {
    const out = coerceParsedNotes({
      workouts: [{ date: '2026-09-29', title: 'Push', exercises: [
        { name: 'Bench press', sets: 3, reps: '8', weight: 135, weightUnit: null, rpe: 8 },
        { name: 'Incline DB press', sets: '3', reps: 10, weight: 25, weightUnit: 'kg' },
        { name: 'Push-ups', sets: 2, reps: '20', weight: null, bodyweight: true },
      ] }],
      unparsed: ['felt tired'],
    }, 'imperial', TODAY);
    expect(out.workouts).toEqual([{ date: '2026-09-29', title: 'Push', exercises: [
      { name: 'Bench press', sets: 3, reps: '8', weight: 135, rpe: 8, notes: null, bodyweight: false, setEntries: null },
      { name: 'Incline DB press', sets: 3, reps: '10', weight: 55.1, rpe: null, notes: null, bodyweight: false, setEntries: null },
      { name: 'Push-ups', sets: 2, reps: '20', weight: null, rpe: null, notes: null, bodyweight: true, setEntries: null },
    ] }]);
    expect(out.unparsed).toEqual(['felt tired']);
  });

  it('turns differing sets into set entries, and describes the exercise by its heaviest set', () => {
    const out = coerceParsedNotes({ workouts: [{ date: null, exercises: [
      { name: 'Squat', sets: 1, reps: '5', setEntries: [{ weight: 100, reps: 5 }, { weight: 110, reps: 5 }, { weight: 120, reps: 3 }], weightUnit: 'kg' },
    ] }] }, 'metric', TODAY);
    expect(out.workouts[0].exercises[0]).toMatchObject({ sets: 3, weight: 120, setEntries: [{ weight: 100, reps: 5, rpe: null }, { weight: 110, reps: 5, rpe: null }, { weight: 120, reps: 3, rpe: null }] });
  });

  it('drops future or implausible dates, nameless exercises and empty sessions, and orders by date', () => {
    const out = coerceParsedNotes({ workouts: [
      { date: '2026-10-05', exercises: [{ name: 'Row', sets: 3, reps: '10', weight: 9999 }] },
      { date: '2026-09-30', exercises: [{ name: '', sets: 3 }, { name: 'Curl', sets: 0, reps: '12', rpe: 14 }] },
      { date: '2026-09-28', exercises: [] },
      { date: 'last tuesday', exercises: [{ name: 'Deadlift', sets: 1, reps: '5', weight: 315 }] },
    ] }, 'imperial', TODAY);
    expect(out.workouts.map((w) => [w.date, w.exercises.map((e) => e.name)])).toEqual([['2026-09-30', ['Curl']], [null, ['Row']], [null, ['Deadlift']]]);
    expect(out.workouts[0].exercises[0]).toMatchObject({ sets: 1, rpe: null });
    expect(out.workouts[1].exercises[0].weight).toBeNull();
  });

  it('survives a reply that is not the expected shape', () => {
    for (const bad of [null, 'nope', { workouts: 'x' }, { workouts: [null, 3] }]) expect(coerceParsedNotes(bad, 'imperial', TODAY)).toEqual({ workouts: [], unparsed: [] });
  });
});

describe('parseWorkoutNotes', () => {
  it('tells the model today\'s date and unit, and reads a fenced reply', async () => {
    let sent = '';
    const out = await parseWorkoutNotes('Mon - bench 3x8 135', 'imperial', TODAY, async (p) => {
      sent = p;
      return '```json\n{"workouts":[{"date":"2026-09-28","exercises":[{"name":"Bench press","sets":3,"reps":"8","weight":135}]}]}\n```';
    });
    expect(sent).toContain('Today is Friday 2026-10-02');
    expect(sent).toContain('default unit is lb');
    expect(sent).toContain('Mon - bench 3x8 135');
    expect(sent).toContain('Monday 2026-09-28');
    expect(out.workouts[0]).toMatchObject({ date: '2026-09-28', exercises: [{ name: 'Bench press', weight: 135 }] });
  });
});

describe('recentCalendar', () => {
  it('lists today back two weeks with weekdays', () => {
    const lines = recentCalendar('2026-10-02').split('\n');
    expect(lines).toHaveLength(14);
    expect(lines.slice(0, 5)).toEqual(['Friday 2026-10-02 (today)', 'Thursday 2026-10-01 (yesterday)', 'Wednesday 2026-09-30', 'Tuesday 2026-09-29', 'Monday 2026-09-28']);
  });
});
