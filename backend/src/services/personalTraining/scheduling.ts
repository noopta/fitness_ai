// Scheduling (handoff B8): the trainer's weekly availability, clients booking
// open slots themselves from their portal, a session credit taken from their
// package, and a reminder the day before.
//
// Times: availability is written in the practice's local time (its profile
// time zone, else the trainer's, else Eastern) and every booking is stored as
// an instant. A slot is "`trainerId`|`startsAt`" and is unique while booked,
// so two clients can never hold the same hour, even racing.

import { consumeCredit, refundCredit } from './billing.js';
import { audit, sendAutomated } from './drafts.js';
import { prisma } from './db.js';
import { notifyLinkClient } from './links.js';
import { DEFAULT_TZ } from './status.js';
import type { AvailabilityWindow, BookingView, Slot } from './types.js';

const MIN_MS = 60_000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS = 24 * HOUR_MS;
/** A client can cancel and get their credit back up to this many hours before. */
export const CANCEL_NOTICE_HOURS = Number(process.env.PT_CANCEL_NOTICE_HOURS ?? 24);
/** Slots open from this many hours ahead, so nobody books the hour that is about to start. */
const MIN_LEAD_HOURS = 2;

export class ScheduleError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ScheduleError';
    this.status = status;
    this.code = code;
  }
}

export async function practiceTimezone(practiceId: string, trainerId?: string): Promise<string> {
  const p = await prisma.ptPracticeProfile.findUnique({ where: { practiceId }, select: { timezone: true } });
  if (p?.timezone) return p.timezone;
  if (trainerId) {
    const u = await prisma.user.findUnique({ where: { id: trainerId }, select: { timezone: true } as any }).catch(() => null) as { timezone?: string | null } | null;
    if (u?.timezone) return u.timezone;
  }
  return DEFAULT_TZ;
}

/** The UTC instant for a local wall-clock time in `tz`. Pure; exported for tests. */
export function zonedInstant(date: string, minuteOfDay: number, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, Math.floor(minuteOfDay / 60), minuteOfDay % 60);
  // The offset of `tz` at that moment, found by formatting the guess there and measuring the difference.
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asLocal = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'));
  const offset = asLocal - guess;
  const first = guess - offset;
  // Recheck once across a DST change.
  const p2 = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(first));
  const h2 = Number(p2.find((p) => p.type === 'hour')?.value) % 24;
  const m2 = Number(p2.find((p) => p.type === 'minute')?.value);
  const drift = (h2 * 60 + m2 - minuteOfDay) * MIN_MS;
  return new Date(first - (Math.abs(drift) < 3 * HOUR_MS ? drift : 0));
}

const localDate = (d: Date, tz: string) => d.toLocaleDateString('en-CA', { timeZone: tz });
const localWeekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

// ── Availability ─────────────────────────────────────────────────────────────

export async function getAvailability(practiceId: string, trainerId: string): Promise<AvailabilityWindow[]> {
  const rows = await prisma.ptAvailability.findMany({ where: { practiceId, trainerId, active: true }, orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }] });
  return rows.map((r) => ({ id: r.id, weekday: r.weekday, startMinute: r.startMinute, endMinute: r.endMinute, slotMinutes: r.slotMinutes, location: r.location }));
}

/** Replace the trainer's weekly windows. Existing bookings are untouched. */
export async function setAvailability(practiceId: string, trainerId: string, raw: unknown): Promise<AvailabilityWindow[]> {
  if (!Array.isArray(raw) || raw.length > 50) throw new ScheduleError('windows must be a list (50 at most)', 400);
  const windows = raw.map((w: any) => {
    const weekday = Number(w?.weekday), start = Number(w?.startMinute), end = Number(w?.endMinute), slot = Number(w?.slotMinutes ?? 60);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new ScheduleError('weekday must be 0–6', 400);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 24 * 60 || end <= start) throw new ScheduleError('Each window needs a start before its end', 400);
    if (![15, 20, 30, 45, 50, 60, 75, 90, 120].includes(slot)) throw new ScheduleError('Sessions must be 15–120 minutes', 400);
    if (end - start < slot) throw new ScheduleError('A window must fit at least one session', 400);
    return { weekday, startMinute: start, endMinute: end, slotMinutes: slot, location: typeof w?.location === 'string' ? w.location.trim().slice(0, 120) || null : null };
  });
  for (const a of windows) for (const b of windows) {
    if (a !== b && a.weekday === b.weekday && a.startMinute < b.endMinute && b.startMinute < a.endMinute) throw new ScheduleError('Windows on the same day overlap', 400);
  }
  await prisma.ptAvailability.updateMany({ where: { practiceId, trainerId, active: true }, data: { active: false } });
  for (const w of windows) await prisma.ptAvailability.create({ data: { practiceId, trainerId, ...w } });
  await audit({ practiceId, trainerId, action: 'availability_set', itemType: 'schedule', itemId: trainerId, meta: { windows: windows.length } });
  return getAvailability(practiceId, trainerId);
}

