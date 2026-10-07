// log_past_workouts: a pasted history becomes a preview (nothing saved), then
// one confirmed batch. Parsing is faked; what's tested is the two-step flow,
// what the model and the card see, and that a batch can't land twice.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ user: { findUnique: vi.fn() }, workoutLog: { findMany: vi.fn() } }));
const h = vi.hoisted(() => ({ executeOp: vi.fn(), parse: vi.fn(), turnMessage: vi.fn(), findLiveCard: vi.fn(), applyCardAction: vi.fn() }));
vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) { Object.assign(this, db); }) }));
vi.mock('../agent/ops.js', () => ({ defineOp: vi.fn(), executeOp: (...a: unknown[]) => h.executeOp(...a), UNDO_DELETE_MS: 30000 }));
vi.mock('../services/workoutNotesParser.js', () => ({ parseWorkoutNotes: (...a: unknown[]) => h.parse(...a) }));
vi.mock('../agent/turnMessage.js', () => ({ turnMessage: (...a: unknown[]) => h.turnMessage(...a) }));
vi.mock('../agent/cards/store.js', () => ({ userTz: async () => 'America/New_York', findLiveCard: (...a: unknown[]) => h.findLiveCard(...a), applyCardAction: (...a: unknown[]) => h.applyCardAction(...a) }));
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
  h.findLiveCard.mockResolvedValue(null);
  h.parse.mockResolvedValue({ workouts: [pw('2026-07-15', 'Bench press'), pw('2026-07-17', 'Squat'), pw(null, 'Deadlift')], unparsed: [] });
  h.executeOp.mockResolvedValue({ summary: 'Logged · 2 past workouts', result: { created: [{ id: 'a', date: '2026-07-15', title: null, exercises: 1, prs: [] }, { id: 'b', date: '2026-07-17', title: null, exercises: 1, prs: ['Squat'] }], failed: [], skipped: 0, from: '2026-07-15', to: '2026-07-17' } });
});

