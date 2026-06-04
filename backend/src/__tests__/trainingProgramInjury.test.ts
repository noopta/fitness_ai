// Verifies generateTrainingProgram now folds injury context from BOTH sources
// (coachProfile.injuries from the consultation flow AND User.constraintsText
// from the diagnostic flow) plus the structured follow-up fields into the
// prompt, asks the model to report injuryAccommodations, and passes that field
// back through. Regression guard for the bug where constraintsText injuries
// were silently dropped from program generation.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted so the mock exists when the hoisted vi.mock factory runs.
const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('openai', () => {
  // llmService does `new OpenAI(...)` at module load — must be `new`able.
  const OpenAI = vi.fn(function (this: any) {
    this.chat = { completions: { create: mockCreate } };
  });
  return { default: OpenAI, toFile: vi.fn() };
});

// Vertex client is constructed at module load; stub it so no ADC is needed.
vi.mock('@google/genai', () => {
  const GoogleGenAI = vi.fn(function (this: any) {
    this.models = { generateContent: vi.fn() };
  });
  return { GoogleGenAI };
});

// No real vector lookups — keep RAG context empty and offline.
vi.mock('../services/ragService.js', () => ({
  buildRAGContext: vi.fn().mockResolvedValue(''),
}));

import { generateTrainingProgram } from '../services/llmService.js';

function mockProgramResponse(extra: Record<string, unknown> = {}) {
  mockCreate.mockResolvedValue({
    choices: [{ message: { content: JSON.stringify({
      goal: 'strength', daysPerWeek: 3, durationWeeks: 8, phases: [],
      autoregulationRules: [], trackingMetrics: [], ...extra,
    }) } }],
  });
}

function lastPrompt(): string {
  return mockCreate.mock.calls[0][0].messages[0].content as string;
}

const baseParams = {
  goal: 'strength', daysPerWeek: 3, durationWeeks: 8,
  trainingAge: 'intermediate', equipment: 'commercial gym',
  primaryLimiter: null, selectedLift: null, accessories: [] as string[],
};

describe('generateTrainingProgram — injury context', () => {
  beforeEach(() => { mockCreate.mockReset(); });

  it('includes constraintsText injuries even when coachProfile has none', async () => {
    mockProgramResponse();
    await generateTrainingProgram({ ...baseParams, constraintsText: 'left shoulder surgery' });
    const prompt = lastPrompt();
    expect(prompt).toContain('INJURY / CONSTRAINTS — ACCOUNT FOR THESE EXPLICITLY');
    expect(prompt).toContain('left shoulder surgery');
    expect(prompt).toContain('injuryAccommodations');
  });

  it('merges structured injury fields from coachProfile', async () => {
    mockProgramResponse();
    await generateTrainingProgram({
      ...baseParams,
      coachProfile: JSON.stringify({
        injuries: 'shoulder surgery',
        injuryTimeline: '9 months post-op',
        injurySide: 'Left',
        injuryStage: 'cleared by PT',
        injuryGoal: 'build left shoulder strength',
      }),
    });
    const prompt = lastPrompt();
    expect(prompt).toContain('9 months post-op');
    expect(prompt).toContain('Affected side: Left');
    expect(prompt).toContain('build left shoulder strength');
  });

  it('emits no injury block when nothing is provided', async () => {
    mockProgramResponse();
    await generateTrainingProgram({ ...baseParams });
    // The header only appears when an injury block is actually built (the
    // requirements list references the block name generically, so match the
    // full header to avoid a false positive).
    expect(lastPrompt()).not.toContain('INJURY / CONSTRAINTS — ACCOUNT FOR THESE EXPLICITLY');
  });

  it('passes through injuryAccommodations from the model output', async () => {
    mockProgramResponse({ injuryAccommodations: ['Unilateral left pressing prioritized'] });
    const program = await generateTrainingProgram({ ...baseParams, constraintsText: 'shoulder' });
    expect(program.injuryAccommodations).toEqual(['Unilateral left pressing prioritized']);
  });

  it('dedupes identical free-text present in both sources', async () => {
    mockProgramResponse();
    await generateTrainingProgram({
      ...baseParams,
      coachProfile: JSON.stringify({ injuries: 'shoulder surgery' }),
      constraintsText: 'shoulder surgery',
    });
    const prompt = lastPrompt();
    const first = prompt.indexOf('shoulder surgery');
    const second = prompt.indexOf('shoulder surgery', first + 1);
    expect(second).toBe(-1); // only one occurrence — not duplicated
  });
});
