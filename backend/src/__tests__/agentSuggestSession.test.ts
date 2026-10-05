// D3 — "what should I do today?" without a program: suggest_session picks a
// rested, due theme from the user's history, their overdue lifts, numbers
// from the contract-1 suggestion (else last session), and respects equipment
// + injuries (coachProfile AND constraintsText). Plus the canonical exercise
// matcher the read tools now use.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  workoutLog: { findMany: vi.fn() },
  exerciseNormalization: { findMany: vi.fn() },
}));
const flags = vi.hoisted(() => ({ on: true }));
const adapt = vi.hoisted(() => ({ lastForExercises: vi.fn() }));
vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) { Object.assign(this, mocks); }) }));
vi.mock('../services/cacheService.js', () => ({ cacheGet: vi.fn(() => null), cacheSet: vi.fn(), cacheDelete: vi.fn(), cacheClearByPrefix: vi.fn() }));
vi.mock('../services/featureFlags.js', () => ({
  freestyleAvailableFor: () => flags.on, logAdaptationAvailableFor: () => false, phaseInferenceAvailableFor: () => false,
}));
vi.mock('../adaptation/proposalService.js', () => adapt);
vi.mock('../agent/cards/store.js', () => ({ userTz: async () => 'UTC' }));
vi.mock('../agent/profile/coachProfile.js', () => ({
  readProfile: vi.fn(async () => ({ values: { equipment: 'commercial' }, injuries: [], blob: {} })),
}));
vi.mock('../agent/registry.js', () => ({ registerToolkit: vi.fn() }));

import { planSession, numbersFor, equipmentConflict, injuryAreas, injuryConflict, SUGGEST_TOOLS } from '../agent/toolkits/suggest.js';
import { historyFromRows } from '../services/trainingSummary.js';
import { readProfile } from '../agent/profile/coachProfile.js';

const TODAY = '2026-10-05';
const ex = (name: string, weightKg: number | null, reps: number, sets = 3) => ({ name, sets, reps: String(reps), weightKg, bodyweight: weightKg == null });
const row = (id: string, date: string, exercises: any[]) => ({ id, date, title: null, exercises: JSON.stringify(exercises) });

// Push yesterday, legs 3 days ago, pull 6 days ago.
const RECENT = [
  row('a', '2026-09-22', [ex('Barbell Row', 70, 8), ex('Lat Pulldown', 60, 10), ex('Barbell Curl', 30, 10)]),
  row('b', '2026-09-29', [ex('Barbell Row', 72.5, 8), ex('Pull-Up', null, 8), ex('Face Pull', 20, 15)]),
  row('c', '2026-10-02', [ex('Squat', 120, 5), ex('Romanian Deadlift', 100, 8), ex('Leg Curl', 40, 12)]),
  row('d', '2026-10-04', [ex('Bench Press', 90, 5), ex('Overhead Press', 50, 6), ex('Lateral Raise', 10, 15)]),
];

beforeEach(() => {
  Object.values(mocks).forEach((m) => Object.values(m).forEach((fn: any) => fn.mockReset()));
  adapt.lastForExercises.mockReset().mockResolvedValue([]);
  flags.on = true;
  mocks.exerciseNormalization.findMany.mockResolvedValue([]);
  (readProfile as any).mockResolvedValue({ values: { equipment: 'commercial' }, injuries: [], blob: {} });
});

