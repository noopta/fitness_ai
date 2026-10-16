// Leads: enquiries from the practice's public page and people the trainer
// adds by hand. Follow-ups first; each lead can be worked (status, notes,
// a follow-up date) and turned into a web-link client in one step.

import { useState } from 'react';
import { Link } from 'wouter';
import { ArrowLeft, ExternalLink, Plus } from 'lucide-react';
import { COPY, type LeadView, type MeResponse } from '@axiom/personal-training-core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useAddLead, useConvertLead, useLeads, useUpdateLead } from '../businessHooks';
import { BCOPY } from '../copyBusiness';
import { CopyField, errorText, selectClass } from '../components/ChipInput';
import { Gate } from '../components/Gate';
import { Notice, PageTitle, Pill, SkeletonBlock } from '../components/primitives';
import { Shell } from '../components/Shell';
import { usePracticeProfile } from '../platformHooks';

const T = BCOPY.leads;
const STATUSES: LeadView['status'][] = ['new', 'contacted', 'consult_booked', 'won', 'lost'];
const STATUS_TONE: Record<LeadView['status'], 'amber' | 'zinc' | 'green' | 'red'> = { new: 'amber', contacted: 'zinc', consult_booked: 'green', won: 'green', lost: 'zinc' };
const focusRing = 'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15';

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
/** An ISO instant → the YYYY-MM-DD a date input shows, in the trainer's clock. */
export function isoToDateInput(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** A date input's value → 9am that day in the trainer's clock, as ISO; '' clears it. */
export function dateInputToIso(v: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return new Date(`${v}T09:00:00`).toISOString();
}

// ─── Public page banner ──────────────────────────────────────────────────────

function PublicPageBanner({ slug }: { slug: string }) {
  const profile = usePracticeProfile();
  const on = profile.data?.profile?.publicPage;
  const url = `${window.location.origin}/p/${slug}`;
  if (profile.isPending || profile.isError) return null;
  if (!on) {
    return (
      <div role="note" className="mb-6 flex flex-col gap-2 rounded-2xl bg-axiom-warning-soft p-4 text-axiom-warning-ink md:flex-row md:items-center md:justify-between">
        <p className="text-sm font-semibold">{T.pageOff}</p>
        <Link href="/personal-training/settings/practice" className={cn('inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-4 md:min-h-0', focusRing)}>{T.pageOffAction}</Link>
      </div>
    );
  }
  return (
    <div className="mb-6 space-y-2 rounded-2xl border border-border p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">{T.pageOn}</p>
        <a href={url} target="_blank" rel="noreferrer noopener" className={cn('inline-flex items-center gap-1 text-xs font-semibold text-axiom-zinc-600 underline-offset-4 hover:underline', focusRing)}>
          Open <ExternalLink className="size-3.5" aria-hidden />
        </a>
      </div>
      <CopyField value={url} label={T.pageOn} copyLabel={T.copy} copiedLabel={T.copied} />
    </div>
  );
}

// ─── List ────────────────────────────────────────────────────────────────────

function LeadRow({ lead, selected, onSelect }: { lead: LeadView; selected: boolean; onSelect: () => void }) {
  return (
    <li>
      <button
        type="button" onClick={onSelect} aria-current={selected ? 'true' : undefined}
        className={cn('flex w-full flex-col items-start gap-1 rounded-xl px-3 py-3 text-left transition-colors', focusRing, selected ? 'bg-axiom-zinc-100' : 'hover:bg-axiom-zinc-50')}
      >
        <span className="flex w-full items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{lead.name}</span>
          <span className="shrink-0 text-[11px] text-axiom-zinc-500">{new Date(lead.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
        </span>
        {lead.goal && <span className="w-full truncate text-xs text-axiom-zinc-600">{lead.goal}</span>}
        <span className="flex flex-wrap gap-1.5">
          {lead.needsFollowUp && <Pill tone="amber">{T.followUp}</Pill>}
          <Pill tone={STATUS_TONE[lead.status]}>{T.status[lead.status]}</Pill>
          {lead.consultAt && <Pill tone="zinc">{T.consult(when(lead.consultAt))}</Pill>}
        </span>
      </button>
    </li>
  );
}

function AddLeadForm({ onDone }: { onDone: (lead: LeadView | null) => void }) {
  const add = useAddLead();
  const [f, setF] = useState({ name: '', email: '', phone: '', goal: '' });
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (f.name.trim().length < 2) return;
    const input = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v)) as { name: string; email?: string; phone?: string; goal?: string };
    add.mutate(input, { onSuccess: ({ lead }) => onDone(lead) });
  };
  return (
    <form onSubmit={submit} noValidate aria-label={T.addTitle} className="mb-4 space-y-3 rounded-2xl border border-border p-4">
      <p className="text-[15px] font-semibold">{T.addTitle}</p>
      {(['name', 'email', 'phone', 'goal'] as const).map((k) => (
        <div key={k} className="space-y-1">
          <Label htmlFor={`lead-${k}`} className="text-xs">{k === 'name' ? T.name : k === 'email' ? T.email : k === 'phone' ? T.phone : T.goalField}</Label>
          <Input id={`lead-${k}`} type={k === 'email' ? 'email' : k === 'phone' ? 'tel' : 'text'} value={f[k]} onChange={(e) => set(k, e.target.value)} className="h-10 rounded-xl" />
        </div>
      ))}
      {add.isError && <p role="alert" className="text-sm text-axiom-destructive-ink">{errorText(add.error, 'Could not add this lead.')}</p>}
      <div className="flex gap-2">
        <Button type="submit" className="h-11 rounded-xl md:h-10" disabled={f.name.trim().length < 2 || add.isPending}>{T.addSubmit}</Button>
        <Button type="button" variant="ghost" className="h-11 rounded-xl md:h-10" onClick={() => onDone(null)}>{T.cancel}</Button>
      </div>
    </form>
  );
}

