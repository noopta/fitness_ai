import { describe, it, expect } from 'vitest';
import { programFlightKey } from '../routes/coach.js';

describe('programFlightKey — a repeat request joins the running generation', () => {
  const base = { daysPerWeek: 6, durationWeeks: 12, goal: 'strength', save: false };
  it('is the same for the same user and request regardless of key order or tier', () => {
    expect(programFlightKey('u1', { ...base, tier: 'pro' })).toBe(programFlightKey('u1', { save: false, goal: 'strength', durationWeeks: 12, daysPerWeek: 6 }));
  });
  it('differs across users and across different requests', () => {
    expect(programFlightKey('u1', base)).not.toBe(programFlightKey('u2', base));
    expect(programFlightKey('u1', base)).not.toBe(programFlightKey('u1', { ...base, daysPerWeek: 4 }));
  });
});
