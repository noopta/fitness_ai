// Flow D1 (Home event block) and D2 (Today note before you start), plus the
// away-card rule from A1: an unanswered proactive Ask is never folded.
import { describe, it, expect, vi } from 'vitest';

vi.mock('@prisma/client', async () => ({ PrismaClient: (await import('./helpers/memPrisma.js')).PrismaClient }));
vi.mock('../services/cacheService.js', () => ({ cacheDelete: vi.fn(), cacheClearByPrefix: vi.fn(), cacheGet: vi.fn(), cacheSet: vi.fn(), cacheMarkStale: vi.fn() }));

const Sc = await import('../proactive/screens.js');
const { buildAwayItems } = await import('../services/awayDigest.js');

const row = (over: any) => ({
  id: 't', userId: 'u1', kind: 'symptom', title: 'Left elbow on heavy rows', status: 'watching', sourceQuote: 'Elbow\'s a bit cranky', sourceAt: new Date('2026-10-08T10:00:00Z'), sourceRole: 'user',
  read: null, checkBackAt: '2026-11-06', eventDate: null, affectsJson: '["rows","curls"]', metricJson: null, historyJson: '[]', raisedCount: 0, ignoredCount: 0, lastRaisedAt: null, mutedUntil: null,
  resolution: null, resolvedAt: null, createdAt: new Date('2026-10-08T10:00:00Z'), updatedAt: new Date(), ...over,
});

describe('D1 · event countdown', () => {
  const threads = [row({ id: 'fight', kind: 'event', title: 'Amateur fight · Nov 22', status: 'open', eventDate: '2026-11-22', read: 'Two more easy days, then we build.' }), row({ id: 'rec', kind: 'experiment', title: 'Recovery week', status: 'running', read: 'day 3 of 7' })];
  it('the soonest open event: big countdown, the latest follow-up as the read, the phase band', () => {
    const e = Sc.eventBlock(threads, '2026-10-30')!;
    expect(e).toMatchObject({ threadId: 'fight', title: 'Amateur fight', date: '2026-11-22', dateLabel: 'Nov 22', daysOut: 23, note: 'Two more easy days, then we build.', phaseIndex: 0, sub: 'Recovery week · day 3 of 7' });
    expect(e.phases).toEqual(['Recover', 'Build', 'Peak', 'Cut']);
  });
  it('no recovery week running → Build far out, Peak near, Cut in the last days; a past event is gone', () => {
    const only = [threads[0]];
    expect(Sc.eventBlock(only, '2026-10-30')!.phaseIndex).toBe(1);
    expect(Sc.eventBlock(only, '2026-11-15')!.phaseIndex).toBe(2);
    expect(Sc.eventBlock(only, '2026-11-20')!.phaseIndex).toBe(3);
    expect(Sc.eventBlock(only, '2026-11-23')).toBeNull();
  });
});

describe('D2 · note before you start', () => {
  it('only when a thread touches an exercise in this session; two inline answers', () => {
    const n = Sc.todayNote([row({})], ['Chest-supported row', 'Weighted pull-up', 'Face pull'])!;
    expect(n).toMatchObject({ threadId: 't', exercise: 'Chest-supported row', options: ['Got it', 'It\'s fine now'] });
    expect(n.text).toBe('Left elbow on heavy rows check: if it talks on set 2 of chest-supported row, stop and flag it.');
    expect(n.sub).toMatch(/Quiet 3 weeks — I'd like to close this out today/);
  });
  it('nothing on a session that doesn\'t touch the thread, on a rest day, or for a resolved thread', () => {
    expect(Sc.todayNote([row({})], ['Back squat', 'Leg press'])).toBeNull();
    expect(Sc.todayNote([row({})], [])).toBeNull();
    expect(Sc.todayNote([row({ status: 'resolved' })], ['Chest-supported row'])).toBeNull();
  });
  it('an experiment carries its read', () => {
    const n = Sc.todayNote([row({ kind: 'experiment', title: 'Recovery week', status: 'running', read: 'lighter squat, as written', affectsJson: '["Back squat"]' })], ['Back Squat'])!;
    expect(n.text).toBe('Recovery week: lighter squat, as written');
  });
});

describe('A1 · the away card never folds an unanswered Ask', () => {
  const now = new Date('2026-10-30T13:00:00Z');
  const cards = new Map<string, any>([
    ['ask', { id: 'ask', fn: 'PRO-01', pattern: 'ask', meta: { label: 'Check-in' }, state: { status: 'live' } }],
    ['done', { id: 'done', fn: 'PRO-01', pattern: 'ask', meta: { label: 'Check-in' }, state: { status: 'answered', line: 'Not now' } }],
    ['wk', { id: 'wk', fn: 'MEM-05', pattern: 'glance', meta: { label: 'Your week' } }],
  ]);
  const t = (at: string, text: string, cardIds: string[]) => ({ at, text, cardIds, role: 'assistant' as const, origin: 'anakin' });
  it('the live Ask stays under the card; an answered one and routine posts fold', () => {
    const { items, foldedAts } = buildAwayItems([
      t('2026-10-30T07:02:00Z', 'When\'s the fight?', ['ask']),
      t('2026-10-29T07:02:00Z', 'Older question', ['done']),
      t('2026-10-29T22:00:00Z', 'What a week', ['wk']),
    ], cards, '2026-10-28T00:00:00Z', new Set(), now);
    expect(foldedAts).toEqual(['2026-10-29T07:02:00Z', '2026-10-29T22:00:00Z']);
    expect(items.map((i) => i.title)).not.toContain('When\'s the fight?');
  });
});
