import { describe, it, expect } from 'vitest';
import { buildTrainingOverview, parseGoalTargets, exerciseSpec, sessionTitle, sentenceCase, type OverviewInput } from '../services/trainingOverview.js';
import { sessionMinutes } from '../services/sessionMinutes.js';

const LB = 0.45359237;

const program = {
  goal: 'Deadlift 350 by spring',
  durationWeeks: 16,
  phases: [
    {
      phaseName: 'Base/Volume', durationWeeks: 4, rationale: 'Volume first.',
      trainingDays: [
        { day: 'Upper — Push/Pull', focus: 'Hypertrophy', exercises: [{ exercise: 'Bench Press', sets: 4, reps: '8', intensity: 'RPE 7' }] },
        { day: 'Lower Body', focus: 'Hypertrophy', exercises: [{ exercise: 'Back Squat', sets: 4, reps: '6', intensity: 'RPE 8' }, { exercise: 'Deadlift', sets: 3, reps: '5', targetWeightKg: 140 }] },
      ],
    },
    { phaseName: 'Build', durationWeeks: 5, rationale: 'Heavier triples.', trainingDays: [{ day: 'Full', focus: 'Strength', exercises: [] }] },
  ],
};

const days = (todayIdx: number, loggedIdx: number[] = []) =>
  Array.from({ length: 7 }, (_, i) => ({
    date: `2026-10-0${i + 1}`,
    isToday: i === todayIdx,
    isLogged: loggedIdx.includes(i),
    session: i % 2 === 0 ? program.phases[0].trainingDays[i % 4 === 0 ? 0 : 1] : null,
  }));

const base = (over: Partial<OverviewInput> = {}): OverviewInput => ({
  program,
  weekNumber: 6,
  phaseIndex: 1,
  totalWeeks: 16,
  startWeekKey: '2026-W30',
  weekDays: days(2, [0]),
  lifts: [
    { canonicalName: 'Deadlift', current1RMkg: 300 * LB, sessionCount: 12, weekSeries: [{ week: '2026-W29', rm: 270 * LB }, { week: '2026-W30', rm: 280 * LB }, { week: '2026-W38', rm: 300 * LB }] },
    { canonicalName: 'Back Squat', current1RMkg: 250 * LB, sessionCount: 10, weekSeries: [{ week: '2026-W30', rm: 240 * LB }] },
    { canonicalName: 'Bench Press', current1RMkg: 200 * LB, sessionCount: 9, weekSeries: [{ week: '2026-W31', rm: 190 * LB }] },
    { canonicalName: 'Bicep Curl', current1RMkg: 60 * LB, sessionCount: 40 },
  ],
  unitPref: 'lbs' as any,
  completed: [],
  formAnalyses: [],
  liftDiagnostics: [],
  ...over,
});

describe('parseGoalTargets', () => {
  it('reads lift numbers, units and rep targets from free text', () => {
    const t = parseGoalTargets('Deadlift 350 by spring, bench 100kg x 5', 'lb');
    expect(t.get('deadlift')).toEqual({ value: 350, unit: 'lb', reps: null });
    expect(t.get('bench')).toEqual({ value: 100, unit: 'kg', reps: 5 });
    expect(t.has('squat')).toBe(false);
  });
});

