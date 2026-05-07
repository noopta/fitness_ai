/**
 * Pure-helper tests for the progress reinforcement layer:
 *   - Epley e1RM math
 *   - Body-weight milestone crossing detection
 *   - Goal-direction inference (drives weight + nutrition reinforcement)
 *   - Protein target g/day calc + consecutive-day streak walker
 *
 * These functions are intentionally side-effect free so the rules can be
 * audited in tests rather than reasoned about against a live DB.
 */

import { describe, it, expect } from 'vitest';
import {
  epley1RM,
  bestE1RMByLift,
  inferGoalDirection,
  crossedWeightMilestones,
  computeProteinTargetG,
  computeProteinStreak,
} from '../services/progressService.js';

describe('epley1RM', () => {
  it('matches the textbook formula at 5 reps', () => {
    expect(epley1RM(225, 5)).toBe(Math.round(225 * (1 + 5 / 30))); // 263
  });

  it('clamps reps to 10 to keep estimates honest', () => {
    expect(epley1RM(135, 20)).toBe(epley1RM(135, 10));
  });

  it('treats reps below 1 as 1', () => {
    // Clamping reps to 1 is intentional — we still apply the Epley multiplier,
    // so 135 lbs at 1 rep yields 135 * 31/30 ≈ 140.
    expect(epley1RM(135, 0)).toBe(epley1RM(135, 1));
  });
});

describe('bestE1RMByLift', () => {
  it('keeps the highest e1RM across multiple sets of the same lift', () => {
    const ex = [
      { name: 'Bench Press', sets: 1, reps: 5, weightKg: 100 },
      { name: 'bench press', sets: 1, reps: 8, weightKg: 90 }, // lower e1RM
      { name: 'Squat', sets: 1, reps: 3, weightKg: 140 },
    ];
    const out = bestE1RMByLift(ex);
    expect(out.size).toBe(2);
    expect(out.get('bench press')!.displayName).toBe('Bench Press'); // first wins
    // 100 kg @ 5 reps → 220.46 lbs * (1+5/30) = 257.2 → rounded 257
    expect(out.get('bench press')!.e1RMLbs).toBeGreaterThanOrEqual(255);
  });

  it('skips sets with no weight or out-of-range reps', () => {
    const ex = [
      { name: 'A', sets: 1, reps: 5, weightKg: 0 },
      { name: 'B', sets: 1, reps: 12, weightKg: 50 }, // reps too high
      { name: 'C', sets: 1, reps: 5 } as any,         // missing weight
    ];
    expect(bestE1RMByLift(ex).size).toBe(0);
  });

  it("handles reps strings like '6-8' by taking the lower bound", () => {
    const ex = [{ name: 'OHP', sets: 1, reps: '6-8', weightKg: 50 }];
    const out = bestE1RMByLift(ex);
    expect(out.get('ohp')!.e1RMLbs).toBe(epley1RM(50 * 2.20462, 6));
  });
});

describe('inferGoalDirection', () => {
  it('detects fat-loss phrasings', () => {
    for (const goal of ['lose 10 lbs', 'cutting cycle', 'lean down', 'fat loss']) {
      expect(inferGoalDirection(goal)).toBe('lose');
    }
  });
  it('detects mass-gain phrasings', () => {
    expect(inferGoalDirection('lean bulk')).toBe('gain');
    expect(inferGoalDirection('add mass')).toBe('gain');
  });
  it('falls back to maintain when ambiguous or empty', () => {
    expect(inferGoalDirection(null)).toBe('maintain');
    expect(inferGoalDirection('')).toBe('maintain');
    expect(inferGoalDirection('feel better')).toBe('maintain');
  });
});

describe('crossedWeightMilestones', () => {
  it('fires only the milestones newly crossed since the prior log', () => {
    // Starting 200, prior 196 (4 lbs down — no milestone), now 195 (5 lbs down — fire 5)
    expect(crossedWeightMilestones(200, 196, 195, 'lose')).toEqual([5]);
  });

  it('can fire multiple milestones in one log if a user skipped a logging day', () => {
    // Prior 199 (1 lb), now 188 (12 lbs) → cross 5 and 10
    expect(crossedWeightMilestones(200, 199, 188, 'lose')).toEqual([5, 10]);
  });

  it('does not re-fire a milestone the prior log already crossed', () => {
    expect(crossedWeightMilestones(200, 192, 191, 'lose')).toEqual([]);
  });

  it('mirrors logic for mass-gain (negative deltas)', () => {
    expect(crossedWeightMilestones(160, 164, 165, 'gain')).toEqual([5]);
  });

  it('returns no milestones for maintain goals — reinforcement opt-out', () => {
    expect(crossedWeightMilestones(200, 195, 190, 'maintain')).toEqual([]);
  });
});

describe('computeProteinTargetG', () => {
  it('returns null when weight is missing', () => {
    expect(computeProteinTargetG(null, 'lose fat')).toBeNull();
  });

  it('uses the goal-aware multiplier', () => {
    // weightKg 80 × 2.2 (fat loss) = 176
    expect(computeProteinTargetG(80, 'fat loss')).toBe(176);
    // weightKg 80 × 2.1 (hypertrophy)
    expect(computeProteinTargetG(80, 'hypertrophy')).toBe(168);
  });
});

describe('computeProteinStreak', () => {
  it('counts consecutive backward-from-today days at ≥85% of target', () => {
    const target = 160;
    const cutoff = Math.round(target * 0.85); // 136
    const m = new Map<string, number>([
      ['2026-05-07', 150],
      ['2026-05-06', 140],
      ['2026-05-05', 138],
      ['2026-05-04', 100], // breaks streak
      ['2026-05-03', 145],
    ]);
    expect(computeProteinStreak('2026-05-07', m, target)).toBe(3);
    expect(cutoff).toBeLessThan(140); // sanity on the threshold
  });

  it('returns 0 when today is not a hit', () => {
    const m = new Map([['2026-05-07', 80]]);
    expect(computeProteinStreak('2026-05-07', m, 160)).toBe(0);
  });
});
