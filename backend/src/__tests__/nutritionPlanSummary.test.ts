import { describe, it, expect } from 'vitest';
import {
  summarizePlan, planChanges, applyChanges, changeSummary, effectiveTarget, whenOf, nutrientKey,
  PLAN_WEEKS, GUT_DEFAULTS, type StoredPlan, type PlanState, type WindowMeal,
} from '../services/nutritionPlanSummary.js';
import type { MicroTargetResult } from '../services/microTargetsService.js';

const DAY = 86_400_000;
const NOW = new Date('2026-10-05T12:00:00Z');

const targets: MicroTargetResult = {
  focus: ['vitaminDIU', 'ironMg', 'fiberG'],
  targets: [
    { key: 'fiberG', label: 'Fiber', unit: 'g', target: 30, direction: 'meet', rationale: [] },
    { key: 'ironMg', label: 'Iron', unit: 'mg', target: 18, direction: 'meet', rationale: [] },
    { key: 'vitaminDIU', label: 'Vitamin D', unit: 'IU', target: 600, direction: 'meet', rationale: [] },
    { key: 'vitaminB12Mcg', label: 'Vitamin B12', unit: 'mcg', target: 2.4, direction: 'meet', rationale: [] },
    { key: 'sodiumMg', label: 'Sodium', unit: 'mg', target: 2300, direction: 'limit', rationale: [] },
  ],
};

const plan = (over: Partial<StoredPlan> = {}): StoredPlan => ({
  summary: 'Gut first.',
  focusNutrients: targets.focus.map((k) => ({ key: k, label: k, target: 1, unit: 'g', why: 'because', foods: ['x'], citationIds: [] })),
  gutProtocol: { principles: [] },
  supplements: [{ name: 'Vitamin D3', doseRange: '1000 IU', rationale: 'Take it with breakfast, low sun.', citationIds: [] }],
  disclaimer: '', seeProfessional: false,
  ...over,
});

const meal = (date: string, n: Record<string, number>, extra: Partial<WindowMeal> = {}): WindowMeal => ({
  date, nutrientsJson: JSON.stringify(n), plantsJson: JSON.stringify([]), fermentedJson: JSON.stringify([]), ultraProcessed: false, ...extra,
});

