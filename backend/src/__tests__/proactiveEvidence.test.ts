// A1 receipts: every "Why I'm asking" line is computed from rows here, never
// written by the model. Sessions, the user's words, check-ins, stalled lifts,
// protein, weigh-ins, events. No HRV, no soreness score.
import { describe, it, expect, vi } from 'vitest';

vi.mock('@prisma/client', async () => ({ PrismaClient: (await import('./helpers/memPrisma.js')).PrismaClient }));
vi.mock('../services/cacheService.js', () => ({ cacheDelete: vi.fn(), cacheClearByPrefix: vi.fn(), cacheGet: vi.fn(), cacheSet: vi.fn(), cacheMarkStale: vi.fn() }));

const E = await import('../proactive/evidence.js');
const today = '2026-10-30';
const w = (date: string, title: string, rpe: number | null = null, duration: number | null = null) => ({ date, title, duration, exercises: JSON.stringify([{ name: 'Back Squat', sets: 5, reps: '5', rpe }]) });

describe('sessions', () => {
  it('six training days in a row of combat work = "6 hard days in a row"', () => {
    const workouts = ['25', '26', '27', '28', '29', '30'].map((d) => w(`2026-10-${d}`, 'MMA sparring'));
    expect(E.streakEvidence(workouts, today)).toMatchObject({ id: 'streak_days', verb: 'Checked', text: '6 hard days in a row' });
  });
  it('plain lifting isn\'t "hard" unless RPE ≥ 8 or an hour long; under 4 days there is no streak line', () => {
    expect(E.streakEvidence(['27', '28', '29', '30'].map((d) => w(`2026-10-${d}`, 'Push')), today)?.text).toBe('4 days in a row');
    expect(E.streakEvidence(['27', '28', '29', '30'].map((d) => w(`2026-10-${d}`, 'Push', 9)), today)?.text).toBe('4 hard days in a row');
    expect(E.streakEvidence(['29', '30'].map((d) => w(`2026-10-${d}`, 'Push')), today)).toBeNull();
    expect(E.isHardSession(w('2026-10-30', 'Legs', null, 75))).toBe(true);
  });
  it('sessions in the last 7 days when there is no streak', () => {
    expect(E.sessionsEvidence([w('2026-10-24', 'A'), w('2026-10-26', 'B'), w('2026-10-28', 'C')], today)?.text).toBe('3 sessions in 7 days');
    expect(E.sessionsEvidence([w('2026-10-24', 'A'), w('2026-10-28', 'C')], today)).toBeNull();
  });
});

describe('check-ins and words', () => {
  it('energy 2 of 5 at the last 3 check-ins; nothing when one was fine', () => {
    const c = (energy: number) => ({ date: '2026-10-30', energy, sleepHours: 7 });
    expect(E.energyEvidence([c(2), c(2), c(1)])?.text).toBe('Energy 2 of 5 at your last 3 check-ins');
    expect(E.energyEvidence([c(2), c(4), c(1)])).toBeNull();
    expect(E.energyEvidence([c(1), c(1)])).toBeNull();
  });
  it('short sleep on 3 of the last 4 nights', () => {
    const s = (h: number) => ({ date: '2026-10-30', energy: null, sleepHours: h });
    expect(E.sleepEvidence([s(5), s(5.5), s(7), s(5)])?.text).toBe('Under 6 h sleep on 3 of the last 4 nights');
    expect(E.sleepEvidence([s(7), s(5.5), s(7), s(5)])).toBeNull();
  });
  it('the user\'s own words, as a READ receipt, newest first, two at most', () => {
    const msgs = [
      { role: 'user' as const, text: 'Sparring was rough. Legs are cooked.', at: '2026-10-29T20:00:00Z' },
      { role: 'assistant' as const, text: 'Logged. Easy on the squats tomorrow.', at: '2026-10-29T20:00:05Z' },
      { role: 'user' as const, text: 'log lunch: chicken rice', at: '2026-10-30T12:00:00Z' },
      { role: 'user' as const, text: 'Bench feels stuck', at: '2026-10-22T12:00:00Z' },
      { role: 'user' as const, text: 'elbow was a bit cranky again', at: '2026-10-01T12:00:00Z' },
    ];
    const q = E.quoteEvidence(msgs, today);
    expect(q.map((x) => x.text)).toEqual(['“Legs are cooked.” · you, yesterday', '“Bench feels stuck” · you, Oct 22']);
    expect(q[0].verb).toBe('Read');
  });
});

describe('lifts, protein, weight, events', () => {
  it('a lift sat at the same top set for 4 sessions', () => {
    const lifts = [{ name: 'Bench Press', sessions: [1, 2, 3, 4, 5].map((i) => ({ date: `2026-10-${30 - i}`, weightKg: 61.23, reps: 5 })) }, { name: 'Squat', sessions: [{ date: '2026-10-29', weightKg: 100, reps: 5 }, { date: '2026-10-27', weightKg: 97.5, reps: 5 }, { date: '2026-10-25', weightKg: 95, reps: 5 }, { date: '2026-10-23', weightKg: 95, reps: 5 }] }];
    const out = E.stalledLiftEvidence(lifts, 'lb');
    expect(out).toEqual([{ id: 'stalled_bench_press', verb: 'Checked', text: 'Bench Press · 135 × 5 for the last 5 sessions', topics: ['plateau', 'bench press', 'progression'] }]);
  });
  it('protein short on 3 of the logged days (80% of target)', () => {
    const days = [['24', 180], ['25', 120], ['26', 100], ['27', 190], ['28', 130]].map(([d, p]) => ({ date: `2026-10-${d}`, proteinG: Number(p), kcal: 2000 }));
    expect(E.proteinEvidence(days, 180, today)?.text).toBe('Protein short on 3 of the last 5 logged days');
    expect(E.proteinEvidence(days, null, today)).toBeNull();
  });
  it('weigh-ins this week; an open event with its date', () => {
    expect(E.weighInEvidence([{ date: '2026-10-24', weightKg: 80 }, { date: '2026-10-27', weightKg: 79 }, { date: '2026-10-30', weightKg: 78 }], today)?.text).toBe('Weight · 3 weigh-ins this week');
    expect(E.eventEvidence([{ kind: 'event', title: 'Amateur fight · Nov 22', eventDate: '2026-11-22', status: 'open' }, { kind: 'event', title: 'Old meet', eventDate: '2026-10-01', status: 'open' }], today)).toEqual([{ id: 'event_2026-11-22', verb: 'Checked', text: 'Amateur fight · Nov 22', topics: ['event', 'the fight', 'peaking', 'cut'] }]);
  });
  it('the catalog has no HRV or soreness line', () => {
    const items = E.buildEvidence({ today, workouts: ['25', '26', '27', '28', '29', '30'].map((d) => w(`2026-10-${d}`, 'MMA')), checkins: [], messages: [], mealDays: [], proteinTarget: null, weighIns: [], threads: [], lifts: [] });
    expect(items.map((i) => i.id)).toEqual(['streak_days']);
    expect(JSON.stringify(items)).not.toMatch(/hrv|soreness/i);
  });
});
