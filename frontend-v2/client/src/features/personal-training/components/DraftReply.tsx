// The editable AI draft (design handoff §5). Nothing here sends on its own:
// the trainer presses Send, the server opens a short undo window, and only
// when that closes is the message delivered.

import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { COPY, type Draft } from '@axiom/personal-training-core';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useCanUndo, useRedraft, useSendDraft, useUndoDraft } from '../hooks';

export function SentRow({ summary, canUndo, onUndo, busy }: { summary: string; canUndo: boolean; onUndo: () => void; busy?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-axiom-success-soft px-3 py-2.5">
      <p className="flex min-w-0 items-center gap-2 text-[13px] font-semibold text-axiom-success-ink" aria-live="polite">
        <Check className="size-4 shrink-0" aria-hidden />
        <span className="truncate">{summary}</span>
      </p>
      {canUndo && (
        <Button type="button" variant="ghost" className="h-8 shrink-0 rounded-lg px-2.5 text-[13px] text-axiom-success-ink hover:bg-background/60" disabled={busy} onClick={onUndo}>
          {COPY.draft.undo}
        </Button>
      )}
    </div>
  );
}

export function DraftReply({
  draft: initial, label, children, onChange,
}: {
  draft: Draft;
  label?: string;
  /** Extra actions beside Send and Shorter, e.g. "Mark read, no reply". */
  children?: React.ReactNode;
  onChange?: (draft: Draft) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [text, setText] = useState(initial.text);
  const send = useSendDraft();
  const undo = useUndoDraft();
  const shorter = useRedraft();
  const canUndo = useCanUndo(draft.undoUntil);

  // A refetch may bring a newer server state for the same draft (sent elsewhere, undone).
  useEffect(() => {
    setDraft(initial);
    if (initial.status === 'pending') setText(initial.text);
  }, [initial.id, initial.status, initial.undoUntil]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (next: Draft) => { setDraft(next); onChange?.(next); };

  if (draft.status === 'discarded') return <p className="text-xs text-axiom-zinc-500">{COPY.draft.discarded}</p>;

  if (draft.status !== 'pending') {
    return (
      <div className="space-y-2">
        <p className="whitespace-pre-line rounded-xl border border-border p-3 text-sm leading-relaxed text-axiom-zinc-600">{draft.text}</p>
        <SentRow
          summary={COPY.draft.sent}
          canUndo={draft.status === 'sending' && canUndo}
          busy={undo.isPending}
          onUndo={() => undo.mutate(draft.id, { onSuccess: ({ draft: d }) => update(d) })}
        />
        {undo.isError && <p role="alert" className="text-xs text-axiom-destructive-ink">{(undo.error as Error).message}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Textarea
        aria-label={label ?? COPY.draft.label}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        className="min-h-24 rounded-xl text-sm leading-relaxed"
      />
      <p className="text-xs text-axiom-zinc-500">{COPY.briefing.nothingSends}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          className="h-11 rounded-xl md:h-10"
          disabled={!text.trim() || send.isPending}
          onClick={() => send.mutate({ id: draft.id, text }, { onSuccess: ({ draft: d }) => update(d) })}
        >
          {COPY.draft.send}
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="h-11 rounded-xl md:h-10"
          disabled={shorter.isPending || text.trim().length < 80}
          onClick={() => shorter.mutate({ id: draft.id, text }, { onSuccess: ({ draft: d }) => setText(d.text) })}
        >
          {COPY.draft.shorter}
        </Button>
        {children}
      </div>
      {send.isError && <p role="alert" className="text-xs text-axiom-destructive-ink">{(send.error as Error).message || COPY.briefing.sendFailed}</p>}
    </div>
  );
}