describe('summarizePlan', () => {
  const generatedAt = new Date(NOW.getTime() - 9 * DAY); // day 10 → week 2

  it('says which week of eight the plan is in', () => {
    const s = summarizePlan({ plan: plan(), targets, sources: [], generatedAt, meals: [], days: 7, now: NOW });
    expect(s).toMatchObject({ week: 2, weeks: PLAN_WEEKS });
    const late = summarizePlan({ plan: plan(), targets, sources: [], generatedAt: new Date(NOW.getTime() - 90 * DAY), meals: [], days: 7, now: NOW });
    expect(late.week).toBe(PLAN_WEEKS);
  });

  it('keeps counting from the first plan after an edit', () => {
    const s = summarizePlan({ plan: plan({ startedAt: new Date(NOW.getTime() - 22 * DAY).toISOString() }), targets, sources: [], generatedAt: NOW, meals: [], days: 7, now: NOW });
    expect(s.week).toBe(4);
  });

  it('averages focus nutrients over the observed days and counts the ones on track', () => {
    const meals = [meal('2026-10-04', { vitaminDIU: 400, ironMg: 4, fiberG: 20 }), meal('2026-10-05', { vitaminDIU: 400, ironMg: 4, fiberG: 22 })];
    const s = summarizePlan({ plan: plan(), targets, sources: [], generatedAt, meals, days: 2, now: NOW });
    expect(s.focus.map((f) => f.nutrient)).toEqual(['Vitamin D', 'Iron', 'Fiber']);
    expect(s.focus[0]).toMatchObject({ amount: 400, target: 600, unit: 'IU', onTrack: false }); // 67%
    expect(s.focus[1]).toMatchObject({ amount: 4, target: 18, onTrack: false });
    expect(s.focus[2]).toMatchObject({ amount: 21, target: 30, onTrack: true }); // 70%
    expect(s).toMatchObject({ onTrack: 1, total: 3 });
  });

  it('shows mcg as µg', () => {
    const t = { ...targets, focus: ['vitaminB12Mcg'] };
    const s = summarizePlan({ plan: plan(), targets: t, sources: [], generatedAt, meals: [meal('2026-10-05', { vitaminB12Mcg: 1.2 })], days: 1, now: NOW });
    expect(s.focus[0]).toMatchObject({ amount: 1.2, target: 2.4, unit: 'µg' });
  });

  it('builds the gut week: plants, fiber, fermented days, ultra-processed share', () => {
    const meals = [
      meal('2026-10-03', { fiberG: 14 }, { plantsJson: JSON.stringify(['spinach', 'oats']), fermentedJson: JSON.stringify(['kefir']) }),
      meal('2026-10-03', { fiberG: 0 }, { ultraProcessed: true, fermentedJson: JSON.stringify(['yogurt']) }),
      meal('2026-10-04', { fiberG: 7 }, { plantsJson: JSON.stringify(['Spinach', 'apple']) }),
      meal('2026-10-05', { fiberG: 0 }, { ultraProcessed: true }),
    ];
    const s = summarizePlan({ plan: plan(), targets, sources: [], generatedAt, meals, days: 7, now: NOW });
    expect(s.gut.plants).toEqual({ n: 3, target: GUT_DEFAULTS.plants });
    expect(s.gut.fiberG).toEqual({ n: 3, target: 30 });
    expect(s.gut.fermentedDays).toEqual({ n: 1, target: GUT_DEFAULTS.fermentedDays });
    expect(s.gut.upfPct).toEqual({ n: 50, max: GUT_DEFAULTS.upfMax });
  });

  it('lists supplements with dose and when, reading when from the rationale if unset', () => {
    const s = summarizePlan({ plan: plan(), targets, sources: [{ id: 1, type: 'library', title: 'Library' }], generatedAt, meals: [], days: 7, now: NOW });
    expect(s.supplements).toEqual([{ name: 'Vitamin D3', dose: '1000 IU', when: 'with breakfast' }]);
    expect(s.sources).toHaveLength(1);
  });
});

describe('ramps and helpers', () => {
  it('moves a ramped target linearly from → to', () => {
    const ramps = { fiberG: { from: 24, to: 36, weeks: 4, startedAt: new Date(NOW.getTime() - 14 * DAY).toISOString() } };
    expect(effectiveTarget('fiberG', 36, ramps, NOW)).toBe(30);
    expect(effectiveTarget('fiberG', 36, ramps, new Date(NOW.getTime() + 60 * DAY))).toBe(36);
    expect(effectiveTarget('ironMg', 18, ramps, NOW)).toBe(18);
  });
  it('resolves nutrient names loosely', () => {
    expect(nutrientKey(targets, 'iron')).toBe('ironMg');
    expect(nutrientKey(targets, 'Vitamin D')).toBe('vitaminDIU');
    expect(nutrientKey(targets, 'b12')).toBeNull();
    expect(nutrientKey(targets, 'vitamin b12')).toBe('vitaminB12Mcg');
  });
  it('reads timing from a rationale', () => {
    expect(whenOf({ rationale: 'Best before bed for sleep.' })).toBe('before bed');
    expect(whenOf({ when: 'with lunch', rationale: 'x' })).toBe('with lunch');
    expect(whenOf({ rationale: 'Food first.' })).toBeNull();
  });
});