describe('planSession (pure)', () => {
  it('picks the most-rested region and its overdue lifts, compounds first', () => {
    const plan = planSession({ history: historyFromRows(RECENT), today: TODAY });
    expect(plan.theme).toBe('pull');
    expect(plan.picks[0].name).toBe('Barbell Row');
    expect(plan.picks.every((p) => p.region === 'pull')).toBe(true);
    expect(plan.why.join(' ')).toMatch(/Push: trained yesterday — resting it/);
    expect(plan.why.join(' ')).toMatch(/Pull: last trained 6 days ago/);
  });

  it('pairs push + pull into an upper day when both are rested', () => {
    const rows = RECENT.slice(0, 3).concat(row('d', '2026-10-01', [ex('Bench Press', 90, 5)])).concat(row('e', '2026-10-04', [ex('Squat', 120, 5)]));
    const plan = planSession({ history: historyFromRows(rows), today: TODAY });
    expect(plan.theme).toBe('upper');
    expect(new Set(plan.picks.map((p) => p.region))).toEqual(new Set(['push', 'pull']));
  });

  it('goes full body after a few days off, and light when everything was just trained', () => {
    const off = planSession({ history: historyFromRows(RECENT), today: '2026-10-09' });
    expect(off.theme).toBe('full_body');
    const busy = [row('x', '2026-10-04', [ex('Bench Press', 90, 5), ex('Barbell Row', 70, 8)]), row('y', '2026-10-05', [ex('Squat', 120, 5)])];
    const light = planSession({ history: historyFromRows(busy), today: TODAY });
    expect(light.light).toBe(true);
  });

  it('honours an explicit focus', () => {
    expect(planSession({ history: historyFromRows(RECENT), today: TODAY, focus: 'legs please' }).theme).toBe('legs');
    expect(planSession({ history: historyFromRows(RECENT), today: TODAY, focus: 'upper' }).theme).toBe('upper');
  });

  it('drops lifts the equipment or an injury rules out, and says why', () => {
    const plan = planSession({ history: historyFromRows(RECENT), today: TODAY, focus: 'legs', injuryText: 'left knee — meniscus' });
    expect(plan.picks.some((p) => /squat/i.test(p.name))).toBe(false);
    expect(plan.excluded).toContainEqual({ name: 'Squat', reason: 'loads your knee' });
    const dumbbells = planSession({ history: historyFromRows(RECENT), today: TODAY, equipment: 'limited' });
    expect(dumbbells.picks.some((p) => /barbell|pulldown/i.test(p.name))).toBe(false);
  });

  it('fills from the library when history is thin', () => {
    const plan = planSession({ history: historyFromRows([]), today: TODAY, equipment: 'limited', injuryText: 'shoulder impingement' });
    expect(plan.insufficientHistory).toBe(true);
    expect(plan.theme).toBe('full_body');
    expect(plan.picks.length).toBeGreaterThanOrEqual(4);
    expect(plan.picks.every((p) => p.fromLibrary)).toBe(true);
    expect(plan.picks.some((p) => equipmentConflict(p.name, 'limited') || injuryConflict(p.name, ['shoulder']))).toBe(false);
  });
});

describe('numbers + constraints', () => {
  const pick = (over: any = {}) => ({ key: 'bench press', name: 'Bench Press', region: 'push', isCompound: true, lastDate: '2026-10-01', daysSince: 4, last: { sets: [{ weightKg: 90, reps: 5, rpe: 8 }, { weightKg: 90, reps: 5, rpe: 8 }], top: { weightKg: 90, reps: 5, rpe: 8 } }, fromLibrary: false, ...over }) as any;

  it('prefers the contract-1 suggestion, then last session, then calibrate', () => {
    expect(numbersFor(pick(), { weightKg: 92.5, reps: '5', sets: 3, rpe: 8, note: 'Try 92.5 kg' } as any, false)).toMatchObject({ weightKg: 92.5, sets: 3, basis: 'suggestion', note: 'Try 92.5 kg' });
    expect(numbersFor(pick(), null, false)).toMatchObject({ weightKg: 90, reps: '5', sets: 2, basis: 'last_session' });
    expect(numbersFor(pick(), null, true)).toMatchObject({ sets: 1, rpe: 6 });
    expect(numbersFor(pick({ last: null, fromLibrary: true }), null, false)).toMatchObject({ weightKg: null, basis: 'new', reps: '6-8' });
  });

  it('reads injury areas and equipment', () => {
    expect(injuryAreas('lower back disc; right shoulder')).toEqual(['shoulder', 'lower back']);
    expect(injuryConflict('Deadlift', ['lower back'])).toBe('loads your lower back');
    expect(injuryConflict('Leg Curl', ['lower back'])).toBeNull();
    expect(equipmentConflict('Cable Fly', 'home')).toMatch(/machine/);
    expect(equipmentConflict('Bench Press', 'home')).toBeNull();
    expect(equipmentConflict('Bench Press', 'limited')).toMatch(/equipment/);
    expect(equipmentConflict('Dumbbell Bench Press', 'limited')).toBeNull();
    expect(equipmentConflict('Leg Press', 'commercial')).toBeNull();
  });
});

