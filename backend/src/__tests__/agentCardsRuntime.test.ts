// Agent-first card runtime: change log + undo windows, the write guard,
// card taps (apply / keep / typed confirm / undo / edit / answer), the
// 3-card cap, and the canonical coaching-profile alias mapping.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── In-memory stand-in for the handful of Prisma models these modules use ──
const db: Record<string, any[]> = { agentCard: [], agentChange: [], user: [] };
let seq = 0;
const match = (row: any, where: any = {}) => Object.entries(where).every(([k, v]) => {
  if (v && typeof v === 'object' && !(v instanceof Date) && 'not' in (v as any)) return row[k] !== (v as any).not;
  return row[k] === v;
});
function model(name: string) {
  return {
    create: async ({ data }: any) => { const row = { id: data.id ?? `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), status: data.status ?? (name === 'agentChange' ? 'applied' : 'live'), ...data }; db[name].push(row); return { ...row }; },
    update: async ({ where, data }: any) => { const row = db[name].find((r) => r.id === where.id); if (!row) throw new Error('not found'); Object.assign(row, data); return { ...row }; },
    findFirst: async ({ where }: any) => { const r = db[name].find((row) => match(row, where)); return r ? { ...r } : null; },
    findUnique: async ({ where }: any) => { const r = db[name].find((row) => match(row, where)); return r ? { ...r } : null; },
    findMany: async ({ where, take }: any = {}) => db[name].filter((row) => match(row, where)).slice().reverse().slice(0, take ?? 999).map((r) => ({ ...r })),
  };
}
vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) { this.agentCard = model('agentCard'); this.agentChange = model('agentChange'); this.user = model('user'); }) }));
vi.mock('../services/cacheService.js', () => ({ cacheDelete: vi.fn(), cacheClearByPrefix: vi.fn(), cacheGet: vi.fn(), cacheSet: vi.fn(), cacheMarkStale: vi.fn() }));

const ops = await import('../agent/ops.js');
const store = await import('../agent/cards/store.js');
const { capCards } = await import('../agent/turn.js');
const profile = await import('../agent/profile/coachProfile.js');

// A toy setting with an inverse, to exercise the machinery end to end.
const state: Record<string, string> = { units: 'lb' };
ops.defineOp({ name: 'test.set_units', run: async (_u, a) => { const prev = state.units; state.units = String(a.value); return { result: { display: state.units }, inverse: { op: 'test.set_units', args: { value: prev } }, summary: `Units · ${prev} → ${state.units}` }; } });
ops.defineOp({ name: 'test.send', run: async () => ({ inverse: null, summary: 'Sent' }) });

beforeEach(() => { db.agentCard = []; db.agentChange = []; db.user = [{ id: 'u1', timezone: 'UTC', coachProfile: null }]; state.units = 'lb'; });

describe('change log', () => {
  it('records the inverse and reverts it', async () => {
    const c = await ops.executeOp('u1', 'test.set_units', { value: 'kg' });
    expect(state.units).toBe('kg');
    expect(c.reversible).toBe(true);
    await ops.revertChange('u1', c.changeId);
    expect(state.units).toBe('lb');
    expect(db.agentChange[0].status).toBe('reverted');
  });
  it('refuses a card undo after the window, but chat can still reverse it', async () => {
    const c = await ops.executeOp('u1', 'test.set_units', { value: 'kg' }, { undoMs: -1 });
    await expect(ops.revertChange('u1', c.changeId)).rejects.toThrow(/undo window/);
    await ops.revertChange('u1', c.changeId, { ignoreWindow: true });
    expect(state.units).toBe('lb');
  });
  it('an irreversible op has no undo', async () => {
    const c = await ops.executeOp('u1', 'test.send', {});
    expect(c.reversible).toBe(false);
    await expect(ops.revertChange('u1', c.changeId)).rejects.toThrow(/can’t be undone/);
  });
  it('another user can’t revert my change', async () => {
    const c = await ops.executeOp('u1', 'test.set_units', { value: 'kg' });
    await expect(ops.revertChange('u2', c.changeId)).rejects.toThrow(/isn’t in your history/);
  });
});

describe('write guard', () => {
  it('a propose-kind tool cannot write', async () => {
    await expect(ops.withWriteGuard('deny', 'propose_x', () => ops.executeOp('u1', 'test.set_units', { value: 'kg' }))).rejects.toThrow(/can only propose/);
    expect(state.units).toBe('lb');
  });
});

describe('card taps', () => {
  const proposal = () => store.saveCard('u1', {
    fn: 'PRF-01', pattern: 'proposal', rule: 'propose', meta: { label: 'Proposed' },
    actions: [{ id: 'apply', label: 'Apply', kind: 'primary' }, { id: 'keep', label: 'Keep', kind: 'secondary' }],
    pending: { actions: { apply: { op: 'test.set_units', args: { value: 'kg' } }, keep: { kind: 'keep' } } },
  });

  it('Apply runs the stored op, then Undo reverses it', async () => {
    const card = await proposal();
    expect(state.units).toBe('lb');
    const applied = await store.applyCardAction('u1', card.id, 'apply');
    expect(state.units).toBe('kg');
    expect(applied.state?.status).toBe('applied');
    expect(applied.state?.line).toMatch(/^Applied /);
    const undone = await store.undoCard('u1', card.id);
    expect(undone.state?.status).toBe('undone');
    expect(state.units).toBe('lb');
  });
  it('a card can’t be applied twice, and Keep changes nothing', async () => {
    const card = await proposal();
    await store.applyCardAction('u1', card.id, 'keep');
    expect(state.units).toBe('lb');
    await expect(store.applyCardAction('u1', card.id, 'apply')).rejects.toThrow(/already been acted on/);
  });
  it('the client can’t name an action the card doesn’t have', async () => {
    const card = await proposal();
    await expect(store.applyCardAction('u1', card.id, 'delete_everything')).rejects.toThrow(/Unknown action/);
  });
  it('typed confirm blocks until DELETE', async () => {
    const card = await store.saveCard('u1', {
      fn: 'ACC-09', pattern: 'confirm', rule: 'confirm_delete',
      actions: [{ id: 'delete', label: 'Delete account', kind: 'destructive', requiresTyped: 'DELETE' }],
      pending: { actions: { delete: { op: 'test.send', args: {}, status: 'deleted' } } },
    });
    await expect(store.applyCardAction('u1', card.id, 'delete', { typed: 'delete' })).rejects.toThrow(/Type DELETE/);
    const done = await store.applyCardAction('u1', card.id, 'delete', { typed: 'DELETE' });
    expect(done.state?.status).toBe('deleted');
  });
  it('a Logged card made with a change gets Undo automatically', async () => {
    const change = await ops.executeOp('u1', 'test.set_units', { value: 'kg' });
    const card = await store.saveCard('u1', { fn: 'PRF-01', pattern: 'setting', rule: 'change_undo', change: { key: 'Units', from: 'lb', to: 'kg' } }, { change });
    expect(card.actions?.some((a) => a.id === 'undo')).toBe(true);
    expect(card.state?.undoUntil).toBeTruthy();
    await store.applyCardAction('u1', card.id, 'undo');
    expect(state.units).toBe('lb');
  });
  it('inline edit runs the edit op and records the old value', async () => {
    const card = await store.saveCard('u1', {
      fn: 'PRF-01', pattern: 'glance', rule: 'show', rows: [{ key: 'Units', value: 'lb', editable: { field: 'units', kind: 'text' } }],
      pending: { edits: { units: { op: 'test.set_units', args: {}, valueKey: 'value', parse: 'text' } } },
    });
    const edited = await store.editCardField('u1', card.id, 'units', 'kg');
    expect(state.units).toBe('kg');
    expect(edited.rows?.[0]).toMatchObject({ value: 'kg', was: 'lb' });
    expect(edited.state?.line).toBe('Corrected — lb → kg');
  });
  it('an Ask answer without an op comes back as the next message', async () => {
    const card = await store.saveCard('u1', { fn: 'WEL-01', pattern: 'ask', rule: 'show', ask: { q: 'How did you sleep?', options: ['Well', 'Okay', 'Badly'] }, pending: { answer: { asMessage: 'I slept {answer}.' } } });
    const r = await store.answerCard('u1', card.id, { option: 2 });
    expect(r.sendAsMessage).toBe('I slept Badly.');
    expect(r.card.state?.status).toBe('answered');
  });
  it('a capture answer swaps in the next card, which owns the Undo', async () => {
    ops.defineOp({ name: 'test.capture', run: async (_u, a) => ({
      result: { nextCard: { fn: 'NUT-02', pattern: 'logged', rule: 'log_undo', rows: [{ key: 'Bowl', value: '520 kcal' }] }, nextOwnsChange: true, line: 'Logged — Bowl' },
      inverse: { op: 'test.send', args: {} }, summary: `Logged ${a.value}`,
    }) });
    const card = await store.saveCard('u1', { fn: 'NUT-02', pattern: 'capture', rule: 'handoff', pending: { answer: { op: 'test.capture', valueKey: 'value' } } });
    const r = await store.answerCard('u1', card.id, { text: 'meal-1' });
    expect(r.card.state).toMatchObject({ status: 'answered', line: 'Logged — Bowl' });
    expect(r.card.state?.changeId).toBeUndefined();
    expect(r.next?.pattern).toBe('logged');
    expect(r.next?.state?.changeId).toBeTruthy();
    expect(r.next?.actions?.some((x) => x.kind === 'undo')).toBe(true);
    expect(r.sendAsMessage).toBeUndefined();
  });
  it('rewriting a draft changes the body and what Send sends', async () => {
    const card = await store.saveCard('u1', { fn: 'SOC-12', pattern: 'draft', rule: 'draft_send', draft: { to: 'Sam', audience: 'Only Sam', body: 'hey' },
      pending: { actions: { send: { op: 'test.send', args: { recipientId: 'x', body: 'hey' } }, cancel: { kind: 'cancel' } } } });
    const edited = await store.editDraftBody('u1', card.id, '  see you at 6  ');
    expect(edited.draft?.body).toBe('see you at 6');
    const row = db.agentCard.find((r) => r.id === card.id);
    expect(JSON.parse(row.pendingJson).actions.send.args.body).toBe('see you at 6');
    await expect(store.editDraftBody('u1', card.id, '   ')).rejects.toThrow();
  });
  it('a newer card for the same entity replaces the older one', async () => {
    const a = await store.saveCard('u1', { fn: 'ADP-01', pattern: 'proposal', rule: 'propose', entity: 'adapt:bench' });
    await store.saveCard('u1', { fn: 'ADP-01', pattern: 'proposal', rule: 'propose', entity: 'adapt:bench' });
    const old = await store.getCard('u1', a.id);
    expect(old.state?.status).toBe('replaced');
  });
});

describe('card cap', () => {
  it('never collapses a card awaiting a tap', async () => {
    const mk = (pattern: any, label: string) => store.saveCard('u1', { fn: 'X', pattern, rule: 'show', meta: { label } });
    const cards = [await mk('glance', 'g1'), await mk('glance', 'g2'), await mk('glance', 'g3'), await mk('proposal', 'p1')];
    const shown = await capCards('u1', cards);
    expect(shown.length).toBe(3);
    expect(shown.some((c) => c.meta?.label === 'p1')).toBe(true);
    expect(shown[shown.length - 1].meta?.label).toMatch(/more change/);
  });
});

describe('coaching profile canonical keys', () => {
  it('reads mobile intake keys through aliases', () => {
    const blob = { obstacle: 'no_plan', biologicalSex: 'prefer_not', sleepQuality: 'decent', equipment: 'full_gym', parq: ['heart', 'none'], trainingStyle: 'muscle' };
    expect(profile.readField(blob, profile.FIELD_BY_KEY.obstacle)).toBe('no_right_plan');
    expect(profile.readField(blob, profile.FIELD_BY_KEY.sex)).toBe('prefer_not_to_say');
    expect(profile.readField(blob, profile.FIELD_BY_KEY.sleep)).toBe('ok');
    expect(profile.readField(blob, profile.FIELD_BY_KEY.equipment)).toBe('commercial');
    expect(profile.readField(blob, profile.FIELD_BY_KEY.parq)).toEqual(['heart_condition', 'none']);
    expect(profile.readField(blob, profile.FIELD_BY_KEY.trainingStyle)).toBe('hypertrophy');
  });
  it('accepts labels and rejects values outside the options', () => {
    expect(profile.normaliseValue(profile.FIELD_BY_KEY.equipment, 'Full gym')).toBe('commercial');
    expect(profile.normaliseValue(profile.FIELD_BY_KEY.daysPerWeek, '4')).toBe(4);
    expect(() => profile.normaliseValue(profile.FIELD_BY_KEY.daysPerWeek, 9)).toThrow(/between 2 and 7/);
    expect(() => profile.normaliseValue(profile.FIELD_BY_KEY.sleep, 'amazing')).toThrow(/must be one of/);
  });
  it('writes by merging — nutrition, consent and welcome keys survive', async () => {
    db.user[0].coachProfile = JSON.stringify({ primaryGoal: 'Strength', nutrition: { mealsPerDay: 3 }, consent: { health: false }, welcomeMessage: 'hi', obstacle: 'time' });
    const { previous } = await profile.writeFields('u1', { goal: 'Half marathon', obstacle: 'motivation' });
    const blob = JSON.parse(db.user[0].coachProfile);
    expect(blob.primaryGoal).toBe('Half marathon');
    expect(blob.obstacleToConsistency).toBe('motivation');
    expect(blob.obstacle).toBeUndefined();
    expect(blob.nutrition).toEqual({ mealsPerDay: 3 });
    expect(blob.consent).toEqual({ health: false });
    expect(blob.welcomeMessage).toBe('hi');
    expect(db.user[0].coachGoal).toBe('Half marathon');
    expect(previous).toEqual({ goal: 'Strength', obstacle: 'time' });
  });
  it('injuries write to both the blob and constraintsText', async () => {
    await profile.writeInjuries('u1', [{ area: 'Left shoulder', note: 'overhead press' }, { area: 'Knee', resolvedAt: '2026-09-01' }]);
    const blob = JSON.parse(db.user[0].coachProfile);
    expect(blob.injuries).toBe('Left shoulder — overhead press');
    expect(db.user[0].constraintsText).toBe('Left shoulder — overhead press');
    expect(blob.injuryList).toHaveLength(2);
  });
});
