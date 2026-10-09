// Web lookup for typed branded foods — the checks between a grounded answer
// and a logged meal, and the swap of the parser's estimate for real values.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(),
  Type: { OBJECT: 'OBJECT', STRING: 'STRING', NUMBER: 'NUMBER', BOOLEAN: 'BOOLEAN' },
}));

import {
  validateBrandedAnswer, applyBrandedLookups, coerceBrandedItems, lookupBranded, _resetBrandedCache,
  buildBrandedPrompt, mentionsBrand, sourceLabel, menuSize, applyLabelMicros, resolveSources, type BrandedItem,
} from '../services/food/brandedLookup.js';

const SRC = [{ title: 'starbucks.ca', uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc' }];
const LATTE = { found: true, name: 'Iced Sugar-Free Caramel Protein Latte', brand: 'Starbucks', basis: 'per_serving', servingSize: 'Grande (16 fl oz)', calories: 210, proteinG: 22, carbsG: 21, fatG: 4.5 };
const item = (o: Partial<BrandedItem> = {}): BrandedItem => ({ brand: 'Starbucks', product: 'Iced Sugar-Free Caramel Protein Latte', size: 'Grande', servings: 1, estimate: { calories: 200, proteinG: 20, carbsG: 20, fatG: 5 }, ...o });

function response(answer: unknown, chunks: unknown[] = [{ web: SRC[0] }]) {
  return { text: JSON.stringify(answer), candidates: [{ groundingMetadata: { groundingChunks: chunks } }] };
}

describe('validateBrandedAnswer', () => {
  it('accepts the exact product and size, per serving', () => {
    const out = validateBrandedAnswer(LATTE, SRC, item());
    expect(out.kind).toBe('found');
    if (out.kind !== 'found') return;
    expect(out.facts.calories).toBe(210);
    expect(out.facts.proteinG).toBe(22);
    expect(out.facts.servingSize).toBe('Grande (16 fl oz)');
  });

  it('refuses an answer with no cited source', () => {
    expect(validateBrandedAnswer(LATTE, [], item())).toEqual({ kind: 'not_found', reason: 'ungrounded' });
  });

  it('refuses an answer sourced only from social media', () => {
    expect(validateBrandedAnswer(LATTE, [{ title: 'facebook.com', uri: 'https://vertexaisearch.cloud.google.com/r' }], item())).toEqual({ kind: 'not_found', reason: 'weak_source' });
    expect(validateBrandedAnswer(LATTE, [{ title: 'facebook.com', uri: 'https://x' }, SRC[0]], item()).kind).toBe('found');
  });

  it('refuses another brand', () => {
    const out = validateBrandedAnswer({ ...LATTE, brand: 'Tim Hortons', name: 'Protein Latte' }, [{ title: 'timhortons.ca', uri: 'https://x' }], item());
    expect(out).toEqual({ kind: 'not_found', reason: 'brand_mismatch' });
  });

  it('refuses a different size', () => {
    const out = validateBrandedAnswer({ ...LATTE, servingSize: 'Tall (12 fl oz)' }, SRC, item());
    expect(out).toEqual({ kind: 'not_found', reason: 'size_mismatch' });
  });

  it('only checks menu sizes, and trusts the model confirming the size', () => {
    expect(menuSize('Grande (16 fl oz)')).toBe('grande');
    expect(menuSize('sandwich')).toBeNull();
    expect(menuSize('14 fl oz')).toBeNull();
    expect(validateBrandedAnswer({ ...LATTE, servingSize: '1 sandwich' }, SRC, item({ size: 'sandwich' })).kind).toBe('found');
    expect(validateBrandedAnswer({ ...LATTE, servingSize: '16 fl oz', sizeMatches: true }, SRC, item()).kind).toBe('found');
  });

  it('does not need a size when none was asked for', () => {
    expect(validateBrandedAnswer({ ...LATTE, servingSize: 'Tall (12 fl oz)' }, SRC, item({ size: null })).kind).toBe('found');
  });

  it('refuses macros that do not add up to the calories', () => {
    expect(validateBrandedAnswer({ ...LATTE, calories: 600 }, SRC, item())).toEqual({ kind: 'not_found', reason: 'macros_mismatch' });
  });

  it('scales per-100 g values to the serving', () => {
    const out = validateBrandedAnswer({ found: true, name: 'Protein Chips', brand: 'Quest', basis: 'per_100g', servingGrams: 32, calories: 440, proteinG: 59, carbsG: 16, fatG: 16 }, [{ title: 'questnutrition.com', uri: 'https://x' }], { brand: 'Quest', size: null });
    expect(out.kind === 'found' && out.facts.calories).toBe(141);
  });

  it('keeps zero-calorie drinks', () => {
    const out = validateBrandedAnswer({ found: true, name: 'Diet Coke', brand: 'Coca-Cola', basis: 'per_serving', servingSize: '355 mL can', calories: 0, proteinG: 0, carbsG: 0, fatG: 0 }, [{ title: 'coca-cola.com', uri: 'https://x' }], { brand: 'Coca-Cola', size: null });
    expect(out.kind === 'found' && out.facts.calories).toBe(0);
  });

  it('treats found=false as a miss', () => {
    expect(validateBrandedAnswer({ found: false }, SRC, item()).kind).toBe('not_found');
  });
});

describe('mentionsBrand and sourceLabel', () => {
  it('matches brand spellings', () => {
    expect(mentionsBrand('Tim Hortons® Canada', 'Tim Hortons')).toBe(true);
    expect(mentionsBrand('starbucks.ca', 'Starbucks')).toBe(true);
    expect(mentionsBrand('dunkin.com', 'Starbucks')).toBe(false);
  });
  it('names the site from the title when the link is a grounding redirect', () => {
    expect(sourceLabel(SRC[0])).toBe('starbucks.ca');
    expect(sourceLabel({ title: null, uri: 'https://www.timhortons.ca/nutrition' })).toBe('timhortons.ca');
    expect(sourceLabel({ title: 'Open Food Facts', uri: 'https://world.openfoodfacts.org/product/1' })).toBe('Open Food Facts');
  });
});

describe('applyBrandedLookups', () => {
  it('swaps the estimate for the published values, times servings', () => {
    const totals = { calories: 700, proteinG: 50, carbsG: 60, fatG: 25 };
    const found = validateBrandedAnswer(LATTE, SRC, item());
    const { totals: t, lookups } = applyBrandedLookups(totals, [item({ servings: 2, estimate: { calories: 400, proteinG: 40, carbsG: 40, fatG: 10 } })], [found]);
    expect(t).toEqual({ calories: 720, proteinG: 54, carbsG: 62, fatG: 24 });
    expect(lookups[0]).toMatchObject({ status: 'found', sourceDomain: 'starbucks.ca', sourceUrl: null, calories: 420 });
  });

  it('leaves the estimate when nothing was found', () => {
    const totals = { calories: 200, proteinG: 20, carbsG: 20, fatG: 5 };
    const { totals: t, lookups } = applyBrandedLookups(totals, [item()], [{ kind: 'unavailable', reason: 'timeout' }]);
    expect(t).toEqual(totals);
    expect(lookups[0].status).toBe('estimated');
  });
});

describe('coerceBrandedItems', () => {
  it('keeps named items, defaults servings, drops junk, caps at three', () => {
    const out = coerceBrandedItems([
      { brand: 'Starbucks', product: 'Latte', size: 'null', calories: '190' },
      { brand: '', product: 'Mystery' },
      { brand: 'A', product: 'a' }, { brand: 'B', product: 'b' }, { brand: 'C', product: 'c' },
    ]);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ brand: 'Starbucks', size: null, servings: 1, estimate: { calories: 190 } });
    expect(coerceBrandedItems('nope')).toEqual([]);
  });
});

