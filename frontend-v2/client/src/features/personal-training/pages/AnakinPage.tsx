// Ask Anakin (design handoff §6.6): a dedicated conversational page. A 260px
// sidebar (new question, questions that run every morning, recent threads),
// the conversation, and a sticky composer with a scope picker.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useRoute } from 'wouter';
import { Plus, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  COPY, anakinMessagePath, queryKeys, seriesDomain,
  type AnakinEvent, type AnakinScope, type MeResponse,
} from '@axiom/personal-training-core';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { ptApi, streamEvents } from '../api';
import { DraftReply } from '../components/DraftReply';
import { Gate } from '../components/Gate';
import { Avatar, Eyebrow, Sparkline } from '../components/primitives';
import { Shell } from '../components/Shell';
import { useAnakinThreads, useScheduledActions } from '../hooks';

type AnswerEvent = Extract<AnakinEvent, { type: 'answer' }>;

interface Turn {
  key: string;
  role: 'user' | 'assistant';
  text: string;
  event?: AnakinEvent;
  status?: string;
  pending?: boolean;
  /** The question this assistant turn answers — what "Run every morning" schedules. */
  question?: string;
  /** For a clarify turn: the option the trainer chose. */
  chosen?: string;
}

const BASE = '/personal-training/anakin';
const selectClass = 'h-9 rounded-xl border border-border bg-background px-2.5 text-[13px] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15';

