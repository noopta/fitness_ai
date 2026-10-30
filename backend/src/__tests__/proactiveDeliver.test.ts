// Flow A: the check-in card (three exits, always), the receipts under it,
// the lock-screen rule and the push gate, the "Stop asking" sheet.
import { describe, it, expect, vi } from 'vitest';

vi.mock('@prisma/client', async () => ({ PrismaClient: (await import('./helpers/memPrisma.js')).PrismaClient }));
vi.mock('../services/cacheService.js', () => ({ cacheDelete: vi.fn(), cacheClearByPrefix: vi.fn(), cacheGet: vi.fn(), cacheSet: vi.fn(), cacheMarkStale: vi.fn() }));
vi.mock('../services/notificationService.js', () => ({ sendPushNotification: vi.fn(async () => {}) }));

const D = await import('../proactive/deliver.js');
const { DEFAULT_PROACTIVE_PREFS } = await import('../proactive/prefs.js');

const evidence = [
  { id: 'streak_days', verb: 'Checked' as const, text: '6 hard sessions in 6 days', topics: [] },
  { id: 'quote_1', verb: 'Read' as const, text: '“Legs are cooked” · you, yesterday', topics: [] },
  { id: 'energy_low', verb: 'Checked' as const, text: 'Energy 2 of 5 at your last 3 check-ins', topics: [] },
];
const cand = { kind: 'checkin' as const, topic: 'the fight date', threadId: null, question: 'When\'s the fight? If it\'s close, I\'ll build a recovery week around it.', primary: 'It\'s soon — I\'ll give the date', evidence: ['streak_days', 'quote_1', 'energy_low'], pushWhyNow: 'Sparring\'s at 9.', area: 'training' as const };

describe('A1 · the check-in turn', () => {
  it('receipts are the cited evidence, in order, verb and text from the catalog', () => {
    expect(D.receiptsFor(cand, evidence)).toEqual([
      { verb: 'Checked', text: '6 hard sessions in 6 days' }, { verb: 'Read', text: '“Legs are cooked” · you, yesterday' }, { verb: 'Checked', text: 'Energy 2 of 5 at your last 3 check-ins' },
    ]);
    expect(D.checkedLine(3)).toBe('Checked 3 things');
  });
  it('the Ask has three exits — act, defer, mute — with the yes option first and typing allowed', () => {
    const card = D.checkinCard(cand, 'ev1');
    expect(card).toMatchObject({ fn: 'PRO-01', pattern: 'ask', meta: { label: 'Check-in' } });
    expect(card.ask?.options).toEqual(['It\'s soon — I\'ll give the date', 'Not now', 'Stop asking about this']);
    expect(card.ask?.typeInstead).toBe(true);
    expect(card.pending?.answer).toMatchObject({ op: 'proactive.answer', args: { eventId: 'ev1', topic: 'the fight date' } });
    expect(D.checkinCard({ ...cand, threadId: 't1', kind: 'followup' }, 'ev1').meta?.label).toBe('Follow-up');
  });
});

describe('A2 · push only when timing matters', () => {
  const ctx = { prefs: { ...DEFAULT_PROACTIVE_PREFS, sessionTime: '09:00' }, localHour: 7, localMinute: 2, hasToken: true };
  it('a session within 6 h, outside quiet hours, pref on, token present → push, copy leads with why now', () => {
    expect(D.pushDecision(cand, ctx)).toEqual({ push: true, body: 'Sparring\'s at 9. One quick question about this week before you go.', reason: 'session soon' });
    expect(D.pushDecision(cand, ctx).body).not.toMatch(/fight|recovery/); // what was noticed stays in the app
  });
  it('otherwise it waits in the thread', () => {
    expect(D.pushDecision({ ...cand, pushWhyNow: null }, ctx).push).toBe(false);
    expect(D.pushDecision(cand, { ...ctx, prefs: { ...ctx.prefs, pushTimeSensitive: false } }).reason).toBe('push pref off');
    expect(D.pushDecision(cand, { ...ctx, hasToken: false }).reason).toBe('no push token');
    expect(D.pushDecision(cand, { ...ctx, localHour: 23 }).reason).toBe('quiet hours');
    expect(D.pushDecision(cand, { ...ctx, prefs: { ...ctx.prefs, sessionTime: null } }).reason).toBe('no session within the window');
    expect(D.pushDecision(cand, { ...ctx, prefs: { ...ctx.prefs, sessionTime: '18:00' } }).reason).toBe('no session within the window');
    expect(D.pushDecision(cand, { ...ctx, localHour: 10 }).reason).toBe('no session within the window'); // already passed
  });
  it('lock-screen rule: no symptoms, weights, check-in values or injury words; a time is fine', () => {
    expect(D.pushSafe('Sparring\'s at 9. One quick question about this week before you go.')).toBe(true);
    expect(D.pushSafe('Six hard days straight and soreness at 7/10. When\'s the fight?')).toBe(false);
    expect(D.pushSafe('Your elbow again — stop and flag it.')).toBe(false);
    expect(D.pushSafe('You\'re down 4.1 kg this week.')).toBe(false);
    expect(D.pushSafe('Energy 2 of 5 — take it easy.')).toBe(false);
    expect(D.pushSafe('Bench 135 × 5 for four sessions.')).toBe(false);
    expect(D.pushSafe('')).toBe(false);
    expect(D.pushSafe('x'.repeat(141))).toBe(false);
  });
  it('a why-now that names a symptom or a number fails the rule and is not pushed', () => {
    expect(D.pushDecision({ ...cand, pushWhyNow: 'Soreness at 7 before sparring' }, ctx).reason).toBe('copy failed the lock-screen rule');
  });
});

describe('A3 · stop asking about what?', () => {
  it('thread · topic · everything, the narrowest first; safety still comes through', () => {
    const card = D.muteSheetCard('The fight date', 'recovery and soreness', 'ev1', 't1');
    expect(card.fn).toBe('PRO-04');
    expect(card.ask?.options).toEqual(['The fight date — this thread only', 'Recovery and soreness — the whole topic, 30 days', 'All check-ins — I only reply when you write first']);
    expect(card.why).toMatch(/Safety checks still come through/);
    expect(D.muteSheetCard(null, 'hydration', 'ev1', null).ask?.options).toHaveLength(2);
  });
  it('minutes to the usual session', () => {
    expect(D.minutesToSession('09:00', 7, 2)).toBe(118);
    expect(D.minutesToSession('09:00', 10, 0)).toBeNull();
    expect(D.minutesToSession(null, 7, 0)).toBeNull();
  });
});
