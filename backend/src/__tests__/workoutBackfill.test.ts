import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ workoutLog: { findMany: vi.fn() } }));
vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) { Object.assign(this, db); }) }));

import { sessionSignature, withoutLogged, buildPreview, takePreview, peekPreview, exerciseValue, previewBatch, leftOutLine, rangeLabel, applyBatchSelection, bestsLine, LIST_MAX } from '../services/workoutBackfill.js';

const ex = (...names: string[]) => names.map((name) => ({ name, sets: 3, reps: '5', weightKg: 100 }));
const TODAY = '2026-10-06';

beforeEach(() => {
  vi.clearAllMocks();
  db.workoutLog.findMany.mockResolvedValue([{ date: '2026-07-15', exercises: JSON.stringify(ex('Bench Press', 'Row')) }]);
});

describe('sessionSignature', () => {
  it('is the day plus exercise names, ignoring case, punctuation and order', () => {
    expect(sessionSignature('2026-07-15', ['Row', 'bench-press'])).toBe(sessionSignature('2026-07-15', ['Bench Press', 'row']));
    expect(sessionSignature('2026-07-15', ['Row'])).not.toBe(sessionSignature('2026-07-16', ['Row']));
  });
});

describe('withoutLogged', () => {
  it('drops sessions already in the log and repeats within the batch', async () => {
    const a = { date: '2026-07-15', exercises: ex('row', 'bench press') };
    const b = { date: '2026-07-16', exercises: ex('Squat') };
    const { fresh, dupes } = await withoutLogged('u1', [a, b, { ...b }] as any);
    expect(fresh).toEqual([b]);
    expect(dupes).toHaveLength(2);
  });
});

describe('buildPreview / takePreview', () => {
  it('sorts ready sessions and sets aside undated, future and already-logged ones', async () => {
    const p = await buildPreview('u1', [
      { date: '2026-08-01', title: 'Legs', exercises: ex('Squat') as any },
      { date: '2026-07-20', title: null, exercises: ex('Deadlift') as any },
      { date: null, title: 'Push', exercises: ex('Bench press') as any },
      { date: '2026-10-09', title: null, exercises: ex('Squat') as any },
      { date: '2026-07-15', title: null, exercises: ex('Bench press', 'Row') as any },
      { date: '2026-07-21', title: null, exercises: [] },
    ], TODAY, ['felt good']);
    expect(p.ready.map((w) => w.date)).toEqual(['2026-07-20', '2026-08-01']);
    expect(p.undated.map((x) => [x.title, x.exercises.map((e) => e.name)])).toEqual([['Push', ['Bench press']]]);
    expect(p.future).toEqual([{ date: '2026-10-09', title: null }]);
    expect(p.duplicates).toEqual([{ date: '2026-07-15', title: null }]);
    expect(p.unparsed).toEqual(['felt good']);
  });

  it('hands a preview back once, and only to its owner', async () => {
    const p = await buildPreview('u1', [{ date: '2026-08-01', title: null, exercises: ex('Squat') as any }], TODAY);
    expect(takePreview('u2', p.previewId)).toBeNull();
    expect(takePreview('u1', p.previewId)?.ready).toHaveLength(1);
    expect(takePreview('u1', p.previewId)).toBeNull();
  });
});

const LB = 0.45359237;
const lb = (n: number) => n * LB;

describe('exerciseValue — one line per lift on the card', () => {
  it('straight sets, sets at different weights, bodyweight reps, and times', () => {
    expect(exerciseValue({ name: 'Squat', sets: 3, reps: '5', weightKg: lb(225) } as any, 'imperial')).toBe('3 × 5 · 225 lb');
    expect(exerciseValue({ name: 'Bench', sets: 3, reps: '5', weightKg: lb(165), setEntries: [{ weightKg: lb(135), reps: 8 }, { weightKg: lb(155), reps: 6 }, { weightKg: lb(165), reps: 5 }] } as any, 'imperial')).toBe('3 sets · 135–165 lb');
    expect(exerciseValue({ name: 'Dips', sets: 3, reps: '8', weightKg: null, bodyweight: true, setEntries: [{ reps: 12 }, { reps: 10 }, { reps: 8 }] } as any, 'imperial')).toBe('3 sets · 12, 10, 8');
    expect(exerciseValue({ name: 'Calf raises', sets: 3, reps: '15', weightKg: null, bodyweight: true } as any, 'imperial')).toBe('3 × 15');
    expect(exerciseValue({ name: 'Run', sets: 1, reps: '5k', weightKg: null, bodyweight: true } as any, 'imperial')).toBe('5k');
    expect(exerciseValue({ name: 'Squat', sets: 3, reps: '5', weightKg: 102.5 } as any, 'metric')).toBe('3 × 5 · 102.5 kg');
  });
});

const exs = (...names: string[]) => names.map((name) => ({ name, sets: 3, reps: '5', weightKg: 100 }));
const preview = (over: Partial<any> = {}) => ({ previewId: 'p', ready: [], undated: [], duplicates: [], future: [], unparsed: [], ...over }) as any;

