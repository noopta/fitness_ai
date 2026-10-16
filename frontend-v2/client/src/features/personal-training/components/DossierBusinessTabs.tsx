// The dossier's Intake, Nutrition and Billing tabs, and the "Programs you
// wrote" section of the Program tab. Intake and nutrition are read from what
// the client did; billing reads Stripe through the server and only ever
// produces a link for the trainer to send.

import { useState } from 'react';
import { Link } from 'wouter';
import {
  COPY, relativeDay, shortDate,
  type ClientPlanView, type IntakeState, type NutritionRollup, type NutritionSummary, type PaymentView,
} from '@axiom/personal-training-core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { PRG } from '../copyPrograms';
import {
  useBillingStatus, useClientBilling, useIntake, useNutrition, useOffers, usePaymentRequest, usePrograms, useResetIntake, useSetNutritionTargets,
} from '../programHooks';
import { CopyField, errorText, selectClass } from './ChipInput';
import { Eyebrow, Notice, Pill, SkeletonBlock } from './primitives';
import { GenerateDialog, NewProgramDialog } from './ProgramDialogs';

const Loading = () => <div aria-busy="true" className="space-y-3"><SkeletonBlock className="h-20 w-full" /><SkeletonBlock className="h-32 w-full" /></div>;
const Failed = ({ retry, text }: { retry: () => void; text: string }) => (
  <Notice alert action={<Button variant="secondary" className="h-10 rounded-xl" onClick={retry}>{COPY.roster.retry}</Button>}>{text}</Notice>
);
const day = (iso: string) => shortDate(new Date(iso.length === 10 ? `${iso}T12:00:00` : iso));

// ── Programs you wrote (inside the Program tab) ──────────────────────────────