describe('lookupBranded', () => {
  beforeEach(() => _resetBrandedCache());

  it('searches with grounding, validates, and caches per item and zone', async () => {
    const generate = vi.fn().mockResolvedValue(response(LATTE));
    const a = await lookupBranded(item(), { tz: 'America/Edmonton', generate });
    const b = await lookupBranded(item(), { tz: 'America/Edmonton', generate });
    expect(a.kind).toBe('found');
    expect(b).toBe(a);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][0].config.tools).toEqual([{ googleSearch: {} }]);
    expect(generate.mock.calls[0][0].contents).toContain('America/Edmonton');
  });

  it('does not cache an outage', async () => {
    const generate = vi.fn().mockRejectedValueOnce(new Error('503')).mockResolvedValue(response(LATTE));
    expect((await lookupBranded(item(), { generate })).kind).toBe('unavailable');
    expect((await lookupBranded(item(), { generate })).kind).toBe('found');
  });

  it('gives up at the time budget', async () => {
    const generate = vi.fn(() => new Promise(() => {}));
    expect(await lookupBranded(item(), { generate, timeoutMs: 20 })).toEqual({ kind: 'unavailable', reason: 'timeout' });
  });

  it('asks for the size in the prompt', () => {
    expect(buildBrandedPrompt(item())).toMatch(/Grande size/);
  });
});

