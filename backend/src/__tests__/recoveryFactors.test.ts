import { describe, it, expect } from 'vitest';
import { analyzeRecoveryFactors } from '../services/recoveryFactorsService.js';

describe('analyzeRecoveryFactors', () => {
  it('returns no factors when everything looks healthy', () => {
    const factors = analyzeRecoveryFactors({
      bodyWeight: [
        { date: '2026-01-01', weightLbs: 180 },
        { date: '2026-01-15', weightLbs: 180.5 },
        { date: '2026-02-01', weightLbs: 181 },
      ],
      nutrition: [
        { date: '2026-01-01', calories: 2800, proteinG: 160 },
        { date: '2026-01-08', calories: 2850, proteinG: 165 },
        { date: '2026-01-15', calories: 2800, proteinG: 158 },
      ],
      wellness: [
        { date: '2026-01-01', sleepHours: 8, stress: 2, energy: 4 },
        { date: '2026-01-08', sleepHours: 7.5, stress: 2, energy: 4 },
        { date: '2026-01-15', sleepHours: 8, stress: 1, energy: 5 },
      ],
      bodyWeightLbs: 181,
    });
    expect(factors).toHaveLength(0);
  });

  it('flags a calorie deficit from a bodyweight downtrend', () => {
    const factors = analyzeRecoveryFactors({
      bodyWeight: [
        { date: '2026-01-01', weightLbs: 190 },
        { date: '2026-01-20', weightLbs: 186 },
        { date: '2026-02-10', weightLbs: 183 },
      ],
      nutrition: [],
      wellness: [],
      bodyWeightLbs: 183,
    });
    expect(factors.some((f) => f.id === 'calorie-deficit')).toBe(true);
  });

  it('flags low protein vs the bodyweight target', () => {
    const factors = analyzeRecoveryFactors({
      bodyWeight: [],
      nutrition: [
        { date: '2026-01-01', calories: 2400, proteinG: 70 },
        { date: '2026-01-08', calories: 2400, proteinG: 75 },
        { date: '2026-01-15', calories: 2400, proteinG: 65 },
      ],
      wellness: [],
      bodyWeightLbs: 190, // target ≈ 133g; ~70g logged is well under
    });
    expect(factors.some((f) => f.id === 'low-protein')).toBe(true);
  });

  it('flags poor sleep + high stress', () => {
    const factors = analyzeRecoveryFactors({
      bodyWeight: [],
      nutrition: [],
      wellness: [
        { date: '2026-01-01', sleepHours: 5.5, stress: 4, energy: 2 },
        { date: '2026-01-08', sleepHours: 6, stress: 4, energy: 2 },
        { date: '2026-01-15', sleepHours: 5, stress: 5, energy: 2 },
      ],
      bodyWeightLbs: 180,
    });
    const ids = factors.map((f) => f.id);
    expect(ids).toContain('poor-sleep');
    expect(ids).toContain('high-stress');
    expect(ids).toContain('low-energy');
  });

  it('severity-ranks factors descending', () => {
    const factors = analyzeRecoveryFactors({
      bodyWeight: [
        { date: '2026-01-01', weightLbs: 200 },
        { date: '2026-01-20', weightLbs: 192 },
        { date: '2026-02-10', weightLbs: 186 },
      ],
      nutrition: [],
      wellness: [
        { date: '2026-01-01', sleepHours: 6.8, stress: 2, energy: 3 },
        { date: '2026-01-08', sleepHours: 6.9, stress: 2, energy: 3 },
        { date: '2026-01-15', sleepHours: 6.7, stress: 2, energy: 3 },
      ],
      bodyWeightLbs: 186,
    });
    for (let i = 1; i < factors.length; i++) {
      expect(factors[i - 1].severity).toBeGreaterThanOrEqual(factors[i].severity);
    }
  });
});
