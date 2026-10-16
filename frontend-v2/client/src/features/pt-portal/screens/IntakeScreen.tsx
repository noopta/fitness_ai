// The conversational intake: the trainer's questions one at a time, answered
// by typing or speaking. Each answer goes to the server, which files it and
// asks a follow-up or the next question — that takes a few seconds.

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, MessageSquareText, Send } from 'lucide-react';
import type { IntakeState } from '@axiom/personal-training-core';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { errorMessage } from '../api';
import { Card, EmptyState, InlineError, LoadFailed, PortalButton, ProgressBar, SkeletonBlock } from '../components';
import { useAnswerIntake, useIntake, usePortalNav, useStartIntake } from '../hooks';
import { appendSpoken, MicButton } from '../MicButton';

const MAX = 2000;

function Typing({ name }: { name: string }) {
  return (
    <div className="flex items-start">
      <div role="status" className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-axiom-zinc-100 px-4 py-3">
        <span className="sr-only">{name} is reading your answer…</span>
        {[0, 1, 2].map((i) => (
          <span key={i} aria-hidden className="size-1.5 rounded-full bg-axiom-zinc-500 motion-safe:animate-[pt-pulse_1.2s_ease-in-out_infinite]" style={{ animationDelay: `${i * 0.2}s` }} />
        ))}
      </div>
    </div>
  );
}

function Transcript({ intake, trainerName, pendingText }: { intake: IntakeState; trainerName: string; pendingText: string | null }) {
  const endRef = useRef<HTMLDivElement>(null);
  const n = intake.transcript.length + (pendingText ? 1 : 0);
  useEffect(() => { try { endRef.current?.scrollIntoView?.({ block: 'end' }); } catch { /* not everywhere */ } }, [n]);
  return (
    <div role="log" aria-label={`Conversation with ${trainerName}`} className="space-y-2">
      {intake.transcript.map((t, i) => (
        <div key={`${t.at}-${i}`} className={cn('flex flex-col', t.role === 'client' ? 'items-end' : 'items-start')}>
          {t.role === 'trainer' && t.probe && <span className="mb-0.5 px-1 text-[11px] font-semibold text-axiom-zinc-500">follow-up</span>}
          <p
            className={cn(
              'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[15px] leading-snug',
              t.role === 'client' ? 'rounded-br-md bg-[var(--portal-accent)] text-[var(--portal-on-accent)]' : 'rounded-bl-md bg-axiom-zinc-100',
              t.role === 'trainer' && t.probe && 'border border-dashed border-axiom-zinc-300',
            )}
          >
            <span className="sr-only">{t.role === 'client' ? 'You: ' : `${trainerName}${t.probe ? ', follow-up' : ''}: `}</span>
            {t.text}
          </p>
        </div>
      ))}
      {pendingText && (
        <>
          <div className="flex flex-col items-end">
            <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-[var(--portal-accent)] px-3.5 py-2 text-[15px] leading-snug text-[var(--portal-on-accent)] opacity-70">
              <span className="sr-only">You: </span>{pendingText}
            </p>
          </div>
          <Typing name={trainerName.split(/\s+/)[0] || trainerName} />
        </>
      )}
      <div ref={endRef} />
    </div>
  );
}