function AnswerView({ event, question, threadId, scope, onAsk }: { event: AnswerEvent; question: string; threadId: string | null; scope: AnakinScope; onAsk: (text: string) => void }) {
  const { add } = useScheduledActions();
  return (
    <div>
      <p className="text-[15px] leading-relaxed">{event.text}</p>
      {event.rows.length > 0 && (
        <ul className="mt-3 divide-y divide-border rounded-2xl border border-border">
          {event.rows.map((r) => (
            <li key={r.clientId}>
              <Link href={`/personal-training/clients/${r.clientId}/timeline`} className="flex min-h-14 items-center gap-3 px-3 py-2.5 transition-colors duration-200 hover:bg-axiom-zinc-50">
                <Avatar initials={r.client.initials} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold">{r.client.name}</span>
                  <span className="block text-xs text-axiom-zinc-600">{r.evidence}</span>
                </span>
                {r.series && r.series.length > 1 && <Sparkline series={r.series} domain={seriesDomain(r.series)} label={`${r.client.name}: ${r.evidence}`} />}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {event.note && <p className="mt-3 rounded-xl bg-axiom-zinc-50 px-3 py-2 text-xs leading-relaxed text-axiom-zinc-600">{event.note}</p>}
      {event.actionable && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {event.rows.length > 0 && threadId && (
            <Button asChild variant="secondary" className="h-9 rounded-xl text-[13px]">
              <Link href={`/personal-training/clients?anakin=${threadId}:${event.messageId}`}>{COPY.anakin.applyFilter}</Link>
            </Button>
          )}
          <Button variant="secondary" className="h-9 rounded-xl text-[13px]" disabled={add.isPending || add.isSuccess} onClick={() => add.mutate({ text: question, scope })}>
            {add.isSuccess ? COPY.anakin.scheduledDone : COPY.anakin.runEveryMorning}
          </Button>
          {event.sources && <span className="text-xs text-axiom-zinc-500">{COPY.anakin.basedOn(event.sources)}</span>}
        </div>
      )}
      {add.isError && <p role="alert" className="mt-1 text-xs text-axiom-destructive-ink">{(add.error as Error).message}</p>}
      {event.followUps.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {event.followUps.map((f) => (
            <button key={f} type="button" onClick={() => onAsk(f)} className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-axiom-zinc-600 transition-colors duration-200 hover:bg-axiom-zinc-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15">
              {f}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AssistantTurn({ turn, threadId, scope, onAsk, onClarify }: { turn: Turn; threadId: string | null; scope: AnakinScope; onAsk: (text: string) => void; onClarify: (turn: Turn, choice: string) => void }) {
  const e = turn.event;
  return (
    <div className="flex gap-3">
      <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-foreground text-xs font-bold text-background">A</span>
      <div className="min-w-0 flex-1 pt-1">
        {turn.pending && !e && (
          <p className="flex items-center gap-2 text-sm text-axiom-zinc-600">
            <span aria-hidden className="size-2 rounded-full bg-foreground motion-safe:animate-[pt-pulse_1.4s_ease-in-out_infinite]" />
            {turn.status || 'Thinking'}
          </p>
        )}
        {e?.type === 'answer' && <AnswerView event={e} question={turn.question ?? ''} threadId={threadId} scope={scope} onAsk={onAsk} />}
        {e?.type === 'clarify' && (
          <div>
            <p className="text-[15px] leading-relaxed">{e.text}</p>
            <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={e.text}>
              {e.options.map((o) => (
                <button
                  key={o} type="button" disabled={!!turn.chosen} aria-pressed={turn.chosen === o} onClick={() => onClarify(turn, o)}
                  className={cn(
                    'h-9 rounded-full border px-3.5 text-[13px] font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15',
                    turn.chosen === o ? 'border-foreground bg-foreground text-background' : 'border-border hover:bg-axiom-zinc-50',
                    turn.chosen && turn.chosen !== o && 'opacity-40',
                  )}
                >
                  {o}
                </button>
              ))}
            </div>
          </div>
        )}
        {e?.type === 'drafts' && (
          <div>
            <p className="text-[15px] leading-relaxed">{e.text}</p>
            <ul className="mt-3 space-y-4">
              {e.drafts.map((d) => (
                <li key={d.id} className="rounded-2xl border border-border p-4">
                  <p className="mb-2 flex items-center gap-2 text-[13px] font-semibold"><Avatar initials={d.client.initials} size={28} />{d.client.name}</p>
                  <DraftReply draft={d} label={`Draft message to ${d.client.name}`} />
                </li>
              ))}
            </ul>
          </div>
        )}
        {e?.type === 'error' && <p role="alert" className="text-sm text-axiom-destructive-ink">{e.message}</p>}
      </div>
    </div>
  );
}

function Anakin({ me }: { me: MeResponse }) {
  const [, params] = useRoute(`${BASE}/:threadId`);
  const routeThread = params?.threadId ?? null;
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const sidebar = useAnakinThreads();
  const { toggle, remove } = useScheduledActions();

  const [threadId, setThreadId] = useState<string | null>(routeThread);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [scope, setScope] = useState<AnakinScope>('all');
  const [busy, setBusy] = useState(false);
  const [showThreads, setShowThreads] = useState(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  // Set while this page created the thread itself, so the route change does not reload over live turns.
  const ownThread = useRef<string | null>(null);

  // Load a thread opened from the sidebar or a link.
  useEffect(() => {
    if (routeThread === ownThread.current) return;
    setThreadId(routeThread);
    if (!routeThread) { setTurns([]); return; }
    let cancelled = false;
    ptApi.anakinThread(routeThread).then((t) => {
      if (cancelled) return;
      let lastQuestion = '';
      setTurns(t.messages.map((m) => {
        if (m.role === 'user') lastQuestion = m.text;
        return { key: m.id, role: m.role, text: m.text, event: m.events[0], question: lastQuestion };
      }));
    }).catch(() => { if (!cancelled) setTurns([{ key: 'err', role: 'assistant', text: '', event: { type: 'error', message: COPY.anakin.failed } }]); });
    return () => { cancelled = true; };
  }, [routeThread]);

  // ⌘K lands here and focuses the composer.
  useEffect(() => { composer.current?.focus(); }, [routeThread]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [turns]);

  const ask = useCallback((question: string, clarifyChoice?: string) => {
    const q = question.trim();
    if (!q || busy) return;
    const key = `a-${Date.now()}`;
    setBusy(true);
    setText('');
    setTurns((prev) => [
      ...prev,
      ...(clarifyChoice ? [] : [{ key: `u-${Date.now()}`, role: 'user' as const, text: q }]),
      { key, role: 'assistant', text: '', pending: true, question: q },
    ]);
    const patch = (p: Partial<Turn>) => setTurns((prev) => prev.map((t) => (t.key === key ? { ...t, ...p } : t)));
    let current = threadId;

    streamEvents<AnakinEvent>(
      anakinMessagePath(threadId),
      { method: 'POST', body: JSON.stringify({ text: q, scope, ...(clarifyChoice ? { clarifyChoice } : {}) }) },
      (e) => {
        if (e.type === 'thread' && !current) { current = e.threadId; ownThread.current = e.threadId; setThreadId(e.threadId); navigate(`${BASE}/${e.threadId}`, { replace: true }); }
        else if (e.type === 'status') patch({ status: e.text });
        else if (e.type === 'answer' || e.type === 'clarify' || e.type === 'drafts' || e.type === 'error') patch({ event: e, pending: false });
      },
    )
      .catch(() => patch({ event: { type: 'error', message: COPY.anakin.failed }, pending: false }))
      .finally(() => { setBusy(false); void qc.invalidateQueries({ queryKey: queryKeys.anakinThreads }); composer.current?.focus(); });
  }, [busy, navigate, qc, scope, threadId]);

  const onClarify = (turn: Turn, choice: string) => {
    setTurns((prev) => prev.map((t) => (t.key === turn.key ? { ...t, chosen: choice } : t)));
    ask(turn.question ?? '', choice);
  };

  const newQuestion = () => { ownThread.current = null; setThreadId(null); setTurns([]); setShowThreads(false); navigate(BASE); composer.current?.focus(); };

  const side = (
    <div className="space-y-6">
      <Button variant="secondary" className="h-10 w-full justify-start rounded-xl" onClick={newQuestion}><Plus aria-hidden />{COPY.anakin.newQuestion}</Button>
      <section>
        <Eyebrow className="mb-2">{COPY.anakin.runsEveryMorning}</Eyebrow>
        {(sidebar.data?.scheduled ?? []).length === 0 ? <p className="text-xs text-axiom-zinc-500">{COPY.anakin.noScheduled}</p> : (
          <ul className="space-y-2">
            {sidebar.data!.scheduled.map((q) => (
              <li key={q.id} className="rounded-xl border border-border bg-background p-2.5">
                <p className="text-[13px] leading-snug">{q.text}</p>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-axiom-zinc-500 tabular-nums">{q.lastCount === undefined ? '' : `${q.lastCount} this morning`}</span>
                  <span className="flex items-center gap-1">
                    <Switch aria-label={`Run every morning: ${q.text}`} checked={q.active} onCheckedChange={(active) => toggle.mutate({ id: q.id, active })} />
                    <Button variant="ghost" className="size-8 rounded-lg p-0 text-axiom-zinc-500" aria-label={`${COPY.anakin.remove}: ${q.text}`} onClick={() => remove.mutate(q.id)}><Trash2 aria-hidden /></Button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <Eyebrow className="mb-2">{COPY.anakin.recent}</Eyebrow>
        <ul className="space-y-0.5">
          {(sidebar.data?.threads ?? []).map((t) => (
            <li key={t.id}>
              <Link
                href={`${BASE}/${t.id}`} onClick={() => { ownThread.current = null; setShowThreads(false); }}
                aria-current={t.id === threadId ? 'page' : undefined}
                className={cn('block truncate rounded-lg px-2 py-1.5 text-[13px] text-axiom-zinc-600 hover:bg-axiom-zinc-100', t.id === threadId && 'bg-axiom-zinc-100 font-semibold text-foreground')}
              >
                {t.title}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );

  return (
    <Shell me={me} active="anakin" title={COPY.anakin.title} width="full">
      <div className="mx-auto flex max-w-[1120px] gap-8">
        <aside className="hidden w-[260px] shrink-0 md:block">{side}</aside>
        <div className="mx-auto flex min-h-[calc(100vh-11rem)] w-full min-w-0 max-w-[820px] flex-col md:min-h-[calc(100vh-6rem)]">
          <div className="mb-3 md:hidden">
            <Button variant="secondary" className="h-10 rounded-xl" aria-expanded={showThreads} onClick={() => setShowThreads((v) => !v)}>{COPY.anakin.recent}</Button>
            {showThreads && <div className="mt-3 rounded-2xl border border-border bg-axiom-zinc-50 p-3">{side}</div>}
          </div>

          <div className="flex-1">
            {turns.length === 0 ? (
              <div className="pt-4 md:pt-10">
                <h1 className="text-[22px] font-bold leading-tight tracking-[-0.02em] md:text-[30px]">{COPY.anakin.heading}</h1>
                <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                  {COPY.anakin.starters.map((s) => (
                    <li key={s.text}>
                      <button type="button" onClick={() => ask(s.text)} className="w-full rounded-2xl border border-border p-4 text-left transition-shadow duration-200 hover:shadow-sm focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15 motion-safe:hover:-translate-y-0.5 motion-safe:transition-transform">
                        <Eyebrow>{s.category}</Eyebrow>
                        <p className="mt-1.5 text-sm font-semibold">{s.text}</p>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <ol className="space-y-6" aria-live="polite">
                {turns.map((t) => (
                  <li key={t.key}>
                    {t.role === 'user'
                      ? <p className="ml-auto w-fit max-w-[85%] rounded-2xl bg-axiom-zinc-100 px-4 py-2.5 text-[15px] leading-relaxed">{t.text}</p>
                      : <AssistantTurn turn={t} threadId={threadId} scope={scope} onAsk={ask} onClarify={onClarify} />}
                  </li>
                ))}
              </ol>
            )}
            <div ref={bottom} />
          </div>

          <form
            className="sticky bottom-16 mt-6 rounded-2xl border border-border bg-background p-2 shadow-sm md:bottom-4"
            onSubmit={(e) => { e.preventDefault(); ask(text); }}
          >
            <Textarea
              ref={composer} value={text} rows={1} placeholder={COPY.anakin.placeholder} aria-label={COPY.anakin.placeholder}
              onChange={(e) => setText(e.target.value)}
              // Enter sends, Shift+Enter is a newline.
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(text); } }}
              className="max-h-40 min-h-10 resize-none border-0 text-[15px] shadow-none focus-visible:ring-0"
            />
            <div className="flex items-center justify-between gap-2 px-1 pb-1">
              <select aria-label={COPY.anakin.scope} className={selectClass} value={scope} onChange={(e) => setScope(e.target.value as AnakinScope)}>
                {(['all', 'new', 'support'] as AnakinScope[]).map((s) => <option key={s} value={s}>{COPY.anakin.scopes[s]}</option>)}
              </select>
              <Button type="submit" className="h-10 rounded-xl" disabled={busy || !text.trim()}>{COPY.anakin.send}</Button>
            </div>
          </form>
        </div>
      </div>
    </Shell>
  );
}

export default function AnakinPage() {
  return <Gate>{(me) => <Anakin me={me} />}</Gate>;
}
