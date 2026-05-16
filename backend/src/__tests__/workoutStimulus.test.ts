import { describe, it, expect } from 'vitest';
import { dissectWorkout, mergeStimulus } from '../services/workoutStimulusService.js';
import { intensityZone, movementPatternFor, muscleRoleFor } from '../data/liftMechanics.js';

describe('liftMechanics', () => {
  it('classifies movement patterns', () => {
    expect(movementPatternFor('Bench Press')).toBe('horizontal-push');
    expect(movementPatternFor('Pull-Up')).toBe('vertical-pull');
    expect(movementPatternFor('Deadlift')).toBe('hinge');
    expect(movementPatternFor('Kettlebell Swing')).toBe('explosive');
    expect(movementPatternFor('Some Unknown Lift')).toBeNull();
  });

  it('classifies intensity zone by rep range', () => {
    expect(intensityZone('Bench Press', 3)).toBe('strength');
    expect(intensityZone('Bench Press', 8)).toBe('hypertrophy');
    expect(intensityZone('Bench Press', 15)).toBe('endurance');
    // Explosive lifts are 'power' regardless of reps
    expect(intensityZone('Kettlebell Swing', 12)).toBe('power');
  });

  it('classifies muscle role from attribution weight', () => {
    // Bench: chest 0.50 (prime), front delt 0.25 (synergist)
    expect(muscleRoleFor('Bench Press', 'Chest')).toBe('prime');
    expect(muscleRoleFor('Bench Press', 'Front Delt')).toBe('synergist');
    // A muscle the lift doesn't train
    expect(muscleRoleFor('Bench Press', 'Hamstrings')).toBeNull();
  });
});

describe('dissectWorkout', () => {
  it('returns empty stimulus for no exercises', () => {
    const s = dissectWorkout([]);
    expect(s.totalTonnageKg).toBe(0);
    expect(s.totalHardSets).toBe(0);
    expect(Object.keys(s.perMuscle)).toHaveLength(0);
  });

  it('dissects a bench press into chest/front-delt/triceps', () => {
    const s = dissectWorkout([
      { name: 'Bench Press', sets: 3, reps: 8, weightKg: 100, rpe: 8 },
    ]);
    // 100kg × 8 reps × 3 sets = 2400kg tonnage
    expect(s.totalTonnageKg).toBe(2400);
    expect(s.totalHardSets).toBe(3);
    // Chest gets 50% of the tonnage
    expect(s.perMuscle.Chest?.tonnageKg).toBe(1200);
    expect(s.perMuscle['Front Delt']?.tonnageKg).toBe(600);
    expect(s.perMuscle.Triceps?.tonnageKg).toBe(600);
    // 8 reps → hypertrophy zone
    expect(s.perMuscle.Chest?.byZone.hypertrophy).toBe(1200);
    expect(s.perMuscle.Chest?.byZone.strength).toBe(0);
  });

  it('tracks movement pattern coverage', () => {
    const s = dissectWorkout([
      { name: 'Bench Press', sets: 3, reps: 5, weightKg: 100 },
      { name: 'Pull-Up', sets: 4, reps: 8, weightKg: 90 },
    ]);
    expect(s.patternsCovered['horizontal-push']).toBe(3);
    expect(s.patternsCovered['vertical-pull']).toBe(4);
  });

  it('skips unmapped lifts and zero-volume sets', () => {
    const s = dissectWorkout([
      { name: 'Bench Press', sets: 0, reps: 8, weightKg: 100 },     // 0 sets
      { name: 'Bench Press', sets: 3, reps: 0, weightKg: 100 },     // 0 reps
      { name: 'Mystery Machine', sets: 3, reps: 8, weightKg: 100 }, // unmapped
    ]);
    expect(s.totalHardSets).toBe(0);
    expect(Object.keys(s.perMuscle)).toHaveLength(0);
  });

  it('accumulates two lifts into the same muscle', () => {
    const s = dissectWorkout([
      { name: 'Bench Press', sets: 3, reps: 8, weightKg: 100 },
      { name: 'Incline Bench Press', sets: 3, reps: 8, weightKg: 80 },
    ]);
    // Chest scored by both lifts — tonnage should exceed either alone.
    expect(s.perMuscle.Chest!.tonnageKg).toBeGreaterThan(1200);
  });
});

describe('mergeStimulus', () => {
  it('sums tonnage + hard sets across workouts, maxes e1RM', () => {
    const w1 = dissectWorkout([{ name: 'Bench Press', sets: 3, reps: 5, weightKg: 100, rpe: 9 }]);
    const w2 = dissectWorkout([{ name: 'Bench Press', sets: 3, reps: 5, weightKg: 110, rpe: 9 }]);
    const merged = mergeStimulus([w1, w2]);
    expect(merged.totalTonnageKg).toBe(w1.totalTonnageKg + w2.totalTonnageKg);
    expect(merged.totalHardSets).toBe(6);
    // bestE1rm reflects the heavier session
    expect(merged.perMuscle.Chest!.bestE1rmKg).toBe(w2.perMuscle.Chest!.bestE1rmKg);
  });

  it('merging an empty list yields an empty stimulus', () => {
    const merged = mergeStimulus([]);
    expect(merged.totalTonnageKg).toBe(0);
    expect(Object.keys(merged.perMuscle)).toHaveLength(0);
  });
});
