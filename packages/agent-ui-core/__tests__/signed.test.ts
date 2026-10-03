import { describe, it, expect } from 'vitest';
import { signedLayout, stampLabel, workingLabel, turnA11yLabel, GROUP_MS } from '../src/signed';
import type { Turn } from '../src/receipts';

// Local-time dates, so the tests hold in any time zone.
const at = (d: number, h: number, m: number) => new Date(2026, 9, d, h, m).getTime();
const NOW = at(3, 14, 0); // Sat 3 Oct 2026, 2:00 pm
const user = (id: string, t?: number): Turn => ({ id, kind: 'user', text: 'hi', receipts: [], done: true, at: t });
const agent = (id: string, t?: number, extra: Partial<Turn> = {}): Turn => ({ id, kind: 'agent', text: 'ok', receipts: [], done: true, at: t, ...extra });

describe('stampLabel', () => {
  it('says Today / Yesterday with a 12-hour clock, else the date', () => {
    expect(stampLabel(at(3, 13, 57), NOW)).toBe('Today 1:57');
    expect(stampLabel(at(2, 18, 10), NOW)).toBe('Yesterday 6:10');
    expect(stampLabel(at(3, 0, 5), NOW)).toBe('Today 12:05');
    expect(stampLabel(new Date(2026, 8, 28, 9, 0).getTime(), NOW)).toBe('Mon 28 Sep');
  });
});

describe('signedLayout', () => {
  it('stamps the first turn, then only after a new day or a gap over 10 minutes', () => {
    const s = signedLayout([user('u1', at(3, 13, 0)), agent('a1', at(3, 13, 1)), user('u2', at(3, 13, 12)), agent('a2', at(3, 13, 12))], NOW);
    expect(s.map((x) => x.stamp)).toEqual(['Today 1:00', null, 'Today 1:12', null]);
  });

  it('stamps a new day even when the gap is short', () => {
    const s = signedLayout([user('u1', at(2, 23, 58)), agent('a1', at(3, 0, 1))], NOW);
    expect(s[1].stamp).toBe('Today 12:01');
  });

  it('groups consecutive user messages within 2 minutes under one label', () => {
    const t0 = at(3, 13, 0);
    const s = signedLayout([user('u1', t0), user('u2', t0 + 60_000), user('u3', t0 + 60_000 + GROUP_MS + 1)], NOW);
    expect(s.map((x) => x.showLabel)).toEqual([true, false, true]);
    expect(s.map((x) => x.grouped)).toEqual([false, true, false]);
  });

  it('always signs agent turns and never labels them as You', () => {
    const s = signedLayout([agent('a1', at(3, 13, 0)), agent('a2', at(3, 13, 0))], NOW);
    expect(s.every((x) => x.showSignature && !x.showLabel)).toBe(true);
  });

  it('shows no stamp for turns without a time', () => {
    const s = signedLayout([user('u1'), agent('a1')], NOW);
    expect(s.map((x) => x.stamp)).toEqual([null, null]);
    expect(s[0].showLabel).toBe(true);
  });
});

describe('workingLabel', () => {
  const r = (verb: any) => ({ id: verb, verb, text: '' });
  it('follows the latest receipt while working, then clears', () => {
    expect(workingLabel(agent('a', 0, { done: false, text: '' }))).toBe('Anakin is thinking…');
    expect(workingLabel(agent('a', 0, { done: false, text: '', receipts: [r('Read')] }))).toBe('Anakin is reading your logs…');
    expect(workingLabel(agent('a', 0, { done: false, text: '', receipts: [r('Read'), r('Checked')] }))).toBe('Anakin is checking your week…');
    expect(workingLabel(agent('a', 0, { done: false, text: '', receipts: [r('Proposed')] }))).toBe('Anakin is drafting…');
    expect(workingLabel(agent('a', 0, { done: false, text: 'Thu' }))).toBe('Anakin is writing…');
    expect(workingLabel(agent('a', 0, { done: true }))).toBeNull();
  });
});

describe('turnA11yLabel', () => {
  it('reads as one line with the speaker first', () => {
    expect(turnA11yLabel(agent('a', 0, { text: "**Thursday's** Upper\nfits today." }))).toBe("Anakin: Thursday's Upper fits today.");
    expect(turnA11yLabel(user('u'))).toBe('You: hi');
  });
});
