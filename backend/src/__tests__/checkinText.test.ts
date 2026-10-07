import { describe, it, expect } from 'vitest';
import { describeCheckin, meanAnswered } from '../services/checkinText.js';

describe('describeCheckin', () => {
  it('lists every answered field', () => {
    expect(describeCheckin({ mood: 4, energy: 3, sleepHours: 7, stress: 3 })).toBe('mood 4/5, energy 3/5, sleep 7h, stress 3/10');
  });
  it('leaves out what was skipped instead of reading it as a low score', () => {
    expect(describeCheckin({ mood: null, energy: null, sleepHours: 6, stress: null })).toBe('sleep 6h');
  });
  it('says so when nothing was answered', () => {
    expect(describeCheckin({})).toBe('no answers');
  });
});

describe('meanAnswered', () => {
  it('averages only answered values', () => {
    expect(meanAnswered([4, null, 2, undefined])).toBe(3);
  });
  it('is null when nothing was answered', () => {
    expect(meanAnswered([null, undefined])).toBeNull();
  });
});
