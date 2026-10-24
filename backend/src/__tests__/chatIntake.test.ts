// New-user program intake in chat (Oct 2026): one question per card, the
// two-ways choice when the intake is empty, and "change my username" asking
// on a card instead of in words.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const db: Record<string, any[]> = { agentCard: [], agentChange: [], user: [] };
let seq = 0;
const match = (row: any, where: any = {}) => Object.entries(where).every(([k, v]) => row[k] === v);
function model(name: string) {
  return {
    create: async ({ data }: any) => { const row = { id: data.id ?? `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), status: 'applied', ...data }; db[name].push(row); return { ...row }; },
    update: async ({ where, data }: any) => { const row = db[name].find((r) => r.id === where.id); if (!row) throw new Error('not found'); Object.assign(row, data); return { ...row }; },
    findFirst: async ({ where }: any) => { const r = db[name].find((row) => match(row, where)); return r ? { ...r } : null; },
    findUnique: async ({ where }: any) => { const r = db[name].find((row) => match(row, where)); return r ? { ...r } : null; },
    findMany: async ({ where, take }: any = {}) => db[name].filter((row) => match(row, where)).slice(0, take ?? 999).map((r) => ({ ...r })),
    count: async () => 0,
  };
}
vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) { this.agentCard = model('agentCard'); this.agentChange = model('agentChange'); this.user = model('user'); }) }));
vi.mock('../services/cacheService.js', () => ({ cacheDelete: vi.fn(), cacheClearByPrefix: vi.fn(), cacheGet: vi.fn(), cacheSet: vi.fn(), cacheMarkStale: vi.fn() }));
vi.mock('../agent/loopback.js', () => ({ callApi: vi.fn(async () => ({ available: true })) }));

process.env.OPENAI_API_KEY ||= 'test';
const ops = await import('../agent/ops.js');
const intake = await import('../agent/toolkits/intake.js');
const { ACCOUNT_TOOLS } = await import('../agent/toolkits/account.js');
const next = intake.INTAKE_TOOLS.find((t) => t.name === 'next_intake_question')!;
const updateAccount = ACCOUNT_TOOLS.find((t) => t.name === 'update_account')!;

beforeEach(() => {
  db.agentCard = []; db.agentChange = [];
  db.user = [{ id: 'u1', timezone: 'UTC', coachProfile: null, coachGoal: null, trainingAge: null, equipment: null, coachBudget: null, constraintsText: null, name: 'Rish Ramez', username: null }];
});

const ask = async () => { const r: any = await next.execute({}, 'u1', {} as any); return { r, card: next.card!({}, r) as any }; };
const answer = (key: string, value: string) => ops.executeOp('u1', 'profile.intake_answer', { key, value });

describe('chat intake: one question at a time', () => {
  it('starts with the goal, as a tappable card that saves and posts the answer', async () => {
    const { r, card } = await ask();
    expect(r.asking).toBe('goal');
    expect(card.pattern).toBe('ask');
    expect(card.meta.label).toBe('Your program · 1 of 7');
    expect(card.ask.typeInstead).toBe(true);
    expect(card.pending.answer).toEqual({ op: 'profile.intake_answer', args: { key: 'goal' }, valueKey: 'value', asMessage: 'My goal: {answer}.' });
  });

  it('walks every step, saving each answer to the profile, then says build', async () => {
    await answer('goal', 'Get stronger');
    expect((await ask()).r.asking).toBe('trainingAge');
    await answer('trainingAge', '1–3 years');
    await answer('daysPerWeek', '4');
    await answer('sessionMinutes', '60 min');
    await answer('equipment', 'Full gym');
    expect((await ask()).r.asking).toBe('injuries');
    await answer('injuries', 'Nothing to work around');
    expect((await ask()).r.asking).toBe('health');
    await answer('health', 'No');
    const { r, card } = await ask();
    expect(r.complete).toBe(true);
    expect(r.healthFlag).toBe(false);
    expect(r.instruction).toMatch(/propose_new_program, confirmed=true/);
    expect(card).toBeNull();
    const blob = JSON.parse(db.user[0].coachProfile);
    expect(blob.daysPerWeek).toBe('4');
    expect(blob.sessionDuration).toBe('60');
    expect(db.user[0].trainingAge).toBe('intermediate');
    expect(db.user[0].equipment).toBe('commercial');
  });

  it('a yes on the health question stops the build and offers the interview', async () => {
    for (const [k, v] of [['goal', 'Lose fat'], ['trainingAge', 'Under 6 months'], ['daysPerWeek', '3'], ['sessionMinutes', '45 min'], ['equipment', 'Dumbbells only'], ['injuries', 'Nothing to work around'], ['health', 'Yes']]) await answer(k, v);
    const { r, card } = await ask();
    expect(r.healthFlag).toBe(true);
    expect(r.instruction).toMatch(/Do not build/);
    expect(card.actions[0].client).toEqual({ action: 'open_page', args: { page: 'intake' } });
  });

  it('a reported injury is flagged for update_injuries', async () => {
    for (const [k, v] of [['goal', 'Build muscle'], ['trainingAge', '3+ years'], ['daysPerWeek', '5'], ['sessionMinutes', '90 min'], ['equipment', 'Home — barbell'], ['injuries', 'left knee hurts on squats']]) await answer(k, v);
    const { r } = await ask();
    expect(r.asking).toBe('health');
    expect(r.instruction).toMatch(/update_injuries/);
  });

  it('turns tapped labels into field values', () => {
    expect(intake.fieldValue('sessionMinutes', '45 min')).toBe(45);
    expect(intake.fieldValue('daysPerWeek', '4 days')).toBe(4);
    expect(() => intake.fieldValue('daysPerWeek', 'a few')).toThrow();
  });
});

describe('the two ways to build', () => {
  it('offers answering here or the intake interview', () => {
    const c: any = intake.buildChoiceCard();
    expect(c.actions.map((a: any) => a.client)).toEqual([
      { action: 'send_message', args: { text: 'Let’s build it here, one question at a time.' } },
      { action: 'open_page', args: { page: 'intake' } },
    ]);
  });
});

describe('change my username', () => {
  it('without a new name, the card asks for it (with suggestions) instead of a question in words', async () => {
    const r: any = await updateAccount.execute({ field: 'username' }, 'u1', {} as any);
    expect(r.askValue).toBe(true);
    const card: any = updateAccount.card!({ field: 'username' }, r);
    expect(card.pattern).toBe('ask');
    expect(card.ask.typeInstead).toBe(true);
    expect(card.ask.options.length).toBeGreaterThan(0);
    expect(card.pending.answer).toEqual({ op: 'account.set', args: { field: 'username' }, valueKey: 'value' });
  });
});
