import { describe, it, expect } from 'vitest';
import {
  arbitrate,
  buildFinderGap,
  diversify,
  effortFactor,
  fitCurve,
  macroPressureOf,
  microPressureOf,
  rankCandidates,
  scoreCandidate,
  type Candidate,
  type RankedCandidate,
} from '../engine/foodFinderRanker.js';
import { computeDayRemaining, type DayRemaining } from '../services/nutritionRemaining.js';

// A realistic 2,600 kcal / 180 g protein plan, so fixtures read like real users.
const PLAN = { calories: 2600, proteinG: 180, carbsG: 300, fatG: 80 };

interface DayOpts {
  kcal?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  micros?: Record<string, number>;
  /** Per-nutrient count of trailing-7d days below target. */
  weekShort?: string[];
  focusKeys?: string[];
}

/** Build a DayRemaining through the real pure pipeline, not a hand-made stub. */
function day(opts: DayOpts = {}): DayRemaining {
  const todayTotals: Record<string, number> = {
    calories: opts.kcal ?? 0,
    proteinG: opts.proteinG ?? 0,
    carbsG: opts.carbsG ?? 0,
    fatG: opts.fatG ?? 0,
    ...(opts.micros ?? {}),
  };
  // A trailing week that is either fully satisfied or fully short per nutrient.
  const weekDay: Record<string, number> = { calories: 2500, proteinG: 180 };
  for (const n of ['ironMg', 'magnesiumMg', 'fiberG', 'vitaminB12Mcg', 'calciumMg', 'potassiumMg', 'zincMg', 'vitaminDIU', 'folateMcg', 'vitaminCMg', 'omega3G', 'cholineMg', 'vitaminEMg', 'leucineG', 'tryptophanG']) {
    weekDay[n] = (opts.weekShort ?? []).includes(n) ? 0 : 100000;
  }
  return computeDayRemaining({
    date: '2026-08-07',
    todayTotals,
    weekDayTotals: Array.from({ length: 7 }, () => weekDay),
    bodyweightKg: 80,
    mealsLogged: 2,
    planMacros: PLAN,
    focusKeys: opts.focusKeys ?? [],
  });
}

/** Every registry floor nutrient comfortably met, so fixtures can isolate one. */
const SATISFIED_MICROS: Record<string, number> = {
  ironMg: 20, magnesiumMg: 500, calciumMg: 1200, zincMg: 15, fiberG: 40,
  vitaminB12Mcg: 5, potassiumMg: 4000, vitaminDIU: 1000, folateMcg: 600,
  vitaminCMg: 200, omega3G: 3, cholineMg: 700, vitaminEMg: 20,
  leucineG: 12, tryptophanG: 2, vitaminAIU: 4000,
};

/**
 * Macros on pace with real room left. Deliberately NOT "2,500 of 2,600 eaten" —
 * that is only 100 kcal of headroom, which is correctly a tight budget, not a
 * micro-led day.
 */
const MACROS_ON_PACE = { kcal: 2100, proteinG: 180, carbsG: 250, fatG: 65 };

const candidate = (over: Partial<Candidate> & { id: string; name: string }): Candidate => ({
  kind: 'ingredient',
  kcal: 0,
  provides: {},
  confidence: 'usda',
  ...over,
});

describe('fitCurve', () => {
  it('does not penalise anything that fits the remaining budget', () => {
    expect(fitCurve(400, 800)).toBe(1);
    expect(fitCurve(800, 800)).toBe(1);
  });

  it('tolerates a modest overshoot', () => {
    expect(fitCurve(900, 800)).toBe(0.7);
  });

  it('falls off quadratically past a 25% overshoot', () => {
    expect(fitCurve(1600, 800)).toBeCloseTo(0.175, 3);
    expect(fitCurve(2400, 800)).toBeLessThan(fitCurve(1600, 800));
  });

  it('switches to kcal-efficiency when nothing is left, rather than zeroing out', () => {
    // Still has to rank something — the user must eat to close a protein gap.
    expect(fitCurve(120, 0)).toBeGreaterThan(fitCurve(600, 0));
    expect(fitCurve(120, 0)).toBeGreaterThan(0);
  });
});

