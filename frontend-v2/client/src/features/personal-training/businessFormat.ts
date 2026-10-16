// Pure helpers for billing and scheduling, shared by the trainer dashboard
// and the client portal: money, minute-of-day times, availability checks and
// week ranges. No DOM, no time-zone maths beyond the viewer's own clock.

import type { AvailabilityWindow, BookingView, OfferView, Slot } from '@axiom/personal-training-core';

// ─── Money ───────────────────────────────────────────────────────────────────

/** "£60.00" / "$1,200" in the offer's currency; whole amounts drop the decimals. */
export function formatMoney(cents: number, currency: string, locale?: string): string {
  const amount = cents / 100;
  const whole = Number.isInteger(amount);
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency', currency: currency.toUpperCase(),
      minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(whole ? 0 : 2)} ${currency.toUpperCase()}`;
  }
}

/** "60", "60.5", "1,200.00" (major units) → cents; null when it is not a price. */
export function parseMoneyToCents(input: string): number | null {
  const s = input.trim().replace(/[,\s]/g, '').replace(/^[^\d.]+/, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

const INTERVAL_LABEL: Record<NonNullable<OfferView['interval']>, [string, string]> = {
  week: ['week', 'weeks'], month: ['month', 'months'], year: ['year', 'years'],
};

/** "/ month", "every 2 weeks", "one-off". */
export function intervalLabel(offer: Pick<OfferView, 'kind' | 'interval' | 'intervalCount'>): string {
  if (offer.kind !== 'subscription' || !offer.interval) return offer.kind === 'package' ? 'package' : 'one-off';
  const n = Math.max(1, offer.intervalCount || 1);
  const [one, many] = INTERVAL_LABEL[offer.interval];
  return n === 1 ? `/ ${one}` : `every ${n} ${many}`;
}

/** "£60 / month · 4 sessions". */
export function offerSummary(offer: OfferView, locale?: string): string {
  const parts = [`${formatMoney(offer.priceCents, offer.currency, locale)} ${intervalLabel(offer)}`];
  if (offer.sessionCredits) parts.push(`${offer.sessionCredits} ${offer.sessionCredits === 1 ? 'session' : 'sessions'}${offer.kind === 'subscription' ? ` each ${offer.interval ?? 'period'}` : ''}`);
  return parts.join(' · ');
}

// ─── Minute-of-day times ─────────────────────────────────────────────────────

/** 450 → "07:30" (the value an <input type="time"> takes). */
export function minuteToInput(m: number): string {
  const h = Math.floor(m / 60) % 24;
  return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** "07:30" → 450; null for anything else. "24:00" is allowed as the end of a day. */
export function inputToMinute(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59 || h > 24 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

/**
 * A minute of the day as a clock time in the viewer's locale ("7:30 am",
 * "07:30"), formatted in UTC so no time zone can shift it.
 */
export function formatMinute(m: number, locale?: string): string {
  return new Date(Date.UTC(2000, 0, 1, Math.floor(m / 60) % 24, m % 60)).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
}

/** "Tue 14 Oct" for a YYYY-MM-DD calendar date, read as that date everywhere. */
export function formatLocalDate(date: string, locale?: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** Open slots grouped by the practice's local date, in order. */
export function groupSlotsByDate(slots: Slot[]): { date: string; slots: Slot[] }[] {
  const by = new Map<string, Slot[]>();
  for (const s of [...slots].sort((a, b) => a.localDate.localeCompare(b.localDate) || a.localMinute - b.localMinute)) {
    const list = by.get(s.localDate);
    if (list) list.push(s); else by.set(s.localDate, [s]);
  }
  return Array.from(by, ([date, list]) => ({ date, slots: list }));
}

// ─── Availability ────────────────────────────────────────────────────────────

export const SESSION_LENGTHS = [15, 20, 30, 45, 50, 60, 75, 90, 120] as const;
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The same rules the server applies, so the editor can say what is wrong before saving. Index → message. */
export function validateWindows(windows: AvailabilityWindow[]): Map<number, string> {
  const errors = new Map<number, string>();
  windows.forEach((w, i) => {
    if (!Number.isInteger(w.startMinute) || !Number.isInteger(w.endMinute) || w.startMinute < 0 || w.endMinute > 24 * 60 || w.endMinute <= w.startMinute) {
      errors.set(i, 'Start must be before end.');
    } else if (!(SESSION_LENGTHS as readonly number[]).includes(w.slotMinutes)) {
      errors.set(i, 'Sessions must be 15–120 minutes.');
    } else if (w.endMinute - w.startMinute < w.slotMinutes) {
      errors.set(i, 'The window must fit at least one session.');
    }
  });
  windows.forEach((a, i) => {
    if (errors.has(i)) return;
    windows.forEach((b, j) => {
      if (i !== j && a.weekday === b.weekday && a.startMinute < b.endMinute && b.startMinute < a.endMinute) errors.set(i, `Overlaps another ${WEEKDAYS[a.weekday]} window.`);
    });
  });
  if (windows.length > 50) errors.set(50, 'At most 50 windows.');
  return errors;
}

// ─── Weeks and bookings ──────────────────────────────────────────────────────

/** Monday 00:00 (local) of the week holding `d`, and the seven days from it. */
export function weekOf(d: Date): { start: Date; end: Date; days: Date[] } {
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const days = Array.from({ length: 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  return { start, end, days };
}

/** YYYY-MM-DD of a Date in the viewer's own time zone. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Bookings bucketed by the viewer's local day, each day in start order. */
export function bookingsByDay(bookings: BookingView[]): Map<string, BookingView[]> {
  const out = new Map<string, BookingView[]>();
  for (const b of [...bookings].sort((x, y) => x.startsAt.localeCompare(y.startsAt))) {
    const k = dayKey(new Date(b.startsAt));
    const list = out.get(k);
    if (list) list.push(b); else out.set(k, [b]);
  }
  return out;
}

/** Used only when a booking does not say (older servers); the server's own rule travels on each booking. */
export const DEFAULT_CANCEL_NOTICE_HOURS = 24;

export function noticeHours(booking: Pick<BookingView, 'cancelNoticeHours'>): number {
  return typeof booking.cancelNoticeHours === 'number' && booking.cancelNoticeHours >= 0 ? booking.cancelNoticeHours : DEFAULT_CANCEL_NOTICE_HOURS;
}

/** Whether a client cancelling now would get the session credit back (the server has the final word). */
export function creditComesBack(booking: Pick<BookingView, 'startsAt' | 'usedCredit' | 'cancelNoticeHours'>, now: Date = new Date()): boolean {
  return booking.usedCredit && new Date(booking.startsAt).getTime() - now.getTime() >= noticeHours(booking) * 3_600_000;
}

/** "7:30 am – 8:30 am" from ISO instants, in the viewer's own clock. */
export function formatTimeRange(startsAt: string, endsAt: string, locale?: string): string {
  const f = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  return `${f(startsAt)} – ${f(endsAt)}`;
}

/** "Tue 14 Oct" from an ISO instant in the viewer's own clock. */
export function formatInstantDay(iso: string, locale?: string): string {
  return new Date(iso).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
}
