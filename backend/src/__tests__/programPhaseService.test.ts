import { describe, it, expect } from 'vitest';
import { computePhaseState, parseSavedProgram, type SavedProgram } from '../services/programPhaseService.js';

const FOUNDATION_BUILD_PEAK: SavedProgram = {
  durationWeeks: 12,
  phases: [
    { phaseName: 'Foundation', durationWeeks: 4 },
    { phaseName: 'Build', durationWeeks: 4 },
    { phaseName: 'Peak/Strength', durationWeeks: 4 },
  ],
};

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

describe('computePhaseState', () => {
  it('returns Foundation in week 1', () => {
    const state = computePhaseState(FOUNDATION_BUILD_PEAK, daysAgo(0));
    expect(state.weekNumber).toBe(1);
    expect(state.phaseName).toBe('Foundation');
    expect(state.phaseIndex).toBe(0);
    expect(state.weekInPhase).toBe(1);
  });

  it('returns Build in week 5 (boundary into second phase)', () => {
    const state = computePhaseState(FOUNDATION_BUILD_PEAK, daysAgo(28));
    expect(state.weekNumber).toBe(5);
    expect(state.phaseName).toBe('Build');
    expect(state.phaseIndex).toBe(1);
    expect(state.weekInPhase).toBe(1);
  });

  it('regression: returns Peak/Strength in week 9 (was incorrectly Foundation)', () => {
    // This is the pomelowarrior case — user 8 weeks into program should be in
    // the third phase, not the first.
    const state = computePhaseState(FOUNDATION_BUILD_PEAK, daysAgo(56));
    expect(state.weekNumber).toBe(9);
    expect(state.phaseName).toBe('Peak/Strength');
    expect(state.phaseIndex).toBe(2);
    expect(state.weekInPhase).toBe(1);
  });

  it('week 4 stays in Foundation (last week of phase, not next)', () => {
    const state = computePhaseState(FOUNDATION_BUILD_PEAK, daysAgo(21));
    expect(state.weekNumber).toBe(4);
    expect(state.phaseName).toBe('Foundation');
    expect(state.phaseIndex).toBe(0);
    expect(state.weekInPhase).toBe(4);
  });

  it('clamps weekNumber to durationWeeks when start date is far in the past', () => {
    const state = computePhaseState(FOUNDATION_BUILD_PEAK, daysAgo(365));
    expect(state.weekNumber).toBe(12);
    expect(state.phaseName).toBe('Peak/Strength');
    expect(state.phaseIndex).toBe(2);
  });

  it('handles unequal phase durations correctly', () => {
    const program: SavedProgram = {
      durationWeeks: 10,
      phases: [
        { phaseName: 'A', durationWeeks: 2 },
        { phaseName: 'B', durationWeeks: 6 },
        { phaseName: 'C', durationWeeks: 2 },
      ],
    };
    expect(computePhaseState(program, daysAgo(0)).phaseName).toBe('A');
    expect(computePhaseState(program, daysAgo(14)).phaseName).toBe('B'); // week 3
    expect(computePhaseState(program, daysAgo(49)).phaseName).toBe('B'); // week 8
    expect(computePhaseState(program, daysAgo(56)).phaseName).toBe('C'); // week 9
  });

  it('falls back to phase.name when phaseName is missing', () => {
    const program: SavedProgram = {
      durationWeeks: 4,
      phases: [{ name: 'Hypertrophy', durationWeeks: 4 }],
    };
    expect(computePhaseState(program, daysAgo(0)).phaseName).toBe('Hypertrophy');
  });

  it('returns sensible defaults for null program', () => {
    const state = computePhaseState(null, null);
    expect(state.phaseName).toBeNull();
    expect(state.weekNumber).toBe(1);
    expect(state.phaseIndex).toBe(0);
    expect(state.currentPhase).toBeNull();
  });

  it('does not return negative daysSinceStart for future start dates', () => {
    const future = new Date();
    future.setUTCDate(future.getUTCDate() + 7);
    const state = computePhaseState(FOUNDATION_BUILD_PEAK, future);
    expect(state.daysSinceStart).toBe(0);
    expect(state.weekNumber).toBe(1);
  });

  it('infers durationWeeks from phases when program-level value is missing', () => {
    const program: SavedProgram = {
      phases: [
        { phaseName: 'A', durationWeeks: 3 },
        { phaseName: 'B', durationWeeks: 3 },
      ],
    };
    const state = computePhaseState(program, daysAgo(35));
    expect(state.weekNumber).toBe(6);
    expect(state.phaseName).toBe('B');
  });
});

describe('parseSavedProgram', () => {
  it('returns null for null input', () => {
    expect(parseSavedProgram(null)).toBeNull();
  });

  it('returns null for malformed JSON without throwing', () => {
    expect(parseSavedProgram('{not json')).toBeNull();
  });

  it('parses valid program JSON', () => {
    const json = JSON.stringify(FOUNDATION_BUILD_PEAK);
    const parsed = parseSavedProgram(json);
    expect(parsed?.phases?.[2].phaseName).toBe('Peak/Strength');
  });
});
