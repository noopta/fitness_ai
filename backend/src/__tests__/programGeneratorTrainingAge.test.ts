// Program generator: training-age scaling of the Foundation phase, strength
// self-assessment mapping and logged-performance starting loads (D5).
// chatClient / RAG are mocked so the assembled prompt can be inspected.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockChat, mockSources } = vi.hoisted(() => ({ mockChat: vi.fn(), mockSources: vi.fn() }));
vi.mock('@google/genai', () => ({ GoogleGenAI: vi.fn(function (this: any) { this.models = {}; }) }));
vi.mock('openai', () => ({ default: vi.fn(), toFile: vi.fn() }));
vi.mock('../services/chatClient.js', () => ({ chatComplete: mockChat }));
vi.mock('../services/ragService.js', () => ({
  buildRAGContext: vi.fn(async () => ''),
  retrieveProgramSources: mockSources,
}));

import {
  generateTrainingProgram,
  normalizeProgramTrainingAge,
  programArchitecture,
  recentPerformanceBlock,
  strengthSelfAssessmentLines,
  summarizeRecentPerformance,
} from '../services/llmService.js';

const NOW = new Date('2026-10-05T12:00:00Z');

const workout = (date: string, exercises: any[]) => ({ id: date, date, exercises: JSON.stringify(exercises), programDayRef: null });

beforeEach(() => {
  mockChat.mockReset();
  mockChat.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ phases: [] }) } }] });
  mockSources.mockReset();
  mockSources.mockResolvedValue({ ragContext: '', sources: [] });
});

describe('normalizeProgramTrainingAge', () => {
  it.each([
    ['beginner', 'beginner'], ['<6 months', 'beginner'], ['Never trained', 'beginner'],
    ['Under a year', 'novice'], ['6-12 months', 'novice'], ['under 1 year', 'novice'],
    ['1-3 years', 'intermediate'], ['1–3 years', 'intermediate'], ['early_intermediate', 'intermediate'], ['intermediate', 'intermediate'], ['2 years', 'intermediate'],
    ['3+ years', 'advanced'], ['3–5 years', 'advanced'], ['5+ years', 'advanced'], ['advanced', 'advanced'], ['10 years', 'advanced'],
  ])('%s → %s', (raw, tier) => {
    expect(normalizeProgramTrainingAge(raw)).toBe(tier);
  });
  it('returns null for unknown/empty', () => {
    expect(normalizeProgramTrainingAge(null)).toBeNull();
    expect(normalizeProgramTrainingAge('')).toBeNull();
    expect(normalizeProgramTrainingAge('banana')).toBeNull();
  });
});