describe('buildTrainingOverview', () => {
  it('picks the three main lifts, using the goal target where the goal names one', () => {
    const o = buildTrainingOverview(base());
    expect(o.unit).toBe('lb');
    expect(o.goal.lifts.map((l) => l.name)).toEqual(['Back Squat', 'Bench Press', 'Deadlift']);
    const dl = o.goal.lifts.find((l) => l.name === 'Deadlift')!;
    expect(dl).toMatchObject({ start: 280, current: 300, target: 350, reps: 'e1RM', targetSource: 'goal' });
    expect(dl.progress).toBeCloseTo(20 / 70, 2);
    expect(o.goal.lifts.find((l) => l.name === 'Back Squat')!.targetSource).toBe('projected');
    expect(o.goal.pct).toBeGreaterThan(0);
  });

  it('calls pace against the week of the program', () => {
    const early = buildTrainingOverview(base({ weekNumber: 1 }));
    expect(early.goal.lifts.find((l) => l.name === 'Deadlift')!.pace).toBe('ahead');
    const late = buildTrainingOverview(base({ weekNumber: 16 }));
    expect(late.goal.lifts.find((l) => l.name === 'Deadlift')!.pace).toBe('behind');
  });

  it('shapes phases with start weeks, effort and the current phase', () => {
    const p = buildTrainingOverview(base()).program!;
    expect(p).toMatchObject({ week: 6, totalWeeks: 16, currentPhase: 1 });
    expect(p.phases[0]).toMatchObject({ name: 'Base', focus: 'volume', weeks: 4, from: 1, why: 'Volume first.', sessions: '2 a week', effort: 'RPE 7–8', focusLine: 'Upper · lower' });
    expect(p.phases[1]).toMatchObject({ name: 'Build', from: 5, focus: 'strength' });
  });

  it('labels Mon–Sun with done / today / planned / rest', () => {
    const w = buildTrainingOverview(base()).week;
    expect(w.days.map((d) => d.dow)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(w.days.map((d) => d.status)).toEqual(['done', 'rest', 'today', 'rest', 'planned', 'rest', 'planned']);
    expect(w).toMatchObject({ done: 1, planned: 4 });
    expect(w.days[2]).toMatchObject({ name: 'Lower', minutes: sessionMinutes(program.phases[0].trainingDays[1]) });
    // lb users: every load is in lb, so the unit is dropped.
    expect(w.days[2].exercises[1]).toEqual({ name: 'Deadlift', spec: '3 × 5 · 310' });
  });

  it("gives each day its own session's duration, not one flat number", () => {
    const upper = { day: 'Upper', exercises: [{ exercise: 'Bench Press', sets: 3, reps: '12' }] };
    const lower = { day: 'Lower', estimatedMinutes: 71, exercises: [{ exercise: 'Back Squat', sets: 3, reps: '12' }] };
    const weekDays = [upper, lower].map((session, i) => ({ date: `2026-10-0${i + 1}`, isToday: false, session }));
    const w = buildTrainingOverview(base({ weekDays })).week;
    expect(w.days[0].minutes).toBe(sessionMinutes(upper));
    expect(w.days[1].minutes).toBe(71);
  });

  it('keeps the unit for kg users and sentence-cases exercise names', () => {
    const session = { day: 'Upper', exercises: [{ exercise: 'Close-Grip Bench Press', sets: 3, reps: '8', targetWeightKg: 80 }] };
    const w = buildTrainingOverview(base({ unitPref: 'kg' as any, weekDays: [{ date: '2026-10-01', isToday: true, session }] })).week;
    expect(w.days[0].exercises[0]).toEqual({ name: 'Close-grip bench press', spec: '3 × 8 · 80 kg' });
  });

  it('does not read 0% after a light session since the best week', () => {
    // Last session was light (current1RMkg 270) but the best week since the start was 300.
    const lifts = [{ canonicalName: 'Deadlift', current1RMkg: 270 * LB, sessionCount: 12,
      weekSeries: [{ week: '2026-W30', rm: 280 * LB }, { week: '2026-W36', rm: 300 * LB }, { week: '2026-W38', rm: 270 * LB }] }];
    const g = buildTrainingOverview(base({ lifts })).goal;
    expect(g.lifts[0]).toMatchObject({ start: 280, current: 300, target: 350 });
    expect(g.lifts[0].progress).toBeCloseTo(20 / 70, 2);
    expect(g.pct).toBe(Math.round((20 / 70) * 100));
  });

  it("is the mean of each lift's (current − start) / (target − start)", () => {
    const o = buildTrainingOverview(base());
    const mean = o.goal.lifts.reduce((s, l) => s + l.progress, 0) / o.goal.lifts.length;
    expect(o.goal.pct).toBe(Math.round(mean * 100));
    expect(o.goal.pct).toBeGreaterThan(0);
  });

  it('orders the archive programs first, then diagnostics newest first', () => {
    const a = buildTrainingOverview(base({
      completed: [
        { id: 'p1', goal: 'Rebuild the back', startDate: '2026-03-01', endDate: '2026-06-01', durationWeeks: 12, reason: 'completed' },
        { id: 'p2', goal: 'Achilles return', startDate: '2025-08-01', endDate: '2026-02-01', durationWeeks: 24, reason: 'replaced' },
      ],
      formAnalyses: [{ id: 'f1', exercise: 'deadlift', status: 'complete', formScore: 82.4, createdAt: '2026-09-14' }, { id: 'f2', exercise: 'squat', status: 'failed', createdAt: '2026-09-20' }],
      liftDiagnostics: [{ id: 's1', lift: 'bench_press', flow: 'conversation', status: 'complete', updatedAt: '2026-09-21' }],
    })).archive;
    expect(a.count).toBe(4);
    expect(a.items.map((i) => i.id)).toEqual(['p1', 'p2', 's1', 'f1']);
    expect(a.items[0]).toMatchObject({ kind: 'program', sub: 'Mar – Jun · 12 wk', value: 'Done' });
    expect(a.items[2]).toMatchObject({ title: 'Bench press · diagnostic', source: 'lift', flow: 'conversation', value: 'Report' });
    expect(a.items[3]).toMatchObject({ title: 'Deadlift · form', value: '82' });
  });

  it('returns empty bands without a program', () => {
    const o = buildTrainingOverview(base({ program: null, weekDays: [] }));
    expect(o.program).toBeNull();
    expect(o.goal.lifts).toEqual([]);
    expect(o.week).toEqual({ done: 0, planned: 0, days: [] });
  });
});

describe('copy helpers', () => {
  it('formats exercise specs in the user unit', () => {
    expect(exerciseSpec({ sets: 3, reps: '5', targetWeightKg: 100 }, 'kg' as any)).toBe('3 × 5 · 100 kg');
    expect(exerciseSpec({ sets: 4, reps: '8', intensity: 'RPE 7' }, 'lbs' as any)).toBe('4 × 8 · RPE 7');
    expect(exerciseSpec({ sets: 2, reps: '10' }, 'lbs' as any)).toBe('2 × 10');
  });
  it('sentence-cases exercise names, keeping short acronyms', () => {
    expect(sentenceCase('Close-Grip Bench Press')).toBe('Close-grip bench press');
    expect(sentenceCase('DB Romanian Deadlift')).toBe('DB romanian deadlift');
    expect(sentenceCase('back squat')).toBe('Back squat');
  });
  it('drops the unit on request', () => {
    expect(exerciseSpec({ sets: 3, reps: '5', targetWeightKg: 100 }, 'lbs' as any, { unit: false })).toBe('3 × 5 · 220');
  });
  it('shortens session names to a title', () => {
    expect(sessionTitle('Upper Body — Arms/Chest Emphasis')).toBe('Upper');
    expect(sessionTitle(null)).toBe('Session');
  });
});
