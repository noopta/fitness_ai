// Paying the trainer: their offers, the client's plans and payments, and the
// way to Stripe's hosted pages for checkout or to change a card or cancel.
// `?offer=` (from the trainer's payment link) picks an offer; `?paid=1` is Stripe's return.

import { useEffect, useRef } from 'react';
import { CheckCircle2, CreditCard, ExternalLink } from 'lucide-react';
import type { OfferView, PaymentView } from '@axiom/personal-training-core';
import { cn } from '@/lib/utils';
import { formatMoney, intervalLabel } from '@/features/personal-training/businessFormat';
import { errorMessage } from '../api';
import { Card, EmptyState, Eyebrow, InlineError, ListSkeleton, LoadFailed, PortalButton, ScreenTitle } from '../components';
import { formatDay } from '../helpers';
import { useCheckout, useManageBilling, usePortalBilling, usePortalNav } from '../hooks';

/** Leave for Stripe. Kept apart so tests can watch it. */
export function leaveFor(url: string) {
  window.location.assign(url);
}

const PAYMENT_LABEL: Record<PaymentView['status'], string> = { paid: 'Paid', open: 'Due', failed: 'Failed', void: 'Void', uncollectible: 'Unpaid' };
const PLAN_LABEL: Record<string, string> = { pending: 'Starting', active: 'Active', past_due: 'Payment due', canceled: 'Cancelled', complete: 'Paid' };

function OfferCard({ offer, highlighted, onBuy, busy }: { offer: OfferView; highlighted: boolean; onBuy: () => void; busy: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlighted) try { ref.current?.scrollIntoView?.({ block: 'center' }); } catch { /* not everywhere */ }
  }, [highlighted]);
  return (
    <div
      ref={ref}
      aria-current={highlighted ? 'true' : undefined}
      className={cn('rounded-2xl border bg-background p-4 shadow-xs', highlighted ? 'border-[var(--portal-accent)] ring-2 ring-[var(--portal-accent)]' : 'border-border')}
    >
      {highlighted && <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-axiom-zinc-600">Picked for you</p>}
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="min-w-0 text-[15px] font-semibold">{offer.name}</h3>
        <p className="shrink-0 text-right">
          <span className="text-[17px] font-bold tabular-nums">{formatMoney(offer.priceCents, offer.currency)}</span>
          {offer.kind === 'subscription' && <span className="text-sm text-axiom-zinc-600"> {intervalLabel(offer)}</span>}
        </p>
      </div>
      {offer.sessionCredits ? (
        <p className="mt-0.5 text-sm text-axiom-zinc-600">
          {offer.sessionCredits} {offer.sessionCredits === 1 ? 'session' : 'sessions'}{offer.kind === 'subscription' ? ` each ${offer.interval ?? 'period'}` : ''}
        </p>
      ) : offer.kind === 'one_time' ? <p className="mt-0.5 text-sm text-axiom-zinc-600">One payment</p> : null}
      {offer.description && <p className="mt-2 text-sm text-axiom-zinc-600">{offer.description}</p>}
      <PortalButton className="mt-3 w-full" onClick={onBuy} disabled={busy} variant={highlighted ? 'accent' : 'secondary'}>
        {busy ? 'Opening checkout…' : offer.kind === 'subscription' ? 'Subscribe' : 'Buy'} <ExternalLink />
      </PortalButton>
    </div>
  );
}