/** Open slots over the next `days`, every trainer of the practice who has availability. */
export async function openSlots(practiceId: string, opts: { days?: number; now?: Date } = {}): Promise<Slot[]> {
  const now = opts.now ?? new Date();
  const days = Math.min(42, Math.max(1, opts.days ?? 14));
  const windows = await prisma.ptAvailability.findMany({ where: { practiceId, active: true } });
  if (windows.length === 0) return [];
  const tz = await practiceTimezone(practiceId, windows[0].trainerId);
  const until = new Date(now.getTime() + (days + 1) * DAY_MS);
  const taken = await prisma.ptBooking.findMany({ where: { practiceId, status: 'booked', startsAt: { gte: now, lte: until } }, select: { trainerId: true, startsAt: true, endsAt: true } });
  const trainers = await prisma.user.findMany({ where: { id: { in: [...new Set(windows.map((w) => w.trainerId))] } }, select: { id: true, name: true } });
  const nameOf = new Map(trainers.map((t) => [t.id, t.name?.trim() || 'Your trainer']));
  const out: Slot[] = [];
  for (let i = 0; i <= days; i++) {
    const date = localDate(new Date(now.getTime() + i * DAY_MS), tz);
    const weekday = localWeekday(date);
    for (const w of windows.filter((x) => x.weekday === weekday)) {
      for (let m = w.startMinute; m + w.slotMinutes <= w.endMinute; m += w.slotMinutes) {
        const startsAt = zonedInstant(date, m, tz);
        const endsAt = new Date(startsAt.getTime() + w.slotMinutes * MIN_MS);
        if (startsAt.getTime() < now.getTime() + MIN_LEAD_HOURS * HOUR_MS) continue;
        if (taken.some((t) => t.trainerId === w.trainerId && t.startsAt < endsAt && startsAt < t.endsAt)) continue;
        out.push({ trainerId: w.trainerId, trainerName: nameOf.get(w.trainerId)!, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), location: w.location, localDate: date, localMinute: m });
      }
    }
  }
  const seen = new Set<string>();
  return out.filter((s) => { const k = `${s.trainerId}|${s.startsAt}`; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

// ── Bookings ─────────────────────────────────────────────────────────────────

type Row = Awaited<ReturnType<typeof prisma.ptBooking.findMany>>[number];
const view = (b: Row, names: Map<string, string>): BookingView => ({
  id: b.id, clientId: b.clientId, clientName: names.get(b.clientId) ?? 'Client', trainerId: b.trainerId, startsAt: b.startsAt.toISOString(), endsAt: b.endsAt.toISOString(),
  status: b.status as BookingView['status'], source: b.source as BookingView['source'], usedCredit: !!b.planId, location: b.location, notes: b.notes,
});

async function names(ids: string[]) {
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name?.trim() || 'Client']));
}

/**
 * Book a slot. From the portal, the slot must be one the trainer offered; a
 * trainer may book any time. A session credit is taken when the client has
 * one; if the practice requires credits and there is none, it is refused.
 */
export async function book(input: { practiceId: string; clientId: string; trainerId?: string; startsAt: unknown; by: 'client' | 'trainer'; minutes?: unknown; notes?: unknown; now?: Date }): Promise<BookingView> {
  const now = input.now ?? new Date();
  const startsAt = typeof input.startsAt === 'string' ? new Date(input.startsAt) : null;
  if (!startsAt || Number.isNaN(startsAt.getTime())) throw new ScheduleError('startsAt must be a time', 400);
  if (startsAt.getTime() < now.getTime()) throw new ScheduleError('That time has passed', 400);

  let trainerId = input.trainerId;
  let endsAt: Date;
  let location: string | null = null;
  if (input.by === 'client') {
    const slot = (await openSlots(input.practiceId, { days: 42, now })).find((s) => s.startsAt === startsAt.toISOString() && (!trainerId || s.trainerId === trainerId));
    if (!slot) throw new ScheduleError('That time is no longer available', 409, 'slot_taken');
    trainerId = slot.trainerId;
    endsAt = new Date(slot.endsAt);
    location = slot.location;
  } else {
    const minutes = Number(input.minutes ?? 60);
    if (!Number.isInteger(minutes) || minutes < 15 || minutes > 240) throw new ScheduleError('minutes must be 15–240', 400);
    endsAt = new Date(startsAt.getTime() + minutes * MIN_MS);
    const clash = await prisma.ptBooking.findFirst({ where: { practiceId: input.practiceId, trainerId: trainerId!, status: 'booked', startsAt: { lt: endsAt }, endsAt: { gt: startsAt } } });
    if (clash) throw new ScheduleError('You already have a session then', 409, 'slot_taken');
  }

  const acct = await prisma.ptStripeAccount.findUnique({ where: { practiceId: input.practiceId }, select: { bookingNeedsCredit: true } });
  const planId = await consumeCredit(input.practiceId, input.clientId);
  if (!planId && acct?.bookingNeedsCredit && input.by === 'client') throw new ScheduleError('You have no sessions left. Buy a package or ask your trainer.', 409, 'no_credit');

  try {
    const row = await prisma.ptBooking.create({
      data: {
        practiceId: input.practiceId, trainerId: trainerId!, clientId: input.clientId, startsAt, endsAt, slotKey: `${trainerId}|${startsAt.toISOString()}`,
        source: input.by === 'client' ? 'portal' : 'trainer', planId, location, notes: typeof input.notes === 'string' ? input.notes.trim().slice(0, 300) || null : null,
      },
    });
    await audit({ practiceId: input.practiceId, trainerId: trainerId!, clientId: input.clientId, action: 'session_booked', itemType: 'booking', itemId: row.id, meta: { by: input.by, credit: !!planId } });
    return view(row, await names([input.clientId]));
  } catch (err: any) {
    if (planId) await refundCredit(planId);
    if (err?.code === 'P2002') throw new ScheduleError('That time is no longer available', 409, 'slot_taken');
    throw err;
  }
}

