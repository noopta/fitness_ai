// Schedule: this week's sessions with complete / no-show / cancel, the weekly
// availability clients book from, and booking a client in directly. Times
// show in the trainer's own clock; availability is minutes of the practice day.

import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import type { AvailabilityWindow, BookingView, MeResponse } from '@axiom/personal-training-core';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useAvailability, useBookSession, useBookings, useSetAvailability, useUpdateBooking } from '../businessHooks';
import {
  SESSION_LENGTHS, WEEKDAYS, bookingsByDay, dayKey, formatTimeRange, inputToMinute, minuteToInput, validateWindows, weekOf,
} from '../businessFormat';
import { BCOPY } from '../copyBusiness';
import { Gate } from '../components/Gate';
import { Notice, PageTitle, Pill, SkeletonBlock } from '../components/primitives';
import { Shell } from '../components/Shell';
import { useRoster } from '../hooks';

const T = BCOPY.schedule;
const selectClass = 'h-10 w-full rounded-xl border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15';
const STATUS_TONE: Record<BookingView['status'], 'green' | 'zinc' | 'red' | 'amber'> = { booked: 'amber', completed: 'green', cancelled: 'zinc', no_show: 'red' };

// ─── Week of bookings ────────────────────────────────────────────────────────

function BookingCard({ booking, onCancel }: { booking: BookingView; onCancel: (b: BookingView) => void }) {
  const update = useUpdateBooking();
  const booked = booking.status === 'booked';
  return (
    <li className={cn('rounded-xl border border-border bg-background p-3', !booked && 'opacity-80')}>
      <p className="text-xs font-semibold tabular-nums text-axiom-zinc-600">{formatTimeRange(booking.startsAt, booking.endsAt)}</p>
      <p className="mt-0.5 text-sm font-semibold">{booking.clientName}</p>
      {booking.location && <p className="text-xs text-axiom-zinc-500">{booking.location}</p>}
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <Pill tone={STATUS_TONE[booking.status]}>{T.status[booking.status]}</Pill>
        {booking.source === 'portal' && <Pill tone="zinc">{T.viaPortal}</Pill>}
        {booking.usedCredit && <Pill tone="zinc">{T.usedCredit}</Pill>}
      </div>
      {booked && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button size="sm" variant="secondary" className="h-9 rounded-lg" disabled={update.isPending} onClick={() => update.mutate({ id: booking.id, status: 'completed' })} aria-label={`${T.complete}: ${booking.clientName}`}>{T.complete}</Button>
          <Button size="sm" variant="secondary" className="h-9 rounded-lg" disabled={update.isPending} onClick={() => update.mutate({ id: booking.id, status: 'no_show' })} aria-label={`${T.noShow}: ${booking.clientName}`}>{T.noShow}</Button>
          <Button size="sm" variant="ghost" className="h-9 rounded-lg text-axiom-destructive-ink" disabled={update.isPending} onClick={() => onCancel(booking)} aria-label={`${T.cancel}: ${booking.clientName}`}>{T.cancel}</Button>
        </div>
      )}
      {update.isError && <p role="alert" className="mt-1 text-xs text-axiom-destructive-ink">{(update.error as Error).message}</p>}
    </li>
  );
}

