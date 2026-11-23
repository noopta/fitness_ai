// set_target edits land on the lift they name (Nov 2026). Tarek's "loads up
// about 5%" batch had no days; "Single arm tricep pushdown" fell back by
// substring to "Tricep Pushdown" on Monday and "Cross cable row (Rear Delts)"
// to "Cable Row" on Tue/Wed, overwriting them with the smaller lifts' targets
// while the card showed only the first match.
import { describe, it, expect, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn() },
  workoutLog: { findMany: vi.fn() },
}));
const coach = vi.hoisted(() => ({
  generateProgramForUser: vi.fn(),
  saveProgramForUser: vi.fn(async () => ({ isNewProgram: false })),
}));
vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) { Object.assign(this, mocks); }) }));
vi.mock('../services/cacheService.js', () => ({ cacheGet: vi.fn(() => null), cacheSet: vi.fn(), cacheDelete: vi.fn(), cacheClearByPrefix: vi.fn() }));
vi.mock('../routes/coach.js', () => ({
  ...coach,
  getCurrentWeekSchedule: vi.fn(async () => ({ phaseName: 'Foundation', weekDays: [] })),
  buildSwapProposal: vi.fn(), applyProposedWeek: vi.fn(), SwapProposalError: class extends Error {},
}));
vi.mock('../services/llmService.js', () => ({}));

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test';
await import('../agent/toolkits/index.js');
const { applyProgramEdits } = await import('../agent/toolkits/program.js');

const lb = (n: number) => n * 0.45359237;
const ex = (exercise: string, lbs: number) => ({ exercise, sets: 3, reps: '10', intensity: 'RPE 8', targetWeightKg: lb(lbs) });
const program = () => ({ phases: [{ phaseName: 'Your week', trainingDays: [
  { day: 'Monday — Push Day', exercises: [ex('Tricep Pushdown', 90), ex('Underarm Trciep push down', 51)] },
  { day: 'Tuesday — Session', exercises: [ex('Cable Row', 90), ex('Hammer Curl', 60)] },
  { day: 'Wednesday — Session', exercises: [ex('Cable Row', 90), ex('Hammer Curl', 60)] },
  { day: 'Saturday — Arms', exercises: [ex('Cross cable row (Rear Delts)', 14), ex('Single arm tricep pushdown', 25)] },
] }] });
const target = (exercise: string, lbs: number) => ({ type: 'set_target' as const, exercise, targetWeightKg: lb(lbs) });
const kgOf = (p: any, day: number, i: number) => Math.round(p.phases[0].trainingDays[day].exercises[i].targetWeightKg / 0.45359237);

describe('set_target edits', () => {
  it('a batch with similarly named lifts changes each lift only by its exact name', () => {
    const { program: next, diff } = applyProgramEdits(program(), [
      target('Tricep Pushdown', 95), target('Cable Row', 95), target('Cross cable row (Rear Delts)', 15), target('Single arm tricep pushdown', 26),
    ], { phaseIndex: 0 });
    expect(kgOf(next, 0, 0)).toBe(95); // Tricep Pushdown kept its own target
    expect(kgOf(next, 1, 0)).toBe(95); // Cable Row, Tuesday
    expect(kgOf(next, 2, 0)).toBe(95); // Cable Row, Wednesday
    expect(kgOf(next, 3, 0)).toBe(15);
    expect(kgOf(next, 3, 1)).toBe(26);
    // The card lists every change, by day when the lift is on several.
    expect(diff.map((d) => d.key)).toEqual(['Tricep Pushdown target', 'Cable Row target · Tuesday — Session', 'Cable Row target · Wednesday — Session', 'Cross cable row (Rear Delts) target', 'Single arm tricep pushdown target']);
  });
  it('a partial name still works when it is unambiguous, and an ambiguous one is refused', () => {
    const { program: next } = applyProgramEdits(program(), [{ ...target('Hammer', 70), day: 'Tuesday' }], { phaseIndex: 0 });
    expect(kgOf(next, 1, 1)).toBe(70);
    const both = { phases: [{ trainingDays: [{ day: 'Monday', exercises: [ex('Tricep Pushdown', 90), ex('Single arm tricep pushdown', 25)] }] }] };
    expect(() => applyProgramEdits(both, [{ ...target('pushdown', 50), day: 'Monday' }], { phaseIndex: 0 })).toThrow(/Couldn.t find/);
  });
  it('targets that are already set produce no rows', () => {
    const { diff } = applyProgramEdits(program(), [target('Tricep Pushdown', 90)], { phaseIndex: 0 });
    expect(diff).toEqual([]);
  });
  it('decimal kg are kept in the row (the card converts them)', () => {
    const { diff } = applyProgramEdits(program(), [{ type: 'set_target', exercise: 'Hammer Curl', day: 'Tuesday', targetWeightKg: 29.5 }], { phaseIndex: 0 });
    expect(diff[0].to).toBe('29.5 kg');
  });
});