export function BillingScreen() {
  const { offer: picked, paid, go } = usePortalNav();
  const q = usePortalBilling();
  const checkout = useCheckout();
  const manage = useManageBilling();

  if (q.isPending) return <div><ScreenTitle>Pay</ScreenTitle><ListSkeleton rows={3} /></div>;
  if (q.isError) return <div><ScreenTitle>Pay</ScreenTitle><LoadFailed onRetry={() => q.refetch()} /></div>;
  const { available, offers, plans, payments } = q.data;
  const hasPlans = plans.length > 0;

  if (!available && !hasPlans && payments.length === 0) {
    return (
      <div>
        <ScreenTitle>Pay</ScreenTitle>
        <EmptyState icon={<CreditCard />} title="Payments aren't open here yet">Your trainer will let you know how to pay them.</EmptyState>
      </div>
    );
  }

  const ordered = picked ? [...offers].sort((a, b) => Number(b.id === picked) - Number(a.id === picked)) : offers;
  const buy = (id: string) => checkout.mutate(id, { onSuccess: ({ url }) => leaveFor(url) });

  return (
    <div className="space-y-5">
      <ScreenTitle sub="Payments go straight to your trainer through Stripe.">Pay</ScreenTitle>

      {paid && (
        <div role="status" className="flex items-start gap-3 rounded-2xl bg-axiom-success-soft p-4 text-axiom-success-ink">
          <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold">Thank you, you're paid up.</p>
            <p className="text-sm">It can take a minute to show below.</p>
          </div>
          <PortalButton variant="ghost" className="-my-2 shrink-0 text-axiom-success-ink" onClick={() => go({ tab: 'billing' })}>Dismiss</PortalButton>
        </div>
      )}

      {hasPlans && (
        <section aria-labelledby="plans-h">
          <Eyebrow className="mb-2"><span id="plans-h">Your plans</span></Eyebrow>
          <Card as="div">
            <ul className="divide-y divide-border">
              {plans.map((p) => (
                <li key={p.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="min-w-0 text-sm font-semibold">{p.offer?.name ?? 'Plan'}</p>
                    <span className={cn('shrink-0 text-xs font-semibold', p.status === 'past_due' ? 'text-axiom-destructive-ink' : 'text-axiom-zinc-600')}>{PLAN_LABEL[p.status] ?? p.status}</span>
                  </div>
                  {p.creditsTotal > 0 && <p className="mt-0.5 text-xs tabular-nums text-axiom-zinc-600">{p.creditsLeft} of {p.creditsTotal} sessions left</p>}
                  {p.currentPeriodEnd && p.status !== 'canceled' && <p className="text-xs text-axiom-zinc-500">Renews {formatDay(p.currentPeriodEnd)}</p>}
                </li>
              ))}
            </ul>
          </Card>
          {manage.isError && <div className="mt-2"><InlineError>{errorMessage(manage.error, 'Could not open the billing page. Try again.')}</InlineError></div>}
          <PortalButton variant="secondary" className="mt-3 w-full" disabled={manage.isPending} onClick={() => manage.mutate(undefined, { onSuccess: ({ url }) => leaveFor(url) })}>
            {manage.isPending ? 'Opening…' : 'Manage card / cancel'} <ExternalLink />
          </PortalButton>
        </section>
      )}

      {available && (
        <section aria-labelledby="offers-h" className="space-y-3">
          <Eyebrow><span id="offers-h">{hasPlans ? 'More options' : 'Options'}</span></Eyebrow>
          {checkout.isError && <InlineError>{errorMessage(checkout.error, 'Could not open checkout. Try again.')}</InlineError>}
          {ordered.length === 0 ? <EmptyState title="Nothing to buy right now">Your trainer hasn't added any plans yet.</EmptyState> : ordered.map((o) => (
            <OfferCard key={o.id} offer={o} highlighted={o.id === picked} busy={checkout.isPending && checkout.variables === o.id} onBuy={() => buy(o.id)} />
          ))}
        </section>
      )}

      {payments.length > 0 && (
        <section aria-labelledby="payments-h">
          <Eyebrow className="mb-2"><span id="payments-h">Payments</span></Eyebrow>
          <Card as="div">
            <ul className="divide-y divide-border">
              {payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold tabular-nums">{formatMoney(p.status === 'paid' ? p.amountPaidCents : p.amountDueCents, p.currency)}</p>
                    <p className="text-xs text-axiom-zinc-500">{formatDay(p.paidAt ?? p.createdAt)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={cn('text-xs font-semibold', p.status === 'failed' || p.status === 'uncollectible' ? 'text-axiom-destructive-ink' : p.status === 'paid' ? 'text-axiom-success-ink' : 'text-axiom-zinc-600')}>{PAYMENT_LABEL[p.status]}</span>
                    {p.hostedUrl && p.status !== 'paid' && p.status !== 'void' && (
                      <a href={p.hostedUrl} target="_blank" rel="noreferrer noopener" className="inline-flex min-h-11 items-center rounded-xl px-2 text-xs font-semibold underline underline-offset-4 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/20">Pay now</a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </div>
  );
}
