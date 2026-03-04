/**
 * Unit tests for the rules engine — volume constraints and accessory selection.
 */

import { describe, it, expect } from 'vitest';
import {
  getVolumeConstraints,
  getApprovedAccessories,
} from '../engine/rulesEngine.js';

// ─── Volume constraints ────────────────────────────────────────────────────────

describe('getVolumeConstraints', () => {
  it('beginner gets the lowest volume caps', () => {
    const c = getVolumeConstraints('beginner');
    expect(c.maxTotalSets).toBe(12);
    expect(c.maxCompoundSets).toBe(5);
    expect(c.maxAccessorySets).toBe(9);
  });

  it('intermediate gets mid-range caps', () => {
    const c = getVolumeConstraints('intermediate');
    expect(c.maxTotalSets).toBe(18);
    expect(c.maxCompoundSets).toBe(8);
    expect(c.maxAccessorySets).toBe(12);
  });

  it('advanced gets the highest volume caps', () => {
    const c = getVolumeConstraints('advanced');
    expect(c.maxTotalSets).toBe(25);
    expect(c.maxCompoundSets).toBe(10);
    expect(c.maxAccessorySets).toBe(18);
  });

  it('unknown/undefined training age gets default caps', () => {
    const c = getVolumeConstraints(undefined);
    expect(c.maxTotalSets).toBe(15);
    expect(c.maxCompoundSets).toBe(6);
    expect(c.maxAccessorySets).toBe(10);
  });

  it('volume caps are in ascending order: beginner < intermediate < advanced', () => {
    const b = getVolumeConstraints('beginner');
    const im = getVolumeConstraints('intermediate');
    const a = getVolumeConstraints('advanced');
    expect(b.maxTotalSets).toBeLessThan(im.maxTotalSets);
    expect(im.maxTotalSets).toBeLessThan(a.maxTotalSets);
  });

  it('accessory sets are always less than total sets', () => {
    for (const age of ['beginner', 'intermediate', 'advanced', undefined]) {
      const c = getVolumeConstraints(age);
      expect(c.maxAccessorySets).toBeLessThan(c.maxTotalSets);
    }
  });
});

// ─── Approved accessories ─────────────────────────────────────────────────────

describe('getApprovedAccessories', () => {
  it('returns an array for a valid lift + limiters', () => {
    const exercises = getApprovedAccessories(
      'flat_bench_press',
      ['triceps_weakness'],
      'commercial'
    );
    expect(Array.isArray(exercises)).toBe(true);
  });

  it('returns empty array for unknown lift', () => {
    const exercises = getApprovedAccessories('unknown_lift', ['some_limiter'], 'commercial');
    expect(exercises).toHaveLength(0);
  });

  it('returns empty array when no limiters provided', () => {
    const exercises = getApprovedAccessories('flat_bench_press', [], 'commercial');
    expect(exercises).toHaveLength(0);
  });

  it('each returned exercise has id and name fields', () => {
    const exercises = getApprovedAccessories(
      'deadlift',
      ['off_floor_weakness'],
      'commercial'
    );
    for (const ex of exercises) {
      expect(ex).toHaveProperty('id');
      expect(ex).toHaveProperty('name');
    }
  });
});
