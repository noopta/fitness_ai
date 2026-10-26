// Oct 2026: a new user's bench press and deadlift showed "BW" and saved with no
// weight, because "no known weight" was read as "bodyweight". loadKind decides
// from the lift instead.
import { describe, it, expect } from 'vitest';
import { loadKind } from '../src/workout';

describe('loadKind', () => {
  it('barbell, dumbbell and machine lifts take a weight', () => {
    for (const n of ['Bench Press', 'Deadlift', 'Incline Bench Press', 'Back Squat', 'Romanian Deadlift', 'Overhead Press', 'Lat Pulldown', 'Cable Crunch', 'Machine Dip', 'Dumbbell Lunge', 'Barbell Hip Thrust', 'Leg Press']) {
      expect(loadKind(n), n).toBe('weighted');
    }
  });
  it('bodyweight lifts are bodyweight (a weight is added weight)', () => {
    for (const n of ['Pull-Up', 'Chin-ups', 'Push-ups', 'Dips', 'Plank', 'Hanging Leg Raise', 'Inverted Row', 'Weighted Pull-up', 'Air Squat', 'Burpees']) {
      expect(loadKind(n), n).toBe('bodyweight');
    }
  });
  it('lifts done either way ask', () => {
    for (const n of ['Walking Lunges', 'Bulgarian Split Squat', 'Step-ups', 'Calf Raise', 'Back Extension', 'Glute Bridge']) {
      expect(loadKind(n), n).toBe('either');
    }
  });
  it('the session’s own bodyweight flag wins', () => {
    expect(loadKind('Bench Press', true)).toBe('bodyweight');
  });
});
