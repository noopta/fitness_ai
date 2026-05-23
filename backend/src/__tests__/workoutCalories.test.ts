/**
 * Pins the workout-calorie estimator's behaviour so future MET-table edits or
 * formula changes don't silently shift user-facing numbers. The estimator is
 * deliberately approximate (population-average MET × kg × hours), but the
 * shape — heavier user burns more, longer session burns more, cardio > heavy
 * compound > isolation — must hold or the UI's "subtract workout burn"
 * adjustment becomes wrong.
 */

import { describe, it, expect } from 'vitest';
import {
  estimateWorkoutCalories,
  estimateWorkoutCaloriesBreakdown,
  type ExerciseInput,
} from '../services/workoutCalories.js';

describe('estimateWorkoutCalories', () => {
  it('returns 0 for an empty workout', () => {
    expect(estimateWorkoutCalories([], { bodyweightKg: 80 })).toBe(0);
  });

  it('returns 0 when bodyweight is non-positive', () => {
    const ex: ExerciseInput[] = [{ name: 'Bench Press', sets: 4, reps: '8' }];
    expect(estimateWorkoutCalories(ex, { bodyweightKg: 0 })).toBe(0);
    expect(estimateWorkoutCalories(ex, { bodyweightKg: -5 })).toBe(0);
  });

  it('estimates a typical strength session at a reasonable order of magnitude', () => {
    const ex: ExerciseInput[] = [
      { name: 'Back Squat', sets: 4, reps: '5' },
      { name: 'Bench Press', sets: 4, reps: '8' },
      { name: 'Bicep Curl',  sets: 3, reps: '10' },
    ];
    // 80 kg lifter, no explicit duration → estimator derives time from
    // sets × seconds-per-set. Should land in the 200-500 kcal range for a
    // session like this; we assert "above zero, below 1000" rather than a
    // tight number so MET tweaks don't break the test.
    const kcal = estimateWorkoutCalories(ex, { bodyweightKg: 80 });
    expect(kcal).toBeGreaterThan(150);
    expect(kcal).toBeLessThan(1000);
  });

  it('scales linearly with bodyweight', () => {
    const ex: ExerciseInput[] = [{ name: 'Deadlift', sets: 5, reps: '5' }];
    const at60 = estimateWorkoutCalories(ex, { bodyweightKg: 60 });
    const at120 = estimateWorkoutCalories(ex, { bodyweightKg: 120 });
    // 2x bodyweight should yield 2x kcal (formula is kcal = MET × kg × h).
    expect(at120).toBeCloseTo(at60 * 2, 0);
  });

  it('credits cardio higher than isolation work per minute', () => {
    const cardio: ExerciseInput[]    = [{ name: 'Treadmill running', sets: 1, reps: '20 min' }];
    const isolation: ExerciseInput[] = [{ name: 'Tricep Extension',  sets: 1, reps: '12' }];
    const cardioKcal     = estimateWorkoutCalories(cardio, { bodyweightKg: 80 });
    const isolationKcal  = estimateWorkoutCalories(isolation, { bodyweightKg: 80 });
    expect(cardioKcal).toBeGreaterThan(isolationKcal);
  });

  it('prefers the user-provided duration over the sets-based estimate', () => {
    const ex: ExerciseInput[] = [{ name: 'Bench Press', sets: 4, reps: '8' }];
    const noDuration = estimateWorkoutCalories(ex, { bodyweightKg: 80 });
    const longSession = estimateWorkoutCalories(ex, {
      bodyweightKg: 80,
      totalDurationMinutes: 60,
    });
    // 60 min logged > the ~12 min the sets-based path would assume for 4 sets.
    expect(longSession).toBeGreaterThan(noDuration);
  });

  it('falls back to the default bodyweight when not provided', () => {
    const ex: ExerciseInput[] = [{ name: 'Back Squat', sets: 3, reps: '5' }];
    const kcalDefault = estimateWorkoutCalories(ex, {});
    expect(kcalDefault).toBeGreaterThan(0);
  });

  it('breakdown sums to the same total as the headline estimate', () => {
    const ex: ExerciseInput[] = [
      { name: 'Deadlift',   sets: 3, reps: '5' },
      { name: 'Bicep Curl', sets: 3, reps: '10' },
      { name: 'Running',    sets: 1, reps: '10 min' },
    ];
    const total = estimateWorkoutCalories(ex, { bodyweightKg: 80 });
    const breakdown = estimateWorkoutCaloriesBreakdown(ex, { bodyweightKg: 80 });
    const sum = breakdown.reduce((s, b) => s + b.kcal, 0);
    // The two paths share a formula; rounding can drift by 1 kcal per entry.
    expect(Math.abs(sum - total)).toBeLessThanOrEqual(breakdown.length);
  });
});
