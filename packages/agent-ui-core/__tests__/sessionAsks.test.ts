// The Move / swap buttons' messages (Oct 29 2026): Tarek got "Can we move Tuesday on Tue?" and a swap that said Monday for a Thursday.
import { describe, it, expect } from 'vitest';
import { moveSessionAsk, swapSessionsAsk, sessionFocus, weekdayName } from '../src/training';

describe('session asks', () => {
  it('the focus drops the weekday prefix', () => {
    expect(sessionFocus('Monday — Push')).toBe('Push');
    expect(sessionFocus('Tuesday')).toBeNull();
    expect(sessionFocus('Upper A')).toBe('Upper A');
  });
  it('the day comes from the date, never the session name', () => {
    expect(weekdayName('2026-10-22')).toBe('Thursday');
    expect(weekdayName('Tue')).toBe('Tuesday');
  });
  it('move', () => {
    expect(moveSessionAsk({ name: 'Tuesday', dow: 'Tue', date: '2026-10-27' })).toBe('Can we move my Tuesday session to another day this week?');
    expect(moveSessionAsk({ name: 'Monday — Push', date: '2026-10-22' })).toBe('Can we move my Thursday session (Push) to another day this week?');
  });
  it('swap', () => {
    expect(swapSessionsAsk({ n: 'Monday — Push', d: 'Thu', date: '2026-10-22' }, { d: 'Tue', date: '2026-10-20' })).toBe('Swap my Thursday session (Push) with Tuesday this week.');
    expect(swapSessionsAsk({ n: 'Legs', d: 'Sat' }, { n: 'Upper', d: 'Mon' })).toBe('Swap my Saturday session (Legs) with Monday (Upper) this week.');
  });
});
