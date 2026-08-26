// Cohort C: inferring the program a lifter has been running from their logs.
import { describe, it, expect } from 'vitest';
import { labelSession, inferProgramFromContext, buildInferredProgramProposal, programLooksAbandoned, splitName } from '../adaptation/rules/inferProgram.js';
import { runBootstrapRules } from '../adaptation/engine.js';
import { buildExposures, makeKeyFn } from '../adaptation/history.js';
import { extractPlannedExercises } from '../adaptation/targets.js';
import type { AdaptationContext } from '../adaptation/types.js';

const NOW = new Date('2026-08-26T12:00:00Z');

function ctxFrom(program: any | null, workouts: Array<{ id: string; date: string; exercises: any[] }>): AdaptationContext {
  const keyFn = makeKeyFn();
  return {
    userId: 'u1', program, unitPref: 'metric',
    planned: program ? extractPlannedExercises(program, keyFn) : [],
    exposuresByKey: buildExposures(workouts.map(w => ({ ...w, exercises: JSON.stringify(w.exercises) })), keyFn),
    workoutCount: workouts.length, firstWorkoutDate: workouts[0]?.date ?? null, now: NOW,
  };
}
const ex = (name: string, weightKg: number, reps: number, sets = 3) => ({
  name, sets, reps: String(reps), weightKg, setEntries: Array.from({ length: sets }, () => ({ weightKg, reps })),
});
function daysAgo(n: number): string { return new Date(NOW.getTime() - n * 86400000).toISOString().slice(0, 10); }

/** 6 weeks of PPL, 3×/week. */
function pplHistory() {
  const out: Array<{ id: string; date: string; exercises: any[] }> = [];
  let id = 0;
  for (let w = 0; w < 6; w++) {
    const base = 42 - w * 7;
    out.push({ id: 'p' + id++, date: daysAgo(base), exercises: [ex('Bench Press', 80 + w * 2.5, 8), ex('Overhead Press', 45, 8), ex('Triceps Pressdown', 25, 12), ...(w % 2 ? [ex('Lateral Raise', 10, 15)] : [])] });
    out.push({ id: 'p' + id++, date: daysAgo(base - 2), exercises: [ex('Barbell Row', 70, 8), ex('Lat Pulldown', 60, 10), ex('Barbell Curl', 30, 10)] });
    out.push({ id: 'p' + id++, date: daysAgo(base - 4), exercises: [ex('Back Squat', 100 + w * 5, 5, 4), ex('Romanian Deadlift', 90, 8), ex('Leg Curl', 40, 12)] });
  }
  return out;
}

describe('labelSession / splitName', () => {
  it('labels by category share', () => {
    expect(labelSession(['Bench Press', 'Overhead Press', 'Triceps Pressdown'])).toBe('push');
    expect(labelSession(['Barbell Row', 'Lat Pulldown', 'Barbell Curl'])).toBe('pull');
    expect(labelSession(['Back Squat', 'Romanian Deadlift', 'Leg Curl'])).toBe('legs');
    expect(labelSession(['Bench Press', 'Barbell Row', 'Overhead Press', 'Lat Pulldown'])).toBe('upper');
    expect(labelSession(['Back Squat', 'Bench Press', 'Barbell Row'])).toBe('full');
    expect(labelSession(['Plank'])).toBe('full');
  });
  it('names the split', () => {
    expect(splitName(['push', 'pull', 'legs'])).toBe('Push / Pull / Legs');
    expect(splitName(['upper', 'lower'])).toBe('Upper / Lower');
    expect(splitName(['full'])).toBe('Full body');
  });
});

