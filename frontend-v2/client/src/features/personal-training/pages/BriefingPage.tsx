// Morning briefing (design handoff §6.1): who needs the trainer today, why,
// and the action — without leaving the page. Five states: default, all clear,
// stale, new trainer, and loading/streaming.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ShieldCheck, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  BRIEFING_STREAM_PATH, COPY, clockTime, queryKeys, shortDate,
  type Briefing, type BriefingItem, type BriefingResponse, type BriefingSource, type BriefingStreamEvent, type MeResponse,
} from '@axiom/personal-training-core';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { streamEvents } from '../api';
import { SentRow } from '../components/DraftReply';
import { Gate } from '../components/Gate';
import { Avatar, EvidenceList, Eyebrow, Notice, Pill, SkeletonBlock } from '../components/primitives';
import { Shell } from '../components/Shell';
import { useBriefing, useCanUndo, useResolveItem, useUndoItem } from '../hooks';

const SOURCES: BriefingSource[] = ['workouts', 'checkIns', 'messages', 'programs'];
const timelineHref = (clientId: string) => `/personal-training/clients/${clientId}/timeline`;
const dateEyebrow = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

// ── A card ───────────────────────────────────────────────────────────────────

interface CardApi { send: () => void; dismiss: () => void; toggleWhy: () => void }

