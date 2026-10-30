// End to end on the in-memory store: the morning evaluation (reasoner → gate
// → delivery), the three exits on the card, the mute sheet with Undo, the
// free-user gate, and prepared-work expiry with its one re-offer.
import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.AGENT_ENABLED = 'true';
process.env.UI_V2_ENABLED = '1';
process.env.PROACTIVE_V2_ENABLED = '1';
process.env.NODE_ENV = 'test';

vi.mock('@prisma/client', async () => ({ PrismaClient: (await import('./helpers/memPrisma.js')).PrismaClient }));
vi.mock('../services/cacheService.js', () => ({ cacheDelete: vi.fn(), cacheClearByPrefix: vi.fn(), cacheGet: vi.fn(), cacheSet: vi.fn(), cacheMarkStale: vi.fn() }));
vi.mock('../services/notificationService.js', () => ({ sendPushNotification: vi.fn(async () => {}) }));
vi.mock('../services/moderationService.js', () => ({ moderateText: vi.fn(async () => ({ allowed: true })) }));
vi.mock('../services/chatClient.js', () => ({ chatComplete: vi.fn(async () => { throw new Error('no model in tests'); }) }));

const { db, reset } = await import('./helpers/memPrisma.js');
const sweep = await import('../proactive/sweep.js');
const store = await import('../agent/cards/store.js');
const prefs = await import('../proactive/prefs.js');
const prepared = await import('../proactive/prepared.js');
await import('../proactive/index.js');

const now = new Date('2026-10-30T07:02:00Z');
const day = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString().slice(0, 10);
const mma = (n: number) => ({ id: `w${n}`, userId: 'u1', date: day(n), title: 'MMA sparring', exercises: JSON.stringify([{ name: 'Sparring', sets: 6, reps: '3', rpe: 9 }]), createdAt: new Date(now.getTime() - n * 86_400_000) });

function seed(over: Record<string, any[]> = {}) {
  reset({
    user: [{ id: 'u1', email: 'mark@example.com', tier: 'pro', timezone: 'UTC', unitPreference: 'imperial', expoPushToken: 'ExponentPushToken[x]', prefsJson: null, coachProfile: null, savedProgram: JSON.stringify({ phases: [{ trainingDays: [{ day: 'Monday', exercises: [{ exercise: 'Back Squat', sets: 5, reps: '5' }] }] }] }) }],
    workoutLog: [1, 2, 3, 4, 5, 6].map(mma),
    wellnessCheckin: [1, 2, 3].map((n) => ({ id: `c${n}`, userId: 'u1', date: day(n), energy: 2, sleepHours: 6.5, stress: null, createdAt: new Date() })),
    agentConversation: [{ id: 'conv', userId: 'u1', messagesJson: JSON.stringify([
      { role: 'user', text: 'Got a fight coming up', at: `${day(18)}T10:00:00.000Z` },
      { role: 'assistant', text: 'Noted — when is it?', at: `${day(18)}T10:00:05.000Z` },
      { role: 'user', text: 'Sparring was rough. Legs are cooked.', at: `${day(1)}T20:00:00.000Z` },
      { role: 'assistant', text: 'Logged. Easy on the squats tomorrow.', at: `${day(1)}T20:00:05.000Z` },
    ]), summary: null, summarizedThrough: null }],
    agentThread: [{ id: 'fight', userId: 'u1', kind: 'event', title: 'Fight coming up', status: 'open', sourceQuote: 'Got a fight coming up', sourceAt: new Date(`${day(18)}T10:00:00Z`), sourceRole: 'user', read: null, checkBackAt: day(0), eventDate: null, affectsJson: '[]', metricJson: null, historyJson: '[]', raisedCount: 0, ignoredCount: 0, lastRaisedAt: null, mutedUntil: null, resolution: null, resolvedAt: null, createdAt: new Date(`${day(18)}T10:00:00Z`), updatedAt: new Date() }],
    ...over,
  });
}