describe('planChanges → applyChanges', () => {
  const state = (over: Partial<PlanState> = {}): PlanState => ({ plan: plan(), targets, macros: { calories: 2400, proteinG: 150, carbsG: 260, fatG: 80 }, ...over });
  const generatedAt = new Date(NOW.getTime() - 9 * DAY);

  it('raises fiber with a ramp and shows before → after', () => {
    const c = planChanges(state(), [{ field: 'fiber', to: 38, ramp: { weeks: 3 } }], NOW);
    expect(c[0]).toMatchObject({ field: 'fiberG', kind: 'target', to: 38, ramp: { weeks: 3 } });
    expect(c[0].row).toEqual({ key: 'Fiber target', from: '30 g', to: '38 g over 3 weeks' });
    const next = applyChanges(plan(), targets, c, generatedAt, NOW);
    expect(next.targets.targets.find((t) => t.key === 'fiberG')!.target).toBe(38);
    expect(next.plan.ramps!.fiberG).toMatchObject({ from: 30, to: 38, weeks: 3 });
    expect(next.plan.startedAt).toBe(generatedAt.toISOString());
    // Today the ramp has just started.
    expect(effectiveTarget('fiberG', 38, next.plan.ramps, NOW)).toBe(30);
  });

  it('drops a supplement', () => {
    const c = planChanges(state(), [{ field: 'supplement', name: 'vitamin d', to: null }], NOW);
    expect(c[0].row).toEqual({ key: 'Vitamin D3', from: '1000 IU · with breakfast', to: 'Dropped', removed: true });
    expect(applyChanges(plan(), targets, c, generatedAt, NOW).plan.supplements).toEqual([]);
    expect(changeSummary(c)).toBe('Vitamin D3 dropped');
  });

  it('adds a supplement with dose and timing', () => {
    const c = planChanges(state(), [{ field: 'supplement', to: { name: 'Magnesium glycinate', dose: '200 mg', when: 'before bed' } }], NOW);
    expect(c[0].row).toEqual({ key: 'Magnesium glycinate', from: 'None', to: '200 mg · before bed' });
    const p = applyChanges(plan(), targets, c, generatedAt, NOW).plan;
    expect(p.supplements.map((s) => s.name)).toEqual(['Vitamin D3', 'Magnesium glycinate']);
  });

  it('swaps the focus list ("focus on iron instead")', () => {
    const c = planChanges(state(), [{ field: 'focus', to: ['iron', 'vitamin b12'] }], NOW);
    expect(c[0].row).toEqual({ key: 'Focus', from: 'Vitamin D, iron, fiber', to: 'Iron, vitamin B12' });
    const next = applyChanges(plan(), targets, c, generatedAt, NOW);
    expect(next.targets.focus).toEqual(['ironMg', 'vitaminB12Mcg']);
    expect(next.plan.focusNutrients.map((f) => f.key)).toEqual(['ironMg', 'vitaminB12Mcg']);
    expect(next.plan.focusNutrients[0].why).toBe('because'); // kept
  });

  it('changes gut targets and macros', () => {
    const c = planChanges(state(), [{ field: 'plants', to: 25 }, { field: 'proteinG', to: 170 }], NOW);
    expect(c.map((x) => x.row)).toEqual([{ key: 'Plants a week', from: '30', to: '25' }, { key: 'Protein', from: '150 g', to: '170 g' }]);
    const next = applyChanges(plan(), targets, c.filter((x) => x.kind !== 'macro'), generatedAt, NOW);
    expect(next.plan.gutTargets).toEqual({ plants: 25 });
  });

  it('refuses plan edits without a plan, but allows macros', () => {
    expect(() => planChanges(state({ plan: null, targets: null }), [{ field: 'fiberG', to: 35 }])).toThrow(/no nutrition plan/);
    expect(planChanges(state({ plan: null, targets: null }), [{ field: 'calories', to: 2200 }])[0].kind).toBe('macro');
  });

  it('refuses unknown fields and empty lists in plain words', () => {
    expect(() => planChanges(state(), [{ field: 'vibes', to: 3 }])).toThrow(/can’t change “vibes”/);
    expect(() => planChanges(state(), [])).toThrow(/Say what to change/);
    expect(() => planChanges(state(), [{ field: 'supplement', name: 'creatine', to: null }])).toThrow(/no creatine/);
  });
});