// ─── Detail ──────────────────────────────────────────────────────────────────

function LeadDetail({ lead, onBack }: { lead: LeadView; onBack: () => void }) {
  const update = useUpdateLead(lead.id);
  const convert = useConvertLead(lead.id);
  const [status, setStatus] = useState(lead.status);
  const [notes, setNotes] = useState(lead.notes ?? '');
  const [followUp, setFollowUp] = useState(isoToDateInput(lead.followUpAt));
  const dirty = status !== lead.status || notes !== (lead.notes ?? '') || followUp !== isoToDateInput(lead.followUpAt);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    update.mutate({ status, notes: notes.trim() || null, followUpAt: followUp ? dateInputToIso(followUp) : null });
  };

  return (
    <article aria-labelledby="lead-h">
      <button type="button" onClick={onBack} className={cn('mb-3 inline-flex min-h-11 items-center gap-1.5 rounded-lg text-[13px] font-semibold text-axiom-zinc-600 md:hidden', focusRing)}>
        <ArrowLeft className="size-4" aria-hidden /> {T.back}
      </button>
      <h2 id="lead-h" className="text-[20px] font-semibold tracking-[-0.01em]">{lead.name}</h2>
      <p className="mt-0.5 text-xs text-axiom-zinc-500">{lead.source === 'public_page' ? T.fromPage : T.manual} · {new Date(lead.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</p>

      <dl className="mt-4 space-y-3 rounded-2xl border border-border p-4 text-sm">
        <div>
          <dt className="text-xs text-axiom-zinc-500">{T.contact}</dt>
          <dd className="mt-0.5 flex flex-col">
            {lead.email && <a href={`mailto:${lead.email}`} className="underline-offset-4 hover:underline">{lead.email}</a>}
            {lead.phone && <a href={`tel:${lead.phone}`} className="underline-offset-4 hover:underline">{lead.phone}</a>}
            {!lead.email && !lead.phone && '—'}
          </dd>
        </div>
        {lead.goal && <div><dt className="text-xs text-axiom-zinc-500">{T.goal}</dt><dd className="mt-0.5">{lead.goal}</dd></div>}
        {lead.message && <div><dt className="text-xs text-axiom-zinc-500">{T.message}</dt><dd className="mt-0.5 whitespace-pre-wrap">{lead.message}</dd></div>}
        {lead.consultAt && <div><dt className="text-xs text-axiom-zinc-500">{T.status.consult_booked}</dt><dd className="mt-0.5">{when(lead.consultAt)}</dd></div>}
      </dl>

      <form onSubmit={save} className="mt-4 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="lead-status" className="text-xs">{T.statusLabel}</Label>
            <select id="lead-status" className={selectClass} value={status} onChange={(e) => { setStatus(e.target.value as LeadView['status']); update.reset(); }}>
              {STATUSES.map((s) => <option key={s} value={s}>{T.status[s]}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="lead-follow" className="text-xs">{T.followUpAt}</Label>
            <Input id="lead-follow" type="date" value={followUp} onChange={(e) => { setFollowUp(e.target.value); update.reset(); }} className="h-10 rounded-xl" />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="lead-notes" className="text-xs">{T.notes}</Label>
          <Textarea id="lead-notes" rows={3} maxLength={2000} value={notes} placeholder={T.notesPlaceholder} onChange={(e) => { setNotes(e.target.value); update.reset(); }} className="rounded-xl text-sm" />
        </div>
        {update.isError && <p role="alert" className="text-sm text-axiom-destructive-ink">{errorText(update.error, 'Could not save.')}</p>}
        {update.isSuccess && !dirty && <p role="status" className="text-sm text-axiom-success-ink">{T.saved}</p>}
        <Button type="submit" variant="secondary" className="h-11 rounded-xl md:h-10" disabled={!dirty || update.isPending}>{T.save}</Button>
      </form>

      <section className="mt-6 border-t border-border pt-4">
        {convert.isSuccess ? (
          <div className="space-y-2">
            <p role="status" className="text-sm font-semibold">{T.converted(convert.data.client.name.split(' ')[0])}</p>
            <CopyField value={convert.data.link.url} label={T.converted(convert.data.client.name)} copyLabel={COPY.invite.copy} copiedLabel={COPY.invite.copied} />
            <Link href={`/personal-training/clients/${encodeURIComponent(convert.data.client.id)}/overview`} className={cn('inline-flex min-h-11 items-center text-sm font-semibold underline-offset-4 hover:underline md:min-h-0', focusRing)}>{T.openClient}</Link>
          </div>
        ) : lead.clientId ? (
          <div className="flex items-center gap-3">
            <Pill tone="green">{T.alreadyClient}</Pill>
            <Link href={`/personal-training/clients/${encodeURIComponent(lead.clientId)}/overview`} className={cn('text-sm font-semibold underline-offset-4 hover:underline', focusRing)}>{T.openClient}</Link>
          </div>
        ) : (
          <>
            <Button className="h-11 rounded-xl md:h-10" onClick={() => convert.mutate()} disabled={convert.isPending}>{convert.isPending ? T.converting : T.convert}</Button>
            {convert.isError && <p role="alert" className="mt-2 text-sm text-axiom-destructive-ink">{errorText(convert.error, 'Could not make them a client.')}</p>}
          </>
        )}
      </section>
    </article>
  );
}

function LeadsView({ me }: { me: MeResponse }) {
  const q = useLeads();
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const leads = q.data?.leads ?? [];
  const lead = leads.find((l) => l.id === selected) ?? null;

  return (
    <Shell me={me} active="leads" title={T.title}>
      <PageTitle sub={T.sub}>{T.title}</PageTitle>
      {me.practice && <PublicPageBanner slug={me.practice.slug} />}
      <div className="md:grid md:grid-cols-[320px_minmax(0,1fr)] md:gap-8">
        <div className={cn(lead && 'hidden md:block')}>
          {adding ? <AddLeadForm onDone={(l) => { setAdding(false); if (l) setSelected(l.id); }} /> : (
            <Button variant="secondary" className="mb-3 h-11 w-full rounded-xl md:h-10" onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /> {T.add}</Button>
          )}
          {q.isPending ? (
            <div aria-busy="true" className="space-y-2">{[0, 1, 2].map((i) => <SkeletonBlock key={i} className="h-16 w-full rounded-xl" />)}</div>
          ) : q.isError ? (
            <Notice alert action={<Button variant="secondary" className="h-10 rounded-xl" onClick={() => q.refetch()}>{BCOPY.inbox.retry}</Button>}>{T.loadFailed}</Notice>
          ) : leads.length === 0 ? (
            <Notice><p className="font-semibold text-foreground">{T.empty}</p><p className="mt-1">{T.emptyBody}</p></Notice>
          ) : (
            <nav aria-label={T.title}><ul className="space-y-0.5">{leads.map((l) => <LeadRow key={l.id} lead={l} selected={l.id === selected} onSelect={() => setSelected(l.id)} />)}</ul></nav>
          )}
        </div>
        <div className={cn(!lead && 'hidden md:block')}>
          {lead ? <LeadDetail key={lead.id} lead={lead} onBack={() => setSelected(null)} /> : <Notice>{T.pick}</Notice>}
        </div>
      </div>
    </Shell>
  );
}

export default function LeadsPage() {
  return <Gate>{(me) => <LeadsView me={me} />}</Gate>;
}