describe('log_past_workouts', () => {
  it('previews from the user\'s own message without saving: a list card with ticks, the undated row last', async () => {
    const r: any = await tool.execute({ useMessage: true }, 'u1');
    expect(h.parse).toHaveBeenCalledWith('july 15 bench 3x5 135 ...', 'imperial', '2026-10-06');
    expect(h.executeOp).not.toHaveBeenCalled();
    expect(r).toMatchObject({ mode: 'preview', toLog: 2, found: 3, from: '2026-07-15', to: '2026-07-17', undated: [{ title: null, exercises: ['Deadlift'] }] });
    const card: any = await tool.card!({}, r, ctx);
    expect(card.pattern).toBe('proposal');
    expect(card.meta.label).toBe('Past workouts · 15 Jul – 17 Jul');
    expect(card.batch.kind).toBe('list');
    expect(card.batch.selectable).toBe(true);
    expect(card.batch.sessions.map((x: any) => [x.i, x.day, x.count])).toEqual([[0, 'Wed 15 Jul', '1 lift'], [1, 'Fri 17 Jul', '1 lift'], [2, null, '1 lift']]);
    expect(card.batch.sessions[0].detail).toEqual([{ name: 'Bench press', value: '3 × 5 · 135 lb' }]);
    expect(card.actions[0]).toMatchObject({ id: 'apply', label: 'Log 2 workouts' });
    expect(card.pending.batch).toEqual({ action: 'apply' });
    expect(card.pending.actions.apply.args.inputs.map((x: any) => x.date)).toEqual(['2026-07-15', '2026-07-17', null]);
    expect(card.pending.actions.keep).toEqual({ kind: 'keep', line: 'Not logged' });
    expect(tool.refine!(r, {})).toEqual({ verb: 'Read', text: 'Workout history · 3 sessions' });
  });

  it('the reading receipt counts the characters it is reading', () => {
    h.turnMessage.mockReturnValue('x'.repeat(2140));
    expect(tool.receipt!({ useMessage: true }, 'u1')).toEqual({ verb: 'Reading', text: 'Your notes · 2,140 characters' });
  });

  it('accepts sessions the agent already structured', async () => {
    const r: any = await tool.execute({ workouts: [{ date: '2026-08-02', exercises: [{ name: 'Row', sets: 4, reps: '10', weight: 95 }] }] }, 'u1');
    expect(h.parse).not.toHaveBeenCalled();
    expect(r.sessions).toEqual([{ date: '2026-08-02', title: null, exercises: ['Row'] }]);
  });

  it('a "yes" in chat logs through the preview card, which flips in the thread', async () => {
    const p: any = await tool.execute({ useMessage: true }, 'u1');
    const applied = { id: 'card1', state: { status: 'applied', line: 'Logged 2 workouts' }, batch: { sessions: [{ date: '2026-07-15' }, { date: '2026-07-17' }, { date: null }], bests: '1 was a best at the time — squat 225 × 5.' } };
    h.findLiveCard.mockResolvedValue({ id: 'card1' });
    h.applyCardAction.mockResolvedValue(applied);
    const r: any = await tool.execute({ confirm: true, previewId: p.previewId }, 'u1');
    expect(h.applyCardAction).toHaveBeenCalledWith('u1', 'card1', 'apply');
    expect(h.executeOp).not.toHaveBeenCalled();
    expect(r).toMatchObject({ mode: 'logged', count: 2, from: '2026-07-15', to: '2026-07-17', bests: applied.batch.bests });
    expect(r._cardUpdates).toEqual([applied]);
    expect(await tool.card!({}, r, ctx)).toBeNull();
    expect(tool.refine!(r, {})).toEqual({ verb: 'Logged', text: '2 past workouts · 15 Jul – 17 Jul' });
  });

  it('with no card (classic app) confirm logs the stored preview once', async () => {
    const p: any = await tool.execute({ useMessage: true }, 'u1');
    const r: any = await tool.execute({ confirm: true, previewId: p.previewId }, 'u1');
    expect(h.executeOp).toHaveBeenCalledWith('u1', 'workout.create_many', { inputs: p._preview.ready, unit: 'imperial' });
    expect(r).toMatchObject({ mode: 'logged', count: 2 });
    await expect(tool.execute({ confirm: true, previewId: p.previewId }, 'u1')).rejects.toThrow(/expired or was already logged/);
  });

  it('re-previews without a skipped week', async () => {
    h.parse.mockResolvedValue({ workouts: [pw('2026-07-15', 'Bench press'), pw('2026-07-21', 'Squat'), pw('2026-07-23', 'Row')], unparsed: [] });
    const p: any = await tool.execute({ useMessage: true }, 'u1');
    const r: any = await tool.execute({ previewId: p.previewId, skipWeeksOf: ['2026-07-23'] }, 'u1');
    expect(r.previewId).not.toBe(p.previewId);
    expect(r.sessions.map((x: any) => x.date)).toEqual(['2026-07-15']);
    const card: any = await tool.card!({}, r, ctx);
    expect(card.entity).toBe('workouts:backfill'); // replaces the older preview card
  });

  it('nothing that reads as training: no card, one line to say', async () => {
    h.parse.mockResolvedValue({ workouts: [], unparsed: ['felt tired'] });
    const r: any = await tool.execute({ useMessage: true }, 'u1');
    expect(r).toMatchObject({ mode: 'none' });
    expect(r.say).toMatch(/couldn’t find any workouts/);
    expect(await tool.card!({}, r, ctx)).toBeNull();
    expect(tool.refine!(r, {})).toEqual({ verb: 'Read', text: 'Your notes · no workouts' });
  });

  it('everything already logged: the nothing-new card with Open history', async () => {
    db.workoutLog.findMany.mockResolvedValue([
      { date: '2026-07-15', exercises: JSON.stringify([{ name: 'Bench press' }]) },
      { date: '2026-07-17', exercises: JSON.stringify([{ name: 'Squat' }]) },
    ]);
    h.parse.mockResolvedValue({ workouts: [pw('2026-07-15', 'Bench press'), pw('2026-07-17', 'Squat')], unparsed: [] });
    const r: any = await tool.execute({ useMessage: true }, 'u1');
    const card: any = await tool.card!({}, r, ctx);
    expect(card).toMatchObject({ pattern: 'glance', meta: { label: 'Past workouts' }, empty: 'All 2 sessions are already in your log (15 Jul – 17 Jul). Nothing to add.' });
    expect(card.actions[0].client).toEqual({ action: 'open_page', args: { page: 'history' } });
  });
});