export async function cancel(input: { practiceId: string; bookingId: string; by: 'client' | 'trainer'; actorId: string; clientId?: string; now?: Date }): Promise<BookingView> {
  const now = input.now ?? new Date();
  const row = await prisma.ptBooking.findUnique({ where: { id: input.bookingId } });
  if (!row || row.practiceId !== input.practiceId || (input.clientId && row.clientId !== input.clientId)) throw new ScheduleError('Session not found', 404);
  if (row.status !== 'booked') throw new ScheduleError('This session is not booked', 409);
  const lateForClient = input.by === 'client' && row.startsAt.getTime() - now.getTime() < CANCEL_NOTICE_HOURS * HOUR_MS;
  const updated = await prisma.ptBooking.update({ where: { id: row.id }, data: { status: 'cancelled', slotKey: null, cancelledAt: now } });
  // A trainer's cancel, or a client's with enough notice, gives the credit back.
  if (row.planId && !lateForClient) await refundCredit(row.planId);
  await audit({ practiceId: input.practiceId, trainerId: row.trainerId, clientId: row.clientId, action: 'session_cancelled', itemType: 'booking', itemId: row.id, meta: { by: input.by, creditReturned: !!row.planId && !lateForClient } });
  return view(updated, await names([row.clientId]));
}

export async function markSession(practiceId: string, trainerId: string, bookingId: string, status: unknown): Promise<BookingView> {
  if (status !== 'completed' && status !== 'no_show') throw new ScheduleError('status must be completed or no_show', 400);
  const row = await prisma.ptBooking.findUnique({ where: { id: bookingId } });
  if (!row || row.practiceId !== practiceId) throw new ScheduleError('Session not found', 404);
  const updated = await prisma.ptBooking.update({ where: { id: bookingId }, data: { status, slotKey: null } });
  await audit({ practiceId, trainerId, clientId: row.clientId, action: `session_${status}`, itemType: 'booking', itemId: bookingId });
  return view(updated, await names([row.clientId]));
}

export async function listBookings(practiceId: string, opts: { from?: Date; to?: Date; clientId?: string } = {}): Promise<BookingView[]> {
  const from = opts.from ?? new Date(Date.now() - 7 * DAY_MS);
  const to = opts.to ?? new Date(Date.now() + 42 * DAY_MS);
  const rows = await prisma.ptBooking.findMany({ where: { practiceId, startsAt: { gte: from, lte: to }, ...(opts.clientId ? { clientId: opts.clientId } : {}) }, orderBy: { startsAt: 'asc' } });
  const n = await names(rows.map((r) => r.clientId));
  return rows.map((r) => view(r, n));
}

/** Reminders for sessions starting in the next 24 hours. Idempotent: a reminder is claimed before it is sent. */
export async function sendReminders(now: Date = new Date()): Promise<number> {
  const due = await prisma.ptBooking.findMany({ where: { status: 'booked', reminderSentAt: null, startsAt: { gt: now, lte: new Date(now.getTime() + DAY_MS) } }, take: 100 });
  let sent = 0;
  for (const b of due) {
    const claimed = await prisma.ptBooking.updateMany({ where: { id: b.id, reminderSentAt: null }, data: { reminderSentAt: now } });
    if (claimed.count !== 1) continue;
    const tz = await practiceTimezone(b.practiceId, b.trainerId);
    const when = b.startsAt.toLocaleString('en-US', { timeZone: tz, weekday: 'long', hour: 'numeric', minute: '2-digit' });
    await sendAutomated({ practiceId: b.practiceId, trainerId: b.trainerId, clientId: b.clientId, action: 'booking_reminder', itemId: b.id, body: `A reminder: we have a session ${when}${b.location ? ` at ${b.location}` : ''}. If you can't make it, cancel from your page.` });
    await notifyLinkClient(b.practiceId, b.clientId, { subject: 'Your session is coming up', preview: `A reminder: your session is ${when}.`, path: '?tab=book' });
    sent += 1;
  }
  return sent;
}
