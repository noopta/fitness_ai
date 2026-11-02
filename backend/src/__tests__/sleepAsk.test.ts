// "How did you sleep?" at most once a day, from either source.
import { describe, it, expect } from 'vitest';
import { sleepAskAllowed, SLEEP_ASKED_KEY } from '../services/sleepAsk.js';

describe('sleepAskAllowed', () => {
  it('asks when there is no check-in and it has not been asked today', () => {
    expect(sleepAskAllowed({}, '2026-11-02', false)).toBe(true);
    expect(sleepAskAllowed({ [SLEEP_ASKED_KEY]: '2026-11-01' }, '2026-11-02', false)).toBe(true);
  });
  it('not after a check-in, and not twice in a day', () => {
    expect(sleepAskAllowed({}, '2026-11-02', true)).toBe(false);
    expect(sleepAskAllowed({ [SLEEP_ASKED_KEY]: '2026-11-02' }, '2026-11-02', false)).toBe(false);
  });
});
