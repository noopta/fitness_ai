// "While you were away" (design 3b): rows from what Anakin posted while the
// user was gone — needs_you first, one row per news card, repeats collapsed.
import { describe, it, expect } from 'vitest';
import { buildAwayItems, awayBlock, kindOf, AWAY_TEXT, type AwayTurn } from '../services/awayDigest.js';

const now = new Date('2026-10-27T13:00:00Z');
const t = (at: string, text: string, cardIds: string[] = [], role: 'user' | 'assistant' = 'assistant'): AwayTurn => ({ at, text, cardIds, role, ...(role === 'assistant' ? { origin: 'anakin' } : {}) });
const cards = new Map<string, any>([
  ['adp1', { id: 'adp1', fn: 'ADP-01', pattern: 'proposal', meta: { label: 'Proposed · Your Lateral Raise is ahead of plan' }, why: 'You hit the top of the 8 range on every set twice in a row.' }],
  ['adp2', { id: 'adp2', fn: 'ADP-01', pattern: 'proposal', meta: { label: 'Proposed · Your Lateral Raise is ahead of plan' }, why: 'Same suggestion again.' }],
  ['wrk', { id: 'wrk', fn: 'WRK-10', pattern: 'glance', meta: { label: 'Today · Full body' } }],
  ['log', { id: 'log', fn: 'LOG-01', pattern: 'review', meta: { label: 'Log check' }, review: { pending: 2, rows: [], period: 'Oct 25' } }],
  ['week', { id: 'week', fn: 'MEM-05', pattern: 'glance', meta: { label: 'Your week' } }],
]);
const turns = [
  t('2026-10-25T20:00:00Z', 'Rock climb earlier today', [], 'user'),
  t('2026-10-26T10:00:00Z', 'I have 2 suggestions from your training.', ['wrk', 'adp1']),
  t('2026-10-26T15:00:00Z', 'Two entries don’t look right — duplicates and a gap. I haven’t changed anything.', ['log']),
  t('2026-10-26T22:00:00Z', 'What a week, Rashad! Logged food 6 of 7 days.', ['week']),
  t('2026-10-27T01:00:00Z', 'I have 2 suggestions from your training.', ['wrk', 'adp2']),
  t('2026-10-27T02:00:00Z', 'Quick heads-up: Fuel is faster now.'),
];

describe('away rows', () => {
  it('needs_you first, then newest; the glance under every turn is not news; a repeated suggestion is one row', () => {
    const { items, foldedAts } = buildAwayItems(turns, cards, '2026-10-25T21:00:00Z', new Set(), now);
    expect(items.map((i) => [i.kind, i.title])).toEqual([
      ['needs_you', '2 log entries need review'],
      ['announcement', 'Quick heads-up: Fuel is faster now.'],
      ['program_change', 'Your Lateral Raise is ahead of plan'],
      ['insight', 'Your week'],
    ]);
    expect(items[2].cta).toEqual({ label: 'Review suggestion', turnAt: '2026-10-27T01:00:00Z', cardId: 'adp2' });
    expect(foldedAts).toHaveLength(5);
  });
  it('turns an earlier card folded, or before their last message, are not repeated', () => {
    const { items } = buildAwayItems(turns, cards, '2026-10-26T23:00:00Z', new Set(['2026-10-27T02:00:00Z']), now);
    expect(items.map((i) => i.kind)).toEqual(['program_change']);
    const withReply = [...turns, t('2026-10-27T03:00:00Z', 'thanks', [], 'user')];
    expect(buildAwayItems(withReply, cards, '2026-10-25T21:00:00Z', new Set(), now).items).toEqual([]);
  });
  it('its own turn is never folded into the next card', () => {
    expect(buildAwayItems([t('2026-10-27T05:00:00Z', AWAY_TEXT, ['x'])], cards, '2026-10-26T00:00:00Z', new Set(), now).items).toEqual([]);
  });
  it('summary and badge', () => {
    const { items, foldedAts } = buildAwayItems(turns, cards, '2026-10-25T21:00:00Z', new Set(), now);
    const b = awayBlock(items, '2026-10-25T21:00:00Z', foldedAts, now);
    expect(b.summary).toBe('4 updates · 1 needs you');
    expect(b.unopened).toBe(4);
    expect(b.since).toBe('Since Sunday');
    expect(kindOf({ fn: 'WRK-10', pattern: 'glance' } as any)).toBeNull();
  });
});
