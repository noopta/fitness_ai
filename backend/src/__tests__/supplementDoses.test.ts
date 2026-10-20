import { describe, it, expect } from 'vitest';
import { parseSupplementDoses, applySupplementDoses, looksLikeSupplement } from '../services/supplementDoses.js';

const get = (text: string) => Object.fromEntries(parseSupplementDoses(text).map((h) => [h.key, h.amount]));

describe('parseSupplementDoses', () => {
  it('reads the exact entry that saved zero micros (19 Oct)', () => {
    expect(get('Magnesium bisglycinate 200 mg and zinc 15 mg supplements')).toEqual({ magnesiumMg: 200, zincMg: 15 });
  });
  it('vitamins with every unit and conversion', () => {
    expect(get('Vitamin C 1000mg')).toEqual({ vitaminCMg: 1000 });
    expect(get('vitamin D3 5000 IU')).toEqual({ vitaminDIU: 5000 });
    expect(get('D3 50 mcg')).toEqual({ vitaminDIU: 2000 });
    expect(get('B12 1000 mcg')).toEqual({ vitaminB12Mcg: 1000 });
    expect(get('vitamin E 400 IU')).toEqual({ vitaminEMg: 268 });
    expect(get('vitamin A 900 mcg')).toEqual({ vitaminAIU: 2997 });
    expect(get('vitamin K2 100µg')).toEqual({ vitaminKMcg: 100 });
  });
  it('counts capsules', () => {
    expect(get('2 softgels of vitamin D 1000 IU')).toEqual({ vitaminDIU: 2000 });
  });
  it('electrolytes in one line', () => {
    expect(get('LMNT: sodium 1000 mg potassium 200 mg magnesium 60 mg')).toEqual({ sodiumMg: 1000, potassiumMg: 200, magnesiumMg: 60 });
  });
  it('fish oil without EPA/DHA ≈ 30% omega-3; with them, as stated', () => {
    expect(get('fish oil 1000 mg')).toEqual({ omega3G: 0.3 });
    expect(get('omega-3 EPA+DHA 1.2 g')).toEqual({ omega3G: 1.2 });
  });
  it('never reads food weights as doses', () => {
    expect(get('calcium-rich greek yogurt 200 g')).toEqual({});
    expect(get('2 eggs and toast')).toEqual({});
    expect(get('Chicken Caesar wrap with orange juice and vitamin C supplement')).toEqual({});
    expect(get('iron skillet steak 300 g')).toEqual({});
  });
  it('looksLikeSupplement needs a dose', () => {
    expect(looksLikeSupplement('zinc 15 mg')).toBe(true);
    expect(looksLikeSupplement('vitamin C supplement')).toBe(false);
  });
});

describe('applySupplementDoses', () => {
  it('adds a dose the estimate could not have included', () => {
    const r = applySupplementDoses({ vitaminCMg: 182, zincMg: 0 } as any, { vitaminCMg: 182 }, 'wrap with orange juice, vitamin C 1000 mg');
    expect(r.nutrients.vitaminCMg).toBe(1182);
    expect(r.nutrientMap.vitaminCMg).toBe(1182);
  });
  it('keeps an estimate that already includes it', () => {
    const r = applySupplementDoses({ vitaminCMg: 1522.6 } as any, { vitaminCMg: 1522.6 }, 'wrap, OJ and vitamin C 1000 mg');
    expect(r.nutrients.vitaminCMg).toBe(1522.6);
    expect(r.added).toEqual([]);
  });
  it('zero-nutrient supplement log gets its micros (the bug)', () => {
    const r = applySupplementDoses({ magnesiumMg: 0, zincMg: 0 } as any, {}, 'Magnesium bisglycinate 200 mg and zinc 15 mg supplements');
    expect(r.nutrients).toMatchObject({ magnesiumMg: 200, zincMg: 15 });
  });
  it('nutrients outside the fixed schema go to the open map', () => {
    const r = applySupplementDoses({} as any, {}, 'selenium 200 mcg');
    expect(r.nutrientMap.seleniumMcg).toBe(200);
    expect((r.nutrients as any).seleniumMcg).toBeUndefined();
  });
});
