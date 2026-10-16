// Answering a check-in from the portal. Same question rendering as the
// signed-in CheckInAnswerPage, plus voice answers for the text questions:
// the recording is transcribed into the box for the client to read and edit —
// it is never sent on its own.

import { useState } from 'react';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import { COPY, type CheckInQuestion } from '@axiom/personal-training-core';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { errorMessage } from '../api';
import { Card, EmptyState, InlineError, LoadFailed, PortalButton, SkeletonBlock } from '../components';
import { formatDay } from '../helpers';
import { useCheckIn, usePortalNav, useSubmitCheckIn } from '../hooks';
import { canRecordAudio } from '../media';
import { appendSpoken, MicButton } from '../MicButton';

function Scale({ question, value, onChange }: { question: CheckInQuestion; value: number | undefined; onChange: (v: number) => void }) {
  return (
    <div role="radiogroup" aria-labelledby={`q-${question.id}`}>
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} out of 5`} onClick={() => onChange(n)}
            className={cn(
              'h-11 flex-1 rounded-xl border text-sm font-semibold tabular-nums transition-colors duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15',
              value === n ? 'border-[var(--portal-accent)] bg-[var(--portal-accent)] text-[var(--portal-on-accent)]' : 'border-border hover:bg-axiom-zinc-50',
            )}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs text-axiom-zinc-500"><span>{COPY.checkInForm.scaleLow}</span><span>{COPY.checkInForm.scaleHigh}</span></div>
    </div>
  );
}

function VoiceTextAnswer({ question, value, onChange }: { question: CheckInQuestion; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <Textarea
        id={`a-${question.id}`} rows={4} maxLength={1000} value={value} onChange={(e) => onChange(e.target.value)}
        className="rounded-xl text-base md:text-sm" placeholder={canRecordAudio() ? 'Type, or tap Speak and talk' : undefined}
      />
      <MicButton label={`Record your answer to: ${question.text}`} onTranscript={(t) => onChange(appendSpoken(value, t))} />
    </div>
  );
}

export function CheckInScreen({ id }: { id: string }) {
  const { go } = usePortalNav();
  const request = useCheckIn(id);
  const submit = useSubmitCheckIn(id);
  const [answers, setAnswers] = useState<Record<string, string | number>>({});
  const set = (key: string, value: string | number) => setAnswers((a) => ({ ...a, [key]: value }));

  const back = (
    <PortalButton variant="ghost" className="-ml-3 mb-2" onClick={() => go({ tab: 'home' })}>
      <ArrowLeft /> Home
    </PortalButton>
  );

  if (request.isPending) {
    return <div>{back}<div aria-busy="true" aria-label="Loading check-in" className="space-y-3"><SkeletonBlock className="h-7 w-56" /><SkeletonBlock className="h-24 w-full rounded-2xl" /><SkeletonBlock className="h-24 w-full rounded-2xl" /></div></div>;
  }
  if (request.isError) {
    return (
      <div>{back}
        {(request.error as { status?: number }).status === 404
          ? <EmptyState title={COPY.checkInForm.notFound}>It may have been replaced by a newer one.</EmptyState>
          : <LoadFailed onRetry={() => request.refetch()} />}
      </div>
    );
  }
  if (submit.isSuccess) {
    return (
      <Card className="py-10 text-center">
        <CheckCircle2 aria-hidden className="mx-auto mb-3 size-10 text-axiom-success" />
        <h1 className="text-[19px] font-semibold tracking-[-0.01em]">{COPY.checkInForm.done}</h1>
        <p className="mt-1 text-sm text-axiom-zinc-600">{request.data.trainerName} will read it and get back to you.</p>
        <PortalButton className="mt-6 w-full" onClick={() => go({ tab: 'home' })}>Back to home</PortalButton>
      </Card>
    );
  }
  if (request.data.status !== 'due') {
    return (
      <div>{back}
        <EmptyState title={request.data.status === 'submitted' ? COPY.checkInForm.already : 'This check-in has closed.'}>
          {request.data.status === 'missed' ? 'It is past its window. Your trainer will send the next one.' : 'Thanks for checking in.'}
        </EmptyState>
      </div>
    );
  }

  const questions = request.data.questions;
  const complete = questions.every((q) => q.type === 'text' || (answers[q.id] !== undefined && answers[q.id] !== ''));
  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!complete || submit.isPending) return;
    const payload: Record<string, string | number> = {};
    for (const q of questions) {
      const v = answers[q.id];
      payload[q.id] = q.type === 'text' ? String(v ?? '') : Number(v);
    }
    submit.mutate(payload);
  };

  return (
    <div>
      {back}
      <form onSubmit={onSubmit} noValidate>
        <h1 className="text-[22px] font-bold leading-tight tracking-[-0.02em]">{COPY.checkInForm.title(request.data.trainerName)}</h1>
        <p className="mt-1 text-sm text-axiom-zinc-600">Sent {formatDay(request.data.dueAt)} · {questions.length} {questions.length === 1 ? 'question' : 'questions'}</p>
        <div className="mt-5 space-y-4">
          {questions.map((q) => (
            <Card key={q.id} as="div">
              <label id={`q-${q.id}`} htmlFor={q.type === 'scale' ? undefined : `a-${q.id}`} className="mb-3 block text-[15px] font-semibold">{q.text}</label>
              {q.type === 'scale' && <Scale question={q} value={answers[q.id] as number | undefined} onChange={(v) => set(q.id, v)} />}
              {q.type === 'number' && (
                <Input id={`a-${q.id}`} type="number" inputMode="decimal" value={answers[q.id] ?? ''} onChange={(e) => set(q.id, e.target.value)} className="h-11 rounded-xl text-base tabular-nums md:text-sm" />
              )}
              {q.type === 'text' && <VoiceTextAnswer question={q} value={(answers[q.id] as string) ?? ''} onChange={(v) => set(q.id, v)} />}
            </Card>
          ))}
        </div>
        {submit.isError && <div className="mt-4"><InlineError>{errorMessage(submit.error)}</InlineError></div>}
        <PortalButton type="submit" className="mt-5 w-full" disabled={!complete || submit.isPending}>
          {submit.isPending ? 'Sending…' : COPY.checkInForm.submit}
        </PortalButton>
        {!complete && <p className="mt-2 text-center text-xs text-axiom-zinc-500">Answer the scale and number questions to send.</p>}
      </form>
    </div>
  );
}