function BriefCard({
  item, stale, focused, onFocus, register, onResolved, sample,
}: {
  item: BriefingItem;
  stale?: boolean;
  focused?: boolean;
  onFocus?: () => void;
  register?: (id: string, el: HTMLElement | null, api: CardApi | null) => void;
  onResolved?: (id: string) => void;
  /** A non-interactive preview for the new-trainer state. */
  sample?: boolean;
}) {
  const [text, setText] = useState(item.draft.text);
  const [editing, setEditing] = useState(false);
  const [why, setWhy] = useState(false);
  const resolve = useResolveItem();
  const undo = useUndoItem();
  const canUndo = useCanUndo(item.resolution?.undoUntil);
  const ref = useRef<HTMLElement>(null);

  const act = useCallback((action: 'messaged' | 'dismissed' | 'reviewed') => {
    if (sample || resolve.isPending) return;
    resolve.mutate(
      { id: item.id, action, ...(action === 'messaged' ? { editedText: text } : {}) },
      { onSuccess: () => onResolved?.(item.id) },
    );
  }, [item.id, onResolved, resolve, sample, text]);

  useEffect(() => {
    register?.(item.id, ref.current, item.resolution ? null : { send: () => act('messaged'), dismiss: () => act('dismissed'), toggleWhy: () => setWhy((v) => !v) });
    return () => register?.(item.id, null, null);
  }, [act, item.id, item.resolution, register]);

  // Act → collapse: one row with what happened and an Undo.
  if (item.resolution) {
    return (
      <article ref={ref} aria-label={item.resolution.summary}>
        <SentRow summary={item.resolution.summary} canUndo={canUndo} busy={undo.isPending} onUndo={() => undo.mutate(item.id)} />
        {undo.isError && <p role="alert" className="mt-1 text-xs text-axiom-destructive-ink">{(undo.error as Error).message}</p>}
      </article>
    );
  }

  return (
    <article
      ref={ref}
      aria-labelledby={`brief-${item.id}`}
      onFocusCapture={onFocus}
      className={cn(
        'rounded-2xl border border-border bg-background p-4 shadow-xs transition-shadow duration-200 md:p-5',
        !sample && 'hover:shadow-sm motion-safe:hover:-translate-y-0.5 motion-safe:transition-transform',
        focused && 'ring-4 ring-ring/10',
      )}
    >
      <div className="flex items-start gap-3">
        <Link href={timelineHref(item.clientId)} tabIndex={sample ? -1 : undefined} className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15">
          <Avatar initials={item.client.initials} size={44} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link href={timelineHref(item.clientId)} tabIndex={sample ? -1 : undefined} className="text-[13px] font-semibold hover:underline">{item.client.name}</Link>
            <Pill tone={item.severity === 'attention' ? 'red' : 'amber'}>{item.severity === 'attention' ? COPY.briefing.attention : COPY.briefing.look}</Pill>
          </div>
          <p className="truncate text-xs text-axiom-zinc-500">{item.client.meta}</p>
        </div>
        {!sample && (
          <button
            type="button"
            aria-label={`${COPY.briefing.dismiss}: ${item.client.name}`}
            onClick={() => act('dismissed')}
            className="grid size-11 shrink-0 place-items-center rounded-xl text-axiom-zinc-500 hover:bg-axiom-zinc-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15 md:size-9"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>

      <h3 id={`brief-${item.id}`} tabIndex={-1} className="mt-3 text-[17px] font-semibold leading-snug tracking-[-0.01em] focus-visible:outline-none">{item.headline}</h3>
      <p className="mt-1 text-sm leading-relaxed text-axiom-zinc-600">{item.detail}</p>
      {stale && <p className="mt-2 text-xs text-axiom-warning-ink">{COPY.briefing.basedOn(`${shortDate(new Date(item.dataThrough))}, ${clockTime(item.dataThrough)}`)}</p>}

      <div className="mt-4 rounded-xl bg-axiom-zinc-50 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <Eyebrow>{COPY.briefing.suggests}</Eyebrow>
          {item.guardrail && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-axiom-zinc-600">
              <ShieldCheck className="size-3.5" aria-hidden />{item.guardrail.label}
            </span>
          )}
        </div>
        {editing ? (
          <Textarea aria-label={COPY.draft.label} value={text} onChange={(e) => setText(e.target.value)} rows={4} autoFocus className="min-h-24 rounded-xl bg-background text-sm leading-relaxed" />
        ) : (
          <p className="whitespace-pre-line text-sm leading-relaxed">{text}</p>
        )}
        <p className="mt-2 text-xs text-axiom-zinc-500">{COPY.briefing.nothingSends}</p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button type="button" className="h-11 rounded-xl md:h-10" disabled={sample || resolve.isPending || !text.trim()} tabIndex={sample ? -1 : undefined} onClick={() => act('messaged')}>
          {item.primaryLabel}
        </Button>
        <Button type="button" variant="secondary" className="h-11 rounded-xl md:h-10" disabled={sample} tabIndex={sample ? -1 : undefined} onClick={() => setEditing((v) => !v)}>
          {editing ? 'Done editing' : item.secondaryLabel}
        </Button>
        <Button type="button" variant="ghost" className="h-11 rounded-xl text-axiom-zinc-600 md:h-10" disabled={sample} tabIndex={sample ? -1 : undefined} aria-expanded={why} onClick={() => setWhy((v) => !v)}>
          {COPY.briefing.why}
        </Button>
        {!sample && (
          <>
            <Button asChild variant="ghost" className="h-11 rounded-xl text-axiom-zinc-600 md:h-10"><Link href={timelineHref(item.clientId)}>{COPY.briefing.openClient}</Link></Button>
            <Button type="button" variant="ghost" className="h-11 rounded-xl text-axiom-zinc-600 md:h-10" onClick={() => act('reviewed')}>{COPY.briefing.markHandled}</Button>
          </>
        )}
      </div>
      {resolve.isError && <p role="alert" className="mt-2 text-xs text-axiom-destructive-ink">{(resolve.error as Error).message || COPY.briefing.sendFailed}</p>}

      {why && (
        <div className="mt-4 border-t border-border pt-4">
          <Eyebrow className="mb-2">{COPY.briefing.whyHeading}</Eyebrow>
          <EvidenceList reasons={item.evidence.reasons} sources={item.evidence.sources} />
        </div>
      )}
    </article>
  );
}

const SAMPLE: BriefingItem = {
  id: 'sample', clientId: 'sample',
  client: { id: 'sample', name: 'Maya Okafor', initials: 'MO', status: 'support', meta: 'Strength · week 6 of 12 · Squat 100 kg by December' },
  severity: 'attention', headline: 'Maya mentioned pain',
  detail: '"Knee has been sore since Tuesday so I skipped legs." — in a message on 24 Sep.',
  suggestion: { kind: 'message', text: '', draftId: 'sample' },
  draft: { id: 'sample', clientId: 'sample', channel: 'app', status: 'pending', text: 'Thanks for telling me, Maya. Ease off anything that aggravates it for now and do not push through pain. I will adjust this week\'s plan and check in with you tomorrow.' },
  primaryLabel: 'Send reply', secondaryLabel: 'Edit draft', guardrail: { checked: 1, label: 'Checked against 1 contraindication' },
  evidence: { reasons: ['Wrote about knee soreness in a message', 'Active injury on file: Left knee'], sources: [{ kind: 'message', id: 's', label: 'Message, 24 Sep' }] },
  dataThrough: new Date().toISOString(),
};

// ── States ───────────────────────────────────────────────────────────────────

function AllClear({ data }: { data: BriefingResponse }) {
  const stats = [
    [COPY.briefing.statCheckIns, String(data.rosterStats.checkInsThisWeek)],
    [COPY.briefing.statAdherence, `${data.rosterStats.adherence7d}%`],
    [COPY.briefing.statPrs, String(data.rosterStats.prs7d)],
  ];
  return (
    <section className="rounded-2xl border border-border p-6 md:p-8">
      <div className="flex items-center gap-2">
        <span aria-hidden className="size-2 rounded-full bg-axiom-success" />
        <h2 className="text-[17px] font-semibold tracking-[-0.01em]">{COPY.briefing.allClearTitle}</h2>
      </div>
      <p className="mt-1 text-sm text-axiom-zinc-600">{COPY.briefing.allClearBody}</p>
      <dl className="mt-6 grid grid-cols-3 gap-4">
        {stats.map(([label, value]) => (
          <div key={label}>
            <dd className="text-[26px] font-bold leading-none tracking-[-0.02em] tabular-nums">{value}</dd>
            <dt className="mt-1 text-xs text-axiom-zinc-500">{label}</dt>
          </div>
        ))}
      </dl>
      <Link href="/personal-training/anakin" className="mt-6 inline-block text-[13px] font-semibold underline-offset-2 hover:underline">{COPY.briefing.askAnakin}</Link>
    </section>
  );
}

function NewTrainer() {
  const steps: [string, string][] = [
    [COPY.briefing.setupSteps[0], '/personal-training/clients'],
    [COPY.briefing.setupSteps[1], '/personal-training/clients'],
    [COPY.briefing.setupSteps[2], '/personal-training/check-ins'],
    [COPY.briefing.setupSteps[3], '/personal-training/settings/notifications'],
  ];
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-2xl border border-border p-6">
        <h2 className="text-[17px] font-semibold tracking-[-0.01em]">{COPY.briefing.setupTitle}</h2>
        <p className="mt-1 text-sm text-axiom-zinc-600">{COPY.briefing.setupBody}</p>
        <p className="mt-4 text-xs text-axiom-zinc-500 tabular-nums">0 of {steps.length} done</p>
        <ol className="mt-2 divide-y divide-border">
          {steps.map(([label, href], i) => (
            <li key={label}>
              <Link href={href} className="flex min-h-11 items-center gap-3 py-2 text-sm hover:underline">
                <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full bg-axiom-zinc-100 text-[11px] font-bold tabular-nums">{i + 1}</span>
                {label}
              </Link>
            </li>
          ))}
        </ol>
      </section>
      <section aria-label={COPY.briefing.sampleLabel}>
        <Eyebrow className="mb-2">{COPY.briefing.sampleLabel}</Eyebrow>
        <div aria-hidden className="pointer-events-none select-none"><BriefCard item={SAMPLE} sample /></div>
      </section>
    </div>
  );
}

