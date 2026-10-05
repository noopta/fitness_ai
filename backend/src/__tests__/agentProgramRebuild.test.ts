// D4 — classic-app (card contract 1) program changes from chat: a working
// rebuild path (propose_new_program → program_update proposal with a rebuild
// marker → confirm-proposal → applyProgramUpdate activates it), split / level
// inputs, goal-reworded edits keep the goal instead of erroring, and
// propose_program_edit can add / remove a day and change days per week.

import { describe, it, expect, vi, beforeEach } from 'vitest';

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
const { applyProgramEdits, splitLabel, levelOf, PROGRAM_TOOLS } = await import('../agent/toolkits/program.js');
const { applyProgramUpdate, REBUILD_MARKER } = await import('../agent/applyTools.js');
const { getOp } = await import('../agent/ops.js');
const { toolsFor, resetRegistryForTests } = await import('../agent/registry.js');
const { exerciseMatcher, WORKOUT_TOOLS } = await import('../agent/toolkits/workouts.js');

const program = () => ({
  goal: 'strength',
  daysPerWeek: 3,
  phases: [
    { phaseName: 'Foundation', trainingDays: [
      { day: 'Day 1 — Upper', focus: 'upper', exercises: [{ exercise: 'Bench Press', sets: 4, reps: '5' }] },
      { day: 'Day 2 — Lower', focus: 'lower', exercises: [{ exercise: 'Squat', sets: 4, reps: '5' }] },
      { day: 'Day 3 — Full', focus: 'full', exercises: [{ exercise: 'Deadlift', sets: 3, reps: '3' }] },
    ] },
    { phaseName: 'Build', trainingDays: [
      { day: 'Day 1 — Upper', exercises: [{ exercise: 'Bench Press', sets: 5, reps: '3' }] },
      { day: 'Day 2 — Lower', exercises: [{ exercise: 'Squat', sets: 5, reps: '3' }] },
      { day: 'Day 3 — Full', exercises: [{ exercise: 'Deadlift', sets: 3, reps: '2' }] },
    ] },
  ],
});
const tool = (name: string) => PROGRAM_TOOLS.find((t) => t.name === name)!;

beforeEach(() => {
  mocks.user.findUnique.mockReset();
  mocks.user.update.mockReset().mockResolvedValue({});
  coach.generateProgramForUser.mockReset();
  coach.saveProgramForUser.mockClear();
});

describe('propose_program_edit — day-level edits', () => {
  it('adds a day with its exercises, or as a copy of another day', () => {
    const { program: p, diff } = applyProgramEdits(program(), [{ type: 'add_day', day: 'Day 4 — Arms', exercises: [{ exercise: 'Barbell Curl', sets: 3, reps: '10' }] } as any], { phaseIndex: 0 });
    expect(p.phases[0].trainingDays.map((d: any) => d.day)).toEqual(['Day 1 — Upper', 'Day 2 — Lower', 'Day 3 — Full', 'Day 4 — Arms']);
    expect(p.phases[0].trainingDays[3].exercises[0]).toMatchObject({ exercise: 'Barbell Curl', sets: 3, reps: '10' });
    expect(p.daysPerWeek).toBe(4);
    expect(diff[0].key).toBe('+ Day 4 — Arms');
    const copy = applyProgramEdits(program(), [{ type: 'add_day', day: 'Upper B', copyFrom: 'Day 1', after: 'Day 1' } as any], { phaseIndex: 0, allPhases: true }).program;
    expect(copy.phases[0].trainingDays[1].day).toBe('Upper B');
    expect(copy.phases[1].trainingDays[1].exercises[0].sets).toBe(5); // each phase copies its own day
  });

  it('removes a day and refuses to remove the last one', () => {
    const { program: p, diff } = applyProgramEdits(program(), [{ type: 'remove_day', day: 'Day 3 — Full' } as any], { phaseIndex: 0, allPhases: true });
    expect(p.phases.every((ph: any) => ph.trainingDays.length === 2)).toBe(true);
    expect(p.daysPerWeek).toBe(2);
    expect(diff).toEqual([{ key: '− Day 3 — Full', from: '1 exercises', to: 'Removed', removed: true }]);
    const one = { goal: 'x', phases: [{ trainingDays: [{ day: 'Only', exercises: [{ exercise: 'Squat' }] }] }] };
    expect(() => applyProgramEdits(one, [{ type: 'remove_day', day: 'Only' } as any], { phaseIndex: 0 })).toThrow(/at least one/);
    expect(() => applyProgramEdits(program(), [{ type: 'remove_day', day: 'Day 9' } as any], { phaseIndex: 0 })).toThrow(/Couldn’t find/);
  });

  it('changes days per week: fewer drops from the end, more repeats existing days', () => {
    const down = applyProgramEdits(program(), [{ type: 'set_days_per_week', daysPerWeek: 2 } as any], { phaseIndex: 0 });
    expect(down.program.phases[0].trainingDays.map((d: any) => d.day)).toEqual(['Day 1 — Upper', 'Day 2 — Lower']);
    expect(down.diff[0]).toMatchObject({ key: 'Days per week', from: '3', to: '2 · drops Day 3 — Full' });
    const up = applyProgramEdits(program(), [{ type: 'set_days_per_week', daysPerWeek: 5 } as any], { phaseIndex: 0 });
    expect(up.program.phases[0].trainingDays.map((d: any) => d.day)).toEqual(['Day 1 — Upper', 'Day 2 — Lower', 'Day 3 — Full', 'Day 1 (repeat)', 'Day 2 (repeat)']);
    expect(up.program.daysPerWeek).toBe(5);
    expect(() => applyProgramEdits(program(), [{ type: 'set_days_per_week', daysPerWeek: 9 } as any], { phaseIndex: 0 })).toThrow(/1–7/);
  });

  it('flows through the tool as a classic-app program_update proposal', async () => {
    mocks.user.findUnique.mockResolvedValueOnce({ savedProgram: JSON.stringify(program()) }).mockResolvedValueOnce({ unitPreference: 'metric' });
    const r: any = await tool('propose_program_edit').execute({ edits: [{ type: 'add_day', day: 'Arms', copyFrom: 'Day 1' }] }, 'u1');
    expect(r._proposal).toBe(true);
    expect(r.kind).toBe('program_update');
    expect(r.fn).toBe('PRG-06');
    expect(r.updatedProgram.phases[0].trainingDays).toHaveLength(4);
  });
});

