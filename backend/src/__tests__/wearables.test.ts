// Wearables: normalising what sources send, recovery against the user's own
// baselines, and the simulator's scenarios landing where they should.

import { describe, it, expect, vi } from 'vitest';

vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) {}) }));

import { dayColumns, workoutColumns } from '../services/wearables/ingest.js';
import { normaliseActivity } from '../services/wearables/types.js';
import { computeRecovery, pickDays, setsIn, type DayRow } from '../services/wearables/recovery.js';
import { simulate, SCENARIOS } from '../services/wearables/simulator.js';

const END = '2026-10-19';
const asRows = (days: any[], provider = 'simulator'): DayRow[] => days.map((d) => ({ date: d.date, provider, ...(dayColumns(d) as any) }));

describe('normalising a source', () => {
  it('keeps only the fields sent, and drops impossible values instead of failing the sync', () => {
    expect(dayColumns({ date: '2026-10-01', steps: 8123.4 })).toEqual({ steps: 8123 });
    expect(dayColumns({ date: '2026-10-01', restingHr: 9, hrvMs: 52, hrvMethod: 'sdnn' })).toEqual({ hrvMs: 52, hrvMethod: 'sdnn' });
    const s = dayColumns({ date: '2026-10-01', sleep: { minutes: 412, deep: 60, rem: 90, core: 240, awake: 22, start: '2026-09-30T23:10:00-04:00', end: '2026-10-01T06:20:00-04:00' } });
    expect(s).toMatchObject({ sleepMinutes: 412, sleepDeepMin: 60, sleepRemMin: 90, sleepCoreMin: 240, sleepAwakeMin: 22 });
    expect(s.sleepStart).toBeInstanceOf(Date);
  });

  it('maps workout types loosely and computes duration', () => {
    expect(normaliseActivity('HKWorkoutActivityTypeTraditionalStrengthTraining')).toBe('strength');
    expect(normaliseActivity('functionalStrengthTraining')).toBe('strength');
    expect(normaliseActivity('running')).toBe('run');
    expect(normaliseActivity('Pickleball')).toBe('other');
    expect(normaliseActivity(null)).toBe('other');
    const w = workoutColumns({ id: 'a', start: '2026-10-01T17:00:00Z', end: '2026-10-01T18:05:00Z', activityType: 'traditionalStrengthTraining', avgHr: 118 });
    expect(w).toMatchObject({ externalId: 'a', activityType: 'strength', durationMin: 65, avgHr: 118 });
  });
});

