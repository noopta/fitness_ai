// Billing: the trainer connects their own Stripe account (Axiom takes 0%),
// sells offers (subscriptions, session packages, one-offs) and sees what has
// come in. Returning from Stripe onboarding lands on ?connect=done.

import { useEffect, useRef, useState } from 'react';
import { useSearch } from 'wouter';
import { Archive, CheckCircle2, ExternalLink, Plus } from 'lucide-react';
import type { BillingStatus, MeResponse, OfferView, PaymentView, RevenueSummary } from '@axiom/personal-training-core';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import {
  useArchiveOffer, useBillingStatus, useConnectStripe, useCreateOffer, useOffers, useRefreshBillingStatus, useRevenue, useSaveBillingSettings,
  type OfferInput,
} from '../businessHooks';
import { formatMoney, offerSummary, parseMoneyToCents } from '../businessFormat';
import { BCOPY } from '../copyBusiness';
import { Gate } from '../components/Gate';
import { Eyebrow, Notice, PageTitle, Pill, SegmentedControl, SkeletonBlock } from '../components/primitives';
import { Shell } from '../components/Shell';

const T = BCOPY.billing;
const selectClass = 'h-10 w-full rounded-xl border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15';

/** Leave for Stripe's hosted pages. Kept apart so tests can watch it. */
export function goTo(url: string) {
  window.location.assign(url);
}

function ConnectCard({ status }: { status: BillingStatus }) {
  const connect = useConnectStripe();
  const refresh = useRefreshBillingStatus();
  const unfinished = status.connected && !status.chargesEnabled;
  const start = () => connect.mutate(undefined, { onSuccess: ({ url }) => goTo(url) });
  return (
    <section className="rounded-2xl border border-border p-6">
      <h2 className="text-[17px] font-semibold tracking-[-0.01em]">{unfinished ? T.finishTitle : T.connectTitle}</h2>
      <p className="mt-1 max-w-prose text-sm leading-relaxed text-axiom-zinc-600">{unfinished ? T.finishBody : T.connectBody}</p>
      {!unfinished && (
        <div className="mt-4 flex items-start gap-3 rounded-xl bg-axiom-success-soft p-3">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-axiom-success-ink" aria-hidden />
          <div>
            <p className="text-sm font-semibold text-axiom-success-ink">{T.feeTitle}</p>
            <p className="text-[13px] text-axiom-success-ink">{T.feeBody}</p>
          </div>
        </div>
      )}
      {connect.isError && <p role="alert" className="mt-3 text-sm text-axiom-destructive-ink">{(connect.error as Error).message}</p>}
      <div className="mt-5 flex flex-wrap gap-2">
        <Button className="h-11 rounded-xl md:h-10" onClick={start} disabled={connect.isPending}>
          {connect.isPending ? T.connecting : unfinished ? T.continueSetup : T.connect} <ExternalLink className="size-4" aria-hidden />
        </Button>
        {unfinished && <Button variant="secondary" className="h-11 rounded-xl md:h-10" onClick={() => refresh.mutate()} disabled={refresh.isPending}>{T.refresh}</Button>}
      </div>
    </section>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'red' }) {
  return (
    <div className="rounded-2xl border border-border p-4">
      <dt className="text-xs text-axiom-zinc-600">{label}</dt>
      <dd className={cn('mt-1 text-[22px] font-bold tabular-nums tracking-[-0.01em]', tone === 'red' && 'text-axiom-destructive-ink')}>{value}</dd>
    </div>
  );
}

const PAYMENT_TONE: Record<PaymentView['status'], 'green' | 'amber' | 'red' | 'zinc'> = { paid: 'green', open: 'amber', failed: 'red', uncollectible: 'red', void: 'zinc' };

