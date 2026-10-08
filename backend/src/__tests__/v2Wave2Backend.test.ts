import { describe, it, expect } from 'vitest';
import { alternativesFor } from '../services/exerciseAlternatives.js';
import { totalTierLadder } from '../services/strengthMetricsService.js';
import { programFinished } from '../services/trainingOverview.js';
import { isNativeTool, NATIVE_TOOLS } from '../agent/nativeTools.js';

describe('alternativesFor', () => {
  it('offers same-muscle swaps, never the exercise itself', () => {
    const alts = alternativesFor('barbell bench press');
    expect(alts.length).toBeGreaterThan(0);
    expect(alts.every((a) => a.primaryMuscle === 'chest')).toBe(true);
    expect(alts.map((a) => a.name)).not.toContain('Bench Press');
  });
  it('lists same-kind (compound) swaps first', () => {
    const alts = alternativesFor('bench press', 20);
    const firstIso = alts.findIndex((a) => !a.isCompound);
    if (firstIso >= 0) expect(alts.slice(firstIso).every((a) => !a.isCompound)).toBe(true);
  });
  it('has nothing for an unknown name and respects the limit', () => {
    expect(alternativesFor('zzzz qqqq')).toEqual([]);
    expect(alternativesFor('bench press', 2)).toHaveLength(2);
  });
});

describe('totalTierLadder', () => {
  const rel = (s: number | null, b: number | null, d: number | null) => [
    { lift: 'Squat', ratioToBw: s, tier: 'novice' as const },
    { lift: 'Bench Press', ratioToBw: b, tier: 'novice' as const },
    { lift: 'Deadlift', ratioToBw: d, tier: 'novice' as const },
  ];
  it('sums the big three and places the total on the ladder', () => {
    const l = totalTierLadder(rel(1.6, 1.1, 2.0));
    expect(l.ratio).toBe(4.7);
    expect(l.rungs.map((r) => r.multiple)).toEqual([3, 4.25, 6, 7.5]);
    expect(l.tier).toBe('intermediate');
  });
  it('is untested until all three lifts are known', () => {
    const l = totalTierLadder(rel(1.6, null, 2.0));
    expect(l.ratio).toBeNull();
    expect(l.tier).toBe('untested');
    expect(l.missing).toEqual(['Bench Press']);
  });
});

describe('programFinished', () => {
  const days = (...s: string[]) => s.map((status) => ({ status: status as any }));
  it('is finished past the final week', () => {
    expect(programFinished({ isComplete: true, weekNumber: 12, totalWeeks: 12, days: days('planned') })).toBe(true);
  });
  it('is finished in the final week once every session is logged', () => {
    expect(programFinished({ isComplete: false, weekNumber: 12, totalWeeks: 12, days: days('done', 'rest', 'done', 'rest') })).toBe(true);
  });
  it('is not finished with a session left, or before the final week', () => {
    expect(programFinished({ isComplete: false, weekNumber: 12, totalWeeks: 12, days: days('done', 'today') })).toBe(false);
    expect(programFinished({ isComplete: false, weekNumber: 6, totalWeeks: 12, days: days('done', 'done') })).toBe(false);
    expect(programFinished({ isComplete: false, weekNumber: 1, totalWeeks: 0, days: days('done') })).toBe(false);
  });
});

describe('native tools', () => {
  it('only allows deterministic proposal and read tools', () => {
    expect(isNativeTool('propose_workout_swap')).toBe(true);
    expect(isNativeTool('suggest_session')).toBe(true);
    // Model-backed or write tools are never runnable from a screen.
    expect(isNativeTool('propose_new_program')).toBe(false);
    expect(isNativeTool('log_workout')).toBe(false);
    expect([...NATIVE_TOOLS].every((n) => n.startsWith('propose_') || n === 'suggest_session')).toBe(true);
  });
});
