// B3 · the outcome report: five states, honest copy, the right decision per state.
import { describe, it, expect, vi } from 'vitest';

vi.mock('@prisma/client', async () => ({ PrismaClient: (await import('./helpers/memPrisma.js')).PrismaClient }));
vi.mock('../services/cacheService.js', () => ({ cacheDelete: vi.fn(), cacheClearByPrefix: vi.fn(), cacheGet: vi.fn(), cacheSet: vi.fn(), cacheMarkStale: vi.fn() }));

const O = await import('../proactive/outcome.js');

const kg = (lb: number) => lb / 2.20462;
const pts = (start: string, vals: number[]) => vals.map((v, i) => ({ date: new Date(Date.parse(`${start}T00:00:00Z`) + i * 3 * 86_400_000).toISOString().slice(0, 10), e1rmKg: kg(v) }));
const base = (over: Partial<O.OutcomeInput> = {}): O.OutcomeInput => ({
  title: 'the second pull day', lift: 'Chest-supported row', unit: 'lb', startDate: '2026-10-09', today: '2026-10-30',
  before: pts('2026-09-18', [137, 139, 138, 140, 139, 140]), after: pts('2026-10-10', [141, 143, 144, 146, 147, 148]),
  needed: 6, flagsAfter: 0, flagsBefore: 1, confounders: [], ...over,
});

describe('classifyOutcome', () => {
  it('fits: up more than the normal swing, no flags, nothing else moved', () => {
    const r = O.classifyOutcome(base());
    expect(r.state).toBe('fits');
    expect(Math.round(r.pct * 100)).toBe(6);
    expect(r.rateAfter! > r.rateBefore!).toBe(true);
  });
  it('too few: fewer sessions than needed', () => {
    expect(O.classifyOutcome(base({ after: pts('2026-10-10', [141, 143]) })).state).toBe('too_few');
  });
  it('no change: inside the normal session-to-session swing', () => {
    expect(O.classifyOutcome(base({ after: pts('2026-10-10', [139, 141, 140, 141, 140, 141]) })).state).toBe('no_change');
  });
  it('worse: down more than the swing, or the exercise flagged twice', () => {
    expect(O.classifyOutcome(base({ after: pts('2026-10-10', [136, 135, 134, 133, 134, 133]) })).state).toBe('worse');
    expect(O.classifyOutcome(base({ flagsAfter: 2 })).state).toBe('worse');
  });
  it('confounded: up, but something else changed the same week', () => {
    expect(O.classifyOutcome(base({ confounders: [{ label: 'protein', delta: 'up 40 g a day', from: '2026-10-10' }] })).state).toBe('confounded');
  });
  it('the swing floor is 2%; the weekly rate is a slope', () => {
    expect(O.normalSwing(pts('2026-09-18', [140, 140, 140]))).toBe(0.02);
    expect(O.weeklyRate([{ date: '2026-10-01', e1rmKg: 100 }, { date: '2026-10-08', e1rmKg: 101 }, { date: '2026-10-15', e1rmKg: 102 }])).toBeCloseTo(1, 5);
    expect(O.weeklyRate([{ date: '2026-10-01', e1rmKg: 100 }])).toBeNull();
  });
});

describe('copy and card', () => {
  it('says "fits", never "worked", and asks the one decision', () => {
    const i = base(); const r = O.classifyOutcome(i);
    const h = O.outcomeHeadline(i, r);
    expect(h).toBe('Three weeks with the second pull day: row up 6%, no flags. That fits it working — it doesn\'t prove it. Keep it?');
    expect(h).not.toMatch(/\bworked\b/);
  });
  it('the other four outcomes have their own honest lines', () => {
    const few = base({ after: pts('2026-10-10', [141, 143]) });
    expect(O.outcomeHeadline(few, O.classifyOutcome(few))).toBe('Too early to call the second pull day — you\'ve logged 2 of the 6 I need.');
    expect(O.outcomeSub(few, O.classifyOutcome(few))).toBe('I\'ll look again on Nov 13. Nothing changes until then.');
    const flat = base({ after: pts('2026-10-10', [139, 141, 140, 141, 140, 141]) });
    expect(O.outcomeHeadline(flat, O.classifyOutcome(flat))).toMatch(/^Three weeks in, row is flat: 140 → 141 lb\.$/);
    expect(O.outcomeSub(flat, O.classifyOutcome(flat))).toMatch(/inside your normal session-to-session swing/);
    const worse = base({ flagsAfter: 2 });
    expect(O.outcomeHeadline(worse, O.classifyOutcome(worse))).toMatch(/you flagged it 2 times/);
    const conf = base({ confounders: [{ label: 'protein', delta: 'up 40 g a day', from: '2026-10-10' }] });
    expect(O.outcomeHeadline(conf, O.classifyOutcome(conf))).toBe('Row is up 6% — but your protein went up 40 g a day the same week.');
    expect(O.outcomeSub(conf, O.classifyOutcome(conf))).toMatch(/I can't separate the two/);
  });
  it('the decision per state: Keep it / Revert · Give it 2 weeks / Drop it · Keep it / What else · Apply / Not this week · Keep both / Tell me more', () => {
    const labels = (i: O.OutcomeInput) => O.outcomeCard(i, O.classifyOutcome(i), { threadId: 't', changeId: null, eventId: 'e' }).actions!.map((a) => a.label);
    expect(labels(base())).toEqual(['Keep it', 'Revert']);
    expect(labels(base({ after: pts('2026-10-10', [141, 143]) }))).toEqual(['Give it 2 weeks', 'Drop it']);
    expect(labels(base({ after: pts('2026-10-10', [139, 141, 140, 141, 140, 141]) }))).toEqual(['Keep it', 'What else could I try?']);
    expect(labels(base({ flagsAfter: 2 }))).toEqual(['Apply', 'Not this week']);
    expect(labels(base({ confounders: [{ label: 'protein', delta: 'up 40 g a day', from: '2026-10-10' }] }))).toEqual(['Keep both', 'Tell me more']);
  });
  it('the fits card: hero e1RM in the user\'s unit, the series with before and after, rate row, flags row; Revert carries the thread', () => {
    const i = base(); const card = O.outcomeCard(i, O.classifyOutcome(i), { threadId: 't1', changeId: 'c1', eventId: 'e1' });
    expect(card).toMatchObject({ fn: 'PRO-03', pattern: 'proposal', meta: { label: 'Result · the second pull day' } });
    expect(card.hero).toMatchObject({ value: '148', unit: 'lb', delta: '+8 over 3 wk' });
    expect(card.line).toHaveLength(12);
    expect(card.rows?.map((r) => r.key)).toEqual(['Rate before → after', 'Flags']);
    expect((card.pending?.actions?.revert as any)).toMatchObject({ op: 'proactive.outcome_revert', args: { threadId: 't1', changeId: 'c1' } });
    expect(O.outcomeReceipts(i)).toEqual([{ verb: 'Checked', text: 'Compared 6 sessions of chest-supported row' }]);
  });
  it('"What else could I try?" and "Tell me more" post as the user\'s message', () => {
    const flat = base({ after: pts('2026-10-10', [139, 141, 140, 141, 140, 141]) });
    const card = O.outcomeCard(flat, O.classifyOutcome(flat), { threadId: 't', changeId: null, eventId: 'e' });
    expect(card.actions?.[1].client).toMatchObject({ action: 'send_message' });
  });
});
