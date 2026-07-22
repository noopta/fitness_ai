import { describe, it, expect } from 'vitest';
import { computeMicroTargets, statusFor, type MicroTarget } from '../services/microTargetsService.js';

const get = (r: ReturnType<typeof computeMicroTargets>, key: string) =>
  r.targets.find((t) => t.key === key)!;

describe('computeMicroTargets', () => {
  it('returns all 16 targets with male RDA defaults', () => {
    const r = computeMicroTargets({});
    expect(r.targets).toHaveLength(16);
    expect(get(r, 'ironMg').target).toBe(8);
    expect(get(r, 'magnesiumMg').target).toBe(420);
    expect(get(r, 'sodiumMg').direction).toBe('limit');
  });

  it('applies female RDAs (iron 18, magnesium 320)', () => {
    const r = computeMicroTargets({ sex: 'female' });
    expect(get(r, 'ironMg').target).toBe(18);
    expect(get(r, 'magnesiumMg').target).toBe(320);
  });

  it('scales fiber by calorie target at 14g/1000kcal within 25–45 clamp', () => {
    expect(get(computeMicroTargets({ calorieTarget: 2500 }), 'fiberG').target).toBe(35);
    expect(get(computeMicroTargets({ calorieTarget: 1200 }), 'fiberG').target).toBe(25); // clamped low
    expect(get(computeMicroTargets({ calorieTarget: 4000 }), 'fiberG').target).toBe(45); // clamped high
  });

  it('bumps magnesium/potassium/vitD and sodium allowance for heavy training', () => {
    const base = computeMicroTargets({});
    const heavy = computeMicroTargets({ trainingDaysPerWeek: 5 });
    expect(get(heavy, 'magnesiumMg').target).toBe(Math.round(420 * 1.15));
    expect(get(heavy, 'potassiumMg').target).toBe(Math.round(3400 * 1.1));
    expect(get(heavy, 'vitaminDIU').target).toBe(800);
    expect(get(heavy, 'sodiumMg').target).toBe(get(base, 'sodiumMg').target + 500);
    expect(get(heavy, 'magnesiumMg').rationale).toContain('training_bump');
  });

  it('raises iron and zinc for plant-based absorption', () => {
    const vegan = computeMicroTargets({ sex: 'female', dietaryStyle: 'vegan' });
    expect(get(vegan, 'ironMg').target).toBe(Math.round(18 * 1.8));
    expect(get(vegan, 'zincMg').target).toBe(12);
    expect(get(vegan, 'ironMg').rationale).toContain('plant_absorption');
  });

  it('always puts fiber first in focus and caps focus at 6', () => {
    const r = computeMicroTargets({ goals: ['energy', 'sleep'] });
    expect(r.focus[0]).toBe('fiberG');
    expect(r.focus).toHaveLength(6);
  });

  it('weights ranked goals into focus (energy → iron/B12 present)', () => {
    const r = computeMicroTargets({ goals: ['energy'] });
    expect(r.focus).toContain('ironMg');
    expect(r.focus).toContain('vitaminB12Mcg');
  });

  it('vegan style pushes B12/omega-3 risk nutrients into focus', () => {
    const r = computeMicroTargets({ dietaryStyle: 'vegan' });
    expect(r.focus).toContain('vitaminB12Mcg');
    expect(r.focus).toContain('omega3G');
  });

  it('never includes limit-direction nutrients in focus', () => {
    const r = computeMicroTargets({ goals: ['gut_comfort', 'energy', 'recovery'] });
    expect(r.focus).not.toContain('sodiumMg');
    expect(r.focus).not.toContain('sugarG');
  });
});

describe('statusFor', () => {
  const meet: MicroTarget = { key: 'ironMg', label: 'Iron', unit: 'mg', target: 10, direction: 'meet', rationale: [] };
  const limit: MicroTarget = { key: 'sodiumMg', label: 'Sodium', unit: 'mg', target: 2300, direction: 'limit', rationale: [] };

  it('bands meet-direction: ≥70% ok, 40–70% low, <40% vlow', () => {
    expect(statusFor(meet, 7)).toBe('ok');
    expect(statusFor(meet, 5)).toBe('low');
    expect(statusFor(meet, 3.9)).toBe('vlow');
  });

  it('bands limit-direction inverted: under cap ok, +30% low, beyond vlow', () => {
    expect(statusFor(limit, 2200)).toBe('ok');
    expect(statusFor(limit, 2800)).toBe('low');
    expect(statusFor(limit, 3200)).toBe('vlow');
  });
});