export function IntakeScreen({ trainerName }: { trainerName: string }) {
  const { go } = usePortalNav();
  const q = useIntake();
  const start = useStartIntake();
  const answer = useAnswerIntake();
  const [text, setText] = useState('');
  const first = trainerName.split(/\s+/)[0] || trainerName;

  const back = <PortalButton variant="ghost" className="-ml-3 mb-2" onClick={() => go({ tab: 'home' })}><ArrowLeft /> Home</PortalButton>;

  if (q.isPending) {
    return <div>{back}<div aria-busy="true" aria-label="Loading" className="space-y-3"><SkeletonBlock className="h-7 w-56" /><SkeletonBlock className="h-14 w-3/4 rounded-2xl" /><SkeletonBlock className="ml-auto h-14 w-1/2 rounded-2xl" /></div></div>;
  }
  if (q.isError) return <div>{back}<LoadFailed onRetry={() => q.refetch()} /></div>;
  const intake = q.data.intake;

  const header = (
    <div className="mb-4">
      <h1 className="text-[22px] font-bold leading-tight tracking-[-0.02em]">Tell {first} about you</h1>
      {intake.status !== 'not_started' && (
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-xs text-axiom-zinc-600"><span>{intake.status === 'complete' ? 'Complete' : 'Getting to know you'}</span><span className="tabular-nums">{intake.completeness}%</span></div>
          <ProgressBar value={intake.completeness} label="Intake completeness" />
        </div>
      )}
    </div>
  );

  if (intake.status === 'not_started') {
    return (
      <div>
        {back}
        {header}
        <Card className="py-8 text-center">
          <span aria-hidden className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-axiom-zinc-100 text-axiom-zinc-600"><MessageSquareText className="size-5" /></span>
          <p className="text-[15px] font-semibold">A few questions before you start</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-axiom-zinc-600">
            Your goals, your schedule, any injuries, what you have to train with. It takes about five minutes, and you can type or just talk.
            {' '}{first} reads every answer.
          </p>
          {start.isError && <div className="mt-4 text-left"><InlineError>{errorMessage(start.error)}</InlineError></div>}
          <PortalButton className="mt-5 w-full" onClick={() => start.mutate()} disabled={start.isPending}>{start.isPending ? 'Starting…' : 'Start'}</PortalButton>
        </Card>
      </div>
    );
  }

  if (intake.status === 'complete') {
    return (
      <div>
        {back}
        {header}
        <Card className="py-8 text-center">
          <CheckCircle2 aria-hidden className="mx-auto mb-3 size-10 text-axiom-success" />
          <p className="text-[17px] font-semibold">Thanks, that's everything.</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-axiom-zinc-600">{first} has your answers and will use them to shape your training.</p>
          <PortalButton className="mt-5 w-full" onClick={() => go({ tab: 'home' })}>Back to home</PortalButton>
        </Card>
        {intake.fields.some((f) => f.answer) && (
          <section aria-labelledby="intake-answers" className="mt-4">
            <h2 id="intake-answers" className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-axiom-zinc-500">What you told {first}</h2>
            <Card as="div" className="p-0">
              <dl className="divide-y divide-border">
                {intake.fields.filter((f) => f.answer).map((f) => (
                  <div key={f.key} className="px-4 py-3"><dt className="text-xs text-axiom-zinc-500">{f.label}</dt><dd className="mt-0.5 whitespace-pre-wrap text-sm">{f.answer}</dd></div>
                ))}
              </dl>
            </Card>
          </section>
        )}
      </div>
    );
  }

  const pendingText = answer.isPending ? (answer.variables ?? null) : null;
  const trimmed = text.trim();
  const send = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!trimmed || trimmed.length > MAX || answer.isPending) return;
    answer.mutate(trimmed, { onError: () => setText((t) => t || trimmed) });
    setText('');
  };

  return (
    <div className="flex flex-col">
      {back}
      {header}
      <div className="min-h-[30vh] pb-4">
        {intake.transcript.length === 0 && !pendingText
          ? <EmptyState title={`${first} will ask the first question here.`} />
          : <Transcript intake={intake} trainerName={trainerName} pendingText={pendingText} />}
      </div>
      {answer.isError && <div className="mb-2"><InlineError>{errorMessage(answer.error, "That answer didn't go through. Try again.")}</InlineError></div>}
      <form onSubmit={send} className="sticky bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] -mx-4 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
        <label htmlFor="intake-composer" className="sr-only">Your answer</label>
        <div className="flex flex-wrap items-end gap-2">
          <Textarea
            id="intake-composer" rows={2} maxLength={MAX} value={text} placeholder="Type your answer, or tap the mic"
            onChange={(e) => setText(e.target.value)} disabled={answer.isPending}
            className="max-h-40 min-h-11 min-w-0 flex-1 resize-none rounded-xl text-base md:text-sm"
          />
          <MicButton compact label="Speak your answer" disabled={answer.isPending} onTranscript={(t) => setText((cur) => appendSpoken(cur, t))} />
          <PortalButton type="submit" aria-label="Send answer" disabled={!trimmed || trimmed.length > MAX || answer.isPending} className="size-11 shrink-0 px-0">
            <Send />
          </PortalButton>
        </div>
      </form>
    </div>
  );
}
