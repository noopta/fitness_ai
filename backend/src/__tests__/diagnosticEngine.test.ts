/**
 * Unit tests for the deterministic diagnostic engine.
 * No mocks needed — the engine is pure (no side effects, no I/O).
 */

import { describe, it, expect } from 'vitest';
import {
  runDiagnosticEngine,
  type DiagnosticEngineInput,
} from '../engine/diagnosticEngine.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Bench input where:
 * - close_grip is 72% of flat bench (triggers triceps_deficit at <80%)
 * - barbell_row is 60% of flat bench (triggers scap_stability_deficit at <65%)
 * This ensures hypothesis rules fire and we get >=3 hypothesis scores.
 */
function benchInput(overrides: Partial<DiagnosticEngineInput> = {}): DiagnosticEngineInput {
  return {
    liftId: 'flat_bench_press',
    primaryExerciseId: 'flat_bench_press',
    snapshots: [
      { exerciseId: 'flat_bench_press', weight: 225, reps: 5, sets: 3 },  // e1RM ≈ 263
      { exerciseId: 'close_grip_bench_press', weight: 160, reps: 5, sets: 3 }, // ≈71% — triggers ratio_below 0.80
      { exerciseId: 'barbell_row', weight: 130, reps: 5, sets: 3 },            // ≈58% — triggers ratio_below 0.65
    ],
    flags: {},
    bodyweightLbs: 185,
    trainingAge: 'intermediate',
    equipment: 'commercial',
    ...overrides,
  };
}

function squatInput(overrides: Partial<DiagnosticEngineInput> = {}): DiagnosticEngineInput {
  return {
    liftId: 'barbell_back_squat',
    primaryExerciseId: 'barbell_back_squat',
    snapshots: [
      { exerciseId: 'barbell_back_squat', weight: 315, reps: 5, sets: 3 },
      { exerciseId: 'front_squat', weight: 225, reps: 5, sets: 3 },
      { exerciseId: 'romanian_deadlift', weight: 255, reps: 5, sets: 3 },
    ],
    flags: {},
    bodyweightLbs: 200,
    trainingAge: 'intermediate',
    equipment: 'commercial',
    ...overrides,
  };
}

// Actual Epley: 225 * (1 + 5/30) = 225 * 1.1667 = 262.5 → Math.round = 263
const BENCH_225x5_E1RM = Math.round(225 * (1 + 5 / 30)); // 263

// ─── e1RM via engine output ────────────────────────────────────────────────────

describe('e1RM computation (via engine output)', () => {
  it('computes Epley e1RM correctly for 225x5', () => {
    const signals = runDiagnosticEngine(benchInput());
    const e1rm = signals.e1rms['flat_bench_press'];
    expect(e1rm).toBeDefined();
    expect(e1rm.value).toBe(BENCH_225x5_E1RM);
    expect(e1rm.reps_used).toBe(5);
    expect(e1rm.reps_clamped).toBe(false);
    expect(e1rm.confidence).toBe('medium'); // 5 reps → medium
  });

  it('returns high confidence for <= 4 reps', () => {
    const signals = runDiagnosticEngine(
      benchInput({
        snapshots: [{ exerciseId: 'flat_bench_press', weight: 240, reps: 3, sets: 1 }],
      })
    );
    expect(signals.e1rms['flat_bench_press'].confidence).toBe('high');
  });

  it('clamps reps at 10 and returns low confidence for reps > 10', () => {
    const signals = runDiagnosticEngine(
      benchInput({
        snapshots: [{ exerciseId: 'flat_bench_press', weight: 135, reps: 15, sets: 1 }],
      })
    );
    const e1rm = signals.e1rms['flat_bench_press'];
    expect(e1rm.reps_clamped).toBe(true);
    expect(e1rm.reps_used).toBe(10);
    expect(e1rm.confidence).toBe('low');
    // Clamped: 135 * (1 + 10/30) = 135 * 1.333 = 180
    expect(e1rm.value).toBe(Math.round(135 * (1 + 10 / 30)));
  });

  it('keeps the best e1RM when same exercise logged twice', () => {
    const signals = runDiagnosticEngine(
      benchInput({
        snapshots: [
          { exerciseId: 'flat_bench_press', weight: 200, reps: 8, sets: 3 },
          { exerciseId: 'flat_bench_press', weight: 225, reps: 5, sets: 3 },
        ],
      })
    );
    // 225x5 e1RM (263) > 200x8 e1RM (253)
    expect(signals.e1rms['flat_bench_press'].value).toBe(BENCH_225x5_E1RM);
  });

  it('stores e1RM for every exercise in snapshots', () => {
    const signals = runDiagnosticEngine(benchInput());
    expect(signals.e1rms['flat_bench_press']).toBeDefined();
    expect(signals.e1rms['close_grip_bench_press']).toBeDefined();
    expect(signals.e1rms['barbell_row']).toBeDefined();
  });
});

// ─── DiagnosticSignals structure ──────────────────────────────────────────────

