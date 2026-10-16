/**
 * Billing and scheduling helpers shared by the trainer dashboard and the
 * client portal: money, minute-of-day times, availability checks, weeks.
 */

import { describe, it, expect } from 'vitest';
import type { AvailabilityWindow, BookingView, OfferView, Slot } from '@axiom/personal-training-core';
import {
  bookingsByDay, creditComesBack, dayKey, formatLocalDate, formatMinute, formatMoney, groupSlotsByDate, inputToMinute,
  intervalLabel, minuteToInput, offerSummary, parseMoneyToCents, validateWindows, weekOf,
} from '@/features/personal-training/businessFormat';

const offer = (over: Partial<OfferView> = {}): OfferView => ({
  id: 'o1', name: 'Monthly', description: '', kind: 'subscription', priceCents: 6000, currency: 'gbp',
  interval: 'month', intervalCount: 1, sessionCredits: 4, active: true, ...over,
});
const win = (over: Partial<AvailabilityWindow> = {}): AvailabilityWindow => ({ weekday: 1, startMinute: 540, endMinute: 720, slotMinutes: 60, location: null, ...over });

describe('money', () => {
  it('formats in the offer currency, dropping .00 on whole amounts', () => {
    expect(formatMoney(6000, 'gbp', 'en-GB')).toBe('£60');
    expect(formatMoney(5999, 'usd', 'en-US')).toBe('$59.99');
    expect(formatMoney(120000, 'eur', 'en-IE')).toBe('€1,200');
  });
  it('falls back on an unknown currency code', () => {
    expect(formatMoney(1050, 'zz', 'en-GB')).toMatch(/10\.50/);
  });
  it('parses major units into cents', () => {
    expect(parseMoneyToCents('60')).toBe(6000);
    expect(parseMoneyToCents('59.9')).toBe(5990);
    expect(parseMoneyToCents('1,200.05')).toBe(120005);
    expect(parseMoneyToCents('£45')).toBe(4500);
    expect(parseMoneyToCents('12.345')).toBeNull();
    expect(parseMoneyToCents('abc')).toBeNull();
    expect(parseMoneyToCents('')).toBeNull();
  });
  it('describes intervals and offers', () => {
    expect(intervalLabel(offer())).toBe('/ month');
    expect(intervalLabel(offer({ interval: 'week', intervalCount: 2 }))).toBe('every 2 weeks');
    expect(intervalLabel(offer({ kind: 'package', interval: null }))).toBe('package');
    expect(intervalLabel(offer({ kind: 'one_time', interval: null }))).toBe('one-off');
    expect(offerSummary(offer(), 'en-GB')).toBe('£60 / month · 4 sessions each month');
    expect(offerSummary(offer({ kind: 'package', interval: null, sessionCredits: 10, priceCents: 50000 }), 'en-GB')).toBe('£500 package · 10 sessions');
  });
});

describe('minute-of-day times', () => {
  it('round-trips the time input value', () => {
    expect(minuteToInput(450)).toBe('07:30');
    expect(minuteToInput(0)).toBe('00:00');
    expect(inputToMinute('07:30')).toBe(450);
    expect(inputToMinute('24:00')).toBe(1440);
    expect(inputToMinute('24:30')).toBeNull();
    expect(inputToMinute('7:5')).toBeNull();
  });
  it('formats a minute without any time-zone shift', () => {
    expect(formatMinute(450, 'en-US')).toBe('7:30 AM');
    expect(formatMinute(1080, 'en-GB')).toBe('18:00');
  });
  it('formats a calendar date as that date', () => {
    expect(formatLocalDate('2026-10-14', 'en-GB')).toBe('Wed 14 Oct');
  });
  it('groups slots by local date in time order', () => {
    const s = (localDate: string, localMinute: number): Slot => ({ trainerId: 't', trainerName: 'K', startsAt: `${localDate}T00:00:00Z`, endsAt: '', location: null, localDate, localMinute });
    const groups = groupSlotsByDate([s('2026-10-15', 600), s('2026-10-14', 720), s('2026-10-14', 540)]);
    expect(groups.map((g) => [g.date, g.slots.map((x) => x.localMinute)])).toEqual([['2026-10-14', [540, 720]], ['2026-10-15', [600]]]);
  });
});

describe('availability validation', () => {
  it('accepts sensible windows', () => {
    expect(validateWindows([win(), win({ weekday: 2 }), win({ startMinute: 780, endMinute: 900 })]).size).toBe(0);
  });
  it('flags start after end, bad lengths, too-short windows and overlaps', () => {
    const errors = validateWindows([
      win({ startMinute: 700, endMinute: 600 }),
      win({ weekday: 3, slotMinutes: 25 }),
      win({ weekday: 4, startMinute: 540, endMinute: 570 }),
      win({ weekday: 5, startMinute: 540, endMinute: 720 }),
      win({ weekday: 5, startMinute: 660, endMinute: 780 }),
    ]);
    expect(errors.get(0)).toMatch(/before end/);
    expect(errors.get(1)).toMatch(/15–120/);
    expect(errors.get(2)).toMatch(/at least one session/);
    expect(errors.get(3)).toMatch(/Overlaps another Friday/);
    expect(errors.get(4)).toMatch(/Overlaps/);
  });
});

describe('weeks and bookings', () => {
  it('starts the week on Monday', () => {
    const w = weekOf(new Date(2026, 9, 18)); // Sunday 18 Oct
    expect(dayKey(w.start)).toBe('2026-10-12');
    expect(w.days.map(dayKey)).toHaveLength(7);
    expect(dayKey(w.end)).toBe('2026-10-19');
    expect(dayKey(weekOf(new Date(2026, 9, 12)).start)).toBe('2026-10-12');
  });
  it('buckets bookings by local day in start order', () => {
    const b = (id: string, h: number): BookingView => ({
      id, clientId: 'c', clientName: 'C', trainerId: 't', startsAt: new Date(2026, 9, 14, h).toISOString(), endsAt: new Date(2026, 9, 14, h + 1).toISOString(),
      status: 'booked', source: 'trainer', usedCredit: false, location: null, notes: null,
    });
    const by = bookingsByDay([b('late', 18), b('early', 7)]);
    expect(by.get('2026-10-14')?.map((x) => x.id)).toEqual(['early', 'late']);
  });
  it('says the credit comes back with 24 hours or more of notice', () => {
    const now = new Date('2026-10-14T10:00:00Z');
    expect(creditComesBack({ usedCredit: true, startsAt: '2026-10-15T10:00:00Z' }, now)).toBe(true);
    expect(creditComesBack({ usedCredit: true, startsAt: '2026-10-15T09:59:00Z' }, now)).toBe(false);
    expect(creditComesBack({ usedCredit: false, startsAt: '2026-10-20T10:00:00Z' }, now)).toBe(false);
  });
});
