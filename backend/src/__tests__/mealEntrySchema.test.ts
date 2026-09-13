// Meal-entry validation: micronutrients are scan/LLM estimates and must be
// clamped into range, never reject the whole meal (a >20000mg sodium estimate
// 400'd a real user's log four times on 2026-08-28). Macros and structure
// remain strict.
import { describe, it, expect, vi } from 'vitest';

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(function (this: any) {}),
}));
// routes/nutrition.ts transitively constructs the OpenAI client at import
// time — stub the service modules so the schema can be imported in isolation.
vi.mock('../services/llmService.js', () => ({
  parseMealMacros: vi.fn(), analyzeMealPhoto: vi.fn(), suggestMeals: vi.fn(),
  transcribeAudio: vi.fn(), parseNutritionLabel: vi.fn(),
}));
vi.mock('../services/ragService.js', () => ({ buildRAGContext: vi.fn() }));
vi.mock('../services/chatClient.js', () => ({ chatComplete: vi.fn() }));

const { mealEntrySchema } = await import('../routes/nutrition.js');

const base = {
  date: '2026-08-28',
  name: 'Volcano ramen bowl',
  calories: 1200,
  proteinG: 45,
  carbsG: 130,
  fatG: 40,
};

describe('mealEntrySchema — nutrient estimates clamp instead of rejecting', () => {
  it('clamps an implausible sodium estimate to the cap and keeps the meal', () => {
    const parsed = mealEntrySchema.parse({
      ...base,
      nutrients: { sodiumMg: 25000, fiberG: 6 },
    });
    expect(parsed.nutrients?.sodiumMg).toBe(20000);
    expect(parsed.nutrients?.fiberG).toBe(6);
  });

  it('clamps negatives to zero', () => {
    const parsed = mealEntrySchema.parse({
      ...base,
      nutrients: { ironMg: -3 },
    });
    expect(parsed.nutrients?.ironMg).toBe(0);
  });

  it('clamps glycemicIndex but passes null through', () => {
    const hi = mealEntrySchema.parse({ ...base, nutrients: { glycemicIndex: 400 } });
    expect(hi.nutrients?.glycemicIndex).toBe(150);
    const nul = mealEntrySchema.parse({ ...base, nutrients: { glycemicIndex: null } });
    expect(nul.nutrients?.glycemicIndex).toBeNull();
  });

  it('still rejects non-finite nutrient values (broken payload, not an estimate)', () => {
    expect(() =>
      mealEntrySchema.parse({ ...base, nutrients: { sodiumMg: Infinity } }),
    ).toThrow();
  });

  it('macros stay strict — a 6000 kcal single meal still rejects', () => {
    expect(() => mealEntrySchema.parse({ ...base, calories: 6000 })).toThrow();
  });
});
