// The fixed-rule gate: F1 caps/quiet/mutes, B5 back-off, G2 sparse data
// (with the thread exemption), G3 safety bypasses, G4 free users.
import { describe, it, expect, vi } from 'vitest';

vi.mock('@prisma/client', async () => ({ PrismaClient: (await import('./helpers/memPrisma.js')).PrismaClient }));

const { gateCandidate, MIN_SESSIONS, sparseDataNote } = await import('../proactive/gate.js');
const { DEFAULT_PROACTIVE_PREFS, muteTopic } = await import('../proactive/prefs.js');

const now = new Date('2026-10-30T11:02:00Z');
const base = () => ({
  kind: 'checkin' as const, topic: 'recovery', threadId: null, thread: null, prefs: { ...DEFAULT_PROACTIVE_PREFS }, tier: 'pro',
  localHour: 7, localDate: '2026-10-30', recent: [] as any[], sessions: 20, mealDays: 10,
});
const sent = (kind: string, topic: string, when: string, outcome: string | null = null, channel = 'chat') => ({ kind, topic, channel, createdAt: when, outcome });

describe('G4 · free users', () => {
  it('get nothing in chat — there is nothing to reply in', () => {
    expect(gateCandidate({ ...base(), tier: 'free' }, now)).toMatchObject({ allow: false, reason: 'free_tier' });
  });
  it('still get the safety flag, as a screen line', () => {
    expect(gateCandidate({ ...base(), tier: 'free', kind: 'safety' }, now).allow).toBe(true);
  });
});

describe('F1 · caps, quiet hours, mutes', () => {
  it('Normal: one a day', () => {
    const r = gateCandidate({ ...base(), recent: [sent('checkin', 'bench', '2026-10-30T07:00:00Z')] }, now);
    expect(r).toMatchObject({ allow: false, reason: 'daily_cap' });
  });
  it('Often: two a day; Rarely: two a week', () => {
    const two = [sent('checkin', 'bench', '2026-10-30T07:00:00Z'), sent('followup', 'elbow', '2026-10-30T07:05:00Z')];
    expect(gateCandidate({ ...base(), prefs: { ...DEFAULT_PROACTIVE_PREFS, frequency: 'often' }, recent: two.slice(0, 1) }, now).allow).toBe(true);
    expect(gateCandidate({ ...base(), prefs: { ...DEFAULT_PROACTIVE_PREFS, frequency: 'often' }, recent: two }, now).reason).toBe('daily_cap');
    const week = [sent('checkin', 'a', '2026-10-27T07:00:00Z'), sent('checkin', 'b', '2026-10-28T07:00:00Z')];
    expect(gateCandidate({ ...base(), prefs: { ...DEFAULT_PROACTIVE_PREFS, frequency: 'rarely' }, recent: week }, now).reason).toBe('weekly_cap');
  });
  it('dry-run rows and safety never count toward the cap', () => {
    const recent = [sent('checkin', 'bench', '2026-10-30T07:00:00Z', null, 'dryrun'), sent('safety', 'weight cut', '2026-10-30T06:00:00Z')];
    expect(gateCandidate({ ...base(), recent }, now).allow).toBe(true);
  });
  it('quiet hours hold', () => {
    expect(gateCandidate({ ...base(), localHour: 23 }, now)).toMatchObject({ allow: false, reason: 'quiet_hours' });
  });
  it('a muted topic is not raised; "only reply when you write first" blocks everything but safety', () => {
    expect(gateCandidate({ ...base(), prefs: muteTopic(DEFAULT_PROACTIVE_PREFS, 'recovery', 30, now) }, now).reason).toBe('topic_muted');
    expect(gateCandidate({ ...base(), prefs: { ...DEFAULT_PROACTIVE_PREFS, allCheckins: false } }, now).reason).toBe('only_replies');
    expect(gateCandidate({ ...base(), kind: 'safety', prefs: { ...DEFAULT_PROACTIVE_PREFS, allCheckins: false } }, now).allow).toBe(true);
  });
  it('outcome reports can be switched off on their own', () => {
    expect(gateCandidate({ ...base(), kind: 'outcome', threadId: 't1', prefs: { ...DEFAULT_PROACTIVE_PREFS, outcomeReports: false } }, now).reason).toBe('outcome_reports_off');
  });
  it('a topic ignored inside 14 days is on cooldown', () => {
    expect(gateCandidate({ ...base(), recent: [sent('checkin', 'recovery', '2026-10-20T07:00:00Z', 'ignored')] }, now).reason).toBe('topic_cooldown');
    expect(gateCandidate({ ...base(), recent: [sent('checkin', 'recovery', '2026-10-10T07:00:00Z', 'ignored')] }, now).allow).toBe(true);
  });
});