describe('goal-reworded edits keep the goal', () => {
  it('program.replace keeps the stored goal unless it is a goal change', async () => {
    mocks.user.findUnique.mockResolvedValue({ savedProgram: JSON.stringify(program()) });
    const next = { ...program(), goal: 'Build strength' };
    await getOp('program.replace')!.run('u1', { program: next });
    expect(JSON.parse(mocks.user.update.mock.calls[0][0].data.savedProgram).goal).toBe('strength');
    await getOp('program.replace')!.run('u1', { program: next, goalChange: true });
    expect(JSON.parse(mocks.user.update.mock.calls[1][0].data.savedProgram).goal).toBe('Build strength');
  });

  it('applyProgramUpdate keeps the goal instead of refusing', async () => {
    mocks.user.findUnique.mockResolvedValueOnce({ savedProgram: JSON.stringify(program()) });
    const out: any = await applyProgramUpdate('u1', { ...program(), goal: 'Get stronger' });
    expect(out.goal).toBe('strength');
    expect(JSON.parse(mocks.user.update.mock.calls[0][0].data.savedProgram).goal).toBe('strength');
  });
});

describe('rebuild (propose_new_program) on the classic app', () => {
  const generated = () => ({ goal: 'Hypertrophy-focused PPL', daysPerWeek: 6, durationWeeks: 12, phases: [{ phaseName: 'Accumulate', durationWeeks: 6, trainingDays: [{ day: 'Push', exercises: [{ exercise: 'Bench Press', sets: 4, reps: '8' }] }] }] });

  it('passes split + level to generation, keeps the current goal, and returns a rebuild proposal', async () => {
    mocks.user.findUnique.mockResolvedValueOnce({ coachGoal: 'gain strength', tier: 'pro', coachProfile: '{}', trainingAge: 'beginner', savedProgram: JSON.stringify(program()) });
    coach.generateProgramForUser.mockResolvedValueOnce(generated());
    const r: any = await tool('propose_new_program').execute({ split: 'push pull legs', trainingAge: "I'm intermediate" }, 'u1');
    const opts = coach.generateProgramForUser.mock.calls[0][1];
    expect(opts.daysPerWeek).toBe(6);
    expect(opts.goal).toMatch(/^strength — structure the week as a Push\/Pull\/Legs split/);
    expect(opts.goal).toContain('an intermediate lifter');
    expect(r.goal).toBe('strength');
    expect(r.goalChange).toBe(false);
    expect(r.split).toBe('Push/Pull/Legs');
    expect(r.profileNote).toMatch(/update_coaching_profile/);
    expect(r._proposal).toBe(true);
    expect(r.kind).toBe('program_update');
    expect(r.summary).toContain('Push/Pull/Legs');
    expect(r.updatedProgram[REBUILD_MARKER]).toEqual({ goalChange: false });
    expect(r.program[REBUILD_MARKER]).toBeUndefined(); // the v2 card activates a clean copy
  });

  it('an explicit new goal is a goal change', async () => {
    mocks.user.findUnique.mockResolvedValueOnce({ coachGoal: 'strength', tier: 'pro', coachProfile: '{}', trainingAge: 'intermediate', savedProgram: JSON.stringify(program()) });
    coach.generateProgramForUser.mockResolvedValueOnce(generated());
    const r: any = await tool('propose_new_program').execute({ goal: 'fat loss', daysPerWeek: 4 }, 'u1');
    expect(r.goalChange).toBe(true);
    expect(r.goal).toBe('Hypertrophy-focused PPL');
    expect(r.profileNote).toBeUndefined();
  });

  it('free users with a program get the Pro card instead', async () => {
    mocks.user.findUnique.mockResolvedValueOnce({ coachGoal: 'strength', tier: 'free', coachProfile: '{}', trainingAge: null, savedProgram: JSON.stringify(program()) });
    coach.generateProgramForUser.mockRejectedValueOnce(Object.assign(new Error('Pro feature'), { status: 403 }));
    const r: any = await tool('propose_new_program').execute({}, 'u1');
    expect(r.proOnly).toBe(true);
    expect(r._proposal).toBeUndefined();
  });

  it('confirm-proposal path: applyProgramUpdate activates the rebuild (archive + restart), marker stripped', async () => {
    mocks.user.findUnique.mockResolvedValueOnce({ savedProgram: JSON.stringify(program()) });
    const out: any = await applyProgramUpdate('u1', { ...generated(), [REBUILD_MARKER]: { goalChange: false } });
    expect(out).toMatchObject({ applied: true, rebuilt: true, goal: 'strength' });
    const saved = (coach.saveProgramForUser.mock.calls[0] as any[])[1];
    expect(saved[REBUILD_MARKER]).toBeUndefined();
    expect(saved.goal).toBe('strength');
    expect(mocks.user.update).not.toHaveBeenCalled();

    mocks.user.findUnique.mockResolvedValueOnce({ savedProgram: JSON.stringify(program()) });
    await applyProgramUpdate('u1', { ...generated(), [REBUILD_MARKER]: { goalChange: true } });
    expect((coach.saveProgramForUser.mock.calls[1] as any[])[1].goal).toBe('Hypertrophy-focused PPL');
  });

  it('a first program (nothing saved) can be applied from the card', async () => {
    mocks.user.findUnique.mockResolvedValueOnce({ savedProgram: null });
    const out: any = await applyProgramUpdate('u1', { ...generated(), [REBUILD_MARKER]: { goalChange: false } });
    expect(out.goal).toBe('Hypertrophy-focused PPL');
  });

  it('still validates the structure', async () => {
    mocks.user.findUnique.mockResolvedValueOnce({ savedProgram: JSON.stringify(program()) });
    await expect(applyProgramUpdate('u1', { goal: 'x', phases: [], [REBUILD_MARKER]: { goalChange: false } })).rejects.toThrow(/phases/);
  });
});