describe('effortFactor', () => {
  it('does not penalise unknown distance', () => {
    expect(effortFactor(null)).toBe(1);
    expect(effortFactor(undefined)).toBe(1);
  });

  it('decays with distance', () => {
    expect(effortFactor(500)).toBeGreaterThan(effortFactor(5000));
  });
});

describe('pressures', () => {
  it('reads a fresh day as almost entirely macro pressure', () => {
    const d = day();
    expect(macroPressureOf(d)).toBeGreaterThan(0.9);
  });

  it('floors macro pressure when a quarter of protein is still missing', () => {
    // Calories fully met on low-protein food — must NOT read as on track.
    const d = day({ kcal: 2600, carbsG: 300, fatG: 80, proteinG: 120 });
    expect(d.macros.kcal.short).toBe(0);
    expect(macroPressureOf(d)).toBeGreaterThanOrEqual(0.6);
  });

  it('squares shortfall so one deep hole outweighs broad shallow ones', () => {
    const deep = day({ kcal: 2600, proteinG: 180, carbsG: 300, fatG: 80, micros: { ironMg: 0 } });
    const shallow = day({
      kcal: 2600, proteinG: 180, carbsG: 300, fatG: 80,
      micros: { ironMg: 9, magnesiumMg: 300, calciumMg: 750, zincMg: 8, fiberG: 22 },
    });
    expect(microPressureOf(deep)).toBeGreaterThan(microPressureOf(shallow));
  });
});

describe('arbitrate', () => {
  it('leads with macros when the day has barely started', () => {
    const arb = arbitrate(day());
    expect(arb.mode).toBe('macro_priority');
    expect(arb.lambda).toBeLessThanOrEqual(0.35);
  });

  it('switches to micros once macros are on pace but a nutrient is short', () => {
    const arb = arbitrate(day({
      ...MACROS_ON_PACE,
      micros: { ...SATISFIED_MICROS, ironMg: 1 },
      weekShort: ['ironMg'], focusKeys: ['ironMg'],
    }));
    expect(arb.mode).toBe('micro_priority');
    expect(arb.lambda).toBeGreaterThanOrEqual(0.75);
  });

  it('flags tight_budget when calories are nearly spent but protein is not', () => {
    const arb = arbitrate(day({ kcal: 2480, proteinG: 130, carbsG: 300, fatG: 80 }));
    expect(arb.mode).toBe('tight_budget');
    expect(arb.leanOnly).toBe(true);
  });

  it('says on_track — and recommends nothing — when the day is genuinely done', () => {
    const done = day({
      kcal: 2600, proteinG: 180, carbsG: 300, fatG: 80,
      micros: {
        ironMg: 20, magnesiumMg: 500, calciumMg: 1200, zincMg: 15, fiberG: 40,
        vitaminB12Mcg: 5, potassiumMg: 4000, vitaminDIU: 1000, folateMcg: 600,
        vitaminCMg: 200, omega3G: 3, cholineMg: 700, vitaminEMg: 20,
        leucineG: 12, tryptophanG: 2, vitaminAIU: 4000,
      },
    });
    const arb = arbitrate(done);
    expect(arb.mode).toBe('on_track');
    expect(rankCandidates([candidate({ id: 'a', name: 'Eggs', kcal: 200, provides: { proteinG: 18 } })], done).results).toEqual([]);
  });

  it('always produces a rationale sentence', () => {
    expect(arbitrate(day()).rationale.length).toBeGreaterThan(10);
  });
});

