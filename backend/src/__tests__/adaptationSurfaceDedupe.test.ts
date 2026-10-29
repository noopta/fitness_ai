// Suggestions don't repeat (Oct 29 2026): Tarek got 33 cards (11 distinct) in a week.
import { describe, it, expect } from 'vitest';
import { pickToSurface, suggestionSig } from '../agent/adaptationSurfacePick.js';

const now = Date.parse('2026-10-29T12:00:00Z');
const h = (x: number) => now - x * 3600_000;
const p = (id: string, title: string) => ({ id, title });

describe('pickToSurface', () => {
  it('one card per title, even when the detectors re-filed it', () => {
    const r = pickToSurface([p('a', 'Your Lateral Raise is ahead of plan'), p('b', 'Your lateral raise is ahead of plan'), p('c', 'Deload week')], [], now);
    expect(r.map((x) => x.id)).toEqual(['a', 'c']);
  });
  it('a suggestion shown twice in 14 days stays on Training', () => {
    const shown = [{ proposalId: 'old1', title: 'Proposed · Your Lateral Raise is ahead of plan', at: h(24 * 5) }, { proposalId: 'old2', title: 'Proposed · Your Lateral Raise is ahead of plan', at: h(24 * 3) }];
    expect(pickToSurface([p('new', 'Your Lateral Raise is ahead of plan')], shown, now)).toEqual([]);
    expect(pickToSurface([p('x', 'Bench press: add 5 lb')], shown, now).map((x) => x.id)).toEqual(['x']);
  });
  it('at most one suggestion message a day (force skips the gap only)', () => {
    const shown = [{ proposalId: 'z', title: 'Proposed · Deload week', at: h(3) }];
    expect(pickToSurface([p('x', 'Bench press: add 5 lb')], shown, now)).toEqual([]);
    expect(pickToSurface([p('x', 'Bench press: add 5 lb')], shown, now, { force: true }).map((x) => x.id)).toEqual(['x']);
  });
  it('old showings fall out of the window', () => {
    const shown = [1, 2].map((i) => ({ proposalId: `o${i}`, title: 'Deload week', at: h(24 * (15 + i)) }));
    expect(pickToSurface([p('d', 'Deload week')], shown, now).map((x) => x.id)).toEqual(['d']);
  });
  it('signature ignores the card prefix and punctuation', () => {
    expect(suggestionSig('Proposed · Your Lateral Raise is ahead of plan!')).toBe(suggestionSig('your lateral raise is ahead of plan'));
  });
});
