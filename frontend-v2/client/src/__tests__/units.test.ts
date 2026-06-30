import { describe, it, expect } from 'vitest';
import {
  kgToLb, lbToKg, normalizePreference, unitLabel, displayWeight, formatWeight, toKg,
} from '@/lib/units';

describe('web units conversion', () => {
  it('round-trips kg⇄lb', () => {
    expect(lbToKg(kgToLb(100))).toBeCloseTo(100, 6);
  });
  it('exact avoirdupois pound', () => {
    expect(kgToLb(100)).toBeCloseTo(220.462, 2);
    expect(lbToKg(225)).toBeCloseTo(102.058, 2);
  });
});

describe('normalizePreference', () => {
  it('only "metric" is metric', () => {
    expect(normalizePreference('metric')).toBe('metric');
    expect(normalizePreference('imperial')).toBe('imperial');
    expect(normalizePreference(null)).toBe('imperial');
    expect(normalizePreference(undefined)).toBe('imperial');
  });
});

describe('displayWeight / formatWeight / unitLabel', () => {
  it('imperial converts, metric passes through', () => {
    expect(displayWeight(100, 'imperial')).toBe(220);
    expect(displayWeight(100, 'metric')).toBe(100);
  });
  it('formats + omits null/NaN', () => {
    expect(formatWeight(100, 'imperial')).toBe('220 lbs');
    expect(formatWeight(84, 'metric')).toBe('84 kg');
    expect(formatWeight(null, 'metric')).toBe('');
    expect(formatWeight(NaN, 'imperial')).toBe('');
  });
  it('unitLabel', () => {
    expect(unitLabel('metric')).toBe('kg');
    expect(unitLabel('imperial')).toBe('lbs');
  });
});

describe('toKg (input → canonical kg)', () => {
  it('imperial lb→kg, metric identity', () => {
    expect(toKg(225, 'imperial')).toBeCloseTo(102.058, 2);
    expect(toKg(84, 'metric')).toBe(84);
    expect(toKg(null, 'metric')).toBeNull();
  });
  it('imperial round-trips with displayWeight (no drift for a typed value)', () => {
    // user types 185 lbs → store kg → display back == 185
    const kg = toKg(185, 'imperial')!;
    expect(displayWeight(kg, 'imperial')).toBe(185);
  });
});
