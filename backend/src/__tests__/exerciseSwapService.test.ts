// swapOptions with a user's data: their lifts become "yours", injuries come
// from constraintsText AND coachProfile, and an unknown name with no model
// answer comes back as "not known" instead of a guess.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const user = { findUnique: vi.fn() };
const workoutLog = { findMany: vi.fn() };
const exerciseProfileCache = { findMany: vi.fn(async () => []), upsert: vi.fn(async () => ({})) };
vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) { this.user = user; this.workoutLog = workoutLog; this.exerciseProfileCache = exerciseProfileCache; }) }));
const chatComplete = vi.fn();
vi.mock('../services/chatClient.js', () => ({ chatComplete: (...a: any[]) => chatComplete(...a) }));

const { swapOptions } = await import('../services/swap/index.js');

const log = (date: string, names: string[]) => ({ date, exercises: JSON.stringify(names.map((name) => ({ name, sets: 3, reps: 10, weightKg: 20 }))) });

beforeEach(() => {
  vi.clearAllMocks();
  user.findUnique.mockResolvedValue({ equipment: 'commercial', constraintsText: null, coachProfile: null });
  workoutLog.findMany.mockResolvedValue([]);
});

describe('swapOptions', () => {
  it('their logged lifts that do the same job come back as "yours", newest first, under their own names', async () => {
    workoutLog.findMany.mockResolvedValue([log('2026-10-26', ['Single-arm tricep pushdown', 'Bench Press']), log('2026-10-19', ['Skull crushers', 'Tricep Pushdown'])]);
    const r = await swapOptions('u1', { name: 'Tricep Pushdown', reps: '10-12', index: 4 });
    expect(r.original).toEqual({ name: 'Triceps Pressdown', known: true });
    expect(r.yours.map((y) => y.name)).toEqual(['Single-arm tricep pushdown', 'Skull crushers']);
    expect(r.yours[0].lastDone).toBe('2026-10-26');
    expect(r.yours[0].why).toMatch(/done it before/);
    expect(r.best).toHaveLength(3);
    expect(r.yours.map((y) => y.name)).not.toContain('Bench Press');
  });

  it('injuries from the coach profile filter the options', async () => {
    user.findUnique.mockResolvedValue({ equipment: null, constraintsText: null, coachProfile: JSON.stringify({ injuries: 'Recovering from shoulder surgery' }) });
    const r = await swapOptions('u1', { name: 'Bench Press', reps: 5, index: 0 });
    const names = [...r.best, ...r.variants].map((x) => x.name);
    expect(names).not.toContain('Incline Bench Press');
    expect(names).not.toContain('Dips');
  });

  it('equipment: a home gym never gets machine or cable options', async () => {
    user.findUnique.mockResolvedValue({ equipment: 'home_gym', constraintsText: null, coachProfile: null });
    const r = await swapOptions('u1', { name: 'Lat Pulldown', reps: 10, index: 1 });
    expect([...r.best, ...r.variants].every((x) => !['cable', 'machine'].includes(x.equipment))).toBe(true);
  });

  it('an unknown name the model can’t classify is "not known", never a guess', async () => {
    chatComplete.mockRejectedValue(new Error('down'));
    const r = await swapOptions('u1', { name: 'Zercher carry-ish thing' });
    expect(r).toMatchObject({ original: { known: false }, best: [], lowConfidence: true });
  });

  it('an unknown name gets classified once, cached, and ranked', async () => {
    chatComplete.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ mod: 'strength', pattern: 'elbow_flex', m: { biceps: 0.5, brachialis: 0.25, forearms: 0.25 }, prof: 1, load: 1, demand: 1, skill: 2, joints: {}, energy: ['hypertrophy'], eq: 'dumbbell' }) } }] });
    const r = await swapOptions('u1', { name: 'Zottman Curl', reps: 10, index: 5 });
    expect(r.original.known).toBe(true);
    expect(r.best).toHaveLength(3);
    expect(exerciseProfileCache.upsert).toHaveBeenCalledOnce();
  });
});