describe('label micronutrients', () => {
  const found = (micros: any, calories = 200) => ({ kind: 'found' as const, facts: { name: 'x', brand: 'B', servingSize: null, calories, proteinG: 0, carbsG: 0, fatG: 0, micros, sources: [] } });
  it('a lone item takes the label values; unlisted micros follow its calories', () => {
    const meal = { calories: 400, nutrients: { fiberG: 2, sodiumMg: 300, ironMg: 4 }, nutrientMap: { leucineG: 2 } };
    const r = applyLabelMicros(meal, [item({ estimate: { calories: 400, proteinG: 0, carbsG: 0, fatG: 0 } })], [found({ fiberG: 9, sodiumMg: 120 })]);
    expect(r.nutrients).toMatchObject({ fiberG: 9, sodiumMg: 120, ironMg: 2 });
    expect(r.fromLabel.sort()).toEqual(['fiberG', 'sodiumMg']);
    expect(r.nutrientMap).toMatchObject({ leucineG: 2, fiberG: 9, sodiumMg: 120, ironMg: 2 });
  });
  it('in a mixed meal only the item’s share is swapped, times servings', () => {
    const meal = { calories: 800, nutrients: { sodiumMg: 1000 } };
    const r = applyLabelMicros(meal, [item({ servings: 2, estimate: { calories: 400, proteinG: 0, carbsG: 0, fatG: 0 } })], [found({ sodiumMg: 100 })]);
    expect(r.nutrients.sodiumMg).toBe(700); // 1000 − 500 (its half) + 2 × 100
  });
  it('leaves micros alone when nothing was found', () => {
    expect(applyLabelMicros({ calories: 300, nutrients: { fiberG: 3 } }, [item()], [{ kind: 'not_found', reason: 'x' }]).nutrients.fiberG).toBe(3);
  });
});

describe('resolveSources', () => {
  it('follows grounding redirects to the real page, and drops ones that fail', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ headers: { get: () => 'https://www.mcdonalds.com/ca/en-ca/product/mcdouble.html' } })
      .mockRejectedValueOnce(new Error('timeout'));
    const out = await resolveSources([
      { title: 'mcdonalds.com', uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/a' },
      { title: 'x.com', uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/b' },
      { title: 'y.ca', uri: 'https://y.ca/page' },
    ], fetchImpl as any);
    expect(out.map((s) => s.uri)).toEqual(['https://www.mcdonalds.com/ca/en-ca/product/mcdouble.html', '', 'https://y.ca/page']);
  });
});
