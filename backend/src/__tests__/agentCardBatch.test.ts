// Batch cards (past workouts, WRK-13): the tap carries ticks and dates over
// the sessions the card already holds; the op can patch the card (bests, the
// Logged line); Undo leaves Redo open for the rest of the window.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const db: Record<string, any[]> = { agentCard: [], agentChange: [], user: [] };
let seq = 0;
const match = (row: any, where: any = {}) => Object.entries(where).every(([k, v]) => row[k] === v);
function model(name: string) {
  return {
    create: async ({ data }: any) => { const row = { id: data.id ?? `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), status: data.status ?? (name === 'agentChange' ? 'applied' : 'live'), ...data }; db[name].push(row); return { ...row }; },
    update: async ({ where, data }: any) => { const row = db[name].find((r) => r.id === where.id); if (!row) throw new Error('not found'); Object.assign(row, data); return { ...row }; },
    findFirst: async ({ where }: any) => { const r = db[name].find((row) => match(row, where)); return r ? { ...r } : null; },
    findUnique: async ({ where }: any) => { const r = db[name].find((row) => match(row, where)); return r ? { ...r } : null; },
    findMany: async ({ where, take }: any = {}) => db[name].filter((row) => match(row, where)).slice().reverse().slice(0, take ?? 999).map((r) => ({ ...r })),
  };
}
vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) { this.agentCard = model('agentCard'); this.agentChange = model('agentChange'); this.user = model('user'); this.workoutLog = { findMany: async () => [] }; }) }));
vi.mock('../services/cacheService.js', () => ({ cacheDelete: vi.fn(), cacheClearByPrefix: vi.fn(), cacheGet: vi.fn(), cacheSet: vi.fn(), cacheMarkStale: vi.fn() }));

const ops = await import('../agent/ops.js');
const store = await import('../agent/cards/store.js');

// A stand-in for workout.create_many: records what it logged, reverses by removing.
const logged: any[][] = [];
ops.defineOp({
  name: 'test.log_many',
  run: async (_u, a) => {
    const inputs = a.inputs as any[];
    logged.push(inputs);
    return { result: { stateLine: `Logged ${inputs.length} workout${inputs.length === 1 ? "" : "s"}`, cardPatch: { meta: { open: { page: 'history' } }, batch: { bests: '1 was a best at the time — squat 230 × 5.' } } }, inverse: { op: 'test.unlog', args: {} }, summary: 'Logged' };
  },
});
ops.defineOp({ name: 'test.unlog', run: async () => ({ inverse: null, summary: 'Removed' }) });

const inputs = [
  { date: '2026-07-15', title: 'Push', exercises: [{ name: 'Bench press', sets: 3, reps: '5', weightKg: 100 }] },
  { date: '2026-07-17', title: 'Legs', exercises: [{ name: 'Squat', sets: 3, reps: '5', weightKg: 102 }] },
  { date: null, title: 'Push', exercises: [{ name: 'Dips', sets: 3, reps: '8' }] },
];
const batchCard = () => store.saveCard('u1', {
  fn: 'WRK-13', pattern: 'proposal', rule: 'propose', meta: { label: 'Past workouts · 15 Jul – 17 Jul' },
  batch: { kind: 'list', selectable: true, sessions: [] },
  actions: [{ id: 'apply', label: 'Log 2 workouts', kind: 'primary' }, { id: 'keep', label: 'Not now', kind: 'secondary' }],
  undoLine: 'Undone — those workouts are out of your log',
  pending: { actions: { apply: { op: 'test.log_many', args: { inputs, previewId: 'p1' }, status: 'applied' }, keep: { kind: 'keep', line: 'Not logged' } }, batch: { action: 'apply' } },
});

beforeEach(() => { db.agentCard = []; db.agentChange = []; db.user = [{ id: 'u1', timezone: 'UTC' }]; logged.length = 0; });

describe('batch card apply', () => {
  it('logs the dated sessions by default; undated stays out', async () => {
    const c = await batchCard();
    const out = await store.applyCardAction('u1', c.id, 'apply');
    expect(logged[0].map((x) => x.date)).toEqual(['2026-07-15', '2026-07-17']);
    expect(out.state).toMatchObject({ status: 'applied', line: 'Logged 2 workouts' });
    expect(out.meta).toEqual({ label: 'Past workouts · 15 Jul – 17 Jul', open: { page: 'history' } });
    expect(out.batch).toMatchObject({ kind: 'list', bests: '1 was a best at the time — squat 230 × 5.' });
  });

  it('applies ticks and a date for the undated row', async () => {
    const c = await batchCard();
    await store.applyCardAction('u1', c.id, 'apply', { selection: { skip: [0], dates: { '2': '2026-07-20' } } });
    expect(logged[0].map((x) => [x.date, x.title])).toEqual([['2026-07-17', 'Legs'], ['2026-07-20', 'Push']]);
  });

  it('ignores a date for a session that already has one, and future dates', async () => {
    const c = await batchCard();
    await store.applyCardAction('u1', c.id, 'apply', { selection: { dates: { '0': '2026-01-01', '2': '2999-01-01' } } });
    expect(logged[0].map((x) => x.date)).toEqual(['2026-07-15', '2026-07-17']);
  });

  it('refuses a tap with nothing left to log', async () => {
    const c = await batchCard();
    await expect(store.applyCardAction('u1', c.id, 'apply', { selection: { skip: [0, 1] } })).rejects.toThrow(/Tick at least one/);
    expect(logged).toHaveLength(0);
  });

  it('Not now freezes the card as Not logged', async () => {
    const c = await batchCard();
    const out = await store.applyCardAction('u1', c.id, 'keep');
    expect(out.state).toMatchObject({ status: 'kept', line: 'Not logged' });
  });
});

describe('undo and redo', () => {
  it('Undo leaves Redo open; Redo runs the same batch again', async () => {
    const c = await batchCard();
    await store.applyCardAction('u1', c.id, 'apply', { selection: { skip: [1] } });
    const undone = await store.applyCardAction('u1', c.id, 'undo');
    expect(undone.state).toMatchObject({ status: 'undone', line: 'Undone — those workouts are out of your log' });
    expect(Date.parse(undone.state!.redoUntil!)).toBeGreaterThan(Date.now());
    const redone = await store.applyCardAction('u1', c.id, 'redo');
    expect(redone.state).toMatchObject({ status: 'applied', line: 'Logged 1 workout' });
    expect(logged).toHaveLength(2);
    expect(logged[1]).toEqual(logged[0]); // the same selection, not the whole preview
  });

  it('no Redo on a card that was never applied, or once the window has passed', async () => {
    const c = await batchCard();
    await expect(store.applyCardAction('u1', c.id, 'redo')).rejects.toThrow(/Nothing to redo/);
    await store.applyCardAction('u1', c.id, 'apply');
    const row = db.agentCard.find((r) => r.id === c.id)!;
    const card = JSON.parse(row.payloadJson);
    card.state.undoUntil = new Date(Date.now() - 1000).toISOString();
    row.payloadJson = JSON.stringify(card);
    db.agentChange[0].undoUntil = new Date(Date.now() + 60_000);
    const undone = await store.undoCard('u1', c.id);
    expect(undone.state?.redoUntil).toBeUndefined();
  });

  it('findLiveCard finds the preview a "yes" in chat refers to', async () => {
    const c = await batchCard();
    const hit = await store.findLiveCard('u1', 'WRK-13', (p) => (p.actions?.apply as any)?.args?.previewId === 'p1');
    expect(hit?.id).toBe(c.id);
    expect(await store.findLiveCard('u1', 'WRK-13', (p) => (p.actions?.apply as any)?.args?.previewId === 'nope')).toBeNull();
  });
});
