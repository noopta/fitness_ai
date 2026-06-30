// Exercise-swap name resolution: the agent can only act on exercises that
// ACTUALLY exist in the program. Exact / unambiguous-substring resolve; ambiguous
// or missing names return candidates so the agent re-calls with the exact one
// instead of silently changing nothing while reporting success.
import { describe, it, expect, vi } from 'vitest';

// applyTools news up a PrismaClient at module load; stub it — the functions
// under test are pure and never touch prisma.
vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) {}) }));

import { resolveExerciseTarget, collectExerciseNames, buildPlanPatchProposal } from '../agent/applyTools.js';

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


describe('buildPlanPatchProposal (Flow A — propose, never mutate)', () => {
  it('builds a proposal for a resolvable exercise on a day, carrying the current scheme + meta', () => {
    const r = buildPlanPatchProposal(program, {
      fromName: 'bench', toName: 'Flat Dumbbell Press', day: 'Day 1',
      primaryTarget: ['chest'], equipment: 'dumbbell', stimulusDelta: 'held', shoulderLoad: 'lower',
      rationale: 'Same press pattern; DBs reduce anterior shoulder stress.',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.proposal.kind).toBe('plan_patch');
    expect(r.proposal.from.name).toBe('Barbell Bench Press');
    expect(r.proposal.from.sets).toBe(4);                 // pulled from the stored exercise
    expect(r.proposal.to.name).toBe('Flat Dumbbell Press');
    expect(r.proposal.to.sets).toBe(4);                   // inherits when not overridden
    expect(r.proposal.scope).toBe('day');
    expect(r.proposal.meta.equipment).toBe('dumbbell');
    expect(r.proposal.rationale).toMatch(/shoulder/);
  });

  it('carries a valid full updatedProgram (swap applied, scoped, goal preserved) for the legacy/backward-compat apply path', () => {
    const r = buildPlanPatchProposal(program, { fromName: 'bench', toName: 'Flat Dumbbell Press', day: 'Day 1' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const up = r.proposal.updatedProgram;
    // Must be a structurally valid program or applyProgramUpdate/validateProgram rejects it
    // ("updatedProgram.phases must be a non-empty array") — the exact bug this guards against.
    expect(Array.isArray(up?.phases) && up.phases.length > 0).toBe(true);
    expect(up.goal).toBe((program as any).goal);
    // The swap is applied on the scoped day...
    const day1 = up.phases.flatMap((p: any) => p.trainingDays).find((d: any) => d.day === 'Day 1');
    const names1 = day1.exercises.map((e: any) => e.exercise ?? e.name);
    expect(names1).toContain('Flat Dumbbell Press');
    expect(names1).not.toContain('Barbell Bench Press');
    // ...and other days are untouched (scope='day').
    const otherDays = up.phases.flatMap((p: any) => p.trainingDays).filter((d: any) => d.day !== 'Day 1');
    for (const d of otherDays) {
      expect(d.exercises.map((e: any) => e.exercise ?? e.name)).not.toContain('Flat Dumbbell Press');
    }
  });

  it('lets the agent override the to-scheme (e.g. 4x5 -> 4x8 reps)', () => {
    const r = buildPlanPatchProposal(program, { fromName: 'Back Squat', toName: 'Hack Squat', day: 'Day 2', toReps: 8 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.proposal.to.reps).toBe(8);
  });

  it('returns ok:false + candidates when the from-name is ambiguous (never a silent wrong swap)', () => {
    const r = buildPlanPatchProposal(program, { fromName: 'press', toName: 'X', scope: 'program' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.candidates.length).toBeGreaterThan(0);
  });

  it("requires a day label for scope 'day'", () => {
    const r = buildPlanPatchProposal(program, { fromName: 'bench', toName: 'X' }); // no day
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/day label/);
  });

  it('does not resolve an exercise that lives on a different day', () => {
    const r = buildPlanPatchProposal(program, { fromName: 'squat', toName: 'X', day: 'Day 1' }); // squat is Day 2
    expect(r.ok).toBe(false);
  });
});
