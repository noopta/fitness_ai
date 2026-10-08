import { describe, it, expect } from 'vitest';
import { spreadSlots, bestOrder, weekConflicts, applyWeekRecovery, muscleSets, regionOf } from '../services/weekRecovery.js';
import { sessionAt, dayIndexAt } from '../services/programPhaseService.js';

const day = (name: string, ...ex: string[]) => ({ day: name, exercises: ex.map((e) => ({ name: e, sets: 4 })) });
const push = day('Push', 'Bench Press', 'Overhead Press', 'Tricep Pushdown');
const pull = day('Pull', 'Barbell Row', 'Pull-Up', 'Barbell Curl');
const legs = day('Legs', 'Back Squat', 'Romanian Deadlift', 'Leg Curl');
const upperA = day('Upper A', 'Bench Press', 'Barbell Row', 'Overhead Press');
const upperB = day('Upper B', 'Incline Bench Press', 'Pull-Up', 'Lateral Raise');
const lower = day('Lower', 'Back Squat', 'Romanian Deadlift');

describe('week recovery', () => {
  it('spreads sessions through the week', () => {
    expect(spreadSlots(3)).toEqual([0, 2, 4]);
    expect(spreadSlots(4)).toEqual([0, 1, 3, 4]);
  });
  it('reads a day’s muscles and region', () => {
    expect(regionOf(muscleSets(legs))).toBe('lower');
    expect(regionOf(muscleSets(push))).toBe('upper');
  });
  it('orders an upper/lower week so the same session never lands on consecutive days', () => {
    const r = bestOrder([upperA, upperB, lower, { ...lower, day: 'Lower B' }]);
    expect(r.conflicts).toEqual([]);
    const names = r.order.map((i) => [upperA, upperB, lower, { day: 'Lower B' }][i].day);
    // Slots 0,1 and 3,4 are the consecutive pairs: each pair mixes upper and lower.
    expect(new Set([names[0].startsWith('Upper'), names[1].startsWith('Upper')]).size).toBe(2);
  });
  it('flags six upper days in a row — ordering can’t fix that', () => {
    const six = [upperA, upperB, { ...upperA, day: 'Upper C' }, { ...upperB, day: 'Upper D' }, { ...upperA, day: 'Upper E' }, { ...upperB, day: 'Upper F' }];
    const r = bestOrder(six);
    expect(r.conflicts.some((c) => c.kind === 'region_streak')).toBe(true);
  });
  it('passes a 6-day push/pull/legs', () => {
    expect(bestOrder([push, pull, legs, { ...push, day: 'Push 2' }, { ...pull, day: 'Pull 2' }, { ...legs, day: 'Legs 2' }]).conflicts).toEqual([]);
  });
  it('flags a week with no rest', () => {
    expect(weekConflicts([push, pull, legs, push, pull, legs, push], spreadSlots(7)).some((c) => c.kind === 'no_rest')).toBe(true);
  });
  it('writes weekSlots onto each phase and the schedule follows them', () => {
    const p = applyWeekRecovery({ phases: [{ phaseName: 'Build', trainingDays: [push, pull, legs] }] }).program;
    expect(p.phases[0].weekSlots).toEqual([0, 2, 4]);
    const days = p.phases[0].trainingDays;
    expect(sessionAt(days, 1, p.phases[0].weekSlots)).toBeNull();
    expect(dayIndexAt(days, 2, p.phases[0].weekSlots)).toBe(1);
    // Without slots (older programs) the i-th position is the i-th day.
    expect(dayIndexAt(days, 1)).toBe(1);
    // A malformed slot list is ignored.
    expect(dayIndexAt(days, 1, [0, 9, 4])).toBe(1);
  });
});

describe('week recovery — spacing as well as order', () => {
  it('puts four upper-only days every other day', () => {
    const r = bestOrder([upperA, upperB, { ...upperA, day: 'Upper C' }, { ...upperB, day: 'Upper D' }]);
    // Every other day: only one pair of sessions per week falls on consecutive days (the
    // default spread [0,1,3,4] would have two), and that pair is A next to B, not A next to A.
    const s = new Set(r.slots);
    const consecutive = r.slots.filter((d) => s.has((d + 1) % 7));
    expect(consecutive).toHaveLength(1);
    const a = r.slots.indexOf(consecutive[0]), b = r.slots.indexOf((consecutive[0] + 1) % 7);
    const names = r.order.map((i) => ['A', 'B', 'A', 'B'][i]);
    expect(names[a]).not.toBe(names[b]);
  });
  it('keeps the default spread for upper/lower', () => {
    expect(bestOrder([upperA, lower, upperB, { ...lower, day: 'Lower B' }]).slots).toEqual([0, 1, 3, 4]);
  });
});
