import { describe, it, expect } from 'vitest';
import { buildMicroDay } from '../services/microDay.js';

const cov = (key: string, label: string, unit: string, target: number, ceiling = false) => ({ key, label, unit, amount: 0, target, pct: 0, status: 'low' as any, ceiling });
const coverage = [cov('vitaminCMg', 'Vitamin C', 'mg', 90), cov('zincMg', 'Zinc', 'mg', 11), cov('magnesiumMg', 'Magnesium', 'mg', 400), cov('sodiumMg', 'Sodium', 'mg', 2300, true), cov('proteinG', 'Protein', 'g', 130)];
const meal = (name: string, map: Record<string, number>) => ({ name, date: '2026-10-19', calories: 0, nutrientMapJson: JSON.stringify(map) });

describe('buildMicroDay', () => {
  const day = buildMicroDay([
    meal('Chicken Caesar wrap with orange juice', { vitaminCMg: 182, zincMg: 2.2, magnesiumMg: 63, sodiumMg: 1515, proteinG: 49 }),
    meal('Magnesium bisglycinate 200 mg and zinc 15 mg supplements', { magnesiumMg: 200, zincMg: 15 }),
    meal('Vitamin C 2500 mg', { vitaminCMg: 2500 }),
    meal('Selenium 200 mcg', { seleniumMcg: 200 }),
  ], coverage);
  const row = (k: string) => day.groups.flatMap((g) => g.rows).find((r) => r.key === k)!;

  it('every nutrient with totals, % of target and the supplement share', () => {
    expect(row('zincMg')).toMatchObject({ amount: 17.2, target: 11, pct: 156, fromSupplements: 15 });
    expect(row('magnesiumMg')).toMatchObject({ amount: 263, fromSupplements: 200 });
    expect(day.groups.flatMap((g) => g.rows).some((r) => r.key === 'proteinG')).toBe(false);
  });
  it('flags over the upper limit (magnesium judged on supplements only)', () => {
    expect(row('vitaminCMg').overUl).toBe(true);
    expect(row('magnesiumMg').overUl).toBe(false); // 200 mg supplemental < 350
    expect(day.overUl.map((r) => r.key)).toContain('vitaminCMg');
  });
  it('nutrients outside the registry still show, without a detail page', () => {
    expect(row('seleniumMcg')).toMatchObject({ amount: 200, target: 55, hasDetail: false });
    expect(row('zincMg').hasDetail).toBe(true);
  });
  it('groups vitamins, minerals and limits; supplements listed', () => {
    expect(day.groups.map((g) => g.title)).toEqual(['Vitamins', 'Minerals', 'Limits']);
    expect(day.supplements).toHaveLength(3);
    expect(row('zincMg').sources[0]).toMatchObject({ supplement: true, amount: 15 });
  });
});
