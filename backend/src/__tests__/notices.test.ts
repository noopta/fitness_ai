// Notices: things we detected, raised once in chat with what the user can do.
// First one: guided sessions that saved without weights (16 Oct 2026 bug).

import { describe, it, expect, vi } from 'vitest';

vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) { this.user = {}; this.workoutLog = {}; }) }));
vi.mock('../services/cacheService.js', () => ({ cacheDelete: vi.fn(), cacheClearByPrefix: vi.fn(), cacheGet: vi.fn(), cacheSet: vi.fn(), cacheMarkStale: vi.fn() }));

const { weightlessSessions, weightlessNotice } = await import('../agent/notices.js');

const at = (iso: string) => new Date(iso).getTime();
const guided = (name: string, weightKg: number | null) => ({ name, sets: 3, reps: '10', weightKg, bodyweight: weightKg == null, setEntries: [{ weightKg, reps: 10, rpe: 8 }] });

const logs = [
  { id: 'a', date: '2026-10-12', title: 'Monday — Push Day', createdAt: at('2026-10-12T21:27:10Z'), exercises: JSON.stringify([guided('Incline Bench Press', null), guided('Chest Fly', null), guided('Dips', null)]) },
  { id: 'b', date: '2026-10-13', title: 'Tuesday — Session', createdAt: at('2026-10-14T01:47:06Z'), exercises: JSON.stringify([guided('Pull-Up', null)]) }, // bodyweight only
  { id: 'c', date: '2026-10-12', title: 'Push Day', createdAt: at('2026-10-12T21:34:43Z'), exercises: JSON.stringify([{ name: 'Incline Bench Press', sets: 3, reps: '10', weightKg: null }]) }, // not a guided session
  { id: 'd', date: '2026-10-14', title: 'Wednesday — Session', createdAt: at('2026-10-15T03:13:36Z'), exercises: JSON.stringify([guided('Leg Press', 86)]) }, // has weights
  { id: 'e', date: '2026-10-20', title: 'Leg Day', createdAt: at('2026-10-20T03:13:36Z'), exercises: JSON.stringify([guided('Leg Press', null)]) }, // after the fix
];

describe('weightless guided sessions', () => {
  it('finds only bug-window guided sessions whose weighted lifts saved no weight', () => {
    const s = weightlessSessions(logs);
    expect(s.map((x) => x.id)).toEqual(['a']);
    expect(s[0]).toMatchObject({ title: 'Push Day', lifts: ['Incline Bench Press', 'Chest Fly'] });
  });
  it('says what happened plainly and hands the fix to Anakin', () => {
    const n = weightlessNotice(weightlessSessions(logs))!;
    expect(n.text).toMatch(/Mon 12 Oct saved without the weights you lifted/);
    expect(n.text).toMatch(/they didn't drop/);
    const card = n.cards[0];
    expect(card.rows?.[0]).toMatchObject({ key: 'Mon 12 Oct · Push Day', value: '2 lifts' });
    expect(card.actions?.map((a) => a.label)).toEqual(['Add my weights', 'Use my planned weights']);
    expect((card.actions?.[1].client?.args as any).text).toMatch(/planned weights for my sessions on Mon 12 Oct/);
  });
  it('raises nothing when no session was affected', () => {
    expect(weightlessNotice(weightlessSessions([logs[3]]))).toBeNull();
  });
});