describe('B5 · back-off', () => {
  it('a thread ignored twice closes', () => {
    const r = gateCandidate({ ...base(), kind: 'followup', threadId: 't1', thread: { ignoredCount: 2, mutedUntil: null, status: 'open' } }, now);
    expect(r).toMatchObject({ allow: false, reason: 'backoff', closeThread: true });
  });
  it('a muted or closed thread is skipped', () => {
    expect(gateCandidate({ ...base(), kind: 'followup', threadId: 't1', thread: { ignoredCount: 0, mutedUntil: '2030-01-01T00:00:00Z', status: 'open' } }, now).reason).toBe('thread_muted');
    expect(gateCandidate({ ...base(), kind: 'followup', threadId: 't1', thread: { ignoredCount: 0, mutedUntil: null, status: 'resolved' } }, now).reason).toBe('thread_closed');
  });
});

describe('G2 · sparse data', () => {
  it(`Anakin's own observations wait for ${MIN_SESSIONS} sessions`, () => {
    expect(gateCandidate({ ...base(), sessions: 2 }, now).reason).toBe('sparse_data');
    expect(gateCandidate({ ...base(), sessions: 6 }, now).allow).toBe(true);
  });
  it('a Fuel observation uses the meals threshold (3 logged days)', () => {
    expect(gateCandidate({ ...base(), kind: 'insight', area: 'fuel', sessions: 0, mealDays: 2 }, now).reason).toBe('sparse_data');
    expect(gateCandidate({ ...base(), kind: 'insight', area: 'fuel', sessions: 0, mealDays: 3 }, now).allow).toBe(true);
  });
  it('a follow-up on a thread the user opened needs no logs', () => {
    expect(gateCandidate({ ...base(), kind: 'followup', threadId: 't1', thread: { ignoredCount: 0, mutedUntil: null, status: 'open' }, sessions: 0, mealDays: 0 }, now).allow).toBe(true);
  });
  it('says so once, with the dots', () => {
    expect(sparseDataNote(2)).toEqual({ text: expect.stringMatching(/Once I've seen 6 of your sessions/), progress: { done: 2, of: 6 } });
  });
});

describe('G3 · safety', () => {
  it('skips the cap and mutes', () => {
    const prefs = muteTopic({ ...DEFAULT_PROACTIVE_PREFS, frequency: 'rarely' }, 'weight cut', null, now);
    const recent = [sent('checkin', 'a', '2026-10-30T07:00:00Z'), sent('checkin', 'b', '2026-10-29T07:00:00Z'), sent('checkin', 'c', '2026-10-28T07:00:00Z')];
    expect(gateCandidate({ ...base(), kind: 'safety', topic: 'weight cut', prefs, recent }, now).allow).toBe(true);
  });
  it('but not quiet hours — unless the reading suggests acute risk', () => {
    expect(gateCandidate({ ...base(), kind: 'safety', localHour: 23 }, now).reason).toBe('quiet_hours');
    expect(gateCandidate({ ...base(), kind: 'safety', localHour: 23, acute: true }, now).allow).toBe(true);
  });
});