function Streaming({ status, sources, count }: { status: string; sources: Set<BriefingSource>; count: number }) {
  return (
    <div className="mb-6">
      <p className="flex items-center gap-2 text-sm text-axiom-zinc-600">
        <span aria-hidden className="size-2 rounded-full bg-foreground motion-safe:animate-[pt-pulse_1.4s_ease-in-out_infinite]" />
        {status || COPY.briefing.reading(count)}
      </p>
      <ul className="mt-3 flex flex-wrap gap-2" aria-label="Sources read">
        {SOURCES.map((s) => (
          <li key={s} className={cn('rounded-full border px-3 py-1 text-xs font-semibold transition-colors duration-200', sources.has(s) ? 'border-foreground bg-foreground text-background' : 'border-border text-axiom-zinc-500')}>
            {COPY.briefing.sourceLabels[s]}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

function BriefingView({ me }: { me: MeResponse }) {
  const query = useBriefing();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const data = query.data;

  const [stream, setStream] = useState<{ state: 'idle' | 'running' | 'failed'; status: string; sources: Set<BriefingSource>; items: BriefingItem[] }>(
    { state: 'idle', status: '', sources: new Set(), items: [] },
  );
  const [announce, setAnnounce] = useState('');
  const started = useRef(false);

  const generate = useCallback(() => {
    setStream({ state: 'running', status: '', sources: new Set(), items: [] });
    streamEvents<BriefingStreamEvent>(BRIEFING_STREAM_PATH, {}, (e) => {
      if (e.type === 'status') setStream((s) => ({ ...s, status: e.text }));
      if (e.type === 'source') setStream((s) => ({ ...s, sources: new Set(Array.from(s.sources).concat(e.source)) }));
      // Cards render as they arrive; never wait for the whole response.
      if (e.type === 'item') setStream((s) => ({ ...s, items: [...s.items, e.item] }));
      if (e.type === 'error') setStream((s) => ({ ...s, state: 'failed' }));
      if (e.type === 'done') {
        // Swap in place: the query cache is the page's source of truth, so scroll position is untouched.
        qc.setQueryData<BriefingResponse>(queryKeys.briefing, (prev) => (prev ? { ...prev, briefing: e.briefing, stale: false, loggedSince: 0 } : prev));
        setStream((s) => ({ ...s, state: 'idle' }));
        setAnnounce(COPY.briefing.ready(e.briefing.items.length)); // once, not per card
      }
    }).catch(() => setStream((s) => ({ ...s, state: 'failed' })));
  }, [qc]);

  // Today's briefing is missing (first open of the day) or stale: write it now.
  useEffect(() => {
    if (!data || started.current || data.clientCount === 0) return;
    if (!data.briefing || data.stale) { started.current = true; generate(); }
  }, [data, generate]);

  const briefing: Briefing | null = data?.briefing ?? null;
  // While the first briefing streams there is nothing stored to show, so show what has arrived.
  const items = briefing ? briefing.items : stream.items;
  const open = items.filter((i) => !i.resolution);
  const attention = items.filter((i) => i.severity === 'attention');
  const look = items.filter((i) => i.severity === 'look');
  const handled = items.length - open.length;

  // ── Focus and keyboard: J/K move, A sends, D dismisses, W toggles why, Enter opens the client.
  const cards = useRef(new Map<string, { el: HTMLElement | null; api: CardApi | null }>());
  const register = useCallback((id: string, el: HTMLElement | null, api: CardApi | null) => {
    if (!el) cards.current.delete(id); else cards.current.set(id, { el, api });
  }, []);
  const [focusId, setFocusId] = useState<string | null>(null);
  const openIds = useMemo(() => open.map((i) => i.id), [open]);

  const focusCard = useCallback((id: string | undefined) => {
    if (!id) return;
    setFocusId(id);
    const el = cards.current.get(id)?.el;
    el?.querySelector<HTMLElement>('h3')?.focus();
    el?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, []);

  // After resolving a card, focus moves to the next open card's headline (§10).
  const onResolved = useCallback((id: string) => {
    const index = openIds.indexOf(id);
    const next = openIds[index + 1] ?? openIds[index - 1];
    requestAnimationFrame(() => focusCard(next));
  }, [focusCard, openIds]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      const key = e.key.toLowerCase();
      const index = focusId ? openIds.indexOf(focusId) : -1;
      if (key === 'j') { e.preventDefault(); focusCard(openIds[Math.min(openIds.length - 1, index + 1)]); }
      else if (key === 'k') { e.preventDefault(); focusCard(openIds[Math.max(0, index - 1)]); }
      else if (focusId && index >= 0) {
        const api = cards.current.get(focusId)?.api;
        if (key === 'a') { e.preventDefault(); api?.send(); }
        else if (key === 'd') { e.preventDefault(); api?.dismiss(); }
        else if (key === 'w') { e.preventDefault(); api?.toggleWhy(); }
        else if (key === 'enter' && target?.tagName === 'H3') { const item = items.find((i) => i.id === focusId); if (item) navigate(timelineHref(item.clientId)); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusCard, focusId, items, navigate, openIds]);

  if (query.isPending) {
    return <div aria-busy="true" className="space-y-3"><SkeletonBlock className="h-9 w-72" /><SkeletonBlock className="h-40 w-full" /><SkeletonBlock className="h-40 w-full" /></div>;
  }
  if (query.isError || !data) {
    return <Notice alert action={<Button variant="secondary" className="h-10 rounded-xl" onClick={() => query.refetch()}>{COPY.briefing.retry}</Button>}>{COPY.briefing.staleFailed}</Notice>;
  }

  const running = stream.state === 'running';
  const summary = briefing?.summary ?? { attention: attention.length, look: look.length, onPlan: 0 };
  const group = (label: string, list: BriefingItem[]) => list.length > 0 && (
    <section aria-label={label} className="mb-8">
      <Eyebrow className="mb-3">{label} · {list.length}</Eyebrow>
      <div className="space-y-3">
        {list.map((item) => (
          <BriefCard key={item.id} item={item} stale={data.stale} focused={focusId === item.id} onFocus={() => setFocusId(item.id)} register={register} onResolved={onResolved} />
        ))}
      </div>
    </section>
  );

  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">{announce}</p>
      <Eyebrow>{dateEyebrow(data.today)}</Eyebrow>
      <h1 className="mt-1 text-[22px] font-bold leading-tight tracking-[-0.02em] md:text-[30px]">{COPY.briefing.greeting(data.trainerFirstName)}</h1>

      {data.clientCount === 0 ? (
        <div className="mt-6"><NewTrainer /></div>
      ) : (
        <>
          {(briefing || stream.items.length > 0) && (
            <>
              <p className="mt-1 text-sm text-axiom-zinc-600 md:text-[15px]">{COPY.briefing.summary(summary.attention, summary.look, summary.onPlan)}</p>
              {items.length > 0 && (
                <div className="mt-4 mb-6 flex items-center gap-3">
                  <div role="progressbar" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={handled} aria-label={COPY.briefing.meter(handled, items.length)} className="h-1.5 flex-1 overflow-hidden rounded-full bg-axiom-zinc-100">
                    <div className="h-full rounded-full bg-foreground transition-[width] duration-300" style={{ width: `${(handled / items.length) * 100}%` }} />
                  </div>
                  <p className="text-xs font-semibold text-axiom-zinc-600 tabular-nums">{COPY.briefing.meter(handled, items.length)}</p>
                </div>
              )}
            </>
          )}

          {data.stale && briefing && (
            <div role="status" className="mb-6 flex flex-wrap items-center gap-3 rounded-xl bg-axiom-warning-soft px-4 py-3 text-sm text-axiom-warning-ink">
              <span aria-hidden className={cn('size-2 shrink-0 rounded-full bg-axiom-warning', running && 'motion-safe:animate-[pt-pulse_1.4s_ease-in-out_infinite]')} />
              <p className="min-w-0 flex-1">
                {COPY.briefing.staleBanner(briefing.generatedAt ? `${shortDate(new Date(briefing.generatedAt))}, ${clockTime(briefing.generatedAt)}` : 'an earlier', data.loggedSince)}{' '}
                {stream.state === 'failed' ? COPY.briefing.staleFailed : COPY.briefing.staleWorking}
              </p>
              {stream.state === 'failed' && <Button variant="secondary" className="h-9 rounded-lg" onClick={generate}>{COPY.briefing.retry}</Button>}
            </div>
          )}

          {running && !briefing && <Streaming status={stream.status} sources={stream.sources} count={data.clientCount} />}
          {stream.state === 'failed' && !briefing && (
            <Notice alert action={<Button variant="secondary" className="h-10 rounded-xl" onClick={generate}>{COPY.briefing.retry}</Button>}>{COPY.briefing.staleFailed}</Notice>
          )}

          {briefing && items.length === 0 && <AllClear data={data} />}
          {group(COPY.briefing.attention, attention)}
          {group(COPY.briefing.look, look)}
          {running && !briefing && <div aria-hidden className="space-y-3"><SkeletonBlock className="h-40 w-full" /><SkeletonBlock className="h-40 w-full" /></div>}

          {briefing && briefing.scheduled.length > 0 && (
            <section className="mb-8">
              <Eyebrow className="mb-3">{COPY.briefing.morningQuestions}</Eyebrow>
              <ul className="divide-y divide-border rounded-2xl border border-border">
                {briefing.scheduled.map((q) => (
                  <li key={q.id} className="px-4 py-3">
                    <p className="text-xs text-axiom-zinc-500">{q.text}</p>
                    <p className="text-sm">{q.answer}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {briefing && items.length > 0 && briefing.onPlanClients.length > 0 && (
            <details className="rounded-2xl border border-border">
              <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-4 text-[13px] font-semibold">
                <span aria-hidden className="size-2 rounded-full bg-axiom-success" />
                {COPY.briefing.allClearGroup(briefing.onPlanClients.length)}
              </summary>
              <ul className="flex flex-wrap gap-2 border-t border-border p-4">
                {briefing.onPlanClients.map((c) => (
                  <li key={c.id}>
                    <Link href={timelineHref(c.id)} className="flex items-center gap-2 rounded-full border border-border py-1 pl-1 pr-3 text-[13px] hover:bg-axiom-zinc-50">
                      <Avatar initials={c.initials} size={28} />{c.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {open.length > 0 && <p className="mt-6 hidden text-xs text-axiom-zinc-500 md:block">{COPY.briefing.keyboardHint}</p>}
        </>
      )}
    </>
  );
}

export default function BriefingPage() {
  return <Gate>{(me) => <Shell me={me} active="briefing" title={COPY.nav.briefing} width="narrow"><BriefingView me={me} /></Shell>}</Gate>;
}

