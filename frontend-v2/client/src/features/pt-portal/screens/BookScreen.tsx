// Booking sessions with the trainer: what is coming up, what is open, and
// cancelling with the notice rule spelled out. The server decides whether a
// cancelled session's credit comes back, and says so on the cancelled booking.

import { useState } from 'react';
import { CalendarCheck, CalendarX2, MapPin } from 'lucide-react';
import type { BookingView, Slot } from '@axiom/personal-training-core';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import {
  creditComesBack, formatInstantDay, formatLocalDate, formatMinute, formatTimeRange, groupSlotsByDate, noticeHours,
} from '@/features/personal-training/businessFormat';
import { errorMessage } from '../api';
import { Card, EmptyState, Eyebrow, InlineError, ListSkeleton, LoadFailed, PortalButton, ScreenTitle } from '../components';
import { useBook, useCancelBooking, usePortalBilling, usePortalBookings, usePortalNav, useSlots } from '../hooks';

const STATUS: Record<BookingView['status'], string> = { booked: 'Booked', cancelled: 'Cancelled', completed: 'Done', no_show: 'Missed' };

export function totalCredits(plans: { status: string; creditsLeft: number }[] | undefined): number {
  return (plans ?? []).filter((p) => p.status === 'active' || p.status === 'past_due' || p.status === 'complete').reduce((n, p) => n + Math.max(0, p.creditsLeft), 0);
}

/** What happened, from the server's answer on the cancelled booking. */
export function cancelMessage(b: BookingView): string {
  if (!b.usedCredit) return 'Session cancelled.';
  if (b.creditReturned === true) return 'Session cancelled. Your session credit is back.';
  if (b.creditReturned === false) return `Session cancelled. With less than ${noticeHours(b)} hours' notice, the session credit is used.`;
  return 'Session cancelled.';
}

function BookingRow({ b, onCancel }: { b: BookingView; onCancel?: (b: BookingView) => void }) {
  return (
    <li className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{formatInstantDay(b.startsAt)}</p>
        <p className="text-xs tabular-nums text-axiom-zinc-600">{formatTimeRange(b.startsAt, b.endsAt)}</p>
        {b.location && <p className="mt-0.5 flex items-center gap-1 text-xs text-axiom-zinc-500"><MapPin aria-hidden className="size-3" />{b.location}</p>}
      </div>
      {onCancel && b.status === 'booked'
        ? <PortalButton variant="danger" onClick={() => onCancel(b)} aria-label={`Cancel session on ${formatInstantDay(b.startsAt)}`}>Cancel</PortalButton>
        : <span className="shrink-0 text-xs font-semibold text-axiom-zinc-500">{STATUS[b.status]}</span>}
    </li>
  );
}

