// Flow C · Working on: the extractor's guard rails (the quote must be real),
// merging into existing threads, due dates, the rows the page shows.
import { describe, it, expect, vi } from 'vitest';

vi.mock('@prisma/client', async () => ({ PrismaClient: (await import('./helpers/memPrisma.js')).PrismaClient }));
vi.mock('../services/cacheService.js', () => ({ cacheDelete: vi.fn(), cacheClearByPrefix: vi.fn(), cacheGet: vi.fn(), cacheSet: vi.fn(), cacheMarkStale: vi.fn() }));

const T = await import('../proactive/threads.js');

const transcript = [
  'Elbow\'s a bit cranky on the last set of rows — inside of the joint.',
  'Got a fight coming up, amateur, Nov 22.',
  'Should I take creatine during the cut?',
];
const row = (over: Partial<T.ThreadRow>): T.ThreadRow => ({
  id: 't', userId: 'u1', kind: 'symptom', title: 'Left elbow on heavy rows', status: 'watching', sourceQuote: transcript[0], sourceAt: new Date('2026-10-08T10:00:00Z'), sourceRole: 'user',
  read: 'Quiet 3 weeks', checkBackAt: '2026-11-06', eventDate: null, affectsJson: '["rows","curls"]', metricJson: null, historyJson: '[]', raisedCount: 0, ignoredCount: 0, lastRaisedAt: null, mutedUntil: null,
  resolution: null, resolvedAt: null, createdAt: new Date('2026-10-08T10:00:00Z'), updatedAt: new Date(), ...over,
});

describe('extraction', () => {
  it('parses the model\'s JSON leniently and drops rows without a title or quote', () => {
    const out = T.parseExtraction('Here you go: {"threads":[{"kind":"event","title":"Amateur fight","sourceQuote":"Got a fight coming up","eventDate":"2026-11-22","checkBackAt":"2026-11-15"},{"kind":"goal","title":"x"},{"kind":"symptom","title":"Elbow","sourceQuote":"Elbow\'s a bit cranky","affects":["rows"],"eventDate":"soon"}]}');
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ kind: 'event', eventDate: '2026-11-22', checkBackAt: '2026-11-15' });
    expect(out[1].eventDate).toBeNull();
    expect(T.parseExtraction('not json')).toEqual([]);
  });
  it('the source quote must be in the transcript — case, quotes and whitespace aside', () => {
    expect(T.quoteInTranscript('elbow\'s a bit cranky on the last set of rows', transcript)).toBe(true);
    expect(T.quoteInTranscript('“Got a fight coming up”', transcript)).toBe(true);
    expect(T.quoteInTranscript('my knee clicks on squats', transcript)).toBe(false);
    expect(T.quoteInTranscript('rows', transcript)).toBe(false); // too short to be a quote
  });
  it('merges: a real quote creates; a near-duplicate title updates the open thread; an invented quote is dropped', () => {
    const existing = [row({ id: 'elbow' })];
    const { create, update } = T.mergeExtracted(existing, [
      { kind: 'symptom', title: 'Elbow on rows', sourceQuote: 'Elbow\'s a bit cranky on the last set of rows', read: 'Still there on set 3' },
      { kind: 'event', title: 'Amateur fight · Nov 22', sourceQuote: 'Got a fight coming up, amateur, Nov 22', eventDate: '2026-11-22' },
      { kind: 'question', title: 'Creatine during the cut?', sourceQuote: 'Should I take creatine during the cut?' },
      { kind: 'goal', title: '225 bench by March', sourceQuote: 'I want a 225 bench by March' },
      { kind: 'event', title: 'The amateur fight', sourceQuote: 'amateur, Nov 22' },
    ], transcript);
    expect(update).toEqual([{ id: 'elbow', patch: { read: 'Still there on set 3' } }]);
    expect(create.map((c) => c.kind)).toEqual(['event', 'question']); // the goal's quote isn't real; the second event dedupes against the first
  });
  it('titles that share most words are the same thread', () => {
    expect(T.titleSimilarity('Left elbow on heavy rows', 'elbow on rows')).toBeGreaterThanOrEqual(T.SAME_THREAD);
    expect(T.titleSimilarity('Left elbow on heavy rows', 'Knee clicking on squats')).toBeLessThan(T.SAME_THREAD);
  });
});

