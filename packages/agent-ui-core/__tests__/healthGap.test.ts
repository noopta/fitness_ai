import { describe, it, expect } from 'vitest';
import { healthGapNotice, parseHealthReport } from '../src/healthGap';

const raw = (failed: string[], empty: string[]) => JSON.stringify({ failed, empty });

describe('parseHealthReport', () => {
  it('reads a report and ignores anything else', () => {
    expect(parseHealthReport(raw(['sleep'], []))).toEqual({ failed: ['sleep'], empty: [] });
    expect(parseHealthReport('Google stopped accepting our access')).toBeNull();
    expect(parseHealthReport('{"x":1}')).toBeNull();
    expect(parseHealthReport(null)).toBeNull();
  });
});

describe('healthGapNotice', () => {
  it('nothing missing, nothing shown', () => {
    expect(healthGapNotice(null)).toBeNull();
    expect(healthGapNotice(raw([], []))).toBeNull();
  });
  it('stays quiet about types plenty of people never have', () => {
    expect(healthGapNotice(raw([], ['workouts', 'vo2']))).toBeNull();
  });
  it('names one thing once, whichever heart signals are missing', () => {
    expect(healthGapNotice(raw([], ['restingHr', 'hrv']))?.title).toBe('No heart rate from Apple Health');
    expect(healthGapNotice(raw([], ['sleep', 'restingHr', 'hrv']))?.title).toBe('No sleep or heart rate from Apple Health');
  });
  it('gives the fix without claiming they turned it off', () => {
    const n = healthGapNotice(raw([], ['sleep']))!;
    expect(n.sub).toContain('Health → Sharing → Apps → Axiom');
    expect(n.sub).toContain('iPhone alone');
  });
  it('a real read failure is said to be ours, and wins over empties', () => {
    const n = healthGapNotice(raw(['sleep'], ['restingHr']))!;
    expect(n.title).toBe('Couldn’t read your sleep');
    expect(n.sub).toContain('my side');
  });
  it('Fitbit error text is not a report', () => {
    expect(healthGapNotice('token expired')).toBeNull();
  });
});
