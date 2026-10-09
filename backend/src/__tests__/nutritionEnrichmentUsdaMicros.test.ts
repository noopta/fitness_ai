// enrichMealDetailHybrid's meal-photo v2 path: precomputed per-item USDA
// micros are blended directly, skipping the sequential ingredient search.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockEstimate } = vi.hoisted(() => ({ mockEstimate: vi.fn() }));
vi.mock('../services/llmService.js', () => ({ estimateMicronutrientsOnly: mockEstimate }));

import { enrichMealDetailHybrid } from '../services/nutritionEnrichmentService.js';

const detail = (): any => ({
  name: 'Rice and egg', calories: 400, proteinG: 15, carbsG: 50, fatG: 12, mealType: 'lunch', confidence: 'high',
  notes: '', ingredients: ['rice', 'egg'], tags: [], plants: [], fermentedFoods: [], ultraProcessed: false,
  nutrientMap: {}, nutrients: { fiberG: 0 },
});

const LLM_MICROS = { fiberG: 2, sodiumMg: 300, potassiumMg: 200, ironMg: 2, calciumMg: 50 };

beforeEach(() => {
  mockEstimate.mockReset();
  mockEstimate.mockResolvedValue(LLM_MICROS);
});

describe('enrichMealDetailHybrid with usdaMicros', () => {
  it('backfills LLM micros then blends the USDA micros by coverage without fetching', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { detail: out, meta } = await enrichMealDetailHybrid(detail(), {
      usdaMicros: { micros: { potassiumMg: 400, fiberG: 1 }, matched: 1, total: 2 },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockEstimate).toHaveBeenCalledWith('Rice and egg', ['rice', 'egg'], 400, 'global');
    // weight 0.5: 400*0.5 + 200*0.5
    expect(out.nutrients.potassiumMg).toBe(300);
    expect(out.nutrients.fiberG).toBe(1.5);
    expect(meta).toEqual({ provider: 'hybrid_llm_usda', matchedIngredients: 1, totalIngredients: 2, usdaCoveragePct: 50, usedFallback: false });
    fetchSpy.mockRestore();
  });

  it('with no matches keeps the LLM micros and flags the fallback', async () => {
    const { detail: out, meta } = await enrichMealDetailHybrid(detail(), {
      usdaMicros: { micros: {}, matched: 0, total: 3 },
    });
    expect(out.nutrients.potassiumMg).toBe(200);
    expect(meta.usedFallback).toBe(true);
    expect(meta.totalIngredients).toBe(3);
  });
});

describe('enrichMealDetailHybrid for typed meals (blendIngredients: false)', () => {
  it('fills in missing micros but never searches USDA per ingredient', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { detail: out, meta } = await enrichMealDetailHybrid(detail(), { blendIngredients: false });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(out.nutrients.sodiumMg).toBe(300);
    expect(meta.matchedIngredients).toBe(0);
    fetchSpy.mockRestore();
  });
});
