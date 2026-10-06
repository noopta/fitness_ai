import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ workoutLog: { findMany: vi.fn() } }));
vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) { Object.assign(this, db); }) }));

import { sessionSignature, withoutLogged, buildPreview, takePreview } from '../services/workoutBackfill.js';

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
    expect(p.undated).toEqual([{ title: 'Push', exercises: ['Bench press'] }]);
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
