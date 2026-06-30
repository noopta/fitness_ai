// Exercise-swap name resolution: the agent can only act on exercises that
// ACTUALLY exist in the program. Exact / unambiguous-substring resolve; ambiguous
// or missing names return candidates so the agent re-calls with the exact one
// instead of silently changing nothing while reporting success.
import { describe, it, expect, vi } from 'vitest';

// applyTools news up a PrismaClient at module load; stub it — the functions
// under test are pure and never touch prisma.
vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) {}) }));

import { resolveExerciseTarget, collectExerciseNames } from '../agent/applyTools.js';

const program = {
  phases: [
    {
      trainingDays: [
        { day: 'Day 1', exercises: [{ exercise: 'Barbell Bench Press', sets: 4 }, { exercise: 'Incline Dumbbell Press', sets: 3 }] },
        { day: 'Day 2', exercises: [{ name: 'Back Squat', sets: 5 }, { name: 'Romanian Deadlift', sets: 3 }] },
      ],
    },
  ],
};

describe('collectExerciseNames', () => {
  it('returns all distinct stored names across exercise + name fields', () => {
    expect(collectExerciseNames(program).sort()).toEqual([
      'Back Squat', 'Barbell Bench Press', 'Incline Dumbbell Press', 'Romanian Deadlift',
    ]);
  });
  it('is empty for a program with no phases', () => {
    expect(collectExerciseNames({})).toEqual([]);
  });
});

describe('resolveExerciseTarget', () => {
  it('resolves an exact name (case/whitespace-insensitive)', () => {
    const r = resolveExerciseTarget(program, 'barbell   BENCH press');
    expect(r.resolvedName).toBe('Barbell Bench Press');
    expect(r.candidates).toEqual([]);
  });

  it('resolves an unambiguous substring ("bench" -> Barbell Bench Press)', () => {
    expect(resolveExerciseTarget(program, 'bench').resolvedName).toBe('Barbell Bench Press');
  });

  it('resolves "squat" -> Back Squat', () => {
    expect(resolveExerciseTarget(program, 'squat').resolvedName).toBe('Back Squat');
  });

  it('returns candidates (no resolution) when ambiguous — "press" matches two', () => {
    const r = resolveExerciseTarget(program, 'press');
    expect(r.resolvedKey).toBeNull();
    expect(r.candidates.sort()).toEqual(['Barbell Bench Press', 'Incline Dumbbell Press']);
  });

  it('returns token-overlap candidates when not directly found ("leg press")', () => {
    const r = resolveExerciseTarget(program, 'leg press');
    expect(r.resolvedKey).toBeNull();
    expect(r.candidates).toContain('Barbell Bench Press');
    expect(r.candidates).toContain('Incline Dumbbell Press');
  });

  it('falls back to the stored list when nothing matches ("bicep curl")', () => {
    const r = resolveExerciseTarget(program, 'bicep curl');
    expect(r.resolvedKey).toBeNull();
    expect(r.candidates.length).toBeGreaterThan(0);
  });

  it('returns empty candidates for an empty program', () => {
    expect(resolveExerciseTarget({}, 'bench')).toEqual({ resolvedKey: null, resolvedName: null, candidates: [] });
  });
});

describe('day-scoped resolution (default = that day, not the whole plan)', () => {
  it('collectExerciseNames filters to a single training day', () => {
    expect(collectExerciseNames(program, 'Day 1').sort()).toEqual(['Barbell Bench Press', 'Incline Dumbbell Press']);
    expect(collectExerciseNames(program, 'Day 2').sort()).toEqual(['Back Squat', 'Romanian Deadlift']);
  });

  it('resolves within the named day', () => {
    expect(resolveExerciseTarget(program, 'bench', 'Day 1').resolvedName).toBe('Barbell Bench Press');
    expect(resolveExerciseTarget(program, 'squat', 'Day 2').resolvedName).toBe('Back Squat');
  });

  it('does NOT resolve an exercise that lives on a different day', () => {
    const r = resolveExerciseTarget(program, 'bench', 'Day 2'); // bench is on Day 1
    expect(r.resolvedKey).toBeNull();
    expect(r.candidates).toEqual(expect.arrayContaining(['Back Squat', 'Romanian Deadlift']));
  });
});