describe('computeRecovery', () => {
  const base = (n: number, f: (i: number) => Partial<DayRow>) => Array.from({ length: n }, (_, i) => {
    const t = new Date(`${END}T12:00:00Z`); t.setUTCDate(t.getUTCDate() - (n - i));
    return { date: t.toISOString().slice(0, 10), provider: 'apple_health', restingHr: 55, hrvMs: 50, hrvMethod: 'sdnn', sleepMinutes: 420, steps: 8000, activeKcal: 500, ...f(i) } as DayRow;
  });

  it('is unknown without a baseline, rather than guessing', () => {
    const r = computeRecovery(END, [{ date: END, provider: 'apple_health', restingHr: 70, hrvMs: 20, hrvMethod: 'sdnn', sleepMinutes: 300, steps: 100, activeKcal: 10 }]);
    expect(r.status).toBe('unknown');
    expect(r.confidence).toBe(0);
  });

  it('reads a normal day as normal and a good day as ready', () => {
    const rows = base(28, () => ({}));
    expect(computeRecovery(END, [...rows, { ...rows[0], date: END, hrvMs: 51, restingHr: 55 }]).status).toBe('normal');
    expect(computeRecovery(END, [...rows, { ...rows[0], date: END, hrvMs: 56, restingHr: 54, sleepMinutes: 440 }]).status).toBe('ready');
  });

  it('flags strain with the numbers behind it', () => {
    const rows = base(28, () => ({}));
    const r = computeRecovery(END, [...rows, { ...rows[0], date: END, hrvMs: 36, restingHr: 57, sleepMinutes: 400 }]);
    expect(r.status).toBe('strained');
    expect(r.reasons[0]).toBe('HRV 36 ms, 28% under your 28-day 50 ms');
  });

  it('calls for a check-in, not a diagnosis, when resting HR and HRV move together', () => {
    const rows = base(28, () => ({}));
    const r = computeRecovery(END, [...rows, { ...rows[0], date: END, hrvMs: 38, restingHr: 63, wristTempDeltaC: 0.6 }]);
    expect(r.status).toBe('check_in');
  });

  it('never compares HRV across methods (Apple SDNN vs Fitbit RMSSD)', () => {
    const rows = base(28, () => ({ hrvMethod: 'sdnn', hrvMs: 50 }));
    const r = computeRecovery(END, [...rows, { ...rows[0], date: END, provider: 'google_health', hrvMethod: 'rmssd', hrvMs: 30 }]);
    expect(r.hrv).toBeNull();
  });

  it('a run of short nights still counts, even when the latest night is near usual', () => {
    // 4 weeks of 7 h, then 6 nights of 5 h 20, then a 6 h 50 night.
    const rows = base(35, (i) => ({ sleepMinutes: i >= 29 ? 320 : 420 }));
    const r = computeRecovery(END, [...rows, { ...rows[0], date: END, sleepMinutes: 410 }]);
    expect(r.sleep).toMatchObject({ baseline: 420, recentAvg: 350 });
    expect(r.status).toBe('low');
    expect(r.reasons).toContain('Last 3 nights averaged 5 h 50, 1 h 10 under your usual 7 h 00');
  });

  it('counts training load from logged sets', () => {
    const sets = new Map<string, number>();
    for (let i = 7; i < 35; i++) { const t = new Date(`${END}T12:00:00Z`); t.setUTCDate(t.getUTCDate() - i); if (i % 2) sets.set(t.toISOString().slice(0, 10), 12); }
    for (let i = 0; i < 7; i++) { const t = new Date(`${END}T12:00:00Z`); t.setUTCDate(t.getUTCDate() - i); sets.set(t.toISOString().slice(0, 10), 25); }
    const r = computeRecovery(END, base(28, () => ({})), sets);
    expect(r.load?.ratio).toBeGreaterThanOrEqual(1.5);
  });

  it('picks the fuller source when two report the same day', () => {
    const m = pickDays([
      { date: END, provider: 'google_health', restingHr: 55, hrvMs: null, hrvMethod: null, sleepMinutes: null, steps: 9000, activeKcal: null },
      { date: END, provider: 'apple_health', restingHr: 56, hrvMs: 48, hrvMethod: 'sdnn', sleepMinutes: 410, steps: 9100, activeKcal: 520 },
    ]);
    expect(m.get(END)!.provider).toBe('apple_health');
  });

  it('reads sets from logged exercises', () => {
    expect(setsIn(JSON.stringify([{ sets: 3 }, { setEntries: [{}, {}, {}, {}] }, { sets: '2' }]))).toBe(9);
    expect(setsIn('nope')).toBe(0);
  });
});

describe('simulator', () => {
  it('is deterministic per user and scenario', () => {
    const a = simulate({ scenario: 'normal', days: 30, endDate: END, seed: 'u1' });
    expect(simulate({ scenario: 'normal', days: 30, endDate: END, seed: 'u1' })).toEqual(a);
    expect(simulate({ scenario: 'normal', days: 30, endDate: END, seed: 'u2' })).not.toEqual(a);
    expect(a.days).toHaveLength(30);
    expect(a.days[29].date).toBe(END);
    expect(a.workouts.length).toBeGreaterThan(10);
  });

  it('every scenario produces data the ingest schema accepts', () => {
    for (const scenario of SCENARIOS) {
      const s = simulate({ scenario, days: 45, endDate: END, seed: 'x' });
      for (const d of s.days) expect(() => dayColumns(d)).not.toThrow();
      for (const w of s.workouts) expect(() => workoutColumns(w)).not.toThrow();
    }
  });

  it('scenarios land where they should once recovery reads them', () => {
    const status = (scenario: any, seed: string) => computeRecovery(END, asRows(simulate({ scenario, days: 60, endDate: END, seed }).days)).status;
    const seeds = ['a', 'b', 'c', 'd', 'e'];
    expect(seeds.every((s) => status('illness', s) === 'check_in')).toBe(true);
    expect(seeds.filter((s) => ['strained', 'check_in'].includes(status('overreached', s))).length).toBeGreaterThanOrEqual(4);
    expect(seeds.every((s) => ['low', 'strained'].includes(status('poor_sleep', s)))).toBe(true);
    expect(seeds.filter((s) => ['normal', 'ready'].includes(status('normal', s))).length).toBeGreaterThanOrEqual(4);
    expect(seeds.filter((s) => ['normal', 'ready'].includes(status('deload', s))).length).toBeGreaterThanOrEqual(4);
  });
});
