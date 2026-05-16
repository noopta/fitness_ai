import { describe, it, expect } from 'vitest';
import { buildMuscleLedger, ledgerConfidence, type LedgerWorkout } from '../services/muscleLedgerService.js';

// Helper — build a workout on a given date with one bench press set scheme.
function benchWorkout(date: string, weightKg: number, reps = 5): LedgerWorkout {
  return { date, exercises: [{ name: 'Bench Press', sets: 3, reps, weightKg, rpe: 8 }] };
}

describe('buildMuscleLedger', () => {
  it('returns empty ledger for no workouts', () => {
    const l = buildMuscleLedger([]);
    expect(Object.keys(l.entries)).toHaveLength(0);
    expect(ledgerConfidence(l)).toBe(0);
  });

  it('builds entries for muscles a logged lift trains', () => {
    const l = buildMuscleLedger([benchWorkout('2026-01-05', 100)]);
    expect(l.entries.Chest).toBeDefined();
    expect(l.entries['Front Delt']).toBeDefined();
    expect(l.entries.Triceps).toBeDefined();
    // Bench doesn't train legs
    expect(l.entries.Quads).toBeUndefined();
  });

  it('flags improving trend when e1RM climbs week over week', () => {
    // Five weeks of steadily heavier bench → improving chest trend.
    const workouts = [
      benchWorkout('2026-01-05', 100),
      benchWorkout('2026-01-12', 104),
      benchWorkout('2026-01-19', 108),
      benchWorkout('2026-01-26', 112),
      benchWorkout('2026-02-02', 116),
    ];
    const l = buildMuscleLedger(workouts);
    expect(l.entries.Chest?.trend).toBe('improving');
    expect(l.entries.Chest!.trendSlopePerWeekKg).toBeGreaterThan(0);
  });

  it('flags plateau when e1RM is flat across weeks', () => {
    const workouts = [
      benchWorkout('2026-01-05', 100),
      benchWorkout('2026-01-12', 100),
      benchWorkout('2026-01-19', 100),
      benchWorkout('2026-01-26', 100),
    ];
    const l = buildMuscleLedger(workouts);
    expect(l.entries.Chest?.trend).toBe('plateau');
  });

  it('flags declining trend when e1RM drops', () => {
    const workouts = [
      benchWorkout('2026-01-05', 120),
      benchWorkout('2026-01-12', 114),
      benchWorkout('2026-01-19', 108),
      benchWorkout('2026-01-26', 102),
    ];
    const l = buildMuscleLedger(workouts);
    expect(l.entries.Chest?.trend).toBe('declining');
  });

  it('reports insufficient-data trend with fewer than 3 weeks', () => {
    const l = buildMuscleLedger([
      benchWorkout('2026-01-05', 100),
      benchWorkout('2026-01-12', 102),
    ]);
    expect(l.entries.Chest?.trend).toBe('insufficient-data');
  });

  it('classifies intensity zone in the distribution', () => {
    // All sets at 5 reps → strength zone
    const l = buildMuscleLedger([
      benchWorkout('2026-01-05', 100, 5),
      benchWorkout('2026-01-12', 102, 5),
    ]);
    expect(l.entries.Chest!.zoneDistribution.strength).toBeGreaterThan(0.9);
    expect(l.entries.Chest!.zoneDistribution.hypertrophy).toBeLessThan(0.1);
  });

  it('confidence rises with more weeks of data', () => {
    const short = buildMuscleLedger([benchWorkout('2026-01-05', 100)]);
    const long = buildMuscleLedger([
      benchWorkout('2026-01-05', 100),
      benchWorkout('2026-01-12', 102),
      benchWorkout('2026-01-19', 104),
      benchWorkout('2026-01-26', 106),
      benchWorkout('2026-02-02', 108),
    ]);
    expect(long.entries.Chest!.confidence).toBeGreaterThan(short.entries.Chest!.confidence);
  });

  it('ledgerConfidence averages per-muscle confidence', () => {
    const l = buildMuscleLedger([
      benchWorkout('2026-01-05', 100),
      benchWorkout('2026-01-12', 102),
      benchWorkout('2026-01-19', 104),
    ]);
    const c = ledgerConfidence(l);
    expect(c).toBeGreaterThan(0);
    expect(c).toBeLessThanOrEqual(1);
  });
});