describe('programArchitecture', () => {
  it('keeps Foundation for beginners/novices', () => {
    expect(programArchitecture(12, 'beginner').phaseStructure).toMatch(/Phase 1 Foundation/);
    expect(programArchitecture(8, 'novice').phaseStructure).toMatch(/Phase 1 Foundation/);
    expect(programArchitecture(4, 'beginner').phaseStructure).toBe('1 phase (Foundation only)');
  });
  it('intermediate: short base at working intensities, no correction framing', () => {
    const a = programArchitecture(12, 'intermediate');
    expect(a.phaseStructure).toMatch(/Accumulation \(~1\/4/);
    expect(a.phaseStructure).not.toMatch(/Foundation/);
    expect(a.phaseNames).toMatch(/Do NOT name or frame any phase "Foundation" or "Correction"/);
    expect(a.examplePhaseName).toBe('Accumulation');
    expect(a.intensityRule).toMatch(/RPE 7–8/);
  });
  it('advanced: accumulation → intensification → peak, no foundation', () => {
    const a = programArchitecture(12, 'advanced');
    expect(a.phaseStructure).toMatch(/Accumulation.*Intensification.*Peak/);
    expect(a.phaseStructure).toMatch(/No foundation/);
    expect(programArchitecture(4, 'advanced').phaseStructure).toMatch(/Intensification block/);
  });
});

describe('strengthSelfAssessmentLines', () => {
  it('maps v2 answers.current / answers.stall (strengthLevel is never set)', () => {
    const lines = strengthSelfAssessmentLines({ answers: { current: 'Around 1.5× bodyweight', stall: 'Stalled a few weeks' } });
    expect(lines[0]).toContain('Around 1.5× bodyweight');
    expect(lines[1]).toMatch(/Stalled a few weeks.*reset/);
  });
  it('prefers an explicit strengthLevel and lists stated intake sets', () => {
    const lines = strengthSelfAssessmentLines({ strengthLevel: 'strong', benchWeight: '185', benchSets: '3', benchReps: '5', squatWeight: '' });
    expect(lines[0]).toContain('strong');
    expect(lines[1]).toBe("- Stated working sets at intake (user's display unit): Bench 185 × 5 × 3 sets");
  });
  it('is empty for nothing', () => {
    expect(strengthSelfAssessmentLines(null)).toEqual([]);
    expect(strengthSelfAssessmentLines({})).toEqual([]);
  });
});

describe('summarizeRecentPerformance', () => {
  const logs = [
    workout('2026-07-01', [{ name: 'Back Squat', sets: 3, reps: 5, weightKg: 200 }]), // > 8 weeks old: ignored
    workout('2026-09-20', [{ name: 'Back Squat', sets: 3, reps: 5, weightKg: 120 }, { name: 'Bicep Curl', sets: 3, reps: 10, weightKg: 15 }]),
    workout('2026-09-27', [{ name: 'Back Squat', sets: 3, reps: 5, weightKg: 125, rpe: 8 }, { name: 'Bicep Curl', sets: 3, reps: 10, weightKg: 16 }]),
    workout('2026-09-28', [{ name: 'Bench Press', sets: 3, reps: 8, weightKg: 80 }, { name: 'Bicep Curl', sets: 3, reps: 10, weightKg: 16 }]),
    workout('2026-09-29', [{ name: 'Push-up', sets: 3, reps: 15, bodyweight: true }]),
  ];

  it('returns best e1RM + top set per lift in the window, main lifts first', () => {
    const out = summarizeRecentPerformance(logs, NOW);
    expect(out.map((l) => l.name)).toEqual(['Back Squat', 'Bench Press', 'Bicep Curl']);
    const squat = out[0];
    expect(squat.topSet).toMatchObject({ weightKg: 125, reps: 5 });
    expect(squat.topSetDate).toBe('2026-09-27');
    expect(squat.sessions).toBe(2);
    expect(squat.bestE1rmKg).toBeGreaterThan(125);
    expect(squat.bestE1rmKg).toBeLessThan(200);
  });

  it('skips bodyweight-only lifts and respects the limit', () => {
    expect(summarizeRecentPerformance(logs, NOW).some((l) => /push/i.test(l.name))).toBe(false);
    expect(summarizeRecentPerformance(logs, NOW, { limit: 1 })).toHaveLength(1);
    expect(summarizeRecentPerformance([], NOW)).toEqual([]);
  });

  it('recentPerformanceBlock renders kg + lb and the starting-load instruction', () => {
    const block = recentPerformanceBlock(summarizeRecentPerformance(logs, NOW));
    expect(block).toMatch(/RECENT LOGGED PERFORMANCE/);
    expect(block).toMatch(/top set 125 kg \(276 lb\) × 5 @ RPE 8 on 2026-09-27/);
    expect(block).toMatch(/SET STARTING LOADS FROM THESE NUMBERS/);
    expect(recentPerformanceBlock([])).toBe('');
  });
});

describe('generateTrainingProgram prompt', () => {
  const base = {
    goal: 'strength', daysPerWeek: 4, durationWeeks: 12, equipment: null, primaryLimiter: null,
    selectedLift: null, accessories: [] as string[],
  };
  const promptOf = () => mockChat.mock.calls[0][0].messages[0].content as string;

  it('advanced lifter with logs: no Foundation phase, logged numbers present', async () => {
    await generateTrainingProgram({
      ...base, trainingAge: '3+ years',
      coachProfile: JSON.stringify({ answers: { current: '2× bodyweight or more' } }),
      recentWorkouts: [workout(new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10), [{ name: 'Deadlift', sets: 1, reps: 3, weightKg: 200 }])],
    });
    const p = promptOf();
    expect(p).toMatch(/Training age: 3\+ years \(→ advanced\)/);
    expect(p).toMatch(/No foundation phase/);
    expect(p).not.toMatch(/"phaseName": "Foundation"/);
    expect(p).not.toMatch(/Corrective strength/);
    expect(p).toMatch(/2× bodyweight or more/);
    expect(p).toMatch(/Deadlift: best e1RM/);
  });

  it('real beginner keeps the Foundation phase', async () => {
    await generateTrainingProgram({ ...base, trainingAge: 'beginner' });
    const p = promptOf();
    expect(p).toMatch(/Phase 1 Foundation/);
    expect(p).not.toMatch(/RECENT LOGGED PERFORMANCE/);
  });

  it('unknown age, no evidence → original foundation-first layout', async () => {
    await generateTrainingProgram({ ...base, trainingAge: null });
    expect(promptOf()).toMatch(/Phase 1 Foundation/);
    expect(promptOf()).toMatch(/Training age: not stated \(planning as novice\)/);
  });

  it('unknown age but logged training → intermediate, inferred', async () => {
    await generateTrainingProgram({
      ...base, trainingAge: null,
      recentWorkouts: [workout(new Date(Date.now() - 86_400_000).toISOString().slice(0, 10), [{ name: 'Bench Press', sets: 3, reps: 5, weightKg: 100 }])],
    });
    const p = promptOf();
    expect(p).toMatch(/planning as intermediate, inferred from logged training/);
    expect(p).toMatch(/Phase 1 Accumulation \(~1\/4/);
  });

  it('falls back to the profile training age and "just learning" → beginner', async () => {
    await generateTrainingProgram({ ...base, trainingAge: null, coachProfile: JSON.stringify({ trainingAge: '1–3 years' }) });
    expect(promptOf()).toMatch(/Accumulation/);
    mockChat.mockClear();
    await generateTrainingProgram({ ...base, trainingAge: null, coachProfile: JSON.stringify({ answers: { current: 'Just learning it' } }) });
    expect(promptOf()).toMatch(/Phase 1 Foundation/);
  });
});