export function BookScreen({ trainerName }: { trainerName: string }) {
  const { go } = usePortalNav();
  const bookings = usePortalBookings();
  const slots = useSlots();
  const billing = usePortalBilling();
  const book = useBook();
  const cancel = useCancelBooking();
  const [pick, setPick] = useState<Slot | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<BookingView | null>(null);
  const [booked, setBooked] = useState<BookingView | null>(null);
  const [cancelNote, setCancelNote] = useState<string | null>(null);
  const first = trainerName.split(/\s+/)[0] || trainerName;
  const credits = billing.data?.available ? totalCredits(billing.data.plans) : null;

  const now = Date.now();
  const all = bookings.data?.bookings ?? [];
  const upcoming = all.filter((b) => b.status === 'booked' && new Date(b.endsAt).getTime() > now).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const past = all.filter((b) => !upcoming.includes(b)).sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  const code = (book.error as { code?: string | null } | null)?.code;

  const doBook = () => {
    if (!pick) return;
    setBooked(null);
    setCancelNote(null);
    book.mutate({ startsAt: pick.startsAt, trainerId: pick.trainerId }, { onSuccess: ({ booking }) => setBooked(booking) });
    setPick(null);
  };
  const doCancel = () => {
    const b = confirmCancel;
    setConfirmCancel(null);
    if (!b) return;
    setCancelNote(null);
    cancel.mutate(b.id, { onSuccess: ({ booking }) => setCancelNote(cancelMessage(booking)) });
  };

  return (
    <div className="space-y-5">
      <ScreenTitle sub={credits !== null ? `${credits} ${credits === 1 ? 'session' : 'sessions'} left on your plan` : `Sessions with ${first}`}>Book</ScreenTitle>

      {booked && (
        <p role="status" className="flex items-start gap-2 rounded-xl bg-axiom-success-soft px-3 py-2 text-sm text-axiom-success-ink">
          <CalendarCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
          Booked: {formatInstantDay(booked.startsAt)}, {formatTimeRange(booked.startsAt, booked.endsAt)}.
        </p>
      )}
      {cancelNote && <p role="status" className="rounded-xl bg-axiom-zinc-100 px-3 py-2 text-sm">{cancelNote}</p>}
      {cancel.isError && <InlineError>{errorMessage(cancel.error, 'That session could not be cancelled. Try again.')}</InlineError>}

      <section aria-labelledby="upcoming-h">
        <Eyebrow className="mb-2"><span id="upcoming-h">Upcoming</span></Eyebrow>
        {bookings.isPending ? <ListSkeleton rows={1} /> : bookings.isError ? <LoadFailed onRetry={() => bookings.refetch()} /> : upcoming.length === 0 ? (
          <p className="text-sm text-axiom-zinc-600">Nothing booked yet.</p>
        ) : (
          <Card as="div"><ul className="divide-y divide-border">{upcoming.map((b) => <BookingRow key={b.id} b={b} onCancel={setConfirmCancel} />)}</ul></Card>
        )}
      </section>

      <section aria-labelledby="open-h">
        <Eyebrow className="mb-2"><span id="open-h">Open times</span></Eyebrow>
        {book.isError && (
          <div className="mb-3 space-y-2">
            <InlineError>
              {code === 'slot_taken' ? 'Someone just took that time. Here is what is open now.' : errorMessage(book.error, 'That session could not be booked. Try again.')}
            </InlineError>
            {code === 'no_credit' && <PortalButton className="w-full" onClick={() => go({ tab: 'billing' })}>See plans and pay</PortalButton>}
          </div>
        )}
        {slots.isPending ? <ListSkeleton rows={2} /> : slots.isError ? <LoadFailed onRetry={() => slots.refetch()} /> : slots.data.slots.length === 0 ? (
          <EmptyState icon={<CalendarX2 />} title="No open times in the next two weeks">Message {first} to find a time.</EmptyState>
        ) : (
          <div className="space-y-4">
            {groupSlotsByDate(slots.data.slots).map((g) => (
              <div key={g.date} role="group" aria-label={formatLocalDate(g.date)}>
                <p className="mb-1.5 text-sm font-semibold">{formatLocalDate(g.date)}</p>
                <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {g.slots.map((s) => (
                    <li key={`${s.trainerId}-${s.startsAt}`}>
                      <button
                        type="button"
                        onClick={() => { setPick(s); book.reset(); }}
                        aria-label={`${formatLocalDate(g.date)} at ${formatMinute(s.localMinute)}${s.location ? `, ${s.location}` : ''}`}
                        className={cn('min-h-11 w-full rounded-xl border border-border bg-background px-2 text-sm font-semibold tabular-nums hover:bg-axiom-zinc-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/20')}
                      >
                        {formatMinute(s.localMinute)}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {past.length > 0 && (
        <section aria-labelledby="past-h">
          <Eyebrow className="mb-2"><span id="past-h">Past and cancelled</span></Eyebrow>
          <Card as="div"><ul className="divide-y divide-border">{past.slice(0, 10).map((b) => <BookingRow key={b.id} b={b} />)}</ul></Card>
        </section>
      )}

      <AlertDialog open={!!pick} onOpenChange={(o) => { if (!o) setPick(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Book this session?</AlertDialogTitle>
            <AlertDialogDescription>
              {pick ? `${formatLocalDate(pick.localDate)} at ${formatMinute(pick.localMinute)} with ${pick.trainerName}${pick.location ? `, ${pick.location}` : ''}.` : ''}
              {credits !== null && credits > 0 ? ' This uses one session from your plan.' : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Not now</AlertDialogCancel>
            <AlertDialogAction className="min-h-11" onClick={doBook} disabled={book.isPending}>Book</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmCancel} onOpenChange={(o) => { if (!o) setConfirmCancel(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this session?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmCancel && (confirmCancel.usedCredit
                ? creditComesBack(confirmCancel)
                  ? `It's more than ${noticeHours(confirmCancel)} hours away, so your session credit comes back.`
                  : `It's less than ${noticeHours(confirmCancel)} hours away, so the session credit won't come back.`
                : `${first} will see that you cancelled.`)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Keep it</AlertDialogCancel>
            <AlertDialogAction className="min-h-11 bg-axiom-destructive text-white" onClick={doCancel}>Cancel session</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Home card: the next booked session, if any. */
export function NextSessionCard() {
  const { go } = usePortalNav();
  const bookings = usePortalBookings();
  const now = Date.now();
  const next = (bookings.data?.bookings ?? [])
    .filter((b) => b.status === 'booked' && new Date(b.startsAt).getTime() > now)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  if (!next) return null;
  return (
    <button
      type="button"
      onClick={() => go({ tab: 'book' })}
      className="flex w-full items-center gap-3 rounded-2xl border border-border bg-background p-4 text-left shadow-xs hover:bg-axiom-zinc-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/20"
    >
      <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-axiom-zinc-100"><CalendarCheck className="size-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold">Your next session</span>
        <span className="block text-sm text-axiom-zinc-600">{formatInstantDay(next.startsAt)}, {formatTimeRange(next.startsAt, next.endsAt)}{next.location ? ` · ${next.location}` : ''}</span>
      </span>
    </button>
  );
}
