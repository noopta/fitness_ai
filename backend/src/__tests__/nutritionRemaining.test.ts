import { describe, it, expect } from 'vitest';
import {
  computeDayRemaining,
  countDaysBelowTarget,
  normalizePlanMacros,
  planMacrosFromSavedProgram,
  resolveMacroTargets,
  type DayRemainingInput,
} from '../services/nutritionRemaining.js';

const base = (over: Partial<DayRemainingInput> = {}): DayRemainingInput => ({
  date: '2026-08-07',
  todayTotals: {},
  weekDayTotals: [],
  bodyweightKg: 80,
  mealsLogged: 0,
  planMacros: { calories: 2600, proteinG: 180, carbsG: 300, fatG: 80 },
  ...over,
});

describe('normalizePlanMacros', () => {
  it('accepts the canonical shape', () => {
    expect(normalizePlanMacros({ calories: 2000, proteinG: 150, carbsG: 200, fatG: 60 }))
      .toEqual({ calories: 2000, proteinG: 150, carbsG: 200, fatG: 60 });
  });

  it('tolerates the snake_case and bare aliases the saved program has drifted through', () => {
    // The mobile client already does `proteinG ?? protein_g ?? protein`; reading
    // only proteinG here would silently yield a 0 target.
    expect(normalizePlanMacros({ kcal: 2000, protein: 150, carbs_g: 200, fat: 60 }))
      .toEqual({ calories: 2000, proteinG: 150, carbsG: 200, fatG: 60 });
  });

  it('returns null for junk', () => {
    expect(normalizePlanMacros(null)).toBeNull();
    expect(normalizePlanMacros('nope')).toBeNull();
    expect(normalizePlanMacros({ unrelated: 5 })).toBeNull();
  });

  it('ignores negative and non-finite values', () => {
    expect(normalizePlanMacros({ calories: -5, proteinG: 150 })?.calories).toBeNull();
  });
});

describe('planMacrosFromSavedProgram', () => {
  it('digs macros out of the JSON string on User', () => {
    const saved = JSON.stringify({ nutritionPlan: { macros: { calories: 2400, proteinG: 170 } } });
    expect(planMacrosFromSavedProgram(saved)?.calories).toBe(2400);
  });

  it('survives malformed JSON and a missing plan', () => {
    expect(planMacrosFromSavedProgram('{ broken')).toBeNull();
    expect(planMacrosFromSavedProgram(JSON.stringify({}))).toBeNull();
    expect(planMacrosFromSavedProgram(null)).toBeNull();
  });
});

describe('resolveMacroTargets', () => {
  it('lets an explicit dailyCalorieTarget override the plan', () => {
    const t = resolveMacroTargets(base({ dailyCalorieTarget: 2000 }));
    expect(t.kcal).toBe(2000);
  });

  it("keeps the plan's coached protein target over the registry per-kg floor", () => {
    // Registry would give max(130, 1.6*80) = 130; the plan says 180.
    expect(resolveMacroTargets(base()).proteinG).toBe(180);
  });

  it('falls back to the registry per-kg protein floor with no plan', () => {
    const t = resolveMacroTargets(base({ planMacros: null }));
    expect(t.proteinG).toBeGreaterThanOrEqual(130);
    expect(t.kcal).toBe(2000);
  });

  it('adds workout burn to the calorie target', () => {
    expect(resolveMacroTargets(base({ workoutBurnKcal: 400 })).kcal).toBe(3000);
  });

  it('derives carbs and fat from calories when the plan omits them', () => {
    const t = resolveMacroTargets(base({ planMacros: { calories: 2000 } }));
    expect(t.carbsG).toBe(225);
    expect(t.fatG).toBe(62);
  });
});

describe('countDaysBelowTarget', () => {
  it('counts only the days that finished under target', () => {
    const counts = countDaysBelowTarget(
      [{ ironMg: 20 }, { ironMg: 2 }, { ironMg: 1 }],
      80,
    );
    expect(counts.ironMg).toBe(2);
  });

  it('treats an absent nutrient as zero for that day', () => {
    expect(countDaysBelowTarget([{}, {}], 80).ironMg).toBe(2);
  });

  it('excludes ceiling nutrients entirely', () => {
    expect(countDaysBelowTarget([{ sodiumMg: 0 }], 80).sodiumMg).toBeUndefined();
  });
});

describe('computeDayRemaining', () => {
  it('computes remaining, over, and short for macros', () => {
    const d = computeDayRemaining(base({
      todayTotals: { calories: 1000, proteinG: 60, carbsG: 100, fatG: 30 },
    }));
    expect(d.macros.kcal.remaining).toBe(1600);
    expect(d.macros.proteinG.remaining).toBe(120);
    expect(d.macros.proteinG.short).toBeCloseTo(2 / 3, 3);
  });

  it('never reports negative remaining, and surfaces overshoot separately', () => {
    const d = computeDayRemaining(base({ todayTotals: { calories: 3000 } }));
    expect(d.macros.kcal.remaining).toBe(0);
    expect(d.macros.kcal.over).toBe(400);
    expect(d.macros.kcal.short).toBe(0);
  });

  it('gives ceiling nutrients headroom rather than remaining', () => {
    const d = computeDayRemaining(base({ todayTotals: { sodiumMg: 1800 } }));
    const sodium = d.micros.find(m => m.key === 'sodiumMg')!;
    expect(sodium.ceiling).toBe(true);
    expect(sodium.remaining).toBe(0);
    expect(sodium.headroom).toBe(500);
    expect(sodium.short).toBe(0);
  });

  it('marks the focus nutrients from the generated plan', () => {
    const d = computeDayRemaining(base({ focusKeys: ['ironMg'] }));
    expect(d.micros.find(m => m.key === 'ironMg')!.focus).toBe(true);
    expect(d.micros.find(m => m.key === 'zincMg')!.focus).toBe(false);
  });

  it('carries the trailing-week persistence count onto each nutrient', () => {
    const d = computeDayRemaining(base({
      weekDayTotals: [{ ironMg: 0 }, { ironMg: 0 }, { ironMg: 99 }],
    }));
    expect(d.micros.find(m => m.key === 'ironMg')!.daysBelowTarget7d).toBe(2);
  });

  it('reports hasPlan=false when the user has no generated program', () => {
    expect(computeDayRemaining(base({ planMacros: null })).hasPlan).toBe(false);
    expect(computeDayRemaining(base()).hasPlan).toBe(true);
  });

  it('treats a zero target as "no claim to make" rather than 100% short', () => {
    const d = computeDayRemaining(base({ planMacros: { calories: 2600, proteinG: 180, carbsG: 0, fatG: 0 } }));
    // carbs/fat fall back to calorie-derived values rather than reading as a
    // total shortfall against a target nobody set.
    expect(d.macros.carbsG.target).toBeGreaterThan(0);
  });
});