/** A model that answers like the design's Mark scenario: pick up the due thread, cite real evidence. */
const complete = async (_system: string, input: string) => {
  expect(input).toMatch(/id=fight \[event\]/);
  expect(input).toMatch(/streak_days: Checked — 6 hard days in a row/);
  expect(input).toMatch(/energy_low/);
  return JSON.stringify({ candidates: [
    { kind: 'followup', threadId: 'fight', topic: 'the fight date', question: 'Six hard days in a row and your energy is low. When\'s the fight? If it\'s close, I\'ll build a recovery week around it.', primary: 'It\'s soon — I\'ll give the date', evidence: ['streak_days', 'quote_x', 'energy_low'], pushWhyNow: 'Sparring\'s at 9.', area: 'training' },
    { kind: 'checkin', threadId: null, topic: 'hydration', question: 'Drinking enough?', primary: 'Yes', evidence: ['streak_days'], pushWhyNow: null, area: 'training' },
  ] });
};

beforeEach(() => { seed(); sweep.resetSweepForTests(); });

describe('the morning evaluation', () => {
  it('dry run: records what it would have sent and posts nothing', async () => {
    const r = await sweep.evaluateUser('u1', { now, complete, dryRun: true });
    expect(r?.dryRun).toBe(true);
    expect(r?.gated.map((g) => [g.candidate.topic, g.allow, g.reason])).toEqual([['the fight date', true, 'ok'], ['hydration', true, 'ok']]);
    expect(db.proactiveEvent.filter((e) => e.channel === 'dryrun')).toHaveLength(2);
    expect(db.agentCard ?? []).toHaveLength(0);
    expect(JSON.parse(db.agentConversation[0].messagesJson)).toHaveLength(4);
  });
  it('live: one message a day — the due follow-up — as a turn with receipts, an Ask with three exits, and a push because sparring is soon', async () => {
    await prefs.setProactivePrefs('u1', { sessionTime: '09:00' });
    const r = await sweep.evaluateUser('u1', { now, complete, dryRun: false });
    expect(r?.delivered?.topic).toBe('the fight date');
    const msgs = JSON.parse(db.agentConversation[0].messagesJson);
    const last = msgs[msgs.length - 1];
    expect(last).toMatchObject({ role: 'assistant', origin: 'anakin', receipts: [{ verb: 'Checked', text: '6 hard days in a row' }, { verb: 'Checked', text: 'Energy 2 of 5 at your last 3 check-ins' }] });
    const card = JSON.parse(db.agentCard[0].payloadJson);
    expect(card.fn).toBe('PRO-01');
    expect(card.ask.options).toEqual(['It\'s soon — I\'ll give the date', 'Not now', 'Stop asking about this']);
    const { sendPushNotification } = await import('../services/notificationService.js');
    expect(sendPushNotification).toHaveBeenCalledWith(expect.objectContaining({ body: 'Sparring\'s at 9. One quick question about this week before you go.' }));
    expect(db.proactiveEvent.map((e) => e.channel).sort()).toEqual(['chat', 'push']);
    expect(db.agentThread[0].raisedCount).toBe(1);
    // The second candidate waited: Normal is one a day.
    expect(db.proactiveEvent.some((e) => e.topic === 'hydration')).toBe(false);
  });
  it('a free user gets nothing in chat', async () => {
    db.user[0].tier = 'free';
    const r = await sweep.evaluateUser('u1', { now, complete, dryRun: false });
    expect(r?.delivered).toBeNull();
    expect(r?.gated.every((g) => g.reason === 'free_tier')).toBe(true);
  });
  it('G2: with two sessions, the follow-up on the thread the user opened still goes, the own observation waits', async () => {
    db.workoutLog = db.workoutLog.slice(0, 2);
    const two = async () => JSON.stringify({ candidates: [
      { kind: 'followup', threadId: 'fight', topic: 'the fight date', question: 'When\'s the fight?', primary: 'Soon', evidence: ['energy_low'], pushWhyNow: null, area: 'training' },
      { kind: 'checkin', threadId: null, topic: 'sleep', question: 'Sleeping ok?', primary: 'Yes', evidence: ['energy_low'], pushWhyNow: null, area: 'training' },
    ] });
    const r = await sweep.evaluateUser('u1', { now, complete: two, dryRun: true });
    expect(r?.gated.map((g) => [g.candidate.kind, g.reason])).toEqual([['followup', 'ok'], ['checkin', 'sparse_data']]);
  });
});

