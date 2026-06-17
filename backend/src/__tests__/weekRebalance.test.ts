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