describe('inferProgramFromContext', () => {
  it('rebuilds a PPL week with recurring lifts, sets/reps as performed, and seeded targets', () => {
    const inf = inferProgramFromContext(ctxFrom(null, pplHistory()))!;
    expect(inf).not.toBeNull();
    expect(inf.observed.split).toBe('Push / Pull / Legs');
    expect(inf.observed.sessionsPerWeek).toBe(3);
    expect(inf.observed.sessions).toBe(18);
    expect(inf.observed.goal).toBe('hypertrophy');
    const prog = inf.program;
    expect(prog.daysPerWeek).toBe(3);
    expect(prog.phases[0].trainingDays.map((d: any) => d.day)).toEqual(['Push', 'Pull', 'Legs']);
    const push = prog.phases[0].trainingDays[0];
    const bench = push.exercises.find((e: any) => e.exercise === 'Bench Press');
    expect(bench).toMatchObject({ sets: 3, reps: '8', intensity: 'RPE 8', targetBasis: 'history' });
    expect(bench.targetWeightKg).toBeGreaterThanOrEqual(87.5); // median of the last 4 sessions (85..92.5)
    // Lateral raise appeared in 3 of 6 push sessions (50%) → kept; nothing spurious.
    expect(push.exercises.map((e: any) => e.exercise)).toContain('Lateral Raise');
    const legs = prog.phases[0].trainingDays[2];
    expect(legs.exercises.find((e: any) => e.exercise === 'Back Squat')).toMatchObject({ sets: 4, reps: '5' });
    expect(inf.confidence).toBeGreaterThan(0.5);
  });
  it('fills the week by cycling day types when there are fewer types than sessions', () => {
    const ws: Array<{ id: string; date: string; exercises: any[] }> = [];
    for (let i = 0; i < 12; i++) ws.push({ id: 'f' + i, date: daysAgo(40 - i * 3), exercises: [ex('Back Squat', 100, 5), ex('Bench Press', 80, 5), ex('Barbell Row', 70, 5)] });
    const inf = inferProgramFromContext(ctxFrom(null, ws))!;
    expect(inf.observed.split).toBe('Full body');
    expect(inf.observed.goal).toBe('strength');
    const days = inf.program.phases[0].trainingDays.map((d: any) => d.day);
    expect(days.length).toBe(inf.observed.sessionsPerWeek);
    expect(days[0]).toBe('Full Body A');
    expect(days[1]).toBe('Full Body B');
  });
  it('needs at least 6 loaded sessions across 3 weeks', () => {
    expect(inferProgramFromContext(ctxFrom(null, pplHistory().slice(0, 5)))).toBeNull();
    const oneWeek = Array.from({ length: 6 }, (_, i) => ({ id: 'o' + i, date: daysAgo(3), exercises: [ex('Bench Press', 80, 8)] }));
    expect(inferProgramFromContext(ctxFrom(null, oneWeek))).toBeNull();
  });
  it('ignores sessions outside the 8-week window', () => {
    const old = pplHistory().map(w => ({ ...w, date: daysAgo(120) }));
    expect(inferProgramFromContext(ctxFrom(null, old))).toBeNull();
  });
});

describe('programLooksAbandoned + bootstrap routing', () => {
  const program = { goal: 'strength', phases: [{ trainingDays: [{ day: 'A', exercises: [{ exercise: 'Deadlift', sets: 3, reps: '5' }, { exercise: 'Pull-Up', sets: 3, reps: '8' }] }] }] };
  it('is abandoned when recent sessions barely overlap the plan', () => {
    expect(programLooksAbandoned(ctxFrom(program, pplHistory()))).toBe(true);
  });
  it('is not abandoned with too few recent sessions or with matching lifts', () => {
    expect(programLooksAbandoned(ctxFrom(program, pplHistory().slice(0, 2)))).toBe(false);
    const matching = { goal: 'hypertrophy', phases: [{ trainingDays: [{ day: 'Push', exercises: [{ exercise: 'Bench Press', sets: 3, reps: '8' }, { exercise: 'Overhead Press', sets: 3, reps: '8' }] }, { day: 'Pull', exercises: [{ exercise: 'Barbell Row', sets: 3, reps: '8' }, { exercise: 'Lat Pulldown', sets: 3, reps: '10' }] }, { day: 'Legs', exercises: [{ exercise: 'Back Squat', sets: 4, reps: '5' }, { exercise: 'RDL', sets: 3, reps: '8' }] }] }] };
    expect(programLooksAbandoned(ctxFrom(matching, pplHistory()))).toBe(false);
  });
  it('bootstrap rules: no program → program_from_logs; abandoned → program_from_logs; matching → retrofit', () => {
    const noProg = runBootstrapRules(ctxFrom(null, pplHistory()));
    expect(noProg[0]?.kind).toBe('program_from_logs');
    expect((noProg[0].proposal as any).reason).toBe('no_program');
    expect(noProg[0].title).toMatch(/your training describes/);
    const abandoned = runBootstrapRules(ctxFrom(program, pplHistory()));
    expect(abandoned[0]?.kind).toBe('program_from_logs');
    expect((abandoned[0].proposal as any).reason).toBe('abandoned');
    expect(abandoned[0].evidence.find(e => e.label === "Split you've been running")!.value).toBe('Push / Pull / Legs');
    const matching = { goal: 'hypertrophy', phases: [{ trainingDays: [{ day: 'Push', exercises: [{ exercise: 'Bench Press', sets: 3, reps: '8' }] }, { day: 'Pull', exercises: [{ exercise: 'Barbell Row', sets: 3, reps: '8' }] }, { day: 'Legs', exercises: [{ exercise: 'Back Squat', sets: 4, reps: '5' }] }] }] };
    expect(runBootstrapRules(ctxFrom(matching, pplHistory()))[0]?.kind).toBe('retrofit');
  });
  it('returns null when there is too little history to infer from', () => {
    expect(buildInferredProgramProposal(ctxFrom(null, pplHistory().slice(0, 3)), 'no_program')).toBeNull();
  });
});
