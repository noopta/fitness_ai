// Tests for the deterministic muscle-spacing guard that backs the "swap a
// workout / review your week" flow. The bug this prevents: two Upper days
// landing on consecutive calendar days because the LLM rebalancer treats
// "Horizontal Push/Pull" and "Vertical Push/Pull" as different focuses.

import { describe, it, expect } from 'vitest';
import {
  classifyMuscleGroups,
  sessionsConflict,
  muscleBucketLabel,
  placeSessionsAvoidingConflicts,
  hasAdjacentConflict,
  proposeMoveLater,
  type RebSession,
} from '../services/weekRebalance.js';

const s = (day: string): RebSession => ({ day, focus: 'Hypertrophy' });

describe('classifyMuscleGroups', () => {
  it('maps both horizontal and vertical upper days to {upper}', () => {
    expect([...classifyMuscleGroups('Upper — Horizontal Push/Pull')]).toEqual(['upper']);
    expect([...classifyMuscleGroups('Upper — Vertical Push/Pull')]).toEqual(['upper']);
  });

  it('maps hinge/knee-safe lower days to {lower}', () => {
    expect([...classifyMuscleGroups('Lower — Hinge (Knee Safe)')]).toEqual(['lower']);
    expect([...classifyMuscleGroups('Day 2: Lower (Hinge/Knee Safe)')]).toEqual(['lower']);
  });

  it('treats full body as training both regions', () => {
    const g = classifyMuscleGroups('Day 4: Full Body/Accessory + Core');
    expect(g.has('upper')).toBe(true);
    expect(g.has('lower')).toBe(true);
  });

  it('returns an empty set for core/cardio-only days', () => {
    expect(classifyMuscleGroups('Core & Conditioning').size).toBe(0);
  });
});

describe('sessionsConflict', () => {
  it('flags two upper days as conflicting regardless of movement plane', () => {
    expect(sessionsConflict(s('Upper — Horizontal Push/Pull'), s('Upper — Vertical Push/Pull'))).toBe(true);
  });

  it('does not flag upper vs lower', () => {
    expect(sessionsConflict(s('Upper — Horizontal Push/Pull'), s('Lower — Hinge'))).toBe(false);
  });

  it('flags full body against any hard day', () => {
    expect(sessionsConflict(s('Full Body + Core'), s('Upper — Push'))).toBe(true);
    expect(sessionsConflict(s('Full Body + Core'), s('Lower — Squat'))).toBe(true);
  });

  it('never conflicts with a rest day (null)', () => {
    expect(sessionsConflict(s('Upper'), null)).toBe(false);
    expect(sessionsConflict(null, s('Upper'))).toBe(false);
  });
});

describe('muscleBucketLabel', () => {
  it('produces coarse muscle labels for the LLM hint', () => {
    expect(muscleBucketLabel('Upper — Vertical Push/Pull')).toBe('upper');
    expect(muscleBucketLabel('Lower — Hinge')).toBe('lower');
    expect(muscleBucketLabel('Full Body/Accessory')).toBe('full body');
    expect(muscleBucketLabel('Core')).toBe('general');
  });
});