function Week() {
  const [anchor, setAnchor] = useState(() => new Date());
  const week = useMemo(() => weekOf(anchor), [anchor]);
  const q = useBookings({ from: week.start.toISOString(), to: week.end.toISOString() });
  const update = useUpdateBooking();
  const [confirm, setConfirm] = useState<BookingView | null>(null);
  const byDay = useMemo(() => bookingsByDay(q.data?.bookings ?? []), [q.data]);
  const shift = (days: number) => setAnchor((a) => new Date(a.getFullYear(), a.getMonth(), a.getDate() + days));
  const label = week.start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const today = dayKey(new Date());

  return (
    <section aria-labelledby="week-h" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="week-h" className="text-[17px] font-semibold tracking-[-0.01em]">{T.weekOf(label)}</h2>
        <div className="flex items-center gap-1">
          <Button variant="ghost" className="size-11 rounded-xl p-0 md:size-9" onClick={() => shift(-7)} aria-label={T.prev}><ChevronLeft className="size-4" aria-hidden /></Button>
          <Button variant="secondary" className="h-11 rounded-xl md:h-9" onClick={() => setAnchor(new Date())}>{T.today}</Button>
          <Button variant="ghost" className="size-11 rounded-xl p-0 md:size-9" onClick={() => shift(7)} aria-label={T.next}><ChevronRight className="size-4" aria-hidden /></Button>
        </div>
      </div>
      {q.isPending ? <SkeletonBlock className="h-40 w-full rounded-2xl" /> : q.isError ? (
        <Notice alert action={<Button variant="secondary" className="h-10 rounded-xl" onClick={() => q.refetch()}>{BCOPY.inbox.retry}</Button>}>{T.loadFailed}</Notice>
      ) : (
        <>
          {q.data.bookings.length === 0 && <p className="text-sm text-axiom-zinc-500 lg:hidden">{T.noneThisWeek}</p>}
          <ol className="space-y-4 lg:grid lg:grid-cols-7 lg:gap-2 lg:space-y-0">
            {week.days.map((d) => {
              const k = dayKey(d);
              const list = byDay.get(k) ?? [];
              return (
                <li key={k} aria-label={d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} className={cn(list.length === 0 && 'hidden lg:block')}>
                  <p className={cn('mb-1.5 text-xs font-semibold', k === today ? 'text-foreground' : 'text-axiom-zinc-500')}>
                    {d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}
                  </p>
                  {list.length === 0 ? <p className="hidden rounded-xl border border-dashed border-border p-3 text-xs text-axiom-zinc-400 lg:block">{T.noSessions}</p> : (
                    <ul className="space-y-2">{list.map((b) => <BookingCard key={b.id} booking={b} onCancel={setConfirm} />)}</ul>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}
      <AlertDialog open={!!confirm} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm ? T.cancelTitle(confirm.clientName) : ''}</AlertDialogTitle>
            <AlertDialogDescription>{T.cancelBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{T.keep}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (confirm) update.mutate({ id: confirm.id, status: 'cancelled' }); setConfirm(null); }}>{T.confirmCancel}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

// ─── Availability ────────────────────────────────────────────────────────────

const blankWindow = (weekday = 1): AvailabilityWindow => ({ weekday, startMinute: 9 * 60, endMinute: 12 * 60, slotMinutes: 60, location: null });

function Availability() {
  const q = useAvailability();
  const save = useSetAvailability();
  const [windows, setWindows] = useState<AvailabilityWindow[] | null>(null);
  const [tried, setTried] = useState(false);
  useEffect(() => { if (q.data && windows === null) setWindows(q.data.windows); }, [q.data, windows]);

  const list = windows ?? [];
  const errors = validateWindows(list);
  const set = (i: number, patch: Partial<AvailabilityWindow>) => { setWindows(list.map((w, j) => (j === i ? { ...w, ...patch } : w))); save.reset(); };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (errors.size > 0) return;
    save.mutate(list.map(({ id: _id, ...w }) => ({ ...w, location: w.location?.trim() || null })), { onSuccess: (d) => { setWindows(d.windows); setTried(false); } });
  };

  return (
    <section aria-labelledby="avail-h" className="space-y-3">
      <div>
        <h2 id="avail-h" className="text-[17px] font-semibold tracking-[-0.01em]">{T.availability}</h2>
        <p className="text-sm text-axiom-zinc-600">{T.availabilityBody}</p>
      </div>
      {q.isPending || windows === null ? (q.isError ? <Notice alert>{T.loadFailed}</Notice> : <SkeletonBlock className="h-32 w-full rounded-2xl" />) : (
        <form onSubmit={submit} noValidate className="space-y-3">
          {list.length === 0 && <Notice>{T.noWindows}</Notice>}
          <ul className="space-y-3">
            {list.map((w, i) => {
              const err = (tried || save.isError) ? errors.get(i) : undefined;
              const id = `aw-${i}`;
              return (
                <li key={w.id ?? `new-${i}`} className={cn('rounded-2xl border p-3', err ? 'border-axiom-destructive' : 'border-border')}>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-[1.2fr_1fr_1fr_1fr_1.6fr_auto] md:items-end">
                    <div className="space-y-1">
                      <Label htmlFor={`${id}-day`} className="text-xs">{T.weekday}</Label>
                      <select id={`${id}-day`} className={selectClass} value={w.weekday} onChange={(e) => set(i, { weekday: Number(e.target.value) })}>
                        {[1, 2, 3, 4, 5, 6, 0].map((d) => <option key={d} value={d}>{WEEKDAYS[d]}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`${id}-len`} className="text-xs">{T.length}</Label>
                      <select id={`${id}-len`} className={selectClass} value={w.slotMinutes} onChange={(e) => set(i, { slotMinutes: Number(e.target.value) })}>
                        {SESSION_LENGTHS.map((m) => <option key={m} value={m}>{T.minutes(m)}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`${id}-start`} className="text-xs">{T.start}</Label>
                      <Input id={`${id}-start`} type="time" step={300} value={minuteToInput(w.startMinute)} onChange={(e) => set(i, { startMinute: inputToMinute(e.target.value) ?? -1 })} className="h-10 rounded-xl tabular-nums" />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`${id}-end`} className="text-xs">{T.end}</Label>
                      <Input id={`${id}-end`} type="time" step={300} value={minuteToInput(w.endMinute)} onChange={(e) => set(i, { endMinute: inputToMinute(e.target.value) ?? -1 })} className="h-10 rounded-xl tabular-nums" />
                    </div>
                    <div className="col-span-2 space-y-1 md:col-span-1">
                      <Label htmlFor={`${id}-loc`} className="text-xs">{T.location}</Label>
                      <Input id={`${id}-loc`} value={w.location ?? ''} maxLength={120} placeholder={T.locationPlaceholder} onChange={(e) => set(i, { location: e.target.value })} className="h-10 rounded-xl" />
                    </div>
                    <Button type="button" variant="ghost" className="col-span-2 h-10 rounded-xl text-axiom-zinc-600 md:col-span-1" onClick={() => { setWindows(list.filter((_, j) => j !== i)); save.reset(); }} aria-label={`${T.removeWindow}: ${WEEKDAYS[w.weekday]}`}>
                      <Trash2 className="size-4" aria-hidden /><span className="md:sr-only">{T.removeWindow}</span>
                    </Button>
                  </div>
                  {err && <p role="alert" className="mt-2 text-xs text-axiom-destructive-ink">{err}</p>}
                </li>
              );
            })}
          </ul>
          {save.isError && <p role="alert" className="text-sm text-axiom-destructive-ink">{(save.error as Error).message}</p>}
          {save.isSuccess && <p role="status" className="text-sm text-axiom-success-ink">{T.saved}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" className="h-11 rounded-xl md:h-10" onClick={() => { setWindows([...list, blankWindow(list[list.length - 1]?.weekday ?? 1)]); save.reset(); }}>
              <Plus className="size-4" aria-hidden /> {T.addWindow}
            </Button>
            <Button type="submit" className="h-11 rounded-xl md:h-10" disabled={save.isPending}>{T.saveAvailability}</Button>
          </div>
        </form>
      )}
    </section>
  );
}

// ─── Book a client ───────────────────────────────────────────────────────────

function BookClient() {
  const roster = useRoster();
  const book = useBookSession();
  const [clientId, setClientId] = useState('');
  const [date, setDate] = useState(dayKey(new Date()));
  const [time, setTime] = useState('09:00');
  const [minutes, setMinutes] = useState(60);
  const clients = (roster.data?.clients ?? []).filter((c) => c.status !== 'notJoined' || c.channel === 'webLink');
  const valid = !!clientId && /^\d{4}-\d{2}-\d{2}$/.test(date) && inputToMinute(time) !== null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    const startsAt = new Date(`${date}T${time}:00`);
    if (Number.isNaN(startsAt.getTime())) return;
    book.mutate({ clientId, startsAt: startsAt.toISOString(), minutes });
  };

  return (
    <section aria-labelledby="book-h" className="space-y-3">
      <h2 id="book-h" className="text-[17px] font-semibold tracking-[-0.01em]">{T.book}</h2>
      <form onSubmit={submit} noValidate className="grid gap-3 rounded-2xl border border-border p-4 md:grid-cols-[2fr_1.2fr_1fr_1fr_auto] md:items-end">
        <div className="space-y-1">
          <Label htmlFor="book-client" className="text-xs">{T.client}</Label>
          <select id="book-client" className={selectClass} value={clientId} onChange={(e) => { setClientId(e.target.value); book.reset(); }}>
            <option value="">{T.pickClient}</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="book-date" className="text-xs">{T.date}</Label>
          <Input id="book-date" type="date" value={date} onChange={(e) => { setDate(e.target.value); book.reset(); }} className="h-10 rounded-xl" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="book-time" className="text-xs">{T.time}</Label>
          <Input id="book-time" type="time" step={300} value={time} onChange={(e) => { setTime(e.target.value); book.reset(); }} className="h-10 rounded-xl tabular-nums" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="book-min" className="text-xs">{T.length}</Label>
          <select id="book-min" className={selectClass} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
            {SESSION_LENGTHS.map((m) => <option key={m} value={m}>{T.minutes(m)}</option>)}
          </select>
        </div>
        <Button type="submit" className="h-11 rounded-xl md:h-10" disabled={!valid || book.isPending}>{T.bookSubmit}</Button>
        <div className="md:col-span-5">
          {book.isError && <p role="alert" className="text-sm text-axiom-destructive-ink">{(book.error as Error).message}</p>}
          {book.isSuccess && <p role="status" className="text-sm text-axiom-success-ink">{T.booked}</p>}
        </div>
      </form>
    </section>
  );
}

function ScheduleView({ me }: { me: MeResponse }) {
  return (
    <Shell me={me} active="schedule" title={T.title}>
      <PageTitle>{T.title}</PageTitle>
      <div className="space-y-10">
        <Week />
        <BookClient />
        <Availability />
      </div>
    </Shell>
  );
}

export default function SchedulePage() {
  return <Gate>{(me) => <ScheduleView me={me} />}</Gate>;
}