describe('scoring', () => {
  it('THE tight-budget case: 120 kcal of skyr beats a 600 kcal burrito', () => {
    // ~120 kcal left, 50 g protein short. A naive ranker picks the burrito
    // because it closes more protein; the calorie multiplier must forbid it.
    const d = day({ kcal: 2480, proteinG: 130, carbsG: 300, fatG: 80 });
    const { results } = rankCandidates(
      [
        candidate({ id: 'burrito', name: 'Chicken burrito', kind: 'takeout', kcal: 600, provides: { proteinG: 45 }, confidence: 'estimated' }),
        candidate({ id: 'skyr', name: 'Skyr', kcal: 120, provides: { proteinG: 20 } }),
      ],
      d,
    );
    expect(results[0].name).toBe('Skyr');
    const skyr = results.find(r => r.id === 'skyr')!;
    const burrito = results.find(r => r.id === 'burrito')!;
    expect(skyr.score).toBeGreaterThan(burrito.score * 5);
  });

  it('demotes a sodium bomb once the cap is nearly spent', () => {
    const d = day({
      kcal: 1200, proteinG: 90, carbsG: 150, fatG: 40,
      micros: { sodiumMg: 2200 },
    });
    const { results } = rankCandidates(
      [
        candidate({ id: 'salty', name: 'Salty ramen', kind: 'takeout', kcal: 600, provides: { proteinG: 30, sodiumMg: 1800 }, confidence: 'published' }),
        candidate({ id: 'clean', name: 'Grilled chicken', kcal: 600, provides: { proteinG: 30, sodiumMg: 90 }, confidence: 'published' }),
      ],
      d,
    );
    expect(results[0].name).toBe('Grilled chicken');
    // Stronger than "ranked lower": the sodium bomb is dropped outright once
    // the penalty drives its score negative.
    expect(results.some(r => r.id === 'salty')).toBe(false);

    // Score it directly to inspect why it was rejected.
    const arb = arbitrate(d);
    const salty = scoreCandidate(
      candidate({ id: 'salty', name: 'Salty ramen', kind: 'takeout', kcal: 600, provides: { proteinG: 30, sodiumMg: 1800 }, confidence: 'published' }),
      buildFinderGap(d, arb), d, arb,
    );
    expect(salty.overflow).toBeGreaterThan(0);
    expect(salty.warns.some(w => w.key === 'sodiumMg')).toBe(true);
    expect(salty.score).toBeLessThan(0);
  });

  it('barely penalises a high-sodium item when the day has full headroom', () => {
    const fresh = day();
    const arb = arbitrate(fresh);
    const gap = buildFinderGap(fresh, arb);
    const item = candidate({ id: 's', name: 'Ramen', kcal: 600, provides: { proteinG: 30, sodiumMg: 1800 } });
    const spent = day({ kcal: 1200, proteinG: 90, carbsG: 150, fatG: 40, micros: { sodiumMg: 2200 } });
    const spentArb = arbitrate(spent);
    expect(scoreCandidate(item, gap, fresh, arb).overflow)
      .toBeLessThan(scoreCandidate(item, buildFinderGap(spent, spentArb), spent, spentArb).overflow);
  });

  it('flips the winner when the mode flips, on the same two candidates', () => {
    const protein = candidate({ id: 'chicken', name: 'Chicken breast', kcal: 250, provides: { proteinG: 46 } });
    const iron = candidate({ id: 'liver', name: 'Beef liver', kcal: 175, provides: { proteinG: 20, ironMg: 6.5 } });

    const macroLed = rankCandidates([protein, iron], day()).results;
    const microLed = rankCandidates([protein, iron], day({
      ...MACROS_ON_PACE,
      micros: { ...SATISFIED_MICROS, ironMg: 1 },
      weekShort: ['ironMg'], focusKeys: ['ironMg'],
    })).results;

    expect(macroLed[0].name).toBe('Chicken breast');
    expect(microLed[0].name).toBe('Beef liver');
  });

  it('weights a week-long deficit above a one-day dip', () => {
    // Persistence shows up in the GAP VECTOR, not in the aggregate pressure:
    // when a single nutrient is short its weight cancels out of a weighted
    // mean, so microPressure is deliberately not the assertion here.
    const base = { ...MACROS_ON_PACE, micros: { ...SATISFIED_MICROS, ironMg: 1 } };
    const oneDay = day(base);
    const allWeek = day({ ...base, weekShort: ['ironMg'] });

    const wOne = buildFinderGap(oneDay, arbitrate(oneDay)).get('ironMg')!.weight;
    const wWeek = buildFinderGap(allWeek, arbitrate(allWeek)).get('ironMg')!.weight;
    expect(wWeek).toBeGreaterThan(wOne);
  });

  it('prioritises the chronically-short nutrient over an equally-short one', () => {
    // Iron and zinc are both at ~10% of target today; only iron has been short
    // all week. The week-long one should win.
    const d = day({
      ...MACROS_ON_PACE,
      micros: { ...SATISFIED_MICROS, ironMg: 1.2, zincMg: 1.1 },
      weekShort: ['ironMg'],
    });
    const gap = buildFinderGap(d, arbitrate(d));
    expect(gap.get('ironMg')!.weight).toBeGreaterThan(gap.get('zincMg')!.weight);

    const { results } = rankCandidates(
      [
        candidate({ id: 'iron', name: 'Iron source', kcal: 150, provides: { ironMg: 6 } }),
        candidate({ id: 'zinc', name: 'Zinc source', kcal: 150, provides: { zincMg: 5.5 } }),
      ],
      d,
    );
    expect(results[0].name).toBe('Iron source');
  });

  it('discounts estimated menu data against USDA-grounded ingredients', () => {
    const d = day();
    const gap = buildFinderGap(d, arbitrate(d));
    const arb = arbitrate(d);
    const shared = { name: 'X', kcal: 300, provides: { proteinG: 30 } };
    const usda = scoreCandidate(candidate({ id: 'a', ...shared, confidence: 'usda' }), gap, d, arb);
    const est = scoreCandidate(candidate({ id: 'b', ...shared, confidence: 'estimated' }), gap, d, arb);
    expect(usda.score).toBeGreaterThan(est.score);
  });

  it('reports what it closes, biggest contributor first', () => {
    const d = day();
    const arb = arbitrate(d);
    const gap = buildFinderGap(d, arb);
    const r = scoreCandidate(
      candidate({ id: 'a', name: 'Salmon', kcal: 273, provides: { proteinG: 34, omega3G: 2.3 } }),
      gap, d, arb,
    );
    expect(r.closes[0].key).toBe('proteinG');
    expect(r.closes[0].pctOfRemaining).toBeGreaterThan(0);
  });
});

