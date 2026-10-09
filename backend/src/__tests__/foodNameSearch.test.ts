// Name search in Open Food Facts and USDA Branded: same brand, named product,
// one serving as sold.

import { describe, it, expect, vi } from 'vitest';

vi.mock('@google/genai', () => ({ GoogleGenAI: vi.fn() }));

import { offCandidate, usdaCandidate, pickDbMatch, productRecall, searchDatabases } from '../services/food/nameSearch.js';

const BAREBELLS_OFF = { brands: ['Barebells'], product_name: 'Protein Bar Cookies & Cream', serving_size: '55 g', serving_quantity: 55, countries_tags: ['en:canada'], nutriments: { 'energy-kcal_100g': 362, proteins_100g: 36, carbohydrates_100g: 31, fat_100g: 13.6 } };
const QUEST_USDA = { brandOwner: 'Quest Nutrition, LLC', brandName: 'QUEST', description: 'COOKIES & CREAM PROTEIN BAR', servingSize: 60, servingSizeUnit: 'GRM', householdServingFullText: '1 bar', foodNutrients: [{ nutrientId: 1008, value: 333 }, { nutrientId: 1003, value: 35 }, { nutrientId: 1005, value: 40 }, { nutrientId: 1004, value: 13.3 }] };
const item = { brand: 'Barebells', product: 'Cookies & Cream protein bar', size: null };

describe('candidates', () => {
  it('reads OFF per-serving values from per 100 g × serving weight', () => {
    const c = offCandidate(BAREBELLS_OFF)!;
    expect(c.perServing!.calories).toBeCloseTo(199.1, 1);
    expect(c.canada).toBe(true);
  });
  it('prefers OFF stated per-serving values', () => {
    expect(offCandidate({ ...BAREBELLS_OFF, nutriments: { 'energy-kcal_serving': 200, proteins_serving: 20, carbohydrates_serving: 17, fat_serving: 7.5 } })!.perServing!.calories).toBe(200);
  });
  it('reads USDA branded per 100 g × serving size', () => {
    const c = usdaCandidate(QUEST_USDA)!;
    expect(c.perServing!.calories).toBeCloseTo(199.8, 1);
    expect(c.servingSize).toBe('1 bar · 60 g');
  });
  it('drops candidates with no brand or no name', () => {
    expect(offCandidate({ product_name: 'x' })).toBeNull();
    expect(usdaCandidate({ brandOwner: 'A' })).toBeNull();
  });
});

describe('pickDbMatch', () => {
  it('needs the same brand — a Quest bar never answers for Barebells', () => {
    expect(pickDbMatch(item, [usdaCandidate(QUEST_USDA)!], true)).toEqual({ kind: 'not_found', reason: 'no_brand_match', brandSeen: false });
  });
  it('takes the same-brand product with a serving', () => {
    const r = pickDbMatch(item, [usdaCandidate(QUEST_USDA)!, offCandidate(BAREBELLS_OFF)!], true);
    expect(r.kind).toBe('found');
    if (r.kind === 'found') { expect(r.db).toBe('off'); expect(r.facts.calories).toBe(199); expect(r.facts.sources[0].title).toBe('Open Food Facts'); }
  });
  it('reports the brand as seen when only the flavour is missing', () => {
    expect(pickDbMatch({ ...item, product: 'Salty Peanut bar' }, [offCandidate(BAREBELLS_OFF)!], true)).toEqual({ kind: 'not_found', reason: 'no_product_match', brandSeen: true });
  });
  it('scores product words, ignoring the brand', () => {
    expect(productRecall(item, 'Protein Bar Cookies & Cream')).toBe(1);
    expect(productRecall(item, 'Salty Peanut Protein Bar')).toBe(0.5);
  });
});

describe('searchDatabases', () => {
  it('queries both and reports unavailable only when both are down', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('down'));
    expect((await searchDatabases(item, { fetchImpl: fetchImpl as any })).kind).toBe('unavailable');
    const ok = vi.fn().mockImplementation(async (url: string) => ({ ok: true, json: async () => (url.includes('openfoodfacts') ? { hits: [BAREBELLS_OFF] } : { foods: [] }) }));
    process.env.USDA_API_KEY = 'k';
    expect((await searchDatabases(item, { fetchImpl: ok as any })).kind).toBe('found');
  });
});
