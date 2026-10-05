// analyzeMealPhotoItems (meal-photo v2) — the Vertex call shape. The
// @google/genai SDK is mocked; no real Vertex calls.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGenerateContent } = vi.hoisted(() => ({ mockGenerateContent: vi.fn() }));
vi.mock('@google/genai', () => {
  const GoogleGenAI = vi.fn(function (this: any) {
    this.models = { generateContent: mockGenerateContent };
  });
  return { GoogleGenAI };
});
vi.mock('openai', () => ({ default: vi.fn(), toFile: vi.fn() }));

import { analyzeMealPhotoItems } from '../services/llmService.js';

const RESPONSE = {
  items: [{ name: 'Fried egg', usdaQuery: 'egg, whole, fried', preparation: 'fried', grams: 50, visibility: 'full', calories: 90, proteinG: 6, carbsG: 0.4, fatG: 7 }],
  framingWarning: null,
  noFoodDetected: false,
  mealType: 'breakfast',
  name: 'Fried egg',
  confidence: 'high',
  notes: '',
};

beforeEach(() => mockGenerateContent.mockReset());

describe('analyzeMealPhotoItems', () => {
  it('sends every image, the schema, high media resolution and no temperature/seed', async () => {
    mockGenerateContent.mockResolvedValue({ text: JSON.stringify(RESPONSE) });
    const r = await analyzeMealPhotoItems([
      { base64: 'AAA', mimeType: 'image/jpeg' },
      { base64: 'BBB', mimeType: 'image/png' },
    ], { existingItems: [{ id: null, name: 'Toast', grams: 40 }] });

    expect(r.items[0]).toMatchObject({ name: 'Fried egg', grams: 50, visibility: 'full' });
    const call = mockGenerateContent.mock.calls[0][0];
    expect(call.model).toBe('gemini-3.1-pro-preview');
    expect(call.config.responseSchema.propertyOrdering[0]).toBe('items');
    expect(call.config.mediaResolution).toBe('MEDIA_RESOLUTION_HIGH');
    expect(call.config.thinkingConfig.thinkingBudget).toBeGreaterThan(1024);
    expect(call.config).not.toHaveProperty('temperature');
    expect(call.config).not.toHaveProperty('seed');
    const parts = call.contents[0].parts;
    expect(parts).toHaveLength(3);
    expect(parts[0].text).toMatch(/2 photos of ONE meal/);
    expect(parts[0].text).toContain('- Toast (~40 g)');
    expect(parts[0].text).not.toMatch(/vitaminAIU/);
    expect(parts[1].inlineData).toEqual({ mimeType: 'image/jpeg', data: 'AAA' });
    expect(parts[2].inlineData).toEqual({ mimeType: 'image/png', data: 'BBB' });
  });

  it('salvages a truncated response (items come first)', async () => {
    mockGenerateContent.mockResolvedValue({
      text: '{"items": [{"name": "Rice", "usdaQuery": "rice", "grams": 150, "visibility": "full", "calories": 200, "proteinG": 4, "carbsG": 44, "fatG": 0.4}], "framingWarning": null, "noFoodDetected": false, "mealType": "lun',
    });
    const r = await analyzeMealPhotoItems([{ base64: 'x', mimeType: 'image/jpeg' }]);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].name).toBe('Rice');
  });

  it('fails loudly on empty or garbage responses', async () => {
    mockGenerateContent.mockResolvedValue({ text: '' });
    await expect(analyzeMealPhotoItems([{ base64: 'x', mimeType: 'image/jpeg' }])).rejects.toThrow(/empty/);
    mockGenerateContent.mockResolvedValue({ text: 'nope' });
    await expect(analyzeMealPhotoItems([{ base64: 'x', mimeType: 'image/jpeg' }])).rejects.toThrow(/malformed/);
    await expect(analyzeMealPhotoItems([])).rejects.toThrow(/No images/);
  });
});
