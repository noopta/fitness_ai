// G3 · the weight-cut flag: fixed thresholds, the acknowledgement rules, the card.
import { describe, it, expect, vi } from 'vitest';

vi.mock('@prisma/client', async () => ({ PrismaClient: (await import('./helpers/memPrisma.js')).PrismaClient }));
vi.mock('../services/cacheService.js', () => ({ cacheDelete: vi.fn(), cacheClearByPrefix: vi.fn(), cacheGet: vi.fn(), cacheSet: vi.fn(), cacheMarkStale: vi.fn() }));

const S = await import('../proactive/safety.js');
const today = '2026-10-30';
const w = (d: number, kg: number) => ({ date: `2026-10-${d}`, weightKg: kg });

describe('weightCutCheck', () => {
  it('flags ≥ 5% lost inside 7 days with ≥ 4 weigh-ins', () => {
    const f = S.weightCutCheck([w(24, 77.6), w(26, 76.2), w(28, 74.9), w(30, 73.5)], today, null, { hasEvent: true })!;
    expect(f).toMatchObject({ lossKg: 4.1, pct: 5.3, days: 6, weighIns: 4, acute: false, returned: null });
    expect(f.headline).toBe('You\'re down 4.1 kg in 6 days — 5.3% of your weight. That\'s faster than I\'d call safe, even for a fight.');
    expect(f.help).toMatch(/I can't mute this one/);
  });
  it('needs four weigh-ins and the full 5%; old weigh-ins don\'t count', () => {
    expect(S.weightCutCheck([w(24, 77.6), w(28, 74.9), w(30, 73.5)], today)).toBeNull();
    expect(S.weightCutCheck([w(24, 77.6), w(26, 77), w(28, 76), w(30, 75)], today)).toBeNull();
    expect(S.weightCutCheck([{ date: '2026-10-10', weightKg: 80 }, w(26, 76.2), w(28, 74.9), w(30, 73.5)], today)).toBeNull();
  });
  it('acute at 8% in a week — quiet hours don\'t hold it', () => {
    expect(S.weightCutCheck([w(24, 80), w(26, 78), w(28, 75), w(30, 73)], today)!.acute).toBe(true);
  });
  it('"my coach is managing it" pauses for 7 days; it returns if the rate is worse or total loss passes 7%', () => {
    const ins = [w(24, 77.6), w(26, 76.2), w(28, 74.9), w(30, 73.5)];
    const ack = { at: '2026-10-28T08:00:00Z', ratePct: 5.3, startKg: 73.5 };
    expect(S.weightCutCheck(ins, today, ack)).toBeNull();
    expect(S.weightCutCheck([w(24, 78.5), w(26, 76.2), w(28, 74.9), w(30, 73.5)], today, ack)!.returned).toBe('rate_worse');
    expect(S.weightCutCheck(ins, today, { ...ack, startKg: 79.5 })!.returned).toBe('total');
    expect(S.weightCutCheck(ins, today, { ...ack, at: '2026-10-15T08:00:00Z' })!.returned).toBeNull(); // the ack lapsed → a normal flag again
  });
});

describe('the card', () => {
  const flag = S.weightCutCheck([w(24, 77.6), w(26, 76.2), w(28, 74.9), w(30, 73.5)], today)!;
  it('has no "Not now" and no "Stop asking"; the coach option only when a coach runs the program', () => {
    const solo = S.safetyCard(flag, { coachRuns: false, eventLabel: 'Fight · Nov 22', eventId: 'e' });
    expect(solo.actions?.map((a) => a.label)).toEqual(['Help me slow it down', 'That weigh-in was wrong']);
    expect(JSON.stringify(solo)).not.toMatch(/Not now|Stop asking/);
    const coached = S.safetyCard(flag, { coachRuns: true, eventLabel: null, eventId: 'e' });
    expect(coached.actions?.map((a) => a.label)).toEqual(['Help me slow it down', 'My coach is managing it', 'That weigh-in was wrong']);
    expect((coached.pending?.actions?.coach as any).op).toBe('proactive.safety_ack');
    expect(solo.rows?.map((r) => r.value)).toEqual(['4 weigh-ins this week', 'Fight · Nov 22']);
    expect(solo.note).toBe(S.HELP_LINE);
  });
  it('receipts: the weigh-ins and the event', () => {
    expect(S.safetyReceipts(flag, 'Fight · Nov 22')).toEqual([{ verb: 'Checked', text: 'Weight · 4 weigh-ins this week' }, { verb: 'Checked', text: 'Fight · Nov 22' }]);
  });
  it('the thresholds are constants awaiting clinician review', () => {
    expect(S.CUT_RATE_PCT).toBe(5); expect(S.CUT_TOTAL_PCT).toBe(7); expect(S.MIN_WEIGHINS).toBe(4); expect(S.ACK_DAYS).toBe(7);
  });
});
