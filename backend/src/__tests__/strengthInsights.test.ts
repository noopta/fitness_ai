import { describe, it, expect } from 'vitest';
import {
  computeRatios, computeRelativeStrength, computeBalance,
} from '../services/strengthMetricsService.js';
import { generateInsights } from '../services/insightEngine.js';
import { buildMuscleLedger, type LedgerWorkout } from '../services/muscleLedgerService.js';

describe('computeRatios', () => {
  it('flags bench:row drift above band', () => {
    const r = computeRatios([
      { canonicalName: 'Bench Press', e1rmKg: 130 },
      { canonicalName: 'Barbell Row', e1rmKg: 90 },  // 1.44 — well above 1.0-1.1
    ]);
    const benchRow = r.find((x) => x.id === 'bench-row')!;
    expect(benchRow.status).toBe('high');
    expect(benchRow.severity).toBeGreaterThan(0);
    expect(benchRow.value).toBeCloseTo(1.44, 1);
  });

  it('reports in-band ratios cleanly', () => {
    const r = computeRatios([
      { canonicalName: 'Bench Press', e1rmKg: 105 },
      { canonicalName: 'Barbell Row', e1rmKg: 100 }, // 1.05 — in band
    ]);
    expect(r.find((x) => x.id === 'bench-row')!.status).toBe('in-band');
  });

  it('marks no-data when a lift is missing', () => {
    const r = computeRatios([{ canonicalName: 'Bench Press', e1rmKg: 100 }]);
    expect(r.find((x) => x.id === 'bench-row')!.status).toBe('no-data');
  });
});

describe('computeRelativeStrength', () => {
  it('tiers a 2x bodyweight squat as advanced', () => {
    const rs = computeRelativeStrength([{ canonicalName: 'Squat', e1rmKg: 160 }], 80);
    const squat = rs.find((x) => x.lift === 'Squat')!;
    expect(squat.ratioToBw).toBe(2);
    expect(squat.tier).toBe('advanced');
  });
  it('returns untested with no e1RM', () => {
    const rs = computeRelativeStrength([], 80);
    expect(rs.every((x) => x.tier === 'untested')).toBe(true);
  });
});

describe('computeBalance', () => {
  it('flags a quad-dominant lifter', () => {
    const b = computeBalance({ Quads: 100, Hamstrings: 55 }); // 1.82, band 1.0-1.4
    const qh = b.find((x) => x.id === 'quad-ham')!;
    expect(qh.status).toBe('high');
    expect(qh.severity).toBeGreaterThan(0);
  });
});

describe('generateInsights', () => {
  function plateauLedger(): LedgerWorkout[] {
    // Flat bench for 5 weeks → chest-related muscles plateau.
    return [
      { date: '2026-01-05', exercises: [{ name: 'Bench Press', sets: 3, reps: 5, weightKg: 100, rpe: 8 }] },
      { date: '2026-01-12', exercises: [{ name: 'Bench Press', sets: 3, reps: 5, weightKg: 100, rpe: 8 }] },
      { date: '2026-01-19', exercises: [{ name: 'Bench Press', sets: 3, reps: 5, weightKg: 100, rpe: 8 }] },
      { date: '2026-01-26', exercises: [{ name: 'Bench Press', sets: 3, reps: 5, weightKg: 100, rpe: 8 }] },
      { date: '2026-02-02', exercises: [{ name: 'Bench Press', sets: 3, reps: 5, weightKg: 100, rpe: 8 }] },
    ];
  }

  it('detects a stalled lift and root-causes a lagging muscle', () => {
    const ledger = buildMuscleLedger(plateauLedger());
    const insights = generateInsights({
      ledger,
      ratios: [],
      balance: [],
      liftSeries: [{ canonicalName: 'Bench Press', weeklyE1rmKg: [123, 123, 123, 123, 123] }],
      daysSinceLastWorkout: 3,
    });
    const stall = insights.find((i) => i.kind === 'stagnation');
    expect(stall).toBeDefined();
    expect(stall!.title.toLowerCase()).toContain('bench press');
  });

  it('surfaces an imbalance insight from a drifted ratio', () => {
    const ratios = computeRatios([
      { canonicalName: 'Bench Press', e1rmKg: 140 },
      { canonicalName: 'Barbell Row', e1rmKg: 90 },
    ]);
    const insights = generateInsights({
      ledger: buildMuscleLedger([]),
      ratios,
      balance: [],
      liftSeries: [],
      daysSinceLastWorkout: 2,
    });
    expect(insights.some((i) => i.kind === 'imbalance')).toBe(true);
  });

  it('does not flag a still-progressing lift as stalled', () => {
    const insights = generateInsights({
      ledger: buildMuscleLedger([]),
      ratios: [],
      balance: [],
      liftSeries: [{ canonicalName: 'Squat', weeklyE1rmKg: [140, 145, 150, 156, 162] }],
      daysSinceLastWorkout: 1,
    });
    expect(insights.some((i) => i.kind === 'stagnation')).toBe(false);
  });

  it('respects the limit and ranks high priority first', () => {
    const ratios = computeRatios([
      { canonicalName: 'Bench Press', e1rmKg: 160 },
      { canonicalName: 'Barbell Row', e1rmKg: 80 },
    ]);
    const insights = generateInsights({
      ledger: buildMuscleLedger(plateauLedger()),
      ratios,
      balance: computeBalance({ Quads: 100, Hamstrings: 50 }),
      liftSeries: [{ canonicalName: 'Bench Press', weeklyE1rmKg: [123, 123, 123, 123, 123] }],
      daysSinceLastWorkout: 3,
    }, 3);
    expect(insights.length).toBeLessThanOrEqual(3);
    if (insights.length >= 2) {
      const rank = { high: 0, medium: 1, low: 2 } as const;
      expect(rank[insights[0].priority]).toBeLessThanOrEqual(rank[insights[1].priority]);
    }
  });
});