function Payments({ payments }: { payments: PaymentView[] }) {
  if (payments.length === 0) return <p className="text-sm text-axiom-zinc-500">{T.noPayments}</p>;
  return (
    <ul className="divide-y divide-border rounded-2xl border border-border">
      {payments.map((p) => (
        <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold tabular-nums">{formatMoney(p.status === 'paid' ? p.amountPaidCents : p.amountDueCents, p.currency)}</p>
            <p className="text-xs text-axiom-zinc-500">{new Date(p.paidAt ?? p.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}{p.attemptCount > 1 ? ` · ${p.attemptCount} attempts` : ''}</p>
          </div>
          <Pill tone={PAYMENT_TONE[p.status]}>{T.statusLabel[p.status]}</Pill>
        </li>
      ))}
    </ul>
  );
}

function Revenue({ revenue }: { revenue: RevenueSummary }) {
  const m = (c: number) => formatMoney(c, revenue.currency);
  return (
    <section aria-labelledby="rev-h" className="space-y-4">
      <h2 id="rev-h" className="sr-only">Revenue</h2>
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Kpi label={T.kpis.mrr} value={m(revenue.mrrCents)} />
        <Kpi label={T.kpis.collected} value={m(revenue.collected30Cents)} />
        <Kpi label={T.kpis.active} value={String(revenue.activeSubscriptions)} />
        <Kpi label={T.kpis.pastDue} value={String(revenue.pastDue)} tone={revenue.pastDue > 0 ? 'red' : undefined} />
        <Kpi label={T.kpis.failing} value={m(revenue.failingCents)} tone={revenue.failingCents > 0 ? 'red' : undefined} />
        <Kpi label={T.kpis.churn} value={revenue.churnRate30 === null ? '—' : `${Math.round(revenue.churnRate30 * 10) / 10}%`} />
      </dl>
      {revenue.perOffer.length > 0 && (
        <div>
          <Eyebrow className="mb-2">{T.perOffer}</Eyebrow>
          <div className="overflow-x-auto rounded-2xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-axiom-zinc-50 text-left text-xs text-axiom-zinc-600">
                <tr><th scope="col" className="px-4 py-2 font-semibold">{T.perOfferCols.name}</th><th scope="col" className="px-4 py-2 text-right font-semibold">{T.perOfferCols.active}</th><th scope="col" className="px-4 py-2 text-right font-semibold">{T.perOfferCols.sold}</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {revenue.perOffer.map((o) => (
                  <tr key={o.offerId}><td className="px-4 py-2.5">{o.name}</td><td className="px-4 py-2.5 text-right tabular-nums">{o.active}</td><td className="px-4 py-2.5 text-right tabular-nums">{o.sold30}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div>
        <Eyebrow className="mb-2">{T.recent}</Eyebrow>
        <Payments payments={revenue.recent} />
      </div>
    </section>
  );
}

type Kind = OfferView['kind'];

/** The form's fields → the API body, or a message saying what is wrong. Exported for tests. */
export function offerFromForm(f: { name: string; description: string; kind: Kind; price: string; interval: 'week' | 'month' | 'year'; intervalCount: string; sessions: string }): { offer: OfferInput } | { error: string } {
  const priceCents = parseMoneyToCents(f.price);
  if (priceCents === null || priceCents < 100) return { error: T.form.badPrice };
  const sessionsRaw = f.sessions.trim();
  const sessions = sessionsRaw === '' ? null : Number(sessionsRaw);
  if (sessions !== null && (!Number.isInteger(sessions) || sessions < 1 || sessions > 500)) return { error: T.form.badSessions };
  if (f.kind === 'package' && sessions === null) return { error: T.form.badSessions };
  const offer: OfferInput = { name: f.name.trim(), kind: f.kind, priceCents, ...(f.description.trim() ? { description: f.description.trim() } : {}) };
  if (f.kind === 'subscription') {
    offer.interval = f.interval;
    offer.intervalCount = Math.max(1, Math.min(12, Number(f.intervalCount) || 1));
  }
  if (f.kind !== 'one_time') offer.sessionCredits = sessions;
  return { offer };
}

function NewOfferForm({ currency, onDone }: { currency: string; onDone: () => void }) {
  const create = useCreateOffer();
  const [f, setF] = useState({ name: '', description: '', kind: 'subscription' as Kind, price: '', interval: 'month' as 'week' | 'month' | 'year', intervalCount: '1', sessions: '' });
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((s) => ({ ...s, [k]: v })); setError(null); };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const out = offerFromForm(f);
    if ('error' in out) return setError(out.error);
    create.mutate(out.offer, { onSuccess: onDone });
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4 rounded-2xl border border-border p-4" aria-label={T.newOffer}>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="offer-name">{T.form.name}</Label>
          <Input id="offer-name" value={f.name} maxLength={80} placeholder={T.form.namePlaceholder} onChange={(e) => set('name', e.target.value)} className="h-10 rounded-xl" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="offer-price">{T.form.price(currency)}</Label>
          <Input id="offer-price" inputMode="decimal" value={f.price} placeholder="60" onChange={(e) => set('price', e.target.value)} className="h-10 rounded-xl tabular-nums" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="offer-desc">{T.form.description}</Label>
        <Input id="offer-desc" value={f.description} maxLength={300} onChange={(e) => set('description', e.target.value)} className="h-10 rounded-xl" />
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-medium" id="offer-kind-l">{T.form.kind}</p>
        <SegmentedControl label={T.form.kind} value={f.kind} onChange={(k) => set('kind', k)} options={(['subscription', 'package', 'one_time'] as Kind[]).map((k) => ({ value: k, label: T.form.kinds[k] }))} />
      </div>
      {f.kind === 'subscription' && (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="offer-count">{T.form.intervalCount}</Label>
            <Input id="offer-count" type="number" min={1} max={12} value={f.intervalCount} onChange={(e) => set('intervalCount', e.target.value)} className="h-10 rounded-xl tabular-nums" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="offer-interval">{T.form.interval}</Label>
            <select id="offer-interval" className={selectClass} value={f.interval} onChange={(e) => set('interval', e.target.value as typeof f.interval)}>
              {(['week', 'month', 'year'] as const).map((i) => <option key={i} value={i}>{T.form.intervals[i]}</option>)}
            </select>
          </div>
        </div>
      )}
      {f.kind !== 'one_time' && (
        <div className="space-y-1.5 md:max-w-xs">
          <Label htmlFor="offer-sessions">{f.kind === 'package' ? T.form.sessions : T.form.sessionsOptional}</Label>
          <Input id="offer-sessions" type="number" min={1} max={500} value={f.sessions} onChange={(e) => set('sessions', e.target.value)} className="h-10 rounded-xl tabular-nums" />
        </div>
      )}
      {(error || create.isError) && <p role="alert" className="text-sm text-axiom-destructive-ink">{error ?? (create.error as Error).message}</p>}
      <Button type="submit" className="h-11 rounded-xl md:h-10" disabled={f.name.trim().length < 2 || !f.price.trim() || create.isPending}>
        {create.isPending ? T.form.creating : T.form.create}
      </Button>
    </form>
  );
}

function Offers({ currency }: { currency: string }) {
  const offers = useOffers();
  const archive = useArchiveOffer();
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState<OfferView | null>(null);
  const [created, setCreated] = useState(false);
  const list = offers.data?.offers ?? [];
  const active = list.filter((o) => o.active);
  const archived = list.filter((o) => !o.active);

  return (
    <section aria-labelledby="offers-h" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="offers-h" className="text-[17px] font-semibold tracking-[-0.01em]">{T.offers}</h2>
        {!creating && <Button variant="secondary" className="h-10 rounded-xl" onClick={() => { setCreating(true); setCreated(false); }}><Plus className="size-4" aria-hidden /> {T.newOffer}</Button>}
      </div>
      {created && <p role="status" className="text-sm text-axiom-success-ink">{T.form.created}</p>}
      {creating && <NewOfferForm currency={currency} onDone={() => { setCreating(false); setCreated(true); }} />}
      {offers.isPending ? <SkeletonBlock className="h-24 w-full rounded-2xl" /> : offers.isError ? (
        <Notice alert action={<Button variant="secondary" className="h-10 rounded-xl" onClick={() => offers.refetch()}>{BCOPY.inbox.retry}</Button>}>{T.loadFailed}</Notice>
      ) : active.length === 0 && !creating ? <Notice>{T.noOffers}</Notice> : (
        <ul className="divide-y divide-border rounded-2xl border border-border">
          {active.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">{o.name}</p>
                <p className="text-xs text-axiom-zinc-600 tabular-nums">{offerSummary(o)}</p>
                {o.description && <p className="mt-0.5 text-xs text-axiom-zinc-500">{o.description}</p>}
              </div>
              <Button variant="ghost" className="h-10 shrink-0 rounded-xl text-axiom-zinc-600" onClick={() => setConfirm(o)} aria-label={`${T.archive} ${o.name}`}>
                <Archive className="size-4" aria-hidden /> {T.archive}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {archived.length > 0 && <p className="text-xs text-axiom-zinc-500">{T.archived}: {archived.map((o) => o.name).join(', ')}</p>}
      {archive.isError && <p role="alert" className="text-sm text-axiom-destructive-ink">{(archive.error as Error).message}</p>}
      <AlertDialog open={!!confirm} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm ? T.archiveConfirmTitle(confirm.name) : ''}</AlertDialogTitle>
            <AlertDialogDescription>{T.archiveConfirmBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{BCOPY.schedule.keep}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (confirm) archive.mutate(confirm.id); setConfirm(null); }}>{T.archive}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function Settings({ status }: { status: BillingStatus }) {
  const save = useSaveBillingSettings();
  const rows: { key: 'dunningNudges' | 'bookingNeedsCredit'; label: string; body: string }[] = [
    { key: 'dunningNudges', label: T.dunning, body: T.dunningBody },
    { key: 'bookingNeedsCredit', label: T.needsCredit, body: T.needsCreditBody },
  ];
  return (
    <section aria-labelledby="bill-settings-h" className="space-y-2">
      <h2 id="bill-settings-h" className="text-[17px] font-semibold tracking-[-0.01em]">{T.settings}</h2>
      <ul className="divide-y divide-border rounded-2xl border border-border">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0">
              <Label htmlFor={`bill-${r.key}`} className="text-[13px] font-semibold">{r.label}</Label>
              <p className="text-xs text-axiom-zinc-500">{r.body}</p>
            </div>
            <Switch id={`bill-${r.key}`} checked={status[r.key]} onCheckedChange={(v) => save.mutate({ [r.key]: v })} />
          </li>
        ))}
      </ul>
      {save.isError && <p role="alert" className="text-sm text-axiom-destructive-ink">{(save.error as Error).message}</p>}
    </section>
  );
}

function Connected({ status }: { status: BillingStatus }) {
  const revenue = useRevenue();
  return (
    <div className="space-y-10">
      <p className="flex flex-wrap items-center gap-2 text-sm text-axiom-zinc-600">
        <Pill tone="green">{T.connected}</Pill>
        <span>{T.payouts(status.payoutsEnabled)}</span>
        <span aria-hidden>·</span>
        <span>{T.feeTitle}</span>
      </p>
      {revenue.isPending ? <SkeletonBlock className="h-40 w-full rounded-2xl" /> : revenue.isError ? (
        <Notice alert action={<Button variant="secondary" className="h-10 rounded-xl" onClick={() => revenue.refetch()}>{BCOPY.inbox.retry}</Button>}>{T.loadFailed}</Notice>
      ) : <Revenue revenue={revenue.data.revenue} />}
      <Offers currency={status.currency} />
      <Settings status={status} />
    </div>
  );
}

function BillingView({ me }: { me: MeResponse }) {
  const status = useBillingStatus();
  const refresh = useRefreshBillingStatus();
  const search = useSearch();
  const asked = useRef(false);
  // Back from Stripe onboarding: ask Stripe for the fresh account state once.
  useEffect(() => {
    if (asked.current || new URLSearchParams(search).get('connect') !== 'done') return;
    asked.current = true;
    refresh.mutate();
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  // The refresh writes into the same cache entry, so this is always the newest answer.
  const s = status.data?.status;
  return (
    <Shell me={me} active="billing" title={T.title}>
      <PageTitle>{T.title}</PageTitle>
      {status.isPending && !s ? (
        <div aria-busy="true" className="space-y-3"><SkeletonBlock className="h-28 w-full rounded-2xl" /><SkeletonBlock className="h-28 w-full rounded-2xl" /></div>
      ) : !s ? (
        <Notice alert action={<Button variant="secondary" className="h-10 rounded-xl" onClick={() => status.refetch()}>{BCOPY.inbox.retry}</Button>}>{T.loadFailed}</Notice>
      ) : !s.available ? (
        <Notice><p className="font-semibold text-foreground">{T.unavailable}</p><p className="mt-1">{T.unavailableBody}</p></Notice>
      ) : !s.connected || !s.chargesEnabled ? (
        <ConnectCard status={s} />
      ) : (
        <Connected status={s} />
      )}
    </Shell>
  );
}

export default function BillingPage() {
  return <Gate>{(me) => <BillingView me={me} />}</Gate>;
}
