import { describe, it, expect } from 'vitest';
import { buildTrainingOverview, parseGoalTargets, exerciseSpec, sessionTitle, type OverviewInput } from '../services/trainingOverview.js';

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
    expect(w.days[2]).toMatchObject({ name: 'Lower', minutes: 26 });
    expect(w.days[2].exercises[1]).toEqual({ name: 'Deadlift', spec: '3 × 5 · 310 lb' });
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
  it('shortens session names to a title', () => {
    expect(sessionTitle('Upper Body — Arms/Chest Emphasis')).toBe('Upper');
    expect(sessionTitle(null)).toBe('Session');
  });
});
