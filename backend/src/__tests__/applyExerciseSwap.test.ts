// Write-layer test for applyExerciseSwap — the function the plan_patch confirm
// path calls. Mocks Prisma so we can assert the ACTUAL program mutation: scoping
// (day vs program), never-mutate-on-ambiguous, and the Undo round-trip.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUser = vi.hoisted(() => ({ findUnique: vi.fn(), update: vi.fn() }));
vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(function (this: any) { this.user = mockUser; }),
}));
vi.mock('../services/cacheService.js', () => ({ cacheDelete: vi.fn(), cacheClearByPrefix: vi.fn() }));

import { applyExerciseSwap } from '../agent/applyTools.js';

const baseProgram = () => ({
  goal: 'hypertrophy',
  phases: [{
    trainingDays: [
      { day: 'Day 1', exercises: [{ exercise: 'Barbell Bench Press', sets: 4, reps: 5 }, { exercise: 'Incline DB Press', sets: 3 }] },
      { day: 'Day 2', exercises: [{ name: 'Back Squat', sets: 5 }, { name: 'Barbell Bench Press', sets: 3 }] }, // bench on BOTH days
    ],
  }],
});
const namesByDay = (p: any) => p.phases[0].trainingDays.map((d: any) => d.exercises.map((e: any) => e.exercise ?? e.name));

beforeEach(() => { mockUser.findUnique.mockReset(); mockUser.update.mockReset(); });

describe('applyExerciseSwap (write layer)', () => {
  it("scope='day' swaps ONLY the named day; the same exercise on other days is untouched", async () => {
    mockUser.findUnique.mockResolvedValue({ savedProgram: JSON.stringify(baseProgram()) });
    mockUser.update.mockResolvedValue({});
    const r: any = await applyExerciseSwap('u1', 'Barbell Bench Press', 'Flat DB Press', 'no barbell', { scope: 'day', day: 'Day 1' });
    expect(r.applied).toBe(true);
    expect(r.occurrences).toBe(1);
    const [d1, d2] = namesByDay(JSON.parse(mockUser.update.mock.calls[0][0].data.savedProgram));
    expect(d1).toContain('Flat DB Press');
    expect(d1).not.toContain('Barbell Bench Press');
    expect(d2).toContain('Barbell Bench Press'); // Day 2 untouched
  });

  it("scope='program' swaps every occurrence", async () => {
    mockUser.findUnique.mockResolvedValue({ savedProgram: JSON.stringify(baseProgram()) });
    mockUser.update.mockResolvedValue({});
    const r: any = await applyExerciseSwap('u1', 'Barbell Bench Press', 'Flat DB Press', undefined, { scope: 'program' });
    expect(r.applied).toBe(true);
    expect(r.occurrences).toBe(2);
    const all = namesByDay(JSON.parse(mockUser.update.mock.calls[0][0].data.savedProgram)).flat();
    expect(all.filter((n: string) => n === 'Flat DB Press').length).toBe(2);
    expect(all).not.toContain('Barbell Bench Press');
  });

  it('ambiguous name never mutates and returns candidates', async () => {
    mockUser.findUnique.mockResolvedValue({ savedProgram: JSON.stringify(baseProgram()) });
    const r: any = await applyExerciseSwap('u1', 'press', 'X', undefined, { scope: 'program' });
    expect(r.applied).toBe(false);
    expect(r.candidates.length).toBeGreaterThan(0);
    expect(mockUser.update).not.toHaveBeenCalled();
  });

  it('Undo round-trips: applying the inverse restores the original program', async () => {
    let stored = JSON.stringify(baseProgram());
    mockUser.findUnique.mockImplementation(async () => ({ savedProgram: stored }));
    mockUser.update.mockImplementation(async (args: any) => { stored = args.data.savedProgram; return {}; });
    await applyExerciseSwap('u1', 'Barbell Bench Press', 'Flat DB Press', undefined, { scope: 'program' });
    const back: any = await applyExerciseSwap('u1', 'Flat DB Press', 'Barbell Bench Press', undefined, { scope: 'program' }); // inverse
    expect(back.applied).toBe(true);
    const all = namesByDay(JSON.parse(stored)).flat();
    expect(all.filter((n: string) => n === 'Barbell Bench Press').length).toBe(2); // restored
    expect(all).not.toContain('Flat DB Press');
  });
});
