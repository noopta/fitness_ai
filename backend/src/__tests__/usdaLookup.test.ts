import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  extractNutrient,
  foldQuery,
  lookupUsdaFood,
  parseUsdaFood,
  pickBestMatch,
  scoreUsdaMatch,
  searchUsdaCandidates,
  tokens,
  _resetUsdaCache,
  type UsdaCandidate,
} from '../services/food/usdaLookup.js';

const food = (description: string, dataType: string, kcal: number, p: number, c: number, f: number, extra: any[] = []) => ({
  fdcId: 1,
  description,
  dataType,
  foodNutrients: [
    { nutrientId: 1008, unitName: 'KCAL', value: kcal },
    { nutrientId: 1003, unitName: 'G', value: p },
    { nutrientId: 1005, unitName: 'G', value: c },
    { nutrientId: 1004, unitName: 'G', value: f },
    ...extra,
  ],
});

const cand = (description: string, dataType: string, kcal: number): UsdaCandidate =>
  parseUsdaFood(food(description, dataType, kcal, 1, 1, 1))!;

beforeEach(() => _resetUsdaCache());

describe('foldQuery / tokens', () => {
  it('folds case, accents and punctuation', () => {
    expect(foldQuery('  Jalapeño,  POPPERS!! ')).toBe('jalapeno poppers');
  });
  it('drops stopwords and singularises', () => {
    expect(tokens('Eggs, with berries and potatoes')).toEqual(['egg', 'berry', 'potato']);
  });
});

describe('extractNutrient / parseUsdaFood', () => {
  it('sums matching ids and skips kJ rows', () => {
    const f = { foodNutrients: [{ nutrientId: 1008, unitName: 'kJ', value: 400 }, { nutrientId: 1008, unitName: 'KCAL', value: 95 }] };
    expect(extractNutrient(f, [1008])).toBe(95);
  });

  it('falls back to Atwater energy (Foundation), taking one variant not the sum', () => {
    const f = { description: 'Egg, whole, raw', dataType: 'Foundation', foodNutrients: [
      { nutrientId: 2047, value: 143 }, { nutrientId: 2048, value: 140 },
      { nutrientId: 1003, value: 12.4 }, { nutrientId: 1004, value: 9.9 }, { nutrientId: 1005, value: 0.7 },
      { nutrientId: 1092, value: 130 },
    ] };
    const c = parseUsdaFood(f)!;
    expect(c.per100g.calories).toBe(143);
    expect(c.micros.potassiumMg).toBe(130);
  });

  it('derives kcal from macros when no energy row exists, rejects all-zero records', () => {
    const c = parseUsdaFood({ description: 'X', foodNutrients: [{ nutrientId: 1003, value: 10 }, { nutrientId: 1004, value: 10 }] })!;
    expect(c.per100g.calories).toBe(130);
    expect(parseUsdaFood({ description: 'Y', foodNutrients: [] })).toBeNull();
    expect(parseUsdaFood({ foodNutrients: [] })).toBeNull();
  });
});

describe('scoreUsdaMatch / pickBestMatch', () => {
  it('requires the head word', () => {
    expect(scoreUsdaMatch('egg, fried', 'fried', { description: 'Rice, fried', dataType: 'Survey (FNDDS)' })).toBe(-1);
  });

  it('prefers the plain entry over a long qualified one', () => {
    const plain = scoreUsdaMatch('chicken breast, grilled', 'grilled', { description: 'Chicken breast, grilled', dataType: 'Survey (FNDDS)' });
    const busy = scoreUsdaMatch('chicken breast, grilled', 'grilled', { description: 'Chicken breast, grilled, breaded, with skin, from fast food', dataType: 'Survey (FNDDS)' });
    expect(plain).toBeGreaterThan(busy);
  });

  it('nudges FNDDS for cooked items and Foundation/SR for raw', () => {
    const fn = { description: 'Broccoli, steamed', dataType: 'Survey (FNDDS)' };
    const sr = { description: 'Broccoli, steamed', dataType: 'SR Legacy' };
    expect(scoreUsdaMatch('broccoli steamed', 'steamed', fn)).toBeGreaterThan(scoreUsdaMatch('broccoli steamed', 'steamed', sr));
    expect(scoreUsdaMatch('broccoli', null, { ...sr, description: 'Broccoli, raw' }))
      .toBeGreaterThan(scoreUsdaMatch('broccoli', null, { ...fn, description: 'Broccoli, raw' }));
  });

  it('rejects weak matches', () => {
    expect(pickBestMatch('salmon teriyaki bowl', null, [cand('Salmon, raw', 'Foundation', 200)], null)).toBeNull();
  });

  it('rejects a profile implausibly far from the model per-100g kcal', () => {
    const chips = cand('Banana, chips', 'SR Legacy', 519);
    const fresh = cand('Banana, raw', 'SR Legacy', 89);
    expect(pickBestMatch('banana', null, [chips, fresh], 90)?.description).toBe('Banana, raw');
    expect(pickBestMatch('banana', null, [chips], 90)).toBeNull();
    // Without a model figure the plausibility gate is skipped.
    expect(pickBestMatch('banana', null, [chips], null)?.description).toBe('Banana, chips');
  });
});

describe('searchUsdaCandidates / lookupUsdaFood', () => {
  const okResp = (foods: any[]) => ({ ok: true, json: async () => ({ foods }) }) as any;

  it('returns null without an api key (no fetch)', async () => {
    const fetchImpl = vi.fn();
    expect(await searchUsdaCandidates('rice', { apiKey: '', fetchImpl: fetchImpl as any })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('queries lab datasets only and caches by folded query', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResp([food('Rice, white, cooked', 'SR Legacy', 130, 2.7, 28, 0.3)]));
    const a = await searchUsdaCandidates('Rice, white, cooked', { apiKey: 'k', fetchImpl });
    const b = await searchUsdaCandidates('  rice white COOKED ', { apiKey: 'k', fetchImpl });
    expect(a).toHaveLength(1);
    expect(b).toBe(a);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.dataType).toEqual(['Foundation', 'SR Legacy', 'Survey (FNDDS)']);
    expect(body.dataType).not.toContain('Branded');
  });

  it('does not cache failures', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: false } as any)
      .mockResolvedValueOnce(okResp([food('Egg, fried', 'Survey (FNDDS)', 196, 13.6, 0.9, 15)]));
    expect(await searchUsdaCandidates('egg fried', { apiKey: 'k', fetchImpl })).toBeNull();
    expect(await searchUsdaCandidates('egg fried', { apiKey: 'k', fetchImpl })).toHaveLength(1);
  });

  it('aborts after the timeout and returns null', async () => {
    const fetchImpl = vi.fn((_url: string, init: any) => new Promise((_res, rej) => {
      init.signal.addEventListener('abort', () => rej(new Error('aborted')));
    })) as any;
    const t0 = Date.now();
    expect(await searchUsdaCandidates('slow food', { apiKey: 'k', fetchImpl, timeoutMs: 30 })).toBeNull();
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('lookupUsdaFood returns the best acceptable match', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResp([
      food('Egg, whole, cooked, scrambled', 'SR Legacy', 149, 10, 1.6, 11),
      food('Egg, whole, cooked, fried', 'SR Legacy', 196, 13.6, 0.8, 14.8),
    ]));
    const m = await lookupUsdaFood('egg, whole, fried', 'fried', 200, { apiKey: 'k', fetchImpl });
    expect(m?.description).toBe('Egg, whole, cooked, fried');
  });
});