describe('what becomes a thread (silent test, 31 Oct)', () => {
  const today = '2026-10-31';
  it('app-support questions are not threads', () => {
    expect(T.acceptExtracted({ kind: 'question', title: 'How to get share photo', sourceQuote: 'x' }, today)).toBe(false);
    expect(T.acceptExtracted({ kind: 'question', title: 'Fix snap function', sourceQuote: 'x' }, today)).toBe(false);
    expect(T.acceptExtracted({ kind: 'question', title: 'Creatine during the cut?', sourceQuote: 'x', checkBackAt: '2026-11-15' }, today)).toBe(true);
  });
  it('a planned session is not an event; an event needs a future date', () => {
    expect(T.acceptExtracted({ kind: 'event', title: 'Saturday Arm and Shoulders', sourceQuote: 'x', eventDate: '2026-11-01' }, today)).toBe(false);
    expect(T.acceptExtracted({ kind: 'event', title: 'Amateur fight', sourceQuote: 'x', eventDate: '2026-11-22' }, today)).toBe(true);
    expect(T.acceptExtracted({ kind: 'event', title: 'Amateur fight', sourceQuote: 'x', eventDate: '2026-10-01' }, today)).toBe(false);
    expect(T.acceptExtracted({ kind: 'event', title: 'Leg day match', sourceQuote: 'x', eventDate: '2026-11-22' }, today)).toBe(true);
  });
  it('check-backs in the past are dropped; an old unanswered question without one is stale', () => {
    expect(T.acceptExtracted({ kind: 'goal', title: 'Bench 225 by March', sourceQuote: 'x', checkBackAt: '2026-03-01' }, today)).toBe(false);
    expect(T.acceptExtracted({ kind: 'question', title: 'Next-time bench changes', sourceQuote: 'x' }, today, '2026-10-01T10:00:00Z')).toBe(false);
    expect(T.acceptExtracted({ kind: 'question', title: 'Next-time bench changes', sourceQuote: 'x' }, today, '2026-10-29T10:00:00Z')).toBe(true);
    expect(T.acceptExtracted({ kind: 'symptom', title: 'Right shin discomfort', sourceQuote: 'x' }, today, '2026-09-01T10:00:00Z')).toBe(true);
  });
});

describe('due and rows', () => {
  const today = '2026-10-30';
  const threads = [
    row({ id: 'fight', kind: 'event', title: 'Amateur fight · Nov 22', status: 'open', eventDate: '2026-11-22', checkBackAt: '2026-11-10', read: 'peak plan on Nov 10' }),
    row({ id: 'rec', kind: 'experiment', title: 'Recovery week', status: 'running', checkBackAt: '2026-11-09', read: 'sessions, energy' }),
    row({ id: 'elbow' }),
    row({ id: 'q', kind: 'question', title: 'Creatine during the cut?', status: 'open', checkBackAt: '2026-10-30', sourceAt: new Date('2026-10-21T10:00:00Z') }),
    row({ id: 'muted', kind: 'question', title: 'Muted thing', status: 'open', checkBackAt: '2026-10-01', mutedUntil: new Date('2030-01-01') }),
    row({ id: 'done', kind: 'experiment', title: 'Second pull day', status: 'resolved', resolution: 'Kept · rows +6%, fits', resolvedAt: new Date('2026-10-30T08:00:00Z') }),
    row({ id: 'wrong', status: 'wrong' }),
  ];
  it('due = open, check-back today or earlier, not muted', () => {
    expect(T.dueThreads(threads, today).map((t) => t.id)).toEqual(['q']);
  });
  it('counts down to the event', () => {
    expect(T.countdown('2026-11-22', today)).toBe(23);
    expect(T.countdown('2026-10-29', today)).toBe(-1);
  });
  it('C1 rows: type in the sub, check-back as the value, the event takes the big numeral; closed rows carry the resolution; wrong rows are gone', () => {
    const { open, closed } = T.threadRows(threads, today);
    expect(open.map((r) => r.id)).toEqual(['fight', 'q', 'elbow', 'rec', 'muted']);
    expect(open.find((r) => r.id === 'fight')).toMatchObject({ value: '23d', big: true, sub: 'Event · peak plan on Nov 10' });
    expect(open.find((r) => r.id === 'rec')).toMatchObject({ sub: 'Experiment · sessions, energy', value: 'Nov 9', big: false });
    expect(open.find((r) => r.id === 'q')).toMatchObject({ sub: 'Question · you asked Oct 21', value: 'Oct 30' });
    expect(closed).toEqual([expect.objectContaining({ id: 'done', sub: 'Resolved · Kept · rows +6%, fits', value: 'Oct 30' })]);
  });
});
