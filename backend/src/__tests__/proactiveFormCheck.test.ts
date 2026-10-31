// Flow H · form check in chat: the receipts and card the result turn carries,
// and "Add cue" writing onto the program.
import { describe, it, expect, vi } from 'vitest';

vi.mock('@prisma/client', async () => ({ PrismaClient: (await import('./helpers/memPrisma.js')).PrismaClient }));
vi.mock('../services/cacheService.js', () => ({ cacheDelete: vi.fn(), cacheClearByPrefix: vi.fn(), cacheGet: vi.fn(), cacheSet: vi.fn(), cacheMarkStale: vi.fn() }));

const F = await import('../proactive/formCheck.js');

const analysis: F.FormAnalysisLike = {
  exercise: 'Back squat', formScore: 7.5, repCount: 5,
  strengths: ['Depth is good on all five', 'Bar path stays within 3 cm'],
  weaknesses: [
    { issue: 'Hips rise first out of the hole', severity: 'moderate', cue: 'chest up out of the hole', timestampSec: 14 },
    { issue: 'Knees drift in on rep 5', severity: 'minor', cue: 'knees out over the toes', timestampSec: 19 },
  ],
  summary: "Depth's good on all five. Hips rise first on reps 4–5 — that's where the bar slows. Bar path stays within 3 cm.",
  referenceFrames: [{ weaknessIndex: 0, timestampSec: 14, b64: 'AAAA' }],
};
const previous = { id: 'old', date: '2026-10-12', formScore: 6.5 };

describe('H2 · receipts and text', () => {
  it('watched · computed · compared against the last check of that lift', () => {
    expect(F.formReceipts(analysis, previous)).toEqual([
      { verb: 'Read', text: 'Video · 5 reps' },
      { verb: 'Computed', text: 'Form score 7.5 of 10 · 2 faults' },
      { verb: 'Checked', text: 'Your back squat check from Oct 12 · 6.5 of 10' },
    ]);
    expect(F.formReceipts({ ...analysis, repCount: null, formScore: null, weaknesses: [] }, null)).toEqual([{ verb: 'Read', text: 'Video · the set' }, { verb: 'Computed', text: 'Form read' }]);
  });
  it('the turn text is the summary; without one it names the lead fault and its cue', () => {
    expect(F.formTurnText(analysis)).toMatch(/^Depth's good on all five/);
    expect(F.formTurnText({ ...analysis, summary: '' })).toBe('Back squat: Hips rise first out of the hole. chest up out of the hole');
    expect(F.formTurnText({ exercise: 'unknown', formScore: null, repCount: null })).toBe('the lift looked clean on this set.');
  });
  it('the lead fault is the most severe, then the earliest', () => {
    expect(F.leadWeakness(analysis)?.issue).toBe('Hips rise first out of the hole');
    expect(F.leadWeakness({ ...analysis, weaknesses: [{ issue: 'b', severity: 'minor', cue: 'x', timestampSec: 20 }, { issue: 'a', severity: 'minor', cue: 'y', timestampSec: 3 }] })?.issue).toBe('a');
    expect(F.leadWeakness({ ...analysis, weaknesses: [] })).toBeNull();
  });
});

describe('H3 · the card', () => {
  const card = F.formResultCardV4(analysis, { analysisId: 'fa1', previous, lift: 'Squat' });
  it('eyebrow · still with the fault · severity rows · comparison · Proposed cue · Add cue / Not now / Full analysis', () => {
    expect(card).toMatchObject({ fn: 'FRM-03', pattern: 'proposal', meta: { label: 'Back squat · 5 reps · 7.5 of 10', open: { page: 'form', params: { id: 'fa1' } } } });
    expect(card.media).toEqual({ kind: 'photo', uri: 'data:image/jpeg;base64,AAAA', caption: '14s · Hips rise first out of the hole' });
    expect(card.rows?.map((r) => [r.key, r.value])).toEqual([
      ['Hips rise first out of the hole', 'Moderate · 14s'], ['Knees drift in on rep 5', 'Minor · 19s'], ['Good', 'Depth is good on all five'], ['vs Oct 12', '+1 · 6.5 → 7.5'],
    ]);
    expect(card.why).toBe('Cue on your next squat: "chest up out of the hole"');
    expect(card.actions?.map((a) => a.label)).toEqual(['Add cue', 'Not now', 'Full analysis']);
    expect((card.pending?.actions?.cue as any)).toMatchObject({ op: 'form.add_cue', args: { lift: 'Squat', cue: 'chest up out of the hole', analysisId: 'fa1' }, line: 'Adjusted — "chest up out of the hole" on your next squat' });
    expect(card.actions?.[2].client).toEqual({ action: 'open_page', args: { page: 'form', id: 'fa1' } });
  });
  it('a clean set has no Proposed line and only Full analysis; a safety flag becomes the note', () => {
    const clean = F.formResultCardV4({ ...analysis, weaknesses: [], referenceFrames: [], safetyFlags: ['Bar rolled toward the neck on rep 5'] }, { analysisId: 'fa2', previous: null });
    expect(clean.pattern).toBe('glance');
    expect(clean.media).toBeUndefined();
    expect(clean.why).toBeUndefined();
    expect(clean.actions?.map((a) => a.label)).toEqual(['Full analysis']);
    expect(clean.rows?.map((r) => r.key)).toEqual(['Good', 'Good']);
    expect(clean.note).toBe('Bar rolled toward the neck on rep 5');
  });
});

describe('Add cue → the program', () => {
  const program = { phases: [
    { trainingDays: [{ day: 'Monday', exercises: [{ exercise: 'Back Squat', sets: 5, reps: '5', notes: 'Brace' }, { exercise: 'Leg press', sets: 3, reps: '10' }] }] },
    { trainingDays: [{ day: 'Thursday', exercises: [{ exercise: 'Front squat', sets: 4, reps: '6' }] }] },
  ] };
  it('writes the cue onto every occurrence of the lift, once, and leaves other lifts alone', () => {
    const { program: next, count } = F.applyCueToProgram(program, 'Squat', 'chest up out of the hole');
    expect(count).toBe(2);
    expect(next.phases[0].trainingDays[0].exercises[0].notes).toBe('Brace · Cue: chest up out of the hole');
    expect(next.phases[1].trainingDays[0].exercises[0].notes).toBe('Cue: chest up out of the hole');
    expect(next.phases[0].trainingDays[0].exercises[1].notes).toBeUndefined();
    expect(F.applyCueToProgram(next, 'Squat', 'chest up out of the hole').count).toBe(0);
    expect(program.phases[0].trainingDays[0].exercises[0].notes).toBe('Brace'); // the original is untouched
  });
  it('a lift not on the program takes nothing', () => {
    expect(F.applyCueToProgram(program, 'Deadlift', 'push the floor').count).toBe(0);
  });
});
