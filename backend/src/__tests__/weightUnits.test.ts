import { describe, it, expect } from 'vitest';
import {
  kgToLb, lbToKg, normalizePreference, unitLabel, displayWeight, formatWeight,
  parseToKg, isMetricRegion, detectUnitPreferenceFromAcceptLanguage,
} from '../services/weightUnits.js';
import { prDisplay } from '../services/progressService.js';

describe('kg⇄lb conversion', () => {
  it('round-trips within float tolerance', () => {
    expect(lbToKg(kgToLb(100))).toBeCloseTo(100, 6);
  });
  it('uses the exact avoirdupois pound', () => {
    expect(kgToLb(100)).toBeCloseTo(220.462, 2);
    expect(lbToKg(225)).toBeCloseTo(102.058, 2);
  });
});

describe('normalizePreference', () => {
  it('only "metric" is metric; everything else imperial', () => {
    expect(normalizePreference('metric')).toBe('metric');
    expect(normalizePreference('imperial')).toBe('imperial');
    expect(normalizePreference(null)).toBe('imperial');
    expect(normalizePreference('garbage')).toBe('imperial');
  });
});

describe('displayWeight / formatWeight / unitLabel', () => {
  it('imperial converts kg→lb; metric passes through', () => {
    expect(displayWeight(100, 'imperial')).toBe(220);
    expect(displayWeight(100, 'metric')).toBe(100);
  });
  it('formats with the right label, omits null', () => {
    expect(formatWeight(100, 'imperial')).toBe('220 lbs');
    expect(formatWeight(84, 'metric')).toBe('84 kg');
    expect(formatWeight(null, 'metric')).toBeNull();
    expect(formatWeight(NaN, 'imperial')).toBeNull();
  });
  it('unitLabel', () => {
    expect(unitLabel('metric')).toBe('kg');
    expect(unitLabel('imperial')).toBe('lbs');
  });
});

describe('parseToKg (input → canonical kg)', () => {
  it('imperial input is lb→kg; metric is identity', () => {
    expect(parseToKg(225, 'imperial')).toBeCloseTo(102.058, 2);
    expect(parseToKg(84, 'metric')).toBe(84);
    expect(parseToKg(null, 'metric')).toBeNull();
  });
});

describe('locale → default unit', () => {
  it('EU/metric regions are metric', () => {
    expect(isMetricRegion('DE')).toBe(true);
    expect(isMetricRegion('fr')).toBe(true); // case-insensitive
    expect(isMetricRegion('GB')).toBe(true);
    expect(isMetricRegion('AU')).toBe(true);
  });
  it('US (and unknown) are imperial', () => {
    expect(isMetricRegion('US')).toBe(false);
    expect(isMetricRegion(null)).toBe(false);
    expect(isMetricRegion('ZZ')).toBe(false);
  });
  it('reads the region from Accept-Language', () => {
    expect(detectUnitPreferenceFromAcceptLanguage('de-DE,de;q=0.9')).toBe('metric');
    expect(detectUnitPreferenceFromAcceptLanguage('en-US,en;q=0.9')).toBe('imperial');
    expect(detectUnitPreferenceFromAcceptLanguage('fr-FR')).toBe('metric');
    expect(detectUnitPreferenceFromAcceptLanguage('en-GB')).toBe('metric');
  });
  it('defaults imperial with no/region-less header', () => {
    expect(detectUnitPreferenceFromAcceptLanguage(undefined)).toBe('imperial');
    expect(detectUnitPreferenceFromAcceptLanguage('en')).toBe('imperial');
    expect(detectUnitPreferenceFromAcceptLanguage('')).toBe('imperial');
  });
  it('skips a region-less leading tag to find the first with a region', () => {
    expect(detectUnitPreferenceFromAcceptLanguage('en,de-DE;q=0.8')).toBe('metric');
  });
});

describe('prDisplay (PR push value+unit)', () => {
  it('imperial keeps lbs; metric converts to kg', () => {
    expect(prDisplay(225, 'imperial')).toEqual({ value: 225, unit: 'lbs' });
    expect(prDisplay(225, 'metric')).toEqual({ value: 102, unit: 'kg' });
  });
});
