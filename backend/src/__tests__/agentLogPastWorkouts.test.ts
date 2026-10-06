// log_past_workouts: a pasted history becomes a preview (nothing saved), then
// one confirmed batch. Parsing is faked; what's tested is the two-step flow,
// what the model and the card see, and that a batch can't land twice.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ user: { findUnique: vi.fn() }, workoutLog: { findMany: vi.fn() } }));
const h = vi.hoisted(() => ({ executeOp: vi.fn(), parse: vi.fn(), turnMessage: vi.fn() }));
vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) { Object.assign(this, db); }) }));
vi.mock('../agent/ops.js', () => ({ defineOp: vi.fn(), executeOp: (...a: unknown[]) => h.executeOp(...a), UNDO_DELETE_MS: 30000 }));
vi.mock('../services/workoutNotesParser.js', () => ({ parseWorkoutNotes: (...a: unknown[]) => h.parse(...a) }));
vi.mock('../agent/turnMessage.js', () => ({ turnMessage: (...a: unknown[]) => h.turnMessage(...a) }));
vi.mock('../agent/cards/store.js', () => ({ userTz: async () => 'America/New_York' }));
vi.mock('../agent/cards/format.js', async (orig) => ({ ...(await orig<any>()), todayIn: () => '2026-10-06' }));
vi.mock('../services/workoutLogService.js', () => ({ createWorkoutLog: vi.fn(), createWorkoutLogsBulk: vi.fn(), updateWorkoutLog: vi.fn(), deleteWorkoutLog: vi.fn(), restoreWorkoutLog: vi.fn() }));
vi.mock('../routes/strength.js', () => ({ computeStrengthProfile: vi.fn() }));
vi.mock('../services/cacheService.js', () => ({ cacheGet: vi.fn(), cacheDelete: vi.fn(), cacheClearByPrefix: vi.fn() }));
vi.mock('../adaptation/proposalService.js', () => ({ lastForExercises: vi.fn(), listPending: vi.fn() }));
vi.mock('../agent/loopback.js', () => ({ callApi: vi.fn() }));
vi.mock('../agent/registry.js', () => ({ registerToolkit: vi.fn() }));
vi.mock('../agent/toolkits/adaptation.js', () => ({ adaptationCard: vi.fn() }));

import { WORKOUT_TOOLS } from '../agent/toolkits/workouts.js';

const tool = WORKOUT_TOOLS.find((t) => t.name === 'log_past_workouts')!;
const ctx = { userId: 'u1', unit: 'imperial' as const, tz: 'America/New_York', today: '2026-10-06' };
const pw = (date: string | null, ...names: string[]) => ({ date, title: null, exercises: names.map((name) => ({ name, sets: 3, reps: '5', weight: 135, rpe: null, notes: null, bodyweight: false, setEntries: null })) });

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findUnique.mockResolvedValue({ unitPreference: 'imperial' });
  db.workoutLog.findMany.mockResolvedValue([]);
  h.turnMessage.mockReturnValue('july 15 bench 3x5 135 ...');
  h.parse.mockResolvedValue({ workouts: [pw('2026-07-15', 'Bench press'), pw('2026-07-17', 'Squat'), pw(null, 'Deadlift')], unparsed: [] });
  h.executeOp.mockResolvedValue({ summary: 'Logged · 2 past workouts', result: { created: [{ id: 'a', date: '2026-07-15', title: null, exercises: 1, prs: [] }, { id: 'b', date: '2026-07-17', title: null, exercises: 1, prs: ['Squat'] }], failed: [], skipped: 0, from: '2026-07-15', to: '2026-07-17' } });
});

describe('log_past_workouts', () => {
  it('previews from the user\'s own message without saving, and the card offers one Log tap', async () => {
    const r: any = await tool.execute({ useMessage: true }, 'u1');
    expect(h.parse).toHaveBeenCalledWith('july 15 bench 3x5 135 ...', 'imperial', '2026-10-06');
    expect(h.executeOp).not.toHaveBeenCalled();
    expect(r).toMatchObject({ mode: 'preview', toLog: 2, from: '2026-07-15', to: '2026-07-17', undated: [{ title: null, exercises: ['Deadlift'] }] });
    expect(r._inputs.map((i: any) => i.date)).toEqual(['2026-07-15', '2026-07-17']);
    expect(r._inputs[0].exercises[0]).toMatchObject({ name: 'Bench press', sets: 3, reps: '5' });
    const card: any = await tool.card!({}, r, ctx);
    expect(card.pattern).toBe('proposal');
    expect(card.rows).toHaveLength(2);
    expect(card.note).toMatch(/1 session without a date/);
    expect(card.pending.actions.apply).toEqual(expect.objectContaining({ op: 'workout.create_many', args: { inputs: r._inputs } }));
  });

  it('accepts sessions the agent already structured, alongside or instead of text', async () => {
    const r: any = await tool.execute({ workouts: [{ date: '2026-08-02', exercises: [{ name: 'Row', sets: 4, reps: '10', weight: 95 }] }] }, 'u1');
    expect(h.parse).not.toHaveBeenCalled();
    expect(r.sessions).toEqual([{ date: '2026-08-02', title: null, exercises: ['Row'] }]);
  });

  it('confirm logs the stored preview as one batch, once', async () => {
    const p: any = await tool.execute({ useMessage: true }, 'u1');
    const r: any = await tool.execute({ confirm: true, previewId: p.previewId }, 'u1');
    expect(h.executeOp).toHaveBeenCalledWith('u1', 'workout.create_many', { inputs: p._inputs });
    expect(r).toMatchObject({ mode: 'logged', count: 2, bestsAtTheTime: ['Squat'] });
    await expect(tool.execute({ confirm: true, previewId: p.previewId }, 'u1')).rejects.toThrow(/expired or was already logged/);
    expect(h.executeOp).toHaveBeenCalledTimes(1);
  });

  it('says so when there is nothing that reads as training', async () => {
    h.parse.mockResolvedValue({ workouts: [], unparsed: ['hello'] });
    await expect(tool.execute({ useMessage: true }, 'u1')).rejects.toThrow(/couldn’t find any workouts/);
  });
});
