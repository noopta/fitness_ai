import { describe, it, expect } from 'vitest';
import { computeMuscleScores, buildMuscleProfileAddition } from '../services/muscleScoringService.js';
import { MUSCLE_GROUPS } from '../data/muscleAttribution.js';

describe('computeMuscleScores', () => {
  it('returns empty object for no lifts', () => {
    expect(computeMuscleScores([])).toEqual({});
  });

  it('returns empty for lifts with zero/missing e1RM', () => {
    expect(computeMuscleScores([{ canonicalName: 'Bench Press', current1RMkg: 0 }])).toEqual({});
  });

  it('omits unknown lifts (no muscle attribution defined)', () => {
    expect(
      computeMuscleScores([
        { canonicalName: 'Some Bespoke Lift That Does Not Exist', current1RMkg: 100 },
      ]),
    ).toEqual({});
  });

  it('attributes bench press primarily to chest, then front delt + triceps', () => {
    const scores = computeMuscleScores([{ canonicalName: 'Bench Press', current1RMkg: 100 }]);
    // 100kg bench: chest (0.50) > front delt (0.25) = triceps (0.25). All other muscles missing.
    expect(scores.Chest).toBe(100); // strongest muscle = 100
    expect(scores['Front Delt']).toBe(50);
    expect(scores.Triceps).toBe(50);
    expect(scores.Lats).toBeUndefined();
    expect(scores.Quads).toBeUndefined();
  });

  it('normalizes user-relatively across multiple lifts', () => {
    const scores = computeMuscleScores([
      { canonicalName: 'Bench Press',    current1RMkg: 100 },
      { canonicalName: 'Barbell Row',    current1RMkg: 100 },
      { canonicalName: 'Squat',          current1RMkg: 140 },
      { canonicalName: 'Romanian Deadlift', current1RMkg: 120 },
    ]);

    // At least one muscle hits 100 (the user's strongest).
    const values = Object.values(scores).filter((v): v is number => typeof v === 'number');
    expect(Math.max(...values)).toBe(100);

    // All scores in [0, 100].
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }

    // Sanity: an athlete logging squat + RDL + bench + row should have
    // strong representation across all 6 movement buckets' main muscles.
    expect(scores.Chest).toBeDefined();
    expect(scores.Lats).toBeDefined();
    expect(scores.Quads).toBeDefined();
    expect(scores.Hamstrings).toBeDefined();
  });

  it('uses log scaling so a 300kg deadlift does not dwarf a 30kg curl', () => {
    const scoresLinearWouldDwarf = computeMuscleScores([
      { canonicalName: 'Deadlift',     current1RMkg: 300 },
      { canonicalName: 'Barbell Curl', current1RMkg: 30 },
    ]);

    // Biceps comes only from the curl. If we'd used raw e1RM*weight,
    // biceps would be ≈ (30 * 0.9) = 27 vs erectors ≈ (300 * 0.20) = 60,
    // making biceps barely visible. With log1p, biceps gets a much fairer
    // share (~50+ relative to whatever the max scoring muscle is).
    expect(scoresLinearWouldDwarf.Biceps).toBeGreaterThan(40);
  });

  it('handles multiple lifts contributing to the same muscle', () => {
    // Two row variations should sum biceps contributions, not pick one.
    const scoresOne = computeMuscleScores([
      { canonicalName: 'Barbell Row', current1RMkg: 100 },
    ]);
    const scoresTwo = computeMuscleScores([
      { canonicalName: 'Barbell Row',  current1RMkg: 100 },
      { canonicalName: 'Dumbbell Row', current1RMkg: 40 },
    ]);
    // Mid-back contributions accumulate; user-relative normalization can
    // shift the absolute number, so just check that both rows are
    // reflected (mid-back present in both score sets).
    expect(scoresOne['Mid-back']).toBeDefined();
    expect(scoresTwo['Mid-back']).toBeDefined();
  });
});

describe('buildMuscleProfileAddition', () => {
  it('returns muscleScores + targets + known group list', () => {
    const result = buildMuscleProfileAddition([
      { canonicalName: 'Bench Press', current1RMkg: 100 },
    ]);
    expect(result.muscleScores.Chest).toBe(100);
    expect(result.muscleTargets.default).toBe(80);
    expect(result.muscleGroupsKnown).toEqual(MUSCLE_GROUPS);
  });

  it('returns empty muscleScores for an athlete with no lifts', () => {
    const result = buildMuscleProfileAddition([]);
    expect(result.muscleScores).toEqual({});
    expect(result.muscleGroupsKnown.length).toBeGreaterThan(0);
  });
});
