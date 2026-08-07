// Micro-backfill net — when the primary parse returns no usable micronutrient
// profile, enrichMealDetailHybrid re-asks with a focused nutrients-only call
// and merges the result. Guards the "sometimes no micronutrients" bug.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockEstimate = vi.hoisted(() => vi.fn());
vi.mock('../services/llmService.js', () => ({
  estimateMicronutrientsOnly: mockEstimate,
}));

const { enrichMealDetailHybrid } = await import('../services/nutritionEnrichmentService.js');

const detail = (nutrients: Record<string, number>) => ({
  name: 'Chicken shawarma with rice',
  calories: 617, proteinG: 42, carbsG: 61, fatG: 19,
  mealType: 'lunch' as const, confidence: 'high' as const, notes: '',
  ingredients: ['chicken', 'rice', 'garlic sauce'],
  tags: [], plants: ['rice'], fermentedFoods: [], ultraProcessed: false,
  nutrients: nutrients as any,
});

const richMicros = {
  fiberG: 4, sodiumMg: 1500, ironMg: 3.8, magnesiumMg: 90, potassiumMg: 700,
  calciumMg: 80, zincMg: 2.5, vitaminCMg: 12, vitaminB12Mcg: 1.1, folateMcg: 90,
  vitaminAIU: 500, vitaminDIU: 10, vitaminEMg: 2, sugarG: 4, saturatedFatG: 5,
  cholesterolMg: 100, omega3G: 0.2, omega6G: 1.5,
};

beforeEach(() => {
  mockEstimate.mockReset();
});

describe('micro-backfill in enrichMealDetailHybrid', () => {
  it('re-asks when the parse produced an all-zero micro profile', async () => {
    mockEstimate.mockResolvedValue(richMicros);
    const { detail: out } = await enrichMealDetailHybrid(detail({}));
    // The trailing region defaults to 'global', which makes the re-ask prompt
    // byte-identical to what it was before regional support was added.
    expect(mockEstimate).toHaveBeenCalledWith(
      'Chicken shawarma with rice', ['chicken', 'rice', 'garlic sauce'], 617, 'global',
    );
    expect(out.nutrients.ironMg).toBe(3.8);
    expect(out.nutrients.fiberG).toBe(4);
  });

  it('one lone sodium value is not a usable profile — still backfills', async () => {
    mockEstimate.mockResolvedValue(richMicros);
    const { detail: out } = await enrichMealDetailHybrid(detail({ sodiumMg: 900 }));
    expect(mockEstimate).toHaveBeenCalled();
    expect(out.nutrients.magnesiumMg).toBe(90);
  });

  it('does NOT re-ask when the parse already carried micros', async () => {
    const { detail: out } = await enrichMealDetailHybrid(detail(richMicros));
    expect(mockEstimate).not.toHaveBeenCalled();
    expect(out.nutrients.ironMg).toBe(3.8);
  });

  it('keeps the original zeros when the backfill itself fails', async () => {
    mockEstimate.mockResolvedValue(null);
    const { detail: out } = await enrichMealDetailHybrid(detail({}));
    expect(out.nutrients.ironMg).toBe(0); // degraded, but not crashed
  });
});