describe('rebuild inputs', () => {
  it('normalises splits and levels', () => {
    expect(splitLabel('PPL')?.id).toBe('ppl');
    expect(splitLabel('upper/lower')?.id).toBe('upper_lower');
    expect(splitLabel('full_body')?.label).toBe('Full body');
    expect(splitLabel('bro split')?.id).toBe('bro_split');
    expect(splitLabel('legs twice, arms once')).toMatchObject({ id: 'custom', label: 'legs twice, arms once' });
    expect(splitLabel('')).toBeNull();
    expect(levelOf('Intermediate')).toBe('intermediate');
    expect(levelOf('make it more advanced')).toBe('advanced');
    expect(levelOf('novice')).toBe('beginner');
    expect(levelOf('whatever')).toBeNull();
  });
});

describe('classic-app tool set', () => {
  it('includes the rebuild tool and the session suggester, not v2-only proposals', () => {
    resetRegistryForTests();
    const v1 = new Set(toolsFor(1).map((t) => t.name));
    expect(v1.has('propose_new_program')).toBe(true);
    expect(v1.has('propose_program_edit')).toBe(true);
    expect(v1.has('suggest_session')).toBe(true);
    expect(v1.has('propose_deload')).toBe(false);
    expect(toolsFor(2).some((t) => t.name === 'suggest_session')).toBe(true);
  });
});

describe('agent read tools match exercises canonically (D1)', () => {
  it('exerciseMatcher: canonical key, fragments, and the old substring match', async () => {
    const m = await exerciseMatcher('barbell bench press', []);
    expect(m('Bench Press')).toBe(true);
    expect(m('bench  press')).toBe(true);
    expect(m('Incline Bench Press')).toBe(false);
    const frag = await exerciseMatcher('bench', []);
    expect(frag('Flat Bench Press')).toBe(true);
    expect(frag('Squat')).toBe(false);
    expect((await exerciseMatcher('', []))('anything')).toBe(true);
  });

  it('read_recent_workouts finds a lift logged under another spelling', async () => {
    mocks.user.findUnique.mockResolvedValueOnce({ unitPreference: 'metric' });
    mocks.workoutLog.findMany.mockResolvedValueOnce([
      { id: 'w1', date: '2026-10-01', title: null, duration: null, exercises: JSON.stringify([{ name: 'Flat Bench Press', sets: 3, reps: '5', weightKg: 90 }]) },
      { id: 'w2', date: '2026-09-29', title: null, duration: null, exercises: JSON.stringify([{ name: 'Squat', sets: 3, reps: '5', weightKg: 120 }]) },
    ]);
    const r: any = await WORKOUT_TOOLS.find((t) => t.name === 'read_recent_workouts')!.execute({ exercise: 'barbell bench press' }, 'u1');
    expect(r.count).toBe(1);
    expect(r.workouts[0].id).toBe('w1');
    expect(r.workouts[0].exercises[0].hit).toBe(true);
  });
});