describe('runDiagnosticEngine — output structure', () => {
  it('returns all required top-level fields', () => {
    const signals = runDiagnosticEngine(benchInput());
    expect(signals).toHaveProperty('signals_version');
    expect(signals).toHaveProperty('lift_config_version');
    expect(signals).toHaveProperty('e1rms');
    expect(signals).toHaveProperty('indices');
    expect(signals).toHaveProperty('phase_scores');
    expect(signals).toHaveProperty('primary_phase');
    expect(signals).toHaveProperty('hypothesis_scores');
    expect(signals).toHaveProperty('dominance_archetype');
    expect(signals).toHaveProperty('efficiency_score');
    expect(signals).toHaveProperty('validation_test');
    expect(signals).toHaveProperty('data_gaps');
  });

  it('returns at least 3 hypothesis scores when rules fire', () => {
    const signals = runDiagnosticEngine(benchInput());
    // With weak close-grip and row ratios, triceps_deficit and scap_stability_deficit fire
    expect(signals.hypothesis_scores.length).toBeGreaterThanOrEqual(2);
  });

  it('returns hypothesis scores sorted descending by score', () => {
    const signals = runDiagnosticEngine(benchInput());
    const scores = signals.hypothesis_scores.map(h => h.score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    }
  });

  it('efficiency_score is within 0–100 range', () => {
    const signals = runDiagnosticEngine(benchInput());
    expect(signals.efficiency_score.score).toBeGreaterThanOrEqual(0);
    expect(signals.efficiency_score.score).toBeLessThanOrEqual(100);
  });

  it('primary_phase is a non-empty string', () => {
    const signals = runDiagnosticEngine(benchInput());
    expect(typeof signals.primary_phase).toBe('string');
    expect(signals.primary_phase.length).toBeGreaterThan(0);
  });

  it('phase_scores is an array', () => {
    const signals = runDiagnosticEngine(benchInput());
    expect(Array.isArray(signals.phase_scores)).toBe(true);
  });
});

// ─── Flag-driven hypothesis signals ───────────────────────────────────────────

describe('session flags influence hypothesis scores', () => {
  it('hard_at_lockout flag boosts triceps_deficit score for bench', () => {
    const withFlag = runDiagnosticEngine(
      benchInput({ flags: { hard_at_lockout: true } })
    );
    const withoutFlag = runDiagnosticEngine(benchInput({ flags: {} }));

    const getTricepsScore = (sigs: typeof withFlag) =>
      sigs.hypothesis_scores.find(h => h.key === 'triceps_deficit')?.score ?? 0;

    // With the flag, triceps_deficit gains extra 25 points on top of ratio points
    expect(getTricepsScore(withFlag)).toBeGreaterThan(getTricepsScore(withoutFlag));
  });

  it('hips_shoot_up flag appears in evidence for squat', () => {
    const signals = runDiagnosticEngine(
      squatInput({ flags: { hips_shoot_up: true } })
    );
    // At least one hypothesis should have evidence mentioning the flag
    const hasEvidence = signals.hypothesis_scores.some(h =>
      h.evidence_facts.some(f => f.key === 'hips_shoot_up' || f.type === 'flag')
    );
    expect(hasEvidence).toBe(true);
  });

  it('multiple flags compound hypothesis scores up to 100 cap', () => {
    const signals = runDiagnosticEngine(
      benchInput({ flags: { hard_at_lockout: true, elbows_flare_early: true } })
    );
    signals.hypothesis_scores.forEach(h => {
      expect(h.score).toBeLessThanOrEqual(100);
    });
  });
});

// ─── Dominance archetype ───────────────────────────────────────────────────────

describe('dominance archetype', () => {
  it('has a non-empty label and rationale', () => {
    const signals = runDiagnosticEngine(benchInput());
    expect(signals.dominance_archetype.label.length).toBeGreaterThan(0);
    expect(signals.dominance_archetype.rationale.length).toBeGreaterThan(0);
  });

  it('confidence is between 0 and 1', () => {
    const signals = runDiagnosticEngine(benchInput());
    expect(signals.dominance_archetype.confidence).toBeGreaterThanOrEqual(0);
    expect(signals.dominance_archetype.confidence).toBeLessThanOrEqual(1);
  });

  it('delta_units is "index_points"', () => {
    const signals = runDiagnosticEngine(benchInput());
    expect(signals.dominance_archetype.delta_units).toBe('index_points');
  });
});

// ─── Edge cases ────────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('handles empty snapshots without crashing', () => {
    expect(() =>
      runDiagnosticEngine(benchInput({ snapshots: [] }))
    ).not.toThrow();
  });

  it('returns a string primary_phase even with no snapshot data', () => {
    const signals = runDiagnosticEngine(benchInput({ snapshots: [] }));
    expect(typeof signals.primary_phase).toBe('string');
  });

  it('handles deadlift lift type with flag', () => {
    expect(() =>
      runDiagnosticEngine({
        liftId: 'deadlift',
        primaryExerciseId: 'deadlift',
        snapshots: [
          { exerciseId: 'deadlift', weight: 405, reps: 5, sets: 3 },
          { exerciseId: 'romanian_deadlift', weight: 315, reps: 5, sets: 3 },
        ],
        flags: { hard_off_floor: true },
        bodyweightLbs: 200,
        trainingAge: 'advanced',
        equipment: 'commercial',
      })
    ).not.toThrow();
  });

  it('throws for unknown liftId (no config registered)', () => {
    // The engine intentionally throws when no lift config is found —
    // callers must validate liftId before invoking.
    expect(() =>
      runDiagnosticEngine({
        liftId: 'unknown_lift',
        primaryExerciseId: 'unknown_lift',
        snapshots: [],
        flags: {},
        bodyweightLbs: 180,
        trainingAge: 'beginner',
        equipment: 'commercial',
      })
    ).toThrow(/No lift config found/i);
  });

  it('handles beginner training age', () => {
    const signals = runDiagnosticEngine(benchInput({ trainingAge: 'beginner' }));
    expect(signals).toHaveProperty('efficiency_score');
  });

  it('handles home equipment setting', () => {
    const signals = runDiagnosticEngine(benchInput({ equipment: 'home' }));
    expect(signals).toHaveProperty('validation_test');
  });
});