export function TrainerProgramsSection({ clientId, canProgram }: { clientId: string; canProgram: boolean }) {
  const programs = usePrograms({ clientId });
  const [newOpen, setNewOpen] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const D = PRG.dossierPrograms;
  // Published first, then newest.
  const list = [...(programs.data?.programs ?? [])].sort((a, b) => Number(b.status === 'published') - Number(a.status === 'published') || b.updatedAt.localeCompare(a.updatedAt));

  return (
    <section aria-labelledby="pt-trainer-programs" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="pt-trainer-programs" className="text-[15px] font-semibold tracking-[-0.01em]">{D.title}</h2>
        {canProgram && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" className="h-10 rounded-xl" onClick={() => setGenOpen(true)}>{D.generate}</Button>
            <Button className="h-10 rounded-xl" onClick={() => setNewOpen(true)}>{D.newProgram}</Button>
          </div>
        )}
      </div>
      {programs.isPending ? <SkeletonBlock className="h-16 w-full" />
        : programs.isError ? <Failed retry={() => programs.refetch()} text={D.loadFailed} />
        : list.length === 0 ? <p className="text-sm text-axiom-zinc-500">{D.empty}</p>
        : (
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {list.map((p) => (
              <li key={p.id}>
                <Link href={`/personal-training/programs/${p.id}`} className="flex min-h-14 items-center gap-3 px-4 py-2.5 hover:bg-axiom-zinc-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-[13px] font-semibold">{p.name}</p>
                      <Pill tone={p.status === 'published' ? 'green' : 'zinc'}>{PRG.status[p.status]}</Pill>
                      <span className="rounded-md border border-border px-1.5 py-px text-[10px] font-semibold text-axiom-zinc-600">{PRG.source[p.source]}</span>
                    </div>
                    <p className="text-xs text-axiom-zinc-500">{PRG.list.shape(p.weeks, p.daysPerWeek)} · {PRG.list.updated(relativeDay(p.updatedAt)?.toLowerCase() ?? '')}</p>
                  </div>
                  <span className="shrink-0 text-xs font-semibold text-axiom-zinc-600">{D.open}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      <NewProgramDialog open={newOpen} onOpenChange={setNewOpen} clientId={clientId} />
      <GenerateDialog open={genOpen} onOpenChange={setGenOpen} clientId={clientId} />
    </section>
  );
}

// ── Intake ───────────────────────────────────────────────────────────────────

const I = PRG.intake;

function IntakeBody({ intake, clientId }: { intake: IntakeState; clientId: string }) {
  const reset = useResetIntake(clientId);
  const tone = intake.status === 'complete' ? 'green' : intake.status === 'in_progress' ? 'amber' : 'zinc';
  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={tone}>{I.status[intake.status]}</Pill>
          <p className="text-sm font-semibold tabular-nums">{I.completeness(intake.completeness)}</p>
          {intake.completedAt && <p className="text-xs text-axiom-zinc-500">{I.completedOn(day(intake.completedAt))}</p>}
        </div>
        <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={intake.completeness} aria-label={I.completeness(intake.completeness)} className="mt-3 h-1.5 overflow-hidden rounded-full bg-axiom-zinc-100">
          <div className="h-full rounded-full bg-foreground" style={{ width: `${intake.completeness}%` }} />
        </div>
        {intake.status === 'not_started' && <p className="mt-3 text-sm leading-relaxed text-axiom-zinc-600">{I.notStarted}</p>}
      </section>

      <section aria-label={I.tab}>
        <ul className="divide-y divide-border rounded-2xl border border-border">
          {intake.fields.map((f) => (
            <li key={f.key} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[13px] font-semibold">{f.label}</p>
                {f.required && <span className="text-[11px] text-axiom-zinc-500">{I.required}</span>}
                {f.vague && <span title={I.vagueHelp}><Pill tone="amber">{I.vague}</Pill></span>}
                {intake.current === f.key && <Pill tone="zinc">{I.asking}</Pill>}
              </div>
              {f.answer
                ? <p className="mt-0.5 whitespace-pre-line break-words text-sm leading-relaxed text-axiom-zinc-600">{f.answer}</p>
                : <p className="mt-0.5 text-sm text-axiom-zinc-400">{I.notAnswered}</p>}
            </li>
          ))}
        </ul>
      </section>

      {intake.transcript.length > 0 && (
        <details className="rounded-2xl border border-border">
          <summary className="flex min-h-12 cursor-pointer items-center px-4 text-[13px] font-semibold">{I.transcript} · {intake.transcript.length}</summary>
          <ol className="space-y-3 border-t border-border p-4">
            {intake.transcript.map((t, i) => (
              <li key={i} className={cn('max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed', t.role === 'client' ? 'ml-auto bg-foreground text-background' : 'bg-axiom-zinc-100')}>
                <p className={cn('mb-0.5 text-[11px] font-semibold', t.role === 'client' ? 'text-background/70' : 'text-axiom-zinc-500')}>{t.role === 'client' ? I.client : I.you}</p>
                <p className="whitespace-pre-line break-words">{t.text}</p>
              </li>
            ))}
          </ol>
        </details>
      )}

      {intake.status !== 'not_started' && (
        <div>
          <Button variant="secondary" className="h-10 rounded-xl" disabled={reset.isPending} onClick={() => { if (window.confirm(I.resetConfirm)) reset.mutate(); }}>{I.reset}</Button>
          {reset.isError && <p role="alert" className="mt-1 text-xs text-axiom-destructive-ink">{errorText(reset.error, I.resetFailed)}</p>}
        </div>
      )}
    </div>
  );
}

export function IntakeTab({ clientId }: { clientId: string }) {
  const intake = useIntake(clientId);
  if (intake.isPending) return <Loading />;
  if (intake.isError) return <Failed retry={() => intake.refetch()} text={I.loadFailed} />;
  return <IntakeBody intake={intake.data.intake} clientId={clientId} />;
}

// ── Nutrition ────────────────────────────────────────────────────────────────

const N = PRG.nutrition;
type TargetForm = { calories: string; proteinG: string; carbsG: string; fatG: string };
const TARGET_FIELDS: { key: keyof TargetForm; label: string }[] = [
  { key: 'calories', label: N.calories }, { key: 'proteinG', label: N.protein }, { key: 'carbsG', label: N.carbs }, { key: 'fatG', label: N.fat },
];

/** Empty boxes clear a target; anything else must be a whole non-negative number. */
export function targetsFrom(f: TargetForm): { calories: number | null; proteinG: number | null; carbsG: number | null; fatG: number | null } | null {
  const out: Record<string, number | null> = {};
  for (const { key } of TARGET_FIELDS) {
    const v = f[key].trim();
    if (!v) { out[key] = null; continue; }
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return null;
    out[key] = Math.round(n);
  }
  return out as ReturnType<typeof targetsFrom>;
}

const avg = (v: number | null, unit: string) => (v == null ? '—' : `${Math.round(v).toLocaleString()} ${unit}`);

function Rollup({ title, r }: { title: string; r: NutritionRollup }) {
  return (
    <section aria-label={title} className="rounded-2xl border border-border p-4">
      <Eyebrow className="mb-2">{title}</Eyebrow>
      <p className="text-xs text-axiom-zinc-500 tabular-nums">{N.logged(r.daysLogged, r.windowDays)}</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm tabular-nums">
        <div><dt className="text-xs text-axiom-zinc-500">{N.calories}</dt><dd className="font-semibold">{avg(r.avgCalories, N.kcal)}</dd></div>
        <div><dt className="text-xs text-axiom-zinc-500">{N.protein}</dt><dd className="font-semibold">{avg(r.avgProteinG, 'g')}</dd></div>
        <div><dt className="text-xs text-axiom-zinc-500">{N.carbs}</dt><dd>{avg(r.avgCarbsG, 'g')}</dd></div>
        <div><dt className="text-xs text-axiom-zinc-500">{N.fat}</dt><dd>{avg(r.avgFatG, 'g')}</dd></div>
      </dl>
      {(r.caloriesOnTarget != null || r.proteinOnTarget != null) && (
        <p className="mt-2 text-xs text-axiom-zinc-600 tabular-nums">
          {[r.caloriesOnTarget != null ? N.onTarget(r.caloriesOnTarget) : null, r.proteinOnTarget != null ? N.proteinHit(r.proteinOnTarget) : null].filter(Boolean).join(' · ')}
        </p>
      )}
    </section>
  );
}

function NutritionBody({ n, clientId }: { n: NutritionSummary; clientId: string }) {
  const save = useSetNutritionTargets(clientId);
  const str = (v: number | null | undefined) => (v == null ? '' : String(v));
  const [form, setForm] = useState<TargetForm>({ calories: str(n.targets?.calories), proteinG: str(n.targets?.proteinG), carbsG: str(n.targets?.carbsG), fatG: str(n.targets?.fatG) });
  const parsed = targetsFrom(form);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[15px] leading-relaxed">{n.line}</p>
        {n.patterns?.length > 0 && (
          <section aria-labelledby="pt-nutrition-patterns" className="mt-4">
            <h2 id="pt-nutrition-patterns" className="mb-1.5 text-[13px] font-semibold">{N.patterns}</h2>
            <ul className="space-y-1">
              {n.patterns.map((p) => (
                <li key={p} className="flex gap-2 text-sm leading-relaxed text-axiom-zinc-600"><span aria-hidden className="text-axiom-zinc-400">→</span><span>{p}</span></li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <form
        className="rounded-2xl border border-border p-4"
        onSubmit={(e) => { e.preventDefault(); if (parsed) save.mutate(parsed); }}
      >
        <Eyebrow className="mb-1">{N.targets}</Eyebrow>
        <p className="mb-3 text-xs text-axiom-zinc-500">{N.targetsHelp}</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {TARGET_FIELDS.map(({ key, label }) => (
            <div key={key} className="space-y-1.5">
              <Label htmlFor={`pt-nt-${key}`}>{label}</Label>
              <Input id={`pt-nt-${key}`} type="number" inputMode="numeric" min={0} value={form[key]} onChange={(e) => { save.reset(); setForm((f) => ({ ...f, [key]: e.target.value })); }} className="h-10 rounded-xl tabular-nums" />
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-axiom-zinc-500">{n.appCalorieTarget != null ? N.appTarget(n.appCalorieTarget) : N.noAppTarget}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button type="submit" className="h-10 rounded-xl" disabled={!parsed || save.isPending}>{N.save}</Button>
          {save.isSuccess && <p role="status" className="text-sm text-axiom-success-ink">{N.saved}</p>}
          {save.isError && <p role="alert" className="text-sm text-axiom-destructive-ink">{errorText(save.error, N.failed)}</p>}
        </div>
      </form>

      <div className="grid gap-3 sm:grid-cols-2">
        <Rollup title={N.week} r={n.week} />
        <Rollup title={N.month} r={n.month} />
      </div>

      <section aria-labelledby="pt-nutrition-days">
        <h2 id="pt-nutrition-days" className="mb-2 text-[15px] font-semibold tracking-[-0.01em]">{N.days}</h2>
        {n.days.length === 0 ? <p className="text-sm text-axiom-zinc-500">{N.noDays}</p> : (
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {n.days.map((d) => (
              <li key={d.date} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-2.5 text-[13px] tabular-nums">
                <span className="font-semibold">{day(d.date)}</span>
                <span className="text-axiom-zinc-600">{d.calories.toLocaleString()} {N.kcal} · P {Math.round(d.proteinG)} · C {Math.round(d.carbsG)} · F {Math.round(d.fatG)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function NutritionTab({ clientId }: { clientId: string }) {
  const n = useNutrition(clientId);
  if (n.isPending) return <Loading />;
  if (n.isError) return <Failed retry={() => n.refetch()} text={N.loadFailed} />;
  return <NutritionBody n={n.data.nutrition} clientId={clientId} />;
}

// ── Billing ──────────────────────────────────────────────────────────────────

const BL = PRG.billing;

export function money(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

const PLAN_TONE: Record<ClientPlanView['status'], 'green' | 'amber' | 'red' | 'zinc'> = { active: 'green', pending: 'zinc', past_due: 'red', canceled: 'zinc', complete: 'zinc' };
const PAY_TONE: Record<PaymentView['status'], 'green' | 'amber' | 'red' | 'zinc'> = { paid: 'green', open: 'amber', failed: 'red', void: 'zinc', uncollectible: 'red' };

function RequestPayment({ clientId }: { clientId: string }) {
  const offers = useOffers();
  const request = usePaymentRequest(clientId);
  const [offerId, setOfferId] = useState('');
  const active = (offers.data?.offers ?? []).filter((o) => o.active);
  return (
    <section aria-labelledby="pt-request-pay" className="rounded-2xl border border-border p-4">
      <h2 id="pt-request-pay" className="mb-3 text-[15px] font-semibold tracking-[-0.01em]">{BL.request}</h2>
      {offers.isPending ? <SkeletonBlock className="h-10 w-full" />
        : active.length === 0 ? <p className="text-sm text-axiom-zinc-600">{BL.noOffers} <Link href="/personal-training/billing" className="font-semibold underline-offset-2 hover:underline">{BL.setUp}</Link></p>
        : request.data ? (
          <div className="space-y-2">
            <CopyField value={request.data.url} label={BL.linkLabel} copyLabel={COPY.invite.copy} copiedLabel={COPY.invite.copied} />
            <p className="text-xs text-axiom-zinc-500">{BL.linkNote}</p>
            <Button variant="ghost" className="h-9 rounded-lg px-2 text-xs" onClick={() => { request.reset(); setOfferId(''); }}>{BL.createLink}</Button>
          </div>
        ) : (
          <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); if (offerId) request.mutate(offerId); }}>
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label htmlFor="pt-pay-offer">{BL.offer}</Label>
              <select id="pt-pay-offer" className={selectClass} value={offerId} onChange={(e) => setOfferId(e.target.value)}>
                <option value="">{BL.chooseOffer}</option>
                {active.map((o) => <option key={o.id} value={o.id}>{o.name} · {money(o.priceCents, o.currency)}{o.interval ? ` / ${o.interval}` : ''}</option>)}
              </select>
            </div>
            <Button type="submit" className="h-10 rounded-xl" disabled={!offerId || request.isPending}>{BL.createLink}</Button>
          </form>
        )}
      {request.isError && <p role="alert" className="mt-2 text-sm text-axiom-destructive-ink">{errorText(request.error, BL.linkFailed)}</p>}
    </section>
  );
}

export function BillingTab({ clientId }: { clientId: string }) {
  const status = useBillingStatus();
  const ready = !!status.data && status.data.status.available && status.data.status.connected;
  const billing = useClientBilling(clientId, ready);

  if (status.isPending) return <Loading />;
  if (status.isError) return <Failed retry={() => status.refetch()} text={BL.loadFailed} />;
  if (!ready) {
    const s = status.data.status;
    return (
      <Notice action={s.available ? <Button asChild className="h-10 rounded-xl"><Link href="/personal-training/billing">{BL.setUp}</Link></Button> : undefined}>
        {s.available ? BL.notConnected : BL.unavailable}
      </Notice>
    );
  }
  if (billing.isPending) return <Loading />;
  if (billing.isError) return <Failed retry={() => billing.refetch()} text={BL.loadFailed} />;
  const { plans, payments } = billing.data;

  return (
    <div className="space-y-6">
      <section aria-labelledby="pt-plans">
        <h2 id="pt-plans" className="mb-2 text-[15px] font-semibold tracking-[-0.01em]">{BL.plans}</h2>
        {plans.length === 0 ? <p className="text-sm text-axiom-zinc-500">{BL.noPlans}</p> : (
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {plans.map((p) => (
              <li key={p.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[13px] font-semibold">{p.offer?.name ?? '—'}</p>
                  <Pill tone={PLAN_TONE[p.status]}>{BL.planStatus[p.status]}</Pill>
                </div>
                <p className="mt-0.5 text-xs tabular-nums text-axiom-zinc-600">
                  {[p.creditsTotal > 0 ? BL.credits(p.creditsLeft, p.creditsTotal) : null, p.offer ? money(p.offer.priceCents, p.offer.currency) : null, p.currentPeriodEnd ? BL.renews(day(p.currentPeriodEnd)) : null].filter(Boolean).join(' · ')}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="pt-payments">
        <h2 id="pt-payments" className="mb-2 text-[15px] font-semibold tracking-[-0.01em]">{BL.payments}</h2>
        {payments.length === 0 ? <p className="text-sm text-axiom-zinc-500">{BL.noPayments}</p> : (
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[13px] font-semibold tabular-nums">{money(p.status === 'paid' ? p.amountPaidCents : p.amountDueCents, p.currency)}</p>
                    <Pill tone={PAY_TONE[p.status]}>{BL.paymentStatus[p.status]}</Pill>
                  </div>
                  <p className="text-xs text-axiom-zinc-500 tabular-nums">{day(p.paidAt ?? p.createdAt)}{p.attemptCount > 1 ? ` · ${BL.attempts(p.attemptCount)}` : ''}</p>
                </div>
                {p.hostedUrl && <a href={p.hostedUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold underline-offset-2 hover:underline">{BL.view}</a>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <RequestPayment clientId={clientId} />
    </div>
  );
}