describe('suggest_session tool', () => {
  const tool = SUGGEST_TOOLS[0];

  it('is a read tool with a card', () => {
    expect(tool.kind).toBe('read');
    expect(tool.fn).toBe('WRK-10');
  });

  it('uses the suggestion, reads injuries from BOTH coachProfile and constraintsText, and renders in the user unit', async () => {
    mocks.user.findUnique.mockResolvedValue({ email: 'a@b.c', unitPreference: 'imperial', constraintsText: 'cranky knee' });
    mocks.workoutLog.findMany.mockResolvedValue(RECENT);
    (readProfile as any).mockResolvedValue({ values: { equipment: 'commercial' }, injuries: [{ area: 'lower back' }, { area: 'old wrist', resolvedAt: '2026-01-01' }], blob: {} });
    adapt.lastForExercises.mockResolvedValue([{ name: 'Pull-Up', suggestion: { weightKg: null, reps: '9', sets: 3, rpe: 8, action: 'add_rep', basis: 'trend', note: 'One more rep', proposalId: null } }]);
    const r: any = await tool.execute({ focus: 'pull' }, 'u1');
    expect(r.theme).toBe('pull');
    expect(r.constraints.injuries).toEqual(['lower back']);
    expect(r.excluded.map((x: any) => x.name)).toContain('Barbell Row'); // lower back (structured list)
    const pullUp = r.exercises.find((e: any) => e.name === 'Pull-Up');
    expect(pullUp).toMatchObject({ scheme: '3 × 9', basis: 'suggestion', note: 'One more rep' });
    const pulldown = r.exercises.find((e: any) => e.name === 'Lat Pulldown');
    expect(pulldown.load).toBe('132 lb');

    // Knee text only lives in constraintsText — still respected.
    const legs: any = await tool.execute({ focus: 'legs' }, 'u1');
    expect(legs.exercises.some((e: any) => /squat/i.test(e.name))).toBe(false);
    const card: any = await tool.card!({}, r, { userId: 'u1', unit: 'imperial', tz: 'UTC', today: TODAY });
    expect(card.meta.label).toMatch(/^Today · Pull/);
    expect(card.rows.length).toBe(r.exercises.length);
  });

  it('is a soft no-op when the flags are off', async () => {
    flags.on = false;
    mocks.user.findUnique.mockResolvedValue({ email: null, unitPreference: 'metric', constraintsText: null });
    const r: any = await tool.execute({}, 'u1');
    expect(r.unavailable).toBe(true);
    expect(mocks.workoutLog.findMany).not.toHaveBeenCalled();
    expect(await tool.card!({}, r, { userId: 'u1', unit: 'metric', tz: 'UTC', today: TODAY })).toBeNull();
  });

  it('falls back to the last session when the suggestion service fails', async () => {
    mocks.user.findUnique.mockResolvedValue({ email: 'a@b.c', unitPreference: 'metric', constraintsText: null });
    mocks.workoutLog.findMany.mockResolvedValue(RECENT);
    adapt.lastForExercises.mockRejectedValue(new Error('boom'));
    const r: any = await tool.execute({}, 'u1');
    expect(r.exercises.find((e: any) => e.name === 'Barbell Row')).toMatchObject({ load: '72.5 kg', basis: 'last_session' });
  });
});