describe('diversify', () => {
  const mk = (id: string, kind: 'ingredient' | 'takeout', keys: string[], score: number) =>
    ({ id, name: id, kind, score, closes: keys.map(k => ({ key: k })) } as unknown as RankedCandidate);

  it('drops candidates that close the same things in the same way', () => {
    const out = diversify([
      mk('a', 'ingredient', ['proteinG'], 1),
      mk('b', 'ingredient', ['proteinG'], 0.9),
    ], 5, false);
    expect(out).toHaveLength(1);
  });

  it('keeps same-nutrient candidates when the kind differs', () => {
    const out = diversify([
      mk('a', 'ingredient', ['proteinG'], 1),
      mk('b', 'takeout', ['proteinG'], 0.9),
    ], 5, false);
    expect(out).toHaveLength(2);
  });

  it('guarantees both paths appear when both exist', () => {
    const out = diversify([
      mk('i1', 'ingredient', ['proteinG'], 1),
      mk('i2', 'ingredient', ['ironMg'], 0.9),
      mk('t1', 'takeout', ['calciumMg'], 0.1),
    ], 2, true);
    expect(new Set(out.map(c => c.kind))).toEqual(new Set(['ingredient', 'takeout']));
    expect(out).toHaveLength(2);
  });

  it('does not force a second kind when the caller asked for one path', () => {
    const out = diversify([
      mk('i1', 'ingredient', ['proteinG'], 1),
      mk('i2', 'ingredient', ['ironMg'], 0.9),
    ], 2, true);
    expect(out.every(c => c.kind === 'ingredient')).toBe(true);
  });
});
