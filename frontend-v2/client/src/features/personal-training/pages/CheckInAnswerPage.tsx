// Where a client answers a check-in, from the link in their trainer's
// message. Signed in as themselves; the server only serves a check-in to the
// client it was sent to.

import { useState } from 'react';
import { Link, useRoute } from 'wouter';
import { COPY, type CheckInQuestion } from '@axiom/personal-training-core';
import { BrandLogo } from '@/components/BrandLogo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { SkeletonBlock } from '../components/primitives';
import { useCheckInRequest, useSubmitCheckIn } from '../hooks';

function Scale({ question, value, onChange }: { question: CheckInQuestion; value: number | undefined; onChange: (v: number) => void }) {
  return (
    <div role="radiogroup" aria-labelledby={`q-${question.id}`}>
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} out of 5`} onClick={() => onChange(n)}
            className={cn(
              'h-11 flex-1 rounded-xl border text-sm font-semibold tabular-nums transition-colors duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15',
              value === n ? 'border-foreground bg-foreground text-background' : 'border-border hover:bg-axiom-zinc-50',
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

export default function CheckInAnswerPage() {
  const [, params] = useRoute('/personal-training/check-in/:id');
  const id = params?.id ?? '';
  const request = useCheckInRequest(id);
  const submit = useSubmitCheckIn(id);
  const [answers, setAnswers] = useState<Record<string, string | number>>({});
  const set = (key: string, value: string | number) => setAnswers((a) => ({ ...a, [key]: value }));

  const questions = request.data?.questions ?? [];
  const complete = questions.every((q) => q.type === 'text' || (answers[q.id] !== undefined && answers[q.id] !== ''));
  const done = submit.isSuccess || request.data?.status === 'submitted';

  return (
    <div className="flex min-h-screen flex-col items-center bg-axiom-zinc-50 p-4 py-10">
      <BrandLogo height={28} className="mb-8" />
      <div className="w-full max-w-md rounded-2xl border border-border bg-background p-6 shadow-xs">
        {request.isPending ? (
          <div aria-busy="true"><SkeletonBlock className="mb-3 h-6 w-48" /><SkeletonBlock className="h-40 w-full" /></div>
        ) : request.isError ? (
          <>
            <h1 className="text-[17px] font-semibold tracking-[-0.01em]">{COPY.checkInForm.notFound}</h1>
            <Button asChild variant="secondary" className="mt-4 h-11 rounded-xl"><Link href="/coach">Back to Axiom</Link></Button>
          </>
        ) : done ? (
          <>
            <h1 className="text-[17px] font-semibold tracking-[-0.01em]">{submit.isSuccess ? COPY.checkInForm.done : COPY.checkInForm.already}</h1>
            <Button asChild variant="secondary" className="mt-4 h-11 rounded-xl"><Link href="/coach">Back to Axiom</Link></Button>
          </>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); if (complete) submit.mutate(answers); }}>
            <h1 className="text-[17px] font-semibold tracking-[-0.01em]">{COPY.checkInForm.title(request.data.trainerName)}</h1>
            <p className="mt-1 text-xs text-axiom-zinc-500">{request.data.practiceName}</p>
            <div className="mt-6 space-y-6">
              {questions.map((q) => (
                <div key={q.id}>
                  <label id={`q-${q.id}`} htmlFor={`a-${q.id}`} className="mb-2 block text-sm font-semibold">{q.text}</label>
                  {q.type === 'scale' && <Scale question={q} value={answers[q.id] as number | undefined} onChange={(v) => set(q.id, v)} />}
                  {q.type === 'number' && <Input id={`a-${q.id}`} type="number" inputMode="decimal" value={answers[q.id] ?? ''} onChange={(e) => set(q.id, e.target.value)} className="h-11 rounded-xl tabular-nums" />}
                  {q.type === 'text' && <Textarea id={`a-${q.id}`} rows={3} maxLength={1000} value={(answers[q.id] as string) ?? ''} onChange={(e) => set(q.id, e.target.value)} className="rounded-xl text-sm" />}
                </div>
              ))}
            </div>
            {submit.isError && <p role="alert" className="mt-4 text-sm text-axiom-destructive-ink">{(submit.error as Error).message}</p>}
            <Button type="submit" className="mt-6 h-11 w-full rounded-xl" disabled={!complete || submit.isPending}>{COPY.checkInForm.submit}</Button>
          </form>
        )}
      </div>
    </div>
  );
}
