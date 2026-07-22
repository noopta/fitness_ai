import { describe, it, expect } from 'vitest';
import {
  scoreGutWeek, normalizePlant, distinctPlants, type GutWeekInput,
} from '../services/gutHealthScoreService.js';

const week = (over: Partial<GutWeekInput> = {}): GutWeekInput => ({
  days: 7,
  avgDailyFiberG: 35,
  fiberTargetG: 35,
  distinctPlants: Array.from({ length: 30 }, (_, i) => `plant${i}`),
  fermentedServings: 7,
  mealsLogged: 21,
  ultraProcessedMeals: 0,
  daysWithTwoPlusMeals: 7,
  ...over,
});

describe('scoreGutWeek', () => {
  it('perfect week scores 100 with all pillars on track', () => {
    const r = scoreGutWeek(week());
    expect(r.overall).toBe(100);
    expect(r.pillars.every((p) => p.status === 'ok')).toBe(true);
    expect(r.plantCount).toBe(30);
  });

  it('scores each pillar independently', () => {
    const r = scoreGutWeek(week({ avgDailyFiberG: 14 })); // 40% of target
    const fiber = r.pillars.find((p) => p.key === 'fiber')!;
    expect(fiber.score).toBe(40);
    expect(fiber.status).toBe('low');
    expect(r.pillars.find((p) => p.key === 'plants')!.status).toBe('ok');
  });

  it('scales weekly targets for partial windows (2 observed days)', () => {
    const r = scoreGutWeek(week({
      days: 2, distinctPlants: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'],
      fermentedServings: 2, daysWithTwoPlusMeals: 2, mealsLogged: 5,
    }));
    // plant target scaled to round(30 * 2/7) = 9 → on track
    expect(r.pillars.find((p) => p.key === 'plants')!.score).toBe(100);
    expect(r.pillars.find((p) => p.key === 'ferment')!.score).toBe(100);
  });

  it('penalizes ultra-processed share (60%+ scores 0)', () => {
    const r = scoreGutWeek(week({ mealsLogged: 10, ultraProcessedMeals: 6 }));
    expect(r.pillars.find((p) => p.key === 'avoid')!.score).toBe(0);
  });

  it('handles an empty week without NaN', () => {
    const r = scoreGutWeek(week({
      avgDailyFiberG: 0, distinctPlants: [], fermentedServings: 0,
      mealsLogged: 0, ultraProcessedMeals: 0, daysWithTwoPlusMeals: 0,
    }));
    expect(Number.isFinite(r.overall)).toBe(true);
    expect(r.pillars.find((p) => p.key === 'fiber')!.status).toBe('vlow');
    // no meals logged → avoid pillar shouldn't punish (0% processed share)
    expect(r.pillars.find((p) => p.key === 'avoid')!.score).toBe(100);
  });
});

describe('plant normalization', () => {
  it('canonicalizes case, plurals and prefixes', () => {
    expect(normalizePlant('Tomatoes')).toBe('tomato');
    expect(normalizePlant('cherry tomatoes')).toBe('tomato');
    expect(normalizePlant('Blueberries')).toBe('blueberry');
    expect(normalizePlant('baby spinach')).toBe('spinach');
  });

  it('maps aliases to one canonical name', () => {
    expect(normalizePlant('scallion')).toBe('green onion');
    expect(normalizePlant('garbanzo beans')).toBe('chickpea');
    expect(normalizePlant('courgette')).toBe('zucchini');
  });

  it('counts distinct species across meals once', () => {
    const plants = distinctPlants([
      ['Tomatoes', 'spinach'],
      ['cherry tomato', 'Baby Spinach', 'lentils'],
    ]);
    expect(plants).toEqual(['lentil', 'spinach', 'tomato']);
  });
});
