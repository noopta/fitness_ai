// Log review taps end to end (in memory): Apply removes the extra copies as one
// reversible change, Undo restores them and returns the flag to pending, Keep
// suppresses the rule, and resolving the last flag posts Anakin's follow-up.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const db: Record<string, any[]> = { logFlag: [], agentCard: [], agentChange: [], workoutLog: [], user: [] };
let seq = 0;
const match = (row: any, where: any = {}) => Object.entries(where).every(([k, v]: [string, any]) => {
  if (v && typeof v === 'object' && 'in' in v) return v.in.includes(row[k]);
  return row[k] === v;
});
function model(name: string) {
  return {
    create: async ({ data }: any) => { const row = { id: data.id ?? `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), status: data.status ?? (name === 'logFlag' ? 'pending' : name === 'agentChange' ? 'applied' : 'live'), ...data }; db[name].push(row); return { ...row }; },
    createMany: async ({ data }: any) => { for (const d of data) db[name].push({ id: `${name}-${++seq}`, status: 'pending', detectedAt: new Date(), ...d }); return { count: data.length }; },
    update: async ({ where, data }: any) => { const row = db[name].find((r) => r.id === where.id); if (!row) throw new Error(`${name} not found`); Object.assign(row, data); return { ...row }; },
    updateMany: async ({ where, data }: any) => { const rows = db[name].filter((r) => match(r, where)); rows.forEach((r) => Object.assign(r, data)); return { count: rows.length }; },
    findFirst: async ({ where }: any) => { const r = db[name].find((row) => match(row, where)); return r ? { ...r } : null; },
    findUnique: async ({ where }: any) => { const r = db[name].find((row) => match(row, where)); return r ? { ...r } : null; },
    findMany: async ({ where }: any = {}) => db[name].filter((row) => match(row, where)).map((r) => ({ ...r })),
  };
}
vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) { for (const k of Object.keys(db)) this[k] = model(k); }) }));
vi.mock('../services/cacheService.js', () => ({ cacheDelete: vi.fn(), cacheClearByPrefix: vi.fn(), cacheGet: vi.fn(), cacheSet: vi.fn(), cacheMarkStale: vi.fn() }));
const appended: string[] = [];
vi.mock('../agent/conversation.js', () => ({ appendInitiated: vi.fn(async (_u: string, text: string) => { appended.push(text); }) }));
vi.mock('../routes/strength.js', () => ({ getStrengthProfileCached: vi.fn(async () => ({ lifts: [{ canonicalName: 'Bench Press', current1RM: 225, sessionCount: 9 }], unit: 'lb' })) }));
// The workout service behind workout.remove / workout.restore / workout.update.
vi.mock('../services/workoutLogService.js', () => ({
  deleteWorkoutLog: vi.fn(async (_u: string, id: string) => { const i = db.workoutLog.findIndex((r) => r.id === id); if (i < 0) return null; return db.workoutLog.splice(i, 1)[0]; }),
  restoreWorkoutLog: vi.fn(async (_u: string, row: any) => { db.workoutLog.push(row); return row; }),
  updateWorkoutLog: vi.fn(async (_u: string, id: string, input: any) => { const row = db.workoutLog.find((r) => r.id === id); if (!row) return null; const before = { ...row }; Object.assign(row, { ...input, exercises: JSON.stringify(input.exercises) }); return { before, updated: row }; }),
  createWorkoutLog: vi.fn(), createWorkoutLogsBulk: vi.fn(), addDays: vi.fn(),
}));

process.env.OPENAI_API_KEY ||= 'test';
const review = await import('../services/logReview/index.js');

const climb = (id: string, min: number) => ({ id, userId: 'u1', date: '2026-10-25', title: `Rock climbing · ${min} min`, duration: min, notes: null, exercises: JSON.stringify([{ name: 'Rock climbing', sets: 1, reps: String(min) }]), createdAt: new Date() });

beforeEach(async () => {
  for (const k of Object.keys(db)) db[k] = [];
  appended.length = 0;
  db.user = [{ id: 'u1', unitPreference: 'imperial', weightKg: 80 }];
  db.workoutLog = [climb('a', 150), climb('b', 150), climb('d', 120)];
  const card = { id: 'card1', userId: 'u1', fn: 'LOG-01', pattern: 'review', rule: 'show', status: 'live', payloadJson: JSON.stringify({ id: 'card1', fn: 'LOG-01', pattern: 'review', rule: 'show', state: { status: 'live' } }) };
  db.agentCard = [card];
  db.logFlag = [
    { id: 'f1', userId: 'u1', digestId: 'card1', type: 'conflict', ruleKey: 'conflict:a|b|d', entryIds: JSON.stringify(['a', 'b', 'd']), confidence: 'medium', reason: 'r', impact: null, title: 'Rock climbing: 3 versions', fix: 'Keep the latest version', before: 'x', after: 'y', doneLabel: 'Kept the latest version', suggestion: JSON.stringify({ op: 'delete', payload: { logIds: ['a', 'b'] } }), entryDate: '2026-10-25', status: 'pending' },
    { id: 'f2', userId: 'u1', digestId: 'card1', type: 'equipment', ruleKey: 'equipment:lateral raise', entryIds: JSON.stringify(['d#0']), confidence: 'medium', reason: 'r', impact: null, title: 'Lateral Raise at 135 lb', fix: 'Label it Machine Lateral Raise', before: 'x', after: 'y', doneLabel: 'Labelled machine', suggestion: JSON.stringify({ op: 'update', payload: { logId: 'd', index: 0, patch: { name: 'Machine Lateral Raise' } } }), entryDate: '2026-10-25', status: 'pending' },
  ];
});

describe('log review taps', () => {
  it('apply removes the extra copies in one change; undo puts them back and reopens the row', async () => {
    const card = await review.applyFlag('u1', 'f1');
    expect(db.workoutLog.map((r) => r.id)).toEqual(['d']);
    expect(card.review.rows.find((r: any) => r.id === 'f1').status).toBe('applied');
    expect(card.review.pending).toBe(1);
    await review.undoFlag('u1', 'f1');
    expect(db.workoutLog.map((r) => r.id).sort()).toEqual(['a', 'b', 'd']);
    expect(db.logFlag.find((f) => f.id === 'f1').status).toBe('pending');
  });

  it('pending flags keep their entries out of strength numbers; resolving brings them back', async () => {
    let ex = await review.excludedEntries('u1');
    expect([...ex].sort()).toEqual(['a', 'b', 'd#0']);
    await review.keepFlag('u1', 'f2');
    ex = await review.excludedEntries('u1');
    expect(ex.has('d#0')).toBe(false);
  });

  it('apply all resolves every row once, and Anakin follows up with counts and the e1RM', async () => {
    const card = await review.applyAll('u1', 'card1');
    expect(card.review.pending).toBe(0);
    expect(card.state).toMatchObject({ status: 'answered', line: 'Reviewed' });
    expect(JSON.parse(db.workoutLog[0].exercises)[0].name).toBe('Machine Lateral Raise');
    expect(appended).toEqual(['All reviewed — 2 corrected. Your Bench Press estimated max is now 225 lb.']);
    expect(db.logFlag.every((f) => f.resolvedVia === 'apply_all')).toBe(true);
  });

  it('a second tap on a resolved row is refused, not applied twice', async () => {
    await review.applyFlag('u1', 'f1');
    await expect(review.applyFlag('u1', 'f1')).rejects.toThrow(/Already fixed/);
  });
});
