import { describe, it, expect } from 'vitest';
import {
  BOUNDS,
  bounded,
  isImplausible,
  implausibilityWarning,
  weightDeltaWarning,
  validateDateOfBirth,
  MIN_AGE_YEARS,
} from '../validation/physiologicalBounds.js';

describe('bounded()', () => {
  it('accepts values inside the hard range', () => {
    expect(bounded('dailyCalories').parse(2400)).toBe(2400);
    expect(bounded('bodyWeightKg').parse(82.5)).toBe(82.5);
  });

  it('rejects the 25,000 calorie troll target', () => {
    // The motivating case: PUT /nutrition/targets had no validation at all.
    expect(() => bounded('dailyCalories').parse(25000)).toThrow();
  });

  it('rejects negative and zero calorie targets', () => {
    expect(() => bounded('dailyCalories').parse(-5000)).toThrow();
    expect(() => bounded('dailyCalories').parse(0)).toThrow();
  });

  it('rejects Infinity, which JSON.parse produces from 1e400', () => {
    // A plain .min()/.max() pair lets Infinity through; .finite() is what stops
    // it, and an Infinity here turns every downstream calculation into NaN.
    expect(JSON.parse('1e400')).toBe(Infinity);
    expect(() => bounded('dailyCalories').parse(Infinity)).toThrow();
    expect(() => bounded('bodyWeightKg').parse(-Infinity)).toThrow();
  });

  it('rejects NaN', () => {
    expect(() => bounded('bodyWeightKg').parse(NaN)).toThrow();
  });

  it('rejects non-numbers', () => {
    expect(() => bounded('dailyCalories').parse('banana' as any)).toThrow();
    expect(() => bounded('dailyCalories').parse(null as any)).toThrow();
  });

  it('rejects a 10,000 kg bench but allows a world-record deadlift', () => {
    expect(() => bounded('liftWeightKg').parse(10000)).toThrow();
    // The raw deadlift world record is ~501 kg; the hard cap must clear it.
    expect(bounded('liftWeightKg').parse(501)).toBe(501);
  });

  it('rejects a 900 cm height', () => {
    expect(() => bounded('heightCm').parse(900)).toThrow();
  });

  it('uses the field label in the error message', () => {
    const result = bounded('dailyCalories', 'Calorie target').safeParse(99999);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toContain('Calorie target');
    }
  });
});

describe('isImplausible / implausibilityWarning', () => {
  it('does not flag ordinary values', () => {
    expect(isImplausible('dailyCalories', 2400)).toBe(false);
    expect(implausibilityWarning('bodyWeightKg', 82)).toBeNull();
  });

  it('flags values that are possible but unusual', () => {
    expect(isImplausible('dailyCalories', 6000)).toBe(true);
    expect(isImplausible('dailyCalories', 900)).toBe(true);
    expect(isImplausible('bodyWeightKg', 250)).toBe(true);
  });

  it('returns a warning string rather than throwing — these are saved, not rejected', () => {
    const warning = implausibilityWarning('dailyCalories', 6000, 'Calorie target');
    expect(warning).toContain('Calorie target');
    expect(warning).toContain('6000');
    // A 6000 kcal target is legitimate for a large athlete bulking, so it must
    // still pass the hard gate.
    expect(bounded('dailyCalories').parse(6000)).toBe(6000);
  });

  it('ignores null and undefined', () => {
    expect(isImplausible('bodyWeightKg', null)).toBe(false);
    expect(implausibilityWarning('bodyWeightKg', undefined)).toBeNull();
  });

  it('keeps soft bounds inside hard bounds for every key', () => {
    for (const [key, b] of Object.entries(BOUNDS)) {
      expect(b.hardMin, key).toBeLessThanOrEqual(b.softMin);
      expect(b.softMax, key).toBeLessThanOrEqual(b.hardMax);
    }
  });
});

describe('weightDeltaWarning', () => {
  it('is silent for a normal day-to-day change', () => {
    expect(weightDeltaWarning(82, 82.6)).toBeNull();
  });

  it('flags a lbs-typed-into-kg mixup', () => {
    // 180 lbs entered as 180 kg against a previous 82 kg entry.
    const warning = weightDeltaWarning(82, 180);
    expect(warning).toContain('98.0 kg');
    expect(warning).toContain('right unit');
  });

  it('is silent when there is no previous entry', () => {
    expect(weightDeltaWarning(null, 180)).toBeNull();
    expect(weightDeltaWarning(undefined, 180)).toBeNull();
  });
});

describe('validateDateOfBirth', () => {
  const isoYearsAgo = (years: number) => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - years);
    return d.toISOString().slice(0, 10);
  };

  it('accepts an ordinary adult DOB', () => {
    expect(validateDateOfBirth(isoYearsAgo(30))).toBeNull();
  });

  it('enforces the 13+ floor', () => {
    expect(validateDateOfBirth(isoYearsAgo(10))).toContain(String(MIN_AGE_YEARS));
  });

  it('rejects a future date of birth', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 5);
    expect(validateDateOfBirth(future.toISOString().slice(0, 10))).toContain('future');
  });

  it('rejects an impossible age — the old check only had a lower bound', () => {
    expect(validateDateOfBirth('1200-01-01')).not.toBeNull();
  });

  it('rejects unparseable input', () => {
    expect(validateDateOfBirth('not-a-date')).toBe('Invalid date of birth.');
  });
});
