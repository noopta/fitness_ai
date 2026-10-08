import { describe, it, expect } from 'vitest';
import { sessionAt } from '../services/programPhaseService.js';
import { userSetTargets, resolveTargets } from '../services/nutritionTargets.js';

describe('sessionAt — rest days hold their weekday', () => {
  const days = [{ day: 'Mon — Push', exercises: [{ name: 'Bench' }] }, { day: 'Tue — Rest', exercises: [] }, { day: 'Wed — Legs', exercises: [{ name: 'Squat' }] }];
  it('is the day with exercises, null for a rest placeholder or past the end', () => {
    expect(sessionAt(days, 0)?.day).toBe('Mon — Push');
    expect(sessionAt(days, 1)).toBeNull();
    expect(sessionAt(days, 2)?.day).toBe('Wed — Legs');
    expect(sessionAt(days, 5)).toBeNull();
    expect(sessionAt(days, -1)).toBeNull();
  });
});

describe('user-set targets', () => {
  it('only counts targets the user chose', () => {
    expect(userSetTargets(JSON.stringify({ nutritionTargets: { calories: 1900, proteinG: 180, userSet: true } }))).toEqual({ calories: 1900, proteinG: 180 });
    expect(userSetTargets(JSON.stringify({ nutritionTargets: { calories: 2888 } }))).toBeNull();
    expect(userSetTargets(null)).toBeNull();
  });
  it('a freestyle user with their own 1900 sees 1900', () => {
    expect(resolveTargets({ savedProgram: null, coachProfile: JSON.stringify({ nutritionTargets: { calories: 1900, userSet: true } }), dailyCalorieTarget: 1900 })).toMatchObject({ calories: 1900, source: 'quick' });
  });
});

describe('sessionAt — older day shapes', () => {
  it('treats a day without an exercises field as a session', () => {
    expect(sessionAt([{ day: 'Push' } as any], 0)?.day).toBe('Push');
  });
});