describe('placeSessionsAvoidingConflicts', () => {
  it('never places two upper days back-to-back (the reported bug)', () => {
    // Today (locked) = Upper. Pool still has a second Upper + a Lower to place
    // into the next two open slots. A naive left-to-right fill would put Upper
    // on the very next day, adjacent to today's Upper.
    const days = [
      { date: '2026-06-16', locked: true, session: s('Upper — Horizontal Push/Pull') }, // today, swapped in
      { date: '2026-06-17', locked: false, session: null },
      { date: '2026-06-18', locked: false, session: null },
    ];
    const pool = [s('Upper — Vertical Push/Pull'), s('Lower — Hinge (Knee Safe)')];

    const { placement } = placeSessionsAvoidingConflicts({ days, pool });

    const resolved = days.map(d => (d.locked ? d.session : placement.get(d.date) ?? null));
    expect(hasAdjacentConflict(resolved)).toBe(false);
    // The day immediately after today must NOT be the other Upper day.
    expect(placement.get('2026-06-17')?.day).toBe('Lower — Hinge (Knee Safe)');
    expect(placement.get('2026-06-18')?.day).toBe('Upper — Vertical Push/Pull');
  });

  it('overrides a conflicting LLM preference order', () => {
    const days = [
      { date: '2026-06-16', locked: true, session: s('Upper A') },
      { date: '2026-06-17', locked: false, session: null },
      { date: '2026-06-18', locked: false, session: null },
    ];
    const pool = [s('Upper B'), s('Lower C')];
    // LLM wants Upper B first (adjacent to today's Upper) — must be overridden.
    const { placement } = placeSessionsAvoidingConflicts({
      days,
      pool,
      preference: ['Upper B', 'Lower C'],
    });
    expect(placement.get('2026-06-17')?.day).toBe('Lower C');
    const resolved = days.map(d => (d.locked ? d.session : placement.get(d.date) ?? null));
    expect(hasAdjacentConflict(resolved)).toBe(false);
  });

  it('honors a valid LLM preference order', () => {
    const days = [
      { date: '2026-06-16', locked: true, session: s('Upper A') },
      { date: '2026-06-17', locked: false, session: null },
      { date: '2026-06-18', locked: false, session: null },
    ];
    const pool = [s('Lower C'), s('Upper B')];
    const { placement } = placeSessionsAvoidingConflicts({
      days,
      pool,
      preference: ['Lower C', 'Upper B'],
    });
    expect(placement.get('2026-06-17')?.day).toBe('Lower C');
    expect(placement.get('2026-06-18')?.day).toBe('Upper B');
  });

  it('falls back to a rest day when no pool session fits without a conflict', () => {
    // Today + a locked Upper the day after the single open slot, with only an
    // Upper left in the pool → the slot is squeezed between two Uppers → rest.
    const days = [
      { date: '2026-06-16', locked: true, session: s('Upper A') },
      { date: '2026-06-17', locked: false, session: null },
      { date: '2026-06-18', locked: true, session: s('Upper C') },
    ];
    const pool = [s('Upper B')];
    const { placement } = placeSessionsAvoidingConflicts({ days, pool });
    expect(placement.get('2026-06-17')).toBeNull();
  });

  it('respects locked neighbors that come after the open slot', () => {
    const days = [
      { date: '2026-06-16', locked: false, session: null },
      { date: '2026-06-17', locked: true, session: s('Lower X') },
    ];
    const pool = [s('Lower Y'), s('Upper Z')];
    const { placement } = placeSessionsAvoidingConflicts({ days, pool });
    // Slot 16 sits before a locked Lower → must not be a Lower.
    expect(placement.get('2026-06-16')?.day).toBe('Upper Z');
  });
});

describe('proposeMoveLater', () => {
  // The reported week: Sun–Sat, today Fri 2 Oct, Saturday a rest day.
  const week = () => [
    { date: '2026-09-27', dayLabel: 'Sun', session: s('Deadlift') },
    { date: '2026-09-28', dayLabel: 'Mon', session: s('Bench') },
    { date: '2026-09-29', dayLabel: 'Tue', session: s('Lower') },
    { date: '2026-09-30', dayLabel: 'Wed', session: s('Upper Horizontal Push/Pull') },
    { date: '2026-10-01', dayLabel: 'Thu', session: s('Squat') },
    { date: '2026-10-02', dayLabel: 'Fri', session: s('Upper Vertical Push/Pull') },
    { date: '2026-10-03', dayLabel: 'Sat', session: null },
  ];
  const byDate = (w: any[]) => Object.fromEntries(w.map((d) => [d.date, d]));

  it("moves today's session to tomorrow and leaves today a rest day (the reported bug)", () => {
    const { proposedWeek, rationale } = proposeMoveLater({ weekDays: week(), date: '2026-10-03', sourceDate: '2026-10-02', today: '2026-10-02', loggedDates: new Set() });
    const d = byDate(proposedWeek);
    expect(d['2026-10-02'].session).toBeNull();
    expect(d['2026-10-02'].locked).toBe(false); // written on apply, so the session really leaves today
    expect(d['2026-10-03'].session.day).toBe('Upper Vertical Push/Pull');
    // The session exists exactly once.
    expect(proposedWeek.filter((x) => x.session?.day === 'Upper Vertical Push/Pull')).toHaveLength(1);
    expect(rationale).toBe('Moved Upper Vertical Push/Pull from Fri to Sat; Fri is now a rest day.');
  });

  it("swaps when the later day already has a session", () => {
    const w = week();
    w[6].session = s('Arms');
    const d = byDate(proposeMoveLater({ weekDays: w, date: '2026-10-03', sourceDate: '2026-10-02', today: '2026-10-02', loggedDates: new Set() }).proposedWeek);
    expect(d['2026-10-03'].session.day).toBe('Upper Vertical Push/Pull');
    expect(d['2026-10-02'].session.day).toBe('Arms');
  });

  it('leaves every other day as it was, and locks past and logged days', () => {
    const d = byDate(proposeMoveLater({ weekDays: week(), date: '2026-10-03', sourceDate: '2026-10-02', today: '2026-10-02', loggedDates: new Set(['2026-10-01']) }).proposedWeek);
    expect(d['2026-09-30'].session.day).toBe('Upper Horizontal Push/Pull');
    expect(d['2026-09-30'].locked).toBe(true);
    expect(d['2026-10-01'].locked).toBe(true);
    expect(d['2026-09-30'].isSwapped).toBe(false);
  });
});
