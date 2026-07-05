// Verifies generateStrengthProfileInsights quotes weights in the athlete's
// own unit — these strings render verbatim on the Strength page, so a kg
// user must never read lbs (and vice versa). OpenAI is mocked; we assert on
// the prompt the function builds.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted so the mock fn exists when vi.mock's hoisted factory runs.
const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));
vi.mock('openai', () => ({
  // Must be a constructor (llmService does `new OpenAI(...)`).
  default: vi.fn(function (this: any) {
    this.chat = { completions: { create: mockCreate } };
  }),
  toFile: vi.fn(),
}));
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(function (this: any) {
    this.models = { generateContent: vi.fn() };
  }),
}));
delete process.env.GEMINI_API_KEY;

import { generateStrengthProfileInsights } from '../services/llmService.js';

const baseParams = {
  lifts: [
    { name: 'Bench Press', current1RMkg: 122, monthlyGainPct: 3, sessionCount: 12, category: 'push' },
  ],
  overallStrengthIndex: 70,
  strengthTier: 'Advanced',
  bodyweightKg: 90,
  radarScores: { push: 8 },
  recentDiagnoses: [],
  totalLogs: 30,
};

function sentPrompt(): string {
  return mockCreate.mock.calls[0][0].messages[0].content as string;
}

beforeEach(() => {
  mockCreate.mockReset();
  mockCreate.mockResolvedValue({
    choices: [{ message: { content: '["a","b","c","d"]' } }],
  });
});

describe('generateStrengthProfileInsights unit handling', () => {
  it('quotes lbs when unitPreference is omitted (imperial legacy)', async () => {
    await generateStrengthProfileInsights(baseParams);
    const prompt = sentPrompt();
    expect(prompt).toContain('est. 1RM 269lbs'); // 122 kg → 269 lbs
    expect(prompt).toContain('Bodyweight: 198lbs'); // 90 kg → 198 lbs
    expect(prompt).toContain('Quote all weights in lbs');
    expect(prompt).not.toContain('kg');
  });

  it('quotes kg for metric users', async () => {
    await generateStrengthProfileInsights({ ...baseParams, unitPreference: 'metric' as const });
    const prompt = sentPrompt();
    expect(prompt).toContain('est. 1RM 122kg');
    expect(prompt).toContain('Bodyweight: 90kg');
    expect(prompt).toContain('Quote all weights in kg');
    expect(prompt).not.toContain('lbs');
  });
});