describe('previewBatch', () => {
  it(`up to ${LIST_MAX} sessions: a tickable list, undated rows last`, () => {
    const b = previewBatch(preview({
      ready: [{ date: '2026-07-15', title: 'Push', exercises: exs('Bench press', 'Dips') }],
      undated: [{ title: 'Pull', exercises: exs('Row') }],
      duplicates: [{ date: '2026-07-13', title: 'Legs' }],
    }), 'imperial');
    expect(b).toMatchObject({ kind: 'list', selectable: true, leftOut: 'Left out: 1 already logged (Mon 13 Jul · Legs).' });
    expect(b.sessions.map((x) => [x.i, x.day, x.title, x.names, x.count])).toEqual([[0, 'Wed 15 Jul', 'Push', 'Bench press, Dips', '2 lifts'], [1, null, 'Pull', 'Row', '1 lift']]);
  });

  it('more: hero, sessions per week as bars (gaps included), week rows', () => {
    const days = ['2026-07-13', '2026-07-15', '2026-07-17', '2026-07-20', '2026-07-22', '2026-07-24', '2026-07-25', '2026-08-03', '2026-08-05', '2026-08-07', '2026-08-08', '2026-08-10', '2026-08-12'];
    const b = previewBatch(preview({
      ready: days.map((d, i) => ({ date: d, title: ['Push', 'Pull', 'Legs'][i % 3], exercises: exs('Bench press', 'Row') })),
      duplicates: [{ date: '2026-07-21', title: 'Legs' }],
      future: [{ date: '2026-10-09', title: null }],
    }), 'imperial');
    expect(b.kind).toBe('weeks');
    expect(b.selectable).toBe(false);
    expect(b.hero).toEqual({ value: '13', unit: 'workouts', sub: '5 weeks · 26 exercises · 78 sets' });
    expect(b.bars).toEqual({ v: [3, 4, 0, 4, 2], from: '13 Jul', to: '12 Aug' });
    expect(b.weeks![0]).toEqual({ label: 'Week of 13 Jul', sub: 'Push, Pull, Legs', count: '3 sessions', ids: [0, 1, 2] });
    expect(b.weeks![1].sub).toBe('Push, Pull, Legs · 1 already logged');
    expect(b.weeks!.map((w) => w.label)).toEqual(['Week of 13 Jul', 'Week of 20 Jul', 'Week of 3 Aug', 'Week of 10 Aug']);
    expect(b.leftOut).toBe('Left out: 1 already logged (Tue 21 Jul · Legs) · 1 dated in the future (Fri 9 Oct).');
  });
});

describe('labels', () => {
  it('range and left-out footer', () => {
    expect(rangeLabel(['2026-08-05', '2026-07-15'])).toBe('Past workouts · 15 Jul – 5 Aug');
    expect(rangeLabel([])).toBe('Past workouts');
    expect(leftOutLine(preview({ unparsed: ['a', 'b'] }))).toBe('Left out: 2 lines that weren’t training.');
    expect(leftOutLine(preview())).toBeUndefined();
  });
});

describe('applyBatchSelection', () => {
  const inputs = [{ date: '2026-07-15' }, { date: '2026-07-17' }, { date: null }, { date: null }];
  it('skips ticked-off sessions, dates undated ones, drops what stays undated', () => {
    expect(applyBatchSelection(inputs, { skip: [1], dates: { '2': '2026-07-20' } }, '2026-10-06').map((x) => x.date)).toEqual(['2026-07-15', '2026-07-20']);
  });
  it('a date can\'t be in the future, over a year back, or replace an existing one', () => {
    expect(applyBatchSelection(inputs, { dates: { '0': '2026-01-01', '2': '2026-10-07', '3': '2025-09-01' } }, '2026-10-06').map((x) => x.date)).toEqual(['2026-07-15', '2026-07-17']);
  });
});

describe('bestsLine', () => {
  it('names each best with its top set, in the user\'s unit', () => {
    const inputs = [
      { date: '2026-07-24', exercises: [{ name: 'Squat', sets: 3, reps: '5', weightKg: lb(230) }] },
      { date: '2026-07-20', exercises: [{ name: 'Deadlift', sets: 3, reps: '4', weightKg: lb(320), setEntries: [{ weightKg: lb(300), reps: 8 }, { weightKg: lb(310), reps: 6 }, { weightKg: lb(320), reps: 4 }] }] },
    ] as any;
    expect(bestsLine([{ date: '2026-07-20', prs: ['Deadlift'] }, { date: '2026-07-24', prs: ['Squat'] }], inputs, 'imperial')).toBe('2 were bests at the time — deadlift 320 × 4, squat 230 × 5.');
    expect(bestsLine([{ date: '2026-07-24', prs: [] }], inputs, 'imperial')).toBeUndefined();
  });
});

describe('peekPreview', () => {
  it('reads a preview without using it up', async () => {
    const p = await buildPreview('u1', [{ date: '2026-08-01', title: null, exercises: exs('Squat') as any }], TODAY);
    expect(peekPreview('u1', p.previewId)?.ready).toHaveLength(1);
    expect(takePreview('u1', p.previewId)?.ready).toHaveLength(1);
  });
});
