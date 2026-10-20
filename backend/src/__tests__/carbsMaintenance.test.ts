import { describe, it, expect } from 'vitest';
import { isTrainingDay, applyCarbCycling } from '../services/carbCycling.js';
import { estimateMaintenance, activityFactor } from '../services/maintenance.js';

describe('carb cycling', () => {
  const logged = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']; // Mon–Fri last week
  it('a weekday they trained in the last two weeks is a training day before they log it', () => {
    expect(isTrainingDay('2026-10-19', logged)).toBe(true); // Monday
    expect(isTrainingDay('2026-10-25', logged)).toBe(false); // Sunday
    expect(isTrainingDay('2026-10-25', [...logged, '2026-10-25'])).toBe(true); // logged today
  });
  it('carbs and the calories they carry move with the day', () => {
    const t = { calories: 2400, carbsG: 250, proteinG: 170, fatG: 80 };
    expect(applyCarbCycling(t, { trainingDayCarbs: 300, restDayCarbs: 175 }, true)).toMatchObject({ carbsG: 300, calories: 2600, dayType: 'training' });
    expect(applyCarbCycling(t, { trainingDayCarbs: 300, restDayCarbs: 175 }, false)).toMatchObject({ carbsG: 175, calories: 2100, dayType: 'rest' });
    expect(applyCarbCycling(t, null, true)).toBe(t);
  });
});

describe('maintenance', () => {
  it('counts sport sessions, not just lifting days (Saeed: 3 lifting + 6 MMA)', () => {
    expect(activityFactor(3, 0)).toBe(1.55);
    expect(activityFactor(3, 6)).toBe(1.9);
  });
  it('estimated until there is data, then measured from intake and the trend', () => {
    const est = estimateMaintenance({ weighIns: [], intake: [], bmr: 1780, weightKg: 77, liftingDays: 3, conditioningDays: 6, today: '2026-10-20' });
    expect(est).toMatchObject({ basis: 'estimated', kcal: Math.round(1780 * 1.9) });
    // 21 days at 2,500 kcal, losing 0.5 kg/week → maintenance ≈ 2,500 + 550.
    const days = Array.from({ length: 21 }, (_, i) => new Date(Date.parse('2026-09-30T12:00:00Z') + i * 864e5).toISOString().slice(0, 10));
    const m = estimateMaintenance({ weighIns: days.map((d, i) => ({ date: d, kg: 80 - (0.5 / 7) * i })), intake: days.map((d) => ({ date: d, kcal: 2500 })), bmr: 1780, weightKg: 79, liftingDays: 3, conditioningDays: 0, today: '2026-10-20' });
    expect(m.basis).toBe('measured');
    expect(m.kcal).toBeGreaterThan(3000);
    expect(m.kcal).toBeLessThan(3100);
  });
  it('ignores partial days (they would read as a deficit that never happened)', () => {
    const days = Array.from({ length: 14 }, (_, i) => new Date(Date.parse('2026-10-06T12:00:00Z') + i * 864e5).toISOString().slice(0, 10));
    const m = estimateMaintenance({ weighIns: days.map((d) => ({ date: d, kg: 80 })), intake: days.map((d) => ({ date: d, kcal: 600 })), bmr: 1780, weightKg: 80, liftingDays: 3, conditioningDays: 0, today: '2026-10-20' });
    expect(m.basis).toBe('estimated');
  });
});
