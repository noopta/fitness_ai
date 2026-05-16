import { describe, it, expect } from 'vitest';
import {
  assumedRIR, parseRPE, effectiveReps, e1rmWithRpe, e1rmPlain, e1rmConfidence,
} from '../engine/e1rm.js';

describe('assumedRIR', () => {
  it('lower reps assume closer to failure', () => {
    expect(assumedRIR(1)).toBeLessThan(assumedRIR(8));
    expect(assumedRIR(3)).toBeLessThan(assumedRIR(12));
  });
  it('caps at 3 for high reps', () => {
    expect(assumedRIR(20)).toBe(3);
  });
});

describe('parseRPE', () => {
  it('parses valid numeric + string RPE', () => {
    expect(parseRPE(8)).toBe(8);
    expect(parseRPE('7.5')).toBe(7.5);
  });
  it('rejects empty / out-of-range / garbage', () => {
    expect(parseRPE('')).toBeNull();
    expect(parseRPE(null)).toBeNull();
    expect(parseRPE(0)).toBeNull();
    expect(parseRPE(11)).toBeNull();
    expect(parseRPE('abc')).toBeNull();
  });
});

describe('effectiveReps', () => {
  it('RPE present → reps + (10 - RPE)', () => {
    expect(effectiveReps(5, 7)).toBe(8);   // 3 RIR
    expect(effectiveReps(5, 10)).toBe(5);  // 0 RIR, at failure
    expect(effectiveReps(3, 9)).toBe(4);   // 1 RIR
  });
  it('RPE absent → rep-range-aware assumed RIR', () => {
    expect(effectiveReps(5)).toBe(5 + assumedRIR(5));
    expect(effectiveReps(12)).toBe(12 + assumedRIR(12));
  });
  it('zero reps → zero', () => {
    expect(effectiveReps(0, 8)).toBe(0);
  });
});

describe('e1rmWithRpe vs e1rmPlain', () => {
  it('RPE 10 (to failure) ≈ plain Epley', () => {
    // At RPE 10, RIR = 0, so effective reps == logged reps == plain Epley input.
    expect(e1rmWithRpe(100, 5, 10)).toBe(e1rmPlain(100, 5));
  });

  it('sub-failure RPE yields a higher e1RM than plain Epley', () => {
    // 100kg × 5 @ RPE 7 means 3 reps left → effective 8 reps → higher e1RM.
    const rpeAware = e1rmWithRpe(100, 5, 7);
    const plain = e1rmPlain(100, 5);
    expect(rpeAware).toBeGreaterThan(plain);
  });

  it('absent RPE still beats plain Epley (assumed reps in reserve)', () => {
    expect(e1rmWithRpe(100, 5)).toBeGreaterThan(e1rmPlain(100, 5));
  });

  it('single rep returns the weight itself', () => {
    expect(e1rmWithRpe(140, 1, 10)).toBe(140);
    expect(e1rmPlain(140, 1)).toBe(140);
  });

  it('invalid input returns 0', () => {
    expect(e1rmWithRpe(0, 5, 8)).toBe(0);
    expect(e1rmWithRpe(100, 0, 8)).toBe(0);
    expect(e1rmWithRpe(100, 20, 8)).toBe(0); // beyond 15 reps
  });

  it('caps effective reps so a deep set does not produce nonsense', () => {
    // 100kg × 12 @ RPE 5 → 5 RIR → effective 17, capped to 12.
    const capped = e1rmWithRpe(100, 12, 5);
    const at12 = Math.round(100 * (1 + 12 / 30));
    expect(capped).toBe(at12);
  });
});

describe('e1rmConfidence', () => {
  it('logged RPE scores higher confidence than assumed', () => {
    expect(e1rmConfidence(5, 8)).toBeGreaterThan(e1rmConfidence(5));
  });
  it('very high reps erode confidence', () => {
    expect(e1rmConfidence(15, 8)).toBeLessThan(e1rmConfidence(5, 8));
  });
  it('stays within [0.3, 1]', () => {
    for (const reps of [1, 5, 10, 15]) {
      for (const rpe of [null, 5, 8, 10]) {
        const c = e1rmConfidence(reps, rpe);
        expect(c).toBeGreaterThanOrEqual(0.3);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
  });
});
