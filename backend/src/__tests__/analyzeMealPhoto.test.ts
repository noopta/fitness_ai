// Verifies analyzeMealPhoto (the swapped-from-GPT-4o photo analyzer) calls
// Vertex Gemini correctly, parses the rich nutrition response, and preserves
// the ParsedMealDetail shape that downstream code (enrichMealDetailHybrid)
// depends on. The @google/genai SDK is mocked so no real Vertex calls happen.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted so the mock fn exists when vi.mock's hoisted factory runs.
const { mockGenerateContent } = vi.hoisted(() => ({ mockGenerateContent: vi.fn() }));
vi.mock('@google/genai', () => {
  // Must be a constructor (llmService does `new GoogleGenAI(...)`). Arrow
  // returned by mockImplementation isn't `new`able — use a real function.
  const GoogleGenAI = vi.fn(function (this: any) {
    this.models = { generateContent: mockGenerateContent };
  });
  return { GoogleGenAI };
});

// llmService also imports openai — provide a stub so importing the module
// doesn't try to call the real OpenAI constructor with an empty key.
vi.mock('openai', () => ({
  default: vi.fn(),
  // Used elsewhere in llmService.ts (toFile, etc.) — keep them as no-ops.
  toFile: vi.fn(),
}));

// llmService.ts also imports a handful of engine/data modules at top-level;
// none of them touch external services so the imports work fine without
// mocking. Just make sure GEMINI env vars aren't required.
delete process.env.GEMINI_API_KEY;

import { analyzeMealPhoto, repairTruncatedJson } from '../services/llmService.js';

const RICH_RESPONSE = {
  name: 'Single Banana',
  proteinG: 1,
  carbsG: 27,
  fatG: 0,
  calories: 105,
  mealType: 'snack',
  confidence: 'high',
  notes: 'medium banana',
  ingredients: ['banana'],
  tags: ['fruit', 'vegan'],
  nutrients: {
    fiberG: 3,
    sugarG: 14,
    sodiumMg: 1,
    potassiumMg: 422,
    vitaminCMg: 10,
  },
};

beforeEach(() => {
  mockGenerateContent.mockReset();
});

describe('analyzeMealPhoto (Gemini 3.1 Pro via Vertex AI)', () => {
  it('calls Gemini with the image inline and parses the JSON response', async () => {
    mockGenerateContent.mockResolvedValue({ text: JSON.stringify(RICH_RESPONSE) });

    const result = await analyzeMealPhoto('FAKEBASE64DATA', 'image/jpeg');

    expect(result.name).toBe('Single Banana');
    expect(result.calories).toBe(105);
    expect(result.proteinG).toBe(1);
    expect(result.carbsG).toBe(27);
    expect(result.fatG).toBe(0);
    expect(result.mealType).toBe('snack');
    expect(result.confidence).toBe('high');
    expect(result.ingredients).toEqual(['banana']);
    expect(result.nutrients?.fiberG).toBe(3);
    expect(result.nutrients?.potassiumMg).toBe(422);

    // Confirm we actually called Gemini (not OpenAI) and passed the image
    // through correctly.
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    const call = mockGenerateContent.mock.calls[0][0];
    expect(call.model).toBe('gemini-3.1-pro-preview');
    expect(call.config.responseMimeType).toBe('application/json');
    const parts = call.contents[0].parts;
    expect(parts[0].text).toMatch(/nutrition expert/i);
    expect(parts[1].inlineData.mimeType).toBe('image/jpeg');
    expect(parts[1].inlineData.data).toBe('FAKEBASE64DATA');
  });

  it('throws a clear error when Gemini returns an empty response', async () => {
    mockGenerateContent.mockResolvedValue({ text: '' });
    await expect(analyzeMealPhoto('x', 'image/png')).rejects.toThrow(/empty response/i);
  });

  it('surfaces Gemini errors rather than swallowing them', async () => {
    mockGenerateContent.mockRejectedValue(new Error('Vertex AI quota exceeded'));
    await expect(analyzeMealPhoto('x', 'image/png')).rejects.toThrow(/quota exceeded/i);
  });

  it('handles a minimal-fields response without crashing (graceful fallback)', async () => {
    // Vision sometimes returns sparse output for unclear photos.
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ name: 'Unknown', calories: 0, proteinG: 0, carbsG: 0, fatG: 0 }),
    });
    const result = await analyzeMealPhoto('x', 'image/jpeg');
    expect(result.name).toBe('Unknown');
    expect(result.calories).toBe(0);
  });

  it('passes both jpeg and png mime types through without transformation', async () => {
    mockGenerateContent.mockResolvedValue({ text: JSON.stringify(RICH_RESPONSE) });
    await analyzeMealPhoto('x', 'image/png');
    expect(mockGenerateContent.mock.calls[0][0].contents[0].parts[1].inlineData.mimeType).toBe('image/png');
  });
});

describe('truncated-response salvage (prod incident 2026-07-11)', () => {
  // Gemini cut off mid-nutrients: `…"calciumMg": 35,`. The schema puts
  // name/macros first, so the core fields survive truncation — the scan must
  // succeed with defaulted micronutrients instead of failing outright.
  const TRUNCATED =
    '{"name": "Chicken bowl", "proteinG": 42, "carbsG": 55, "fatG": 12, ' +
    '"calories": 496, "mealType": "lunch", "confidence": "high", ' +
    '"notes": "estimate", "ingredients": ["chicken", "rice"], "tags": ["high-protein"], ' +
    '"nutrients": {"fiberG": 5, "sugarG": 3, "calciumMg": 35,';

  it('salvages a mid-object truncation and keeps the core macros', async () => {
    mockGenerateContent.mockResolvedValue({ text: TRUNCATED });
    const result = await analyzeMealPhoto('x', 'image/jpeg');
    expect(result.name).toBe('Chicken bowl');
    expect(result.proteinG).toBe(42);
    expect(result.calories).toBe(496);
  });

  it('still fails loudly on outright garbage', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'not json at all' });
    await expect(analyzeMealPhoto('x', 'image/jpeg')).rejects.toThrow(/malformed/i);
  });

  describe('repairTruncatedJson', () => {
    it('closes unbalanced braces after dropping a trailing comma', () => {
      const out = repairTruncatedJson('{"a": 1, "b": {"c": 2,');
      expect(JSON.parse(out!)).toEqual({ a: 1, b: { c: 2 } });
    });

    it('drops a dangling partial key and closes an open string', () => {
      const out = repairTruncatedJson('{"a": 1, "b": {"c": 2, "dangl');
      expect(JSON.parse(out!)).toEqual({ a: 1, b: { c: 2 } });
    });

    it('drops a dangling key with partial value', () => {
      const out = repairTruncatedJson('{"a": 1, "nutrients": {"ironMg": 2.');
      expect(JSON.parse(out!)).toEqual({ a: 1, nutrients: {} });
    });

    it('handles truncation inside an array', () => {
      const out = repairTruncatedJson('{"a": 1, "tags": ["x", "y')
      expect(JSON.parse(out!)).toEqual({ a: 1, tags: ['x', 'y'] });
    });

    it('returns null for balanced JSON and for non-objects', () => {
      expect(repairTruncatedJson('{"a": 1}')).toBeNull();
      expect(repairTruncatedJson('plain text')).toBeNull();
    });
  });
});
