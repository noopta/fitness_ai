// The client's thread with their trainer. Lands as an ordinary DM on the
// trainer's side; polled every 20 seconds while this tab is open.

import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { errorMessage } from '../api';
import { EmptyState, InlineError, LoadFailed, PortalButton, SkeletonBlock } from '../components';
import { formatTime } from '../helpers';
import { useMessages, useSendMessage } from '../hooks';

const MAX = 2000;

export function MessagesScreen({ trainerName }: { trainerName: string }) {
  const thread = useMessages();
  const send = useSendMessage();
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const count = thread.data?.messages.length ?? 0;

  useEffect(() => {
    try { endRef.current?.scrollIntoView?.({ block: 'end' }); } catch { /* not in every environment */ }
  }, [count]);

  const trimmed = text.trim();
  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!trimmed || trimmed.length > MAX) return;
    send.mutate(trimmed, { onError: () => setText((t) => t || trimmed) });
    setText('');
  };

  return (
    <div className="flex flex-col">
      <h1 className="mb-4 text-[22px] font-bold leading-tight tracking-[-0.02em]">{trainerName}</h1>
      <div aria-live="polite" aria-label={`Messages with ${trainerName}`} role="log" className="min-h-[40vh] space-y-2 pb-4">
        {thread.isPending ? (
          <div aria-busy="true" aria-label="Loading messages" className="space-y-2">
            <SkeletonBlock className="h-12 w-2/3 rounded-2xl" />
            <SkeletonBlock className="ml-auto h-12 w-1/2 rounded-2xl" />
            <SkeletonBlock className="h-16 w-3/4 rounded-2xl" />
          </div>
        ) : thread.isError && !thread.data ? (
          <LoadFailed onRetry={() => thread.refetch()} />
        ) : count === 0 ? (
          <EmptyState title="No messages yet">Say hi, ask a question, or tell {trainerName.split(/\s+/)[0]} how training is going.</EmptyState>
        ) : (
          thread.data!.messages.map((m) => (
            <div key={m.id} className={cn('flex flex-col', m.fromClient ? 'items-end' : 'items-start')}>
              <p
                className={cn(
                  'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[15px] leading-snug',
                  m.fromClient ? 'rounded-br-md bg-[var(--portal-accent)] text-[var(--portal-on-accent)]' : 'rounded-bl-md bg-axiom-zinc-100 text-foreground',
                  m.pending && 'opacity-60',
                )}
              >
                <span className="sr-only">{m.fromClient ? 'You: ' : `${trainerName}: `}</span>
                {m.body}
              </p>
              <span className="mt-0.5 px-1 text-[11px] text-axiom-zinc-500">{m.pending ? 'Sending…' : formatTime(m.at)}</span>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      {send.isError && <div className="mb-2"><InlineError>{errorMessage(send.error, 'That message did not send. Try again.')}</InlineError></div>}
      <form onSubmit={submit} className="sticky bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] -mx-4 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
        <label htmlFor="portal-composer" className="sr-only">Message {trainerName}</label>
        <div className="flex items-end gap-2">
          <Textarea
            id="portal-composer" rows={1} maxLength={MAX} value={text} placeholder="Write a message"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia?.('(pointer: fine)').matches) { e.preventDefault(); submit(); } }}
            className="max-h-40 min-h-11 flex-1 resize-none rounded-xl text-base md:text-sm"
          />
          <PortalButton type="submit" aria-label="Send message" disabled={!trimmed || trimmed.length > MAX} className="size-11 shrink-0 px-0">
            <Send />
          </PortalButton>
        </div>
        {text.length > MAX - 200 && <p className="mt-1 text-right text-[11px] text-axiom-zinc-500 tabular-nums">{text.length} / {MAX}</p>}
      </form>
    </div>
  );
}