describe('the three exits', () => {
  async function deliverCard() {
    await sweep.evaluateUser('u1', { now, complete, dryRun: false });
    return db.agentCard[db.agentCard.length - 1].id as string;
  }
  it('the yes option becomes the user\'s message; the event is answered', async () => {
    const id = await deliverCard();
    const r = await store.answerCard('u1', id, { option: 0 });
    expect(r.sendAsMessage).toBe('It\'s soon — I\'ll give the date');
    expect(db.proactiveEvent.find((e) => e.channel === 'chat')?.outcome).toBe('answered');
  });
  it('"Not now" sends nothing, moves the check-back out 3 days; a second one closes the thread (B5 back-off)', async () => {
    const id = await deliverCard();
    const r = await store.answerCard('u1', id, { option: 1 });
    expect(r.sendAsMessage).toBeUndefined();
    expect(r.card.state).toMatchObject({ status: 'answered', line: 'Not now — I’ll leave it' });
    expect(db.agentThread[0]).toMatchObject({ ignoredCount: 1, checkBackAt: day(-3), status: 'open' });
    // The next morning it comes round again; a second Not now closes it.
    db.agentThread[0].checkBackAt = day(0);
    sweep.resetSweepForTests();
    db.proactiveEvent = [];
    const id2 = await deliverCard();
    await store.answerCard('u1', id2, { option: 1 });
    expect(db.agentThread[0].status).toBe('closed');
  });
  it('"Stop asking about this" opens the sheet; a pick is an Adjusted change with Undo', async () => {
    const id = await deliverCard();
    const r = await store.answerCard('u1', id, { option: 2 });
    expect(r.sendAsMessage).toBeUndefined();
    expect(r.next?.fn).toBe('PRO-04');
    expect(r.next?.ask?.options).toEqual(['Fight coming up — this thread only', 'The fight date — the whole topic, 30 days', 'All check-ins — I only reply when you write first']);
    const picked = await store.answerCard('u1', r.next!.id, { option: 1 });
    expect(picked.card.state?.line).toBe('Adjusted — the fight date muted for 30 days');
    expect((await prefs.getProactivePrefs('u1')).mutedTopics.map((m) => m.topic)).toEqual(['the fight date']);
    await store.undoCard('u1', picked.card.id);
    expect((await prefs.getProactivePrefs('u1')).mutedTopics).toEqual([]);
  });
  it('"only reply when you write first" switches all check-ins off', async () => {
    const id = await deliverCard();
    const r = await store.answerCard('u1', id, { option: 2 });
    await store.answerCard('u1', r.next!.id, { option: 2 });
    expect((await prefs.getProactivePrefs('u1')).allCheckins).toBe(false);
  });
});

describe('B5 · prepared work expires', () => {
  it('a live PRO-02 past its expiry collapses to the Expired line and posts one re-offer, once', async () => {
    const work = { title: 'Recovery week', startDate: '2026-10-26', endDate: '2026-11-01', rationale: 'Deload.', changes: [{ day: 'Mon', exercise: 'Back squat', from: '5×5', to: '3×5' }], checkBackAt: '2026-11-02' };
    const card = prepared.preparedCard(work, { programNext: {}, programOwner: 'me', prevProgram: '{}', eventId: null, expiresAt: '2026-10-26T00:00:00.000Z', sessionTime: null });
    const saved = await store.saveCard('u1', card);
    expect(db.agentCard[0].expiresAt).toEqual(new Date('2026-10-26T00:00:00.000Z'));
    const n = await prepared.expirePreparedCards(new Date('2026-10-27T06:10:00Z'));
    expect(n).toBe(1);
    const row = db.agentCard.find((c) => c.id === saved.id)!;
    expect(row.status).toBe('expired');
    expect(JSON.parse(row.payloadJson).state.line).toBe('Expired — Recovery week · Monday started before it was applied');
    const reoffer = db.agentCard.find((c) => c.fn === 'PRO-05')!;
    expect(JSON.parse(reoffer.payloadJson).ask.options).toEqual(['Yes, Wed–Sun', 'No, train as planned']);
    expect(await prepared.expirePreparedCards(new Date('2026-10-27T07:10:00Z'))).toBe(0);
    expect(db.agentCard.filter((c) => c.fn === 'PRO-05')).toHaveLength(1);
  });
});
