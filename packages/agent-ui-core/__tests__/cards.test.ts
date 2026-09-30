import { describe, it, expect } from 'vitest';
import { threadReducer, emptyThread, allCards, latestAgentCards, awayRange, type Turn } from '../src/receipts';
import { composerMode, primaryActionIndex, undoOpen, clockTime, type Card } from '../src/cards';

const card = (id: string, over: Partial<Card> = {}): Card => ({ id, fn: 'X-01', pattern: 'glance', rule: 'show', state: { status: 'live' }, ...over });

function sent() {
  return threadReducer(emptyThread(), { type: 'send', id: 'u1', agentId: 'a1', text: 'hi', now: 1 });
}

describe('card reducer', () => {
  it('appends card2 events in order and upserts by id', () => {
    let s = sent();
    s = threadReducer(s, { type: 'event', agentId: 'a1', event: { type: 'card2', card: card('c1') } });
    s = threadReducer(s, { type: 'event', agentId: 'a1', event: { type: 'card2', card: card('c2') } });
    s = threadReducer(s, { type: 'event', agentId: 'a1', event: { type: 'card2', card: card('c1', { note: 'v2' }) } });
    expect(allCards(s).map((c) => [c.id, c.note])).toEqual([['c1', 'v2'], ['c2', undefined]]);
  });

  it('card_set replaces a card wherever it lives and leaves other turns untouched', () => {
    let s = sent();
    s = threadReducer(s, { type: 'event', agentId: 'a1', event: { type: 'card2', card: card('c1') } });
    s = threadReducer(s, { type: 'send', id: 'u2', agentId: 'a2', text: 'more', now: 2 });
    s = threadReducer(s, { type: 'event', agentId: 'a2', event: { type: 'card2', card: card('c2') } });
    const before = s.turns[3];
    s = threadReducer(s, { type: 'card_set', card: card('c1', { state: { status: 'applied' } }) });
    expect(s.turns[1].cards![0].state!.status).toBe('applied');
    expect(s.turns[3]).toBe(before);
  });

  it('card_update patches in place', () => {
    let s = sent();
    s = threadReducer(s, { type: 'event', agentId: 'a1', event: { type: 'card2', card: card('c1') } });
    s = threadReducer(s, { type: 'event', agentId: 'a1', event: { type: 'card_update', cardId: 'c1', patch: { state: { status: 'changed', line: 'Changed since' } } } });
    expect(allCards(s)[0].state!.line).toBe('Changed since');
  });

  it('cards_set fills hydrated turns from their ids, in id order', () => {
    const turns: Turn[] = [{ id: 'h0', kind: 'agent', text: 'x', receipts: [], done: true, cardIds: ['b', 'a'] }];
    let s = threadReducer(emptyThread(), { type: 'hydrate', turns });
    s = threadReducer(s, { type: 'cards_set', cards: [card('a'), card('b')] });
    expect(s.turns[0].cards!.map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('card_after inserts the next flow step once', () => {
    let s = sent();
    s = threadReducer(s, { type: 'event', agentId: 'a1', event: { type: 'card2', card: card('c1') } });
    s = threadReducer(s, { type: 'event', agentId: 'a1', event: { type: 'card2', card: card('c3') } });
    s = threadReducer(s, { type: 'card_after', afterId: 'c1', card: card('c2') });
    s = threadReducer(s, { type: 'card_after', afterId: 'c1', card: card('c2') });
    expect(allCards(s).map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
  });

  it('latestAgentCards stops at the newest user message', () => {
    let s = sent();
    s = threadReducer(s, { type: 'event', agentId: 'a1', event: { type: 'card2', card: card('c1') } });
    expect(latestAgentCards(s).map((c) => c.id)).toEqual(['c1']);
    s = threadReducer(s, { type: 'send', id: 'u2', agentId: 'a2', text: 'next', now: 2 });
    expect(latestAgentCards(s)).toEqual([]);
  });
});

describe('awayRange', () => {
  const t = (id: string, origin?: 'anakin', n = 1): Turn => ({ id, kind: 'agent', text: '', receipts: [], done: true, origin, cardIds: Array.from({ length: n }, (_, i) => `${id}${i}`) });
  it('folds trailing Anakin-initiated turns and counts their cards', () => {
    expect(awayRange([{ id: 'u', kind: 'user', text: 'x', receipts: [], done: true }, t('a'), t('b', 'anakin', 2), t('c', 'anakin')])).toEqual({ start: 2, count: 3 });
  });
  it('is null when the user spoke last', () => {
    expect(awayRange([t('a', 'anakin'), { id: 'u', kind: 'user', text: 'x', receipts: [], done: true }])).toBeNull();
  });
});

describe('composerMode', () => {
  it('answers a live ask or flow', () => {
    expect(composerMode([card('a', { pattern: 'ask' })])).toMatchObject({ kind: 'ask', cardId: 'a', placeholder: 'Or type your answer' });
  });
  it('tweaks drafts and proposals', () => {
    expect(composerMode([card('d', { pattern: 'draft' })]).placeholder).toBe('Change the message…');
    expect(composerMode([card('p', { pattern: 'proposal' })]).placeholder).toBe('Or tell me what to change');
  });
  it('edits a draft body when asked', () => {
    expect(composerMode([card('d', { pattern: 'draft', draft: { to: 'Sam', audience: 'Direct', body: 'hey' } })], 'd')).toMatchObject({ kind: 'draft', to: 'Sam', body: 'hey' });
  });
  it('ignores cards that were already acted on', () => {
    expect(composerMode([card('a', { pattern: 'ask', state: { status: 'answered' } })]).kind).toBe('default');
  });
});

describe('card helpers', () => {
  it('primaryActionIndex skips undo / keep first actions', () => {
    expect(primaryActionIndex([{ id: 'apply', label: 'Apply', kind: 'primary' }])).toBe(0);
    expect(primaryActionIndex([{ id: 'undo', label: 'Undo', kind: 'undo' }])).toBe(-1);
    expect(primaryActionIndex([{ id: 'keep', label: 'Keep', kind: 'secondary' }])).toBe(-1);
    expect(primaryActionIndex(undefined)).toBe(-1);
  });
  it('undoOpen respects the window', () => {
    const now = Date.parse('2026-10-01T12:00:00Z');
    const c = card('x', { state: { status: 'applied', changeId: 'ch', undoUntil: '2026-10-01T12:00:30Z' } });
    expect(undoOpen(c, now)).toBe(true);
    expect(undoOpen(c, now + 31_000)).toBe(false);
    expect(undoOpen(card('y', { state: { status: 'undone', changeId: 'ch', undoUntil: '2026-10-02T00:00:00Z' } }), now)).toBe(false);
  });
  it('clockTime formats a lowercase meridiem', () => {
    expect(clockTime('2026-10-01T14:14:00')).toMatch(/^2:14 pm$/);
    expect(clockTime(undefined)).toBe('');
  });
});
