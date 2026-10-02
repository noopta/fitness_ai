// Check-ins (design handoff §6.4). Inbox: a list and a detail pane on desktop,
// list → detail on a phone. Configure: the schedule, its questions and what
// happens when a check-in is missed.

import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Plus, Trash2 } from 'lucide-react';
import {
  COPY, WEEKDAY_NAMES, hourLabel, relativeDay,
  type CheckIn, type CheckInQuestion, type CheckInSchedule, type Client, type MeResponse, type QuestionType, type Tone,
} from '@axiom/personal-training-core';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { DraftReply } from '../components/DraftReply';
import { Gate } from '../components/Gate';
import { Avatar, EvidenceList, Eyebrow, Notice, PageTitle, Pill, SegmentedControl, SkeletonBlock } from '../components/primitives';
import { Shell } from '../components/Shell';
import { useCheckInActions, useCheckIns, useRoster, useScheduleActions, useSchedules } from '../hooks';

const CLASS_TONE: Record<CheckIn['classification'], Tone> = { flag: 'red', look: 'amber', routine: 'green' };
const selectClass = 'h-10 rounded-xl border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15';

// ── Inbox ────────────────────────────────────────────────────────────────────

function RequestDialog({ open, onOpenChange, clients }: { open: boolean; onOpenChange: (v: boolean) => void; clients: Client[] }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const { request } = useCheckInActions();
  const toggle = (id: string) => setPicked((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const close = (v: boolean) => { if (!v) { setPicked(new Set()); request.reset(); } onOpenChange(v); };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-[17px] font-semibold tracking-[-0.01em]">{COPY.checkIns.requestTitle}</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-axiom-zinc-600">{COPY.checkIns.requestBody}</DialogDescription>
        </DialogHeader>
        {request.isSuccess ? (
          <p role="status" className="text-sm">{COPY.checkIns.requested(request.data.requested)}</p>
        ) : (
          <>
            <ul className="max-h-72 space-y-1 overflow-y-auto">
              {clients.map((c) => (
                <li key={c.id}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2 hover:bg-axiom-zinc-50">
                    <Checkbox checked={picked.has(c.id)} onCheckedChange={() => toggle(c.id)} />
                    <Avatar initials={c.initials} size={28} />
                    <span className="text-[13px] font-semibold">{c.name}</span>
                  </label>
                </li>
              ))}
            </ul>
            {request.isError && <p role="alert" className="text-sm text-axiom-destructive-ink">{(request.error as Error).message}</p>}
            <Button className="h-11 w-full rounded-xl md:h-10" disabled={picked.size === 0 || request.isPending} onClick={() => request.mutate(Array.from(picked))}>
              {COPY.checkIns.requestSend(picked.size)}
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Detail({ checkIn, onBack }: { checkIn: CheckIn; onBack: () => void }) {
  const { markRead } = useCheckInActions();
  return (
    <article aria-label={`${checkIn.client.name} check-in`} className="min-w-0 flex-1">
      <button type="button" onClick={onBack} className="mb-3 flex min-h-11 items-center gap-1 text-[13px] font-semibold text-axiom-zinc-600 md:hidden">
        <ArrowLeft className="size-4" aria-hidden /> {COPY.checkIns.inbox}
      </button>
      <header className="flex items-center gap-3">
        <Avatar initials={checkIn.client.initials} size={44} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-semibold tracking-[-0.01em]">{checkIn.client.name}</h2>
          <p className="text-xs text-axiom-zinc-500">{relativeDay(checkIn.submittedAt)} · App</p>
        </div>
        <Pill tone={CLASS_TONE[checkIn.classification]}>{COPY.checkIns.classification[checkIn.classification]}</Pill>
      </header>

      <section className="mt-5 rounded-xl bg-axiom-zinc-50 p-4">
        <Eyebrow className="mb-2">{COPY.checkIns.axiomRead}</Eyebrow>
        <p className="text-sm leading-relaxed">{checkIn.summary}</p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {checkIn.signals.map((s) => <li key={s.label}><Pill tone={s.tone}>{s.label}</Pill></li>)}
        </ul>
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-semibold text-axiom-zinc-600">What is this based on?</summary>
          <div className="mt-2"><EvidenceList reasons={checkIn.evidence.reasons} sources={checkIn.evidence.sources} /></div>
        </details>
      </section>

      <section className="mt-5">
        <Eyebrow className="mb-2">{COPY.checkIns.answers}</Eyebrow>
        <dl className="divide-y divide-border rounded-xl border border-border">
          {checkIn.answers.map((a) => (
            <div key={a.question} className="grid gap-1 px-4 py-3 md:grid-cols-[1fr_1.4fr] md:gap-4">
              <dt className="text-xs text-axiom-zinc-500 md:text-[13px]">{a.question}</dt>
              <dd className="whitespace-pre-line break-words text-sm">{a.answer || '—'}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-5">
        <Eyebrow className="mb-2">{COPY.draft.label}</Eyebrow>
        {checkIn.reviewedAt && checkIn.draft.status === 'discarded'
          ? <p className="text-sm text-axiom-zinc-600">{COPY.checkIns.reviewed} · no reply sent</p>
          : (
            <DraftReply draft={checkIn.draft}>
              <Button type="button" variant="ghost" className="h-11 rounded-xl text-axiom-zinc-600 md:h-10" disabled={markRead.isPending} onClick={() => markRead.mutate(checkIn.id)}>
                {COPY.checkIns.markRead}
              </Button>
            </DraftReply>
          )}
      </section>
    </article>
  );
}

function Inbox() {
  const inbox = useCheckIns();
  const roster = useRoster();
  const { sendRoutine } = useCheckInActions();
  const [selected, setSelected] = useState<string | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const list = inbox.data?.checkIns ?? [];
  const current = list.find((c) => c.id === selected) ?? null;

  // Desktop always has something open; a phone starts on the list.
  useEffect(() => {
    if (!selected && list.length && window.matchMedia('(min-width: 768px)').matches) setSelected(list[0].id);
  }, [list, selected]);

  if (inbox.isPending) return <div aria-busy="true" className="space-y-2">{[0, 1, 2].map((i) => <SkeletonBlock key={i} className="h-16 w-full" />)}</div>;
  if (inbox.isError) return <Notice alert action={<Button variant="secondary" className="h-10 rounded-xl" onClick={() => inbox.refetch()}>{COPY.roster.retry}</Button>}>{COPY.checkIns.loadFailed}</Notice>;

  const { missed, routinePending } = inbox.data;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button className="h-11 rounded-xl md:h-10" onClick={() => setRequestOpen(true)}>{COPY.checkIns.request}</Button>
        {routinePending > 0 && (
          <Button variant="secondary" className="h-11 rounded-xl md:h-10" disabled={sendRoutine.isPending} onClick={() => sendRoutine.mutate()}>
            {COPY.checkIns.sendRoutine(routinePending)}
          </Button>
        )}
        {sendRoutine.isSuccess && <p role="status" className="text-xs text-axiom-zinc-600">{COPY.checkIns.routineSent(sendRoutine.data.sent)}</p>}
      </div>

      {missed.length > 0 && (
        <section aria-label={COPY.checkIns.missedTitle(missed.length)} className="mb-4 rounded-xl bg-axiom-warning-soft px-4 py-3">
          <p className="text-[13px] font-semibold text-axiom-warning-ink">{COPY.checkIns.missedTitle(missed.length)}</p>
          <ul className="mt-1 space-y-1">
            {missed.map((m) => (
              <li key={m.id} className="text-xs text-axiom-warning-ink"><span className="font-semibold">{m.client.name}</span> · {m.path.join(' → ')}</li>
            ))}
          </ul>
        </section>
      )}

      {list.length === 0 ? (
        <Notice><p className="text-[17px] font-semibold text-foreground">{COPY.checkIns.empty}</p><p className="mt-1">{COPY.checkIns.emptyBody}</p></Notice>
      ) : (
        <div className="md:flex md:gap-6">
          <ul className={cn('divide-y divide-border rounded-2xl border border-border md:block md:w-[360px] md:shrink-0 md:self-start', current && 'hidden')}>
            {list.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  aria-current={c.id === selected ? 'true' : undefined}
                  onClick={() => setSelected(c.id)}
                  className={cn('flex min-h-16 w-full items-start gap-3 px-3 py-3 text-left transition-colors duration-200 hover:bg-axiom-zinc-50', c.id === selected && 'md:bg-axiom-zinc-50')}
                >
                  <Avatar initials={c.client.initials} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-semibold">{c.client.name}</span>
                      <span className="shrink-0 text-xs text-axiom-zinc-500">{relativeDay(c.submittedAt)}</span>
                    </span>
                    <span className="line-clamp-2 block text-xs text-axiom-zinc-600">{c.summary}</span>
                    <span className="mt-1.5 flex flex-wrap items-center gap-2">
                      <Pill tone={CLASS_TONE[c.classification]}>{COPY.checkIns.classification[c.classification]}</Pill>
                      {c.reviewedAt && <span className="text-xs text-axiom-zinc-500">{COPY.checkIns.reviewed}</span>}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {current
            ? <Detail key={current.id} checkIn={current} onBack={() => setSelected(null)} />
            : <p className="hidden flex-1 self-center text-center text-sm text-axiom-zinc-500 md:block">{COPY.checkIns.select}</p>}
        </div>
      )}
      <RequestDialog open={requestOpen} onOpenChange={setRequestOpen} clients={roster.data?.clients ?? []} />
    </>
  );
}

// ── Configure ────────────────────────────────────────────────────────────────

type Editable = Omit<CheckInSchedule, 'id' | 'clientName'>;
const editable = (s: CheckInSchedule): Editable => ({
  clientId: s.clientId, frequency: s.frequency, dayOfWeek: s.dayOfWeek, hour: s.hour, questions: s.questions,
  nudgeAfterHours: s.nudgeAfterHours, flagAfterHours: s.flagAfterHours, pauseAfterMisses: s.pauseAfterMisses, active: s.active,
});

function ScheduleForm({ schedule, name, onRemove }: { schedule: CheckInSchedule; name: string; onRemove?: () => void }) {
  const [form, setForm] = useState<Editable>(editable(schedule));
  const { save } = useScheduleActions();
  const set = <K extends keyof Editable>(key: K, value: Editable[K]) => { save.reset(); setForm((f) => ({ ...f, [key]: value })); };
  const setQuestion = (i: number, patch: Partial<CheckInQuestion>) => set('questions', form.questions.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const move = (i: number, by: number) => {
    const next = [...form.questions];
    const [q] = next.splice(i, 1);
    next.splice(i + by, 0, q);
    set('questions', next);
  };
  const num = (key: 'nudgeAfterHours' | 'flagAfterHours' | 'pauseAfterMisses', label: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`pt-${key}`} className="text-[13px]">{label}</Label>
      <Input id={`pt-${key}`} type="number" inputMode="numeric" min={1} value={form[key]} onChange={(e) => set(key, Number(e.target.value))} className="h-10 w-28 rounded-xl tabular-nums" />
    </div>
  );

  return (
    <form className="min-w-0 flex-1 space-y-6" onSubmit={(e) => { e.preventDefault(); save.mutate(form); }}>
      <div className="flex items-start justify-between gap-4 rounded-xl bg-axiom-zinc-50 p-4">
        <div>
          <Label htmlFor="pt-schedule-active" className="text-[13px] font-semibold">{name} · {form.active ? COPY.checkIns.scheduleOn : COPY.checkIns.scheduleOff}</Label>
          <p className="mt-1 text-xs text-axiom-zinc-600">{COPY.checkIns.activeHint}</p>
        </div>
        <Switch id="pt-schedule-active" checked={form.active} onCheckedChange={(v) => set('active', v)} />
      </div>

      <fieldset>
        <legend className="mb-2"><Eyebrow>{COPY.checkIns.cadence}</Eyebrow></legend>
        <div className="flex flex-wrap gap-3">
          <select aria-label={COPY.checkIns.cadence} className={selectClass} value={form.frequency} onChange={(e) => set('frequency', e.target.value as Editable['frequency'])}>
            <option value="weekly">{COPY.checkIns.frequency.weekly}</option>
            <option value="biweekly">{COPY.checkIns.frequency.biweekly}</option>
          </select>
          <select aria-label={COPY.checkIns.day} className={selectClass} value={form.dayOfWeek} onChange={(e) => set('dayOfWeek', Number(e.target.value))}>
            {WEEKDAY_NAMES.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
          <select aria-label={COPY.checkIns.time} className={selectClass} value={form.hour} onChange={(e) => set('hour', Number(e.target.value))}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
          </select>
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2"><Eyebrow>{COPY.checkIns.questions}</Eyebrow></legend>
        <ol className="space-y-2">
          {form.questions.map((q, i) => (
            <li key={q.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-2">
              <span aria-hidden className="w-5 text-center text-xs font-bold text-axiom-zinc-500 tabular-nums">{i + 1}</span>
              <Input aria-label={`Question ${i + 1}`} value={q.text} maxLength={200} onChange={(e) => setQuestion(i, { text: e.target.value })} className="h-10 min-w-0 flex-1 basis-56 rounded-xl" />
              <select aria-label={`Question ${i + 1} type`} className={selectClass} value={q.type} onChange={(e) => setQuestion(i, { type: e.target.value as QuestionType })}>
                {(['text', 'scale', 'number'] as QuestionType[]).map((t) => <option key={t} value={t}>{COPY.checkIns.questionTypes[t]}</option>)}
              </select>
              {/* Reordering by buttons rather than drag: it works with a keyboard and a screen reader. */}
              <div className="flex">
                <Button type="button" variant="ghost" className="size-10 rounded-xl p-0" aria-label={`${COPY.checkIns.moveUp}: question ${i + 1}`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp aria-hidden /></Button>
                <Button type="button" variant="ghost" className="size-10 rounded-xl p-0" aria-label={`${COPY.checkIns.moveDown}: question ${i + 1}`} disabled={i === form.questions.length - 1} onClick={() => move(i, 1)}><ArrowDown aria-hidden /></Button>
                <Button type="button" variant="ghost" className="size-10 rounded-xl p-0" aria-label={`${COPY.checkIns.remove}: question ${i + 1}`} disabled={form.questions.length === 1} onClick={() => set('questions', form.questions.filter((_, j) => j !== i))}><Trash2 aria-hidden /></Button>
              </div>
            </li>
          ))}
        </ol>
        <Button
          type="button" variant="secondary" className="mt-2 h-10 rounded-xl" disabled={form.questions.length >= 12}
          onClick={() => set('questions', [...form.questions, { id: `q-${Date.now().toString(36)}`, text: '', type: 'text' }])}
        >
          <Plus aria-hidden />{COPY.checkIns.addQuestion}
        </Button>
      </fieldset>

      <fieldset>
        <legend className="mb-2"><Eyebrow>{COPY.checkIns.missedRules}</Eyebrow></legend>
        <div className="flex flex-wrap gap-4">
          {num('nudgeAfterHours', COPY.checkIns.nudgeAfter)}
          {num('flagAfterHours', COPY.checkIns.flagAfter)}
          {num('pauseAfterMisses', COPY.checkIns.pauseAfter)}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" className="h-11 rounded-xl md:h-10" disabled={save.isPending}>{COPY.checkIns.save}</Button>
        {onRemove && <Button type="button" variant="ghost" className="h-11 rounded-xl text-axiom-zinc-600 md:h-10" onClick={onRemove}>{COPY.checkIns.removeOverride}</Button>}
        {save.isSuccess && <p role="status" className="text-sm text-axiom-success-ink">{COPY.checkIns.saved}</p>}
        {save.isError && <p role="alert" className="text-sm text-axiom-destructive-ink">{(save.error as Error).message}</p>}
      </div>
      <p className="text-xs text-axiom-zinc-500">{COPY.checkIns.footer}</p>
    </form>
  );
}

function Configure() {
  const schedules = useSchedules();
  const roster = useRoster();
  const { remove } = useScheduleActions();
  const [selected, setSelected] = useState<string | null>(null);
  // An override being created, before its first save.
  const [draftFor, setDraftFor] = useState<string | null>(null);

  const list = schedules.data?.schedules ?? [];
  const fallback = list[0];
  const clients = roster.data?.clients ?? [];
  const available = useMemo(() => clients.filter((c) => !list.some((s) => s.clientId === c.id)), [clients, list]);

  if (schedules.isPending) return <div aria-busy="true"><SkeletonBlock className="h-64 w-full" /></div>;
  if (schedules.isError || !fallback) return <Notice alert action={<Button variant="secondary" className="h-10 rounded-xl" onClick={() => schedules.refetch()}>{COPY.roster.retry}</Button>}>{COPY.checkIns.loadFailed}</Notice>;

  const draftClient = clients.find((c) => c.id === draftFor);
  const current: CheckInSchedule = draftClient
    ? { ...fallback, id: null, clientId: draftClient.id, clientName: draftClient.name }
    : list.find((s) => (s.clientId ?? 'default') === (selected ?? 'default')) ?? fallback;

  return (
    <div className="md:flex md:gap-6">
      <div className="mb-4 md:mb-0 md:w-[260px] md:shrink-0">
        <ul className="divide-y divide-border rounded-2xl border border-border">
          {[...list, ...(draftClient ? [current] : [])].map((s) => {
            const key = s.clientId ?? 'default';
            const active = (current.clientId ?? 'default') === key;
            return (
              <li key={key}>
                <button
                  type="button" aria-current={active ? 'true' : undefined}
                  onClick={() => { setSelected(s.clientId); setDraftFor(s.id === null && s.clientId ? s.clientId : null); }}
                  className={cn('flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] font-semibold hover:bg-axiom-zinc-50', active && 'bg-axiom-zinc-50')}
                >
                  <span className="truncate">{s.clientId ? s.clientName : COPY.checkIns.scheduleDefault}</span>
                  <span className="shrink-0 text-xs font-normal text-axiom-zinc-500">{s.active ? COPY.checkIns.scheduleOn : COPY.checkIns.scheduleOff}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {available.length > 0 && (
          <select
            aria-label={COPY.checkIns.addOverride} className={cn(selectClass, 'mt-2 w-full')} value=""
            onChange={(e) => { if (e.target.value) { setDraftFor(e.target.value); setSelected(e.target.value); } }}
          >
            <option value="">{COPY.checkIns.addOverride}</option>
            {available.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </div>
      <ScheduleForm
        key={`${current.clientId ?? 'default'}:${current.id ?? 'new'}`}
        schedule={current}
        name={current.clientId ? current.clientName ?? '' : COPY.checkIns.scheduleDefault}
        onRemove={current.clientId ? () => { if (current.id) remove.mutate(current.clientId!); setDraftFor(null); setSelected(null); } : undefined}
      />
    </div>
  );
}

function CheckIns({ me }: { me: MeResponse }) {
  const [tab, setTab] = useState<'inbox' | 'configure'>('inbox');
  return (
    <Shell me={me} active="checkIns" title={COPY.checkIns.title}>
      <PageTitle>{COPY.checkIns.title}</PageTitle>
      <div className="mb-6">
        <SegmentedControl
          label={COPY.checkIns.title} value={tab} onChange={setTab}
          options={[{ value: 'inbox', label: COPY.checkIns.inbox }, { value: 'configure', label: COPY.checkIns.configure }]}
        />
      </div>
      {tab === 'inbox' ? <Inbox /> : <Configure />}
    </Shell>
  );
}

export default function CheckInsPage() {
  return <Gate>{(me) => <CheckIns me={me} />}</Gate>;
}
