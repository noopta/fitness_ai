// Web barcode lookup — the checks that stand between a grounded model answer
// and the community table. The "found" fixture is the real answer Gemini gave
// for 737628064502 on 5 Oct 2026 (Simply Asia Thai Peanut Noodle Kit).

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(),
  Type: { OBJECT: 'OBJECT', STRING: 'STRING', NUMBER: 'NUMBER', BOOLEAN: 'BOOLEAN' },
}));

import { validateWebAnswer, sourcesFrom, webLookupBarcode, cachedWebLookup, _resetWebLookupCache, buildWebPrompt } from '../services/food/webFoodLookup.js';

const SRC = [{ title: 'fatsecret.com', uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc' }];
const KIT = { found: true, name: 'Thai Peanut Noodle Kit', brand: 'Simply Asia Foods', basis: 'per_serving', servingSize: '0.333 PACKAGE (52g)', servingGrams: 52, calories: 200, proteinG: 5, carbsG: 37, fatG: 4 };

function response(answer: unknown, chunks: unknown[] = [{ web: SRC[0] }]) {
  return { text: JSON.stringify(answer), candidates: [{ groundingMetadata: { groundingChunks: chunks } }] };
}

describe('validateWebAnswer', () => {
  it('converts a per-serving answer to per 100 g', () => {
    const out = validateWebAnswer(KIT, SRC);
    expect(out.kind).toBe('found');
    if (out.kind !== 'found') return;
    expect(out.product.caloriesPer100g).toBe(385);   // 200 × 100/52
    expect(out.product.proteinG).toBe(9.6);
    expect(out.product.carbsG).toBe(71.2);
    expect(out.product.fatG).toBe(7.7);
    expect(out.product.servingQuantityG).toBe(52);
    expect(out.product.brand).toBe('Simply Asia Foods');
    expect(out.product.sources).toEqual(SRC);
  });

  it('passes per-100 g values through unchanged', () => {
    const out = validateWebAnswer({ ...KIT, basis: 'per_100g', servingGrams: null, calories: 385, proteinG: 9.6, carbsG: 71.2, fatG: 7.7 }, SRC);
    expect(out.kind === 'found' && out.product.caloriesPer100g).toBe(385);
  });

  it('rejects an answer with no cited source (likely from memory)', () => {
    expect(validateWebAnswer(KIT, [])).toEqual({ kind: 'not_found', reason: 'ungrounded' });
  });

  it('respects found=false', () => {
    expect(validateWebAnswer({ found: false }, SRC)).toEqual({ kind: 'not_found', reason: 'model_not_found' });
    expect(validateWebAnswer(null, SRC)).toEqual({ kind: 'not_found', reason: 'model_not_found' });
  });

  it('rejects a per-serving answer without a serving weight — per 100 g cannot be derived', () => {
    expect(validateWebAnswer({ ...KIT, servingGrams: null }, SRC)).toEqual({ kind: 'not_found', reason: 'no_serving_weight' });
  });

  it('rejects macros that do not add up to the calories', () => {
    expect(validateWebAnswer({ ...KIT, calories: 900 }, SRC)).toEqual({ kind: 'not_found', reason: 'macros_mismatch' });
  });

  it('tolerates label rounding and fibre', () => {
    // 4·5 + 4·37 + 9·4 = 204 vs 200 printed
    expect(validateWebAnswer({ ...KIT, calories: 180 }, SRC).kind).toBe('found');
  });

  it('rejects a missing name or calories', () => {
    expect(validateWebAnswer({ ...KIT, name: '  ' }, SRC)).toEqual({ kind: 'not_found', reason: 'no_name' });
    expect(validateWebAnswer({ ...KIT, calories: null }, SRC)).toEqual({ kind: 'not_found', reason: 'no_calories' });
  });

  it('caps an implausible per-100 g value (per-pack misread)', () => {
    const out = validateWebAnswer({ ...KIT, basis: 'per_100g', calories: 1500, proteinG: 0, carbsG: 0, fatG: 166 }, SRC);
    expect(out.kind === 'found' && out.product.caloriesPer100g).toBe(900);
  });
});

describe('sourcesFrom', () => {
  it('pulls web sources from grounding metadata and skips non-web chunks', () => {
    expect(sourcesFrom(response({}, [{ web: SRC[0] }, { retrievedContext: {} }, { web: { uri: '' } }]))).toEqual(SRC);
    expect(sourcesFrom({})).toEqual([]);
  });
});

describe('webLookupBarcode', () => {
  beforeEach(() => _resetWebLookupCache());

  it('uses Google Search grounding with the structured schema and the default temperature', async () => {
    const generate = vi.fn().mockResolvedValue(response(KIT));
    const out = await webLookupBarcode('737628064502', generate);
    expect(out.kind).toBe('found');
    const args = generate.mock.calls[0][0];
    expect(args.config.tools).toEqual([{ googleSearch: {} }]);
    expect(args.config.responseSchema).toBeTruthy();
    expect(args.config.temperature).toBeUndefined();
    expect(args.contents).toContain('737628064502');
  });

  it('caches a result (hits and misses) so a re-scan does not search again', async () => {
    const generate = vi.fn().mockResolvedValue(response({ found: false }));
    await webLookupBarcode('6154000123456', generate);
    await webLookupBarcode('6154000123456', generate);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(cachedWebLookup('6154000123456')?.kind).toBe('not_found');
  });

  it('reports a model error as unavailable and does not cache it', async () => {
    const generate = vi.fn().mockRejectedValueOnce(new Error('503')).mockResolvedValueOnce(response(KIT));
    expect(await webLookupBarcode('737628064502', generate)).toEqual({ kind: 'unavailable', reason: 'model_error' });
    expect((await webLookupBarcode('737628064502', generate)).kind).toBe('found');
  });

  it('treats unparseable model text as not found', async () => {
    const generate = vi.fn().mockResolvedValue({ text: 'not json', candidates: [] });
    expect(await webLookupBarcode('123456', generate)).toEqual({ kind: 'not_found', reason: 'model_not_found' });
  });
});

describe('buildWebPrompt', () => {
  it('demands an exact barcode match and stated values, not estimates', () => {
    const p = buildWebPrompt('6154000123456');
    expect(p).toContain('6154000123456');
    expect(p).toMatch(/exact barcode/i);
    expect(p).toMatch(/do not estimate/i);
  });
});
