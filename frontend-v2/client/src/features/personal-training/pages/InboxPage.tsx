// The messaging inbox: every client thread, waiting-on-you first, and the
// conversation with what the trainer needs to know about the client on top.
// Replies go through the same undo window as every draft. On a phone the list
// and the thread are separate screens (/inbox and /inbox/:clientId).

import { useState } from 'react';
import { Link, useRoute } from 'wouter';
import { ArrowLeft, ChevronRight, Sparkles } from 'lucide-react';
import {
  clockTime, relativeDay, shortDate,
  type Draft, type InboxContext, type InboxConversation, type InboxThread, type MeResponse,
} from '@axiom/personal-training-core';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useDraftInboxReply, useInbox, useInboxThread, useMessageClient } from '../businessHooks';
import { BCOPY } from '../copyBusiness';
import { DraftReply, SentRow } from '../components/DraftReply';
import { Gate } from '../components/Gate';
import { Avatar, Eyebrow, Notice, Pill, SkeletonBlock, StatusPill } from '../components/primitives';
import { Shell } from '../components/Shell';
import { useCanUndo, useUndoDraft } from '../hooks';

const T = BCOPY.inbox;
const focusRing = 'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15';
const threadHref = (id: string) => `/personal-training/inbox/${encodeURIComponent(id)}`;

function when(iso: string): string {
  const day = relativeDay(iso);
  return day === 'Today' ? clockTime(iso) : day ?? '';
}

// ─── Thread list ─────────────────────────────────────────────────────────────

function ThreadRow({ thread, selected }: { thread: InboxThread; selected: boolean }) {
  const last = thread.lastMessage;
  return (
    <li>
      <Link
        href={threadHref(thread.clientId)}
        aria-current={selected ? 'page' : undefined}
        className={cn('flex min-h-16 items-start gap-3 rounded-xl px-3 py-3 transition-colors duration-200', focusRing, selected ? 'bg-axiom-zinc-100' : 'hover:bg-axiom-zinc-50')}
      >
        <Avatar initials={thread.client.initials} size={36} status={thread.client.status} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <p className={cn('min-w-0 flex-1 truncate text-[13px]', thread.unread > 0 ? 'font-bold' : 'font-semibold')}>{thread.client.name}</p>
            {last && <span className="shrink-0 text-[11px] text-axiom-zinc-500 tabular-nums">{when(last.at)}</span>}
          </div>
          {last && (
            <p className={cn('mt-0.5 truncate text-xs', thread.unread > 0 ? 'text-foreground' : 'text-axiom-zinc-500')}>
              {!last.fromClient && <span className="text-axiom-zinc-500">{T.you}: </span>}{last.body}
            </p>
          )}
          {(thread.awaitingReply || thread.client.channel === 'webLink') && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {thread.awaitingReply && <Pill tone="amber">{T.awaiting}</Pill>}
              {thread.client.channel === 'webLink' && <Pill tone="zinc">{T.webLink}</Pill>}
            </div>
          )}
        </div>
        {thread.unread > 0 && (
          <span className="mt-0.5 grid min-w-5 shrink-0 place-items-center rounded-full bg-foreground px-1.5 text-[11px] font-bold leading-5 text-background tabular-nums">
            <span aria-hidden>{thread.unread}</span>
            <span className="sr-only">{BCOPY.nav.unread(thread.unread)}</span>
          </span>
        )}
      </Link>
    </li>
  );
}

function ThreadList({ selectedId }: { selectedId: string | null }) {
  const inbox = useInbox({ poll: true });
  if (inbox.isPending) {
    return <div aria-busy="true" className="space-y-2">{[0, 1, 2, 3].map((i) => <SkeletonBlock key={i} className="h-16 w-full rounded-xl" />)}</div>;
  }
  if (inbox.isError) {
    return <Notice alert action={<Button variant="secondary" className="h-10 rounded-xl" onClick={() => inbox.refetch()}>{T.retry}</Button>}>{T.listFailed}</Notice>;
  }
  if (inbox.data.threads.length === 0) return <Notice><p className="font-semibold text-foreground">{T.empty}</p><p className="mt-1">{T.emptyBody}</p></Notice>;
  return (
    <nav aria-label={T.title}>
      <ul className="space-y-0.5">{inbox.data.threads.map((t) => <ThreadRow key={t.clientId} thread={t} selected={t.clientId === selectedId} />)}</ul>
    </nav>
  );
}

// ─── Conversation ────────────────────────────────────────────────────────────

function ContextStrip({ clientId, context }: { clientId: string; context: InboxContext }) {
  const C = T.context;
  const facts = [
    context.block ? C.block(context.block.blockLabel, context.block.week, context.block.weeks) : C.noProgram,
    context.lastSessionAt ? C.lastSession(relativeDay(context.lastSessionAt) ?? '') : null,
    context.nextCheckInDue ? C.nextCheckIn(shortDate(new Date(context.nextCheckInDue))) : null,
  ].filter(Boolean) as string[];
  return (
    <section aria-label="Client context" className="space-y-3 rounded-2xl border border-border bg-axiom-zinc-50 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={context.status} />
        {context.statusReason && <p className="min-w-0 text-[13px] text-axiom-zinc-600">{context.statusReason}</p>}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-axiom-zinc-600">{facts.map((f) => <li key={f}>{f}</li>)}</ul>
      {context.contraindications.length > 0 && (
        <div>
          <Eyebrow className="mb-1.5">{C.contraindications}</Eyebrow>
          <ul className="flex flex-wrap gap-1.5">{context.contraindications.map((c) => <li key={c}><Pill tone="red">{c}</Pill></li>)}</ul>
        </div>
      )}
      {context.goals.length > 0 && (
        <div>
          <Eyebrow className="mb-1">{C.goals}</Eyebrow>
          <p className="text-[13px]">{context.goals.join(' · ')}</p>
        </div>
      )}
      {context.nutrition && (
        <div>
          <Eyebrow className="mb-1">{C.nutrition}</Eyebrow>
          <p className="text-[13px]">{context.nutrition}</p>
        </div>
      )}
      <Link href={`/personal-training/clients/${encodeURIComponent(clientId)}/overview`} className={cn('inline-flex min-h-11 items-center gap-1 rounded-lg text-[13px] font-semibold underline-offset-4 hover:underline md:min-h-0', focusRing)}>
        {T.openRecord} <ChevronRight className="size-3.5" aria-hidden />
      </Link>
    </section>
  );
}

function Messages({ convo }: { convo: InboxConversation }) {
  if (convo.messages.length === 0) return <p className="py-8 text-center text-sm text-axiom-zinc-500">{T.noMessages}</p>;
  return (
    <div role="log" aria-label={`Messages with ${convo.client.name}`} className="space-y-2 py-4">
      {convo.messages.map((m) => (
        <div key={m.id} className={cn('flex flex-col', m.fromClient ? 'items-start' : 'items-end')}>
          <p className={cn('max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-relaxed', m.fromClient ? 'rounded-bl-md bg-axiom-zinc-100' : 'rounded-br-md bg-foreground text-background')}>
            <span className="sr-only">{m.fromClient ? `${convo.client.name}: ` : `${T.you}: `}</span>
            {m.body}
          </p>
          <span className="mt-0.5 px-1 text-[11px] text-axiom-zinc-500">{when(m.at)}</span>
        </div>
      ))}
    </div>
  );
}

/** A direct message that has gone into the undo window. */
function QueuedMessage({ draft, onDone }: { draft: Draft; onDone: (d: Draft | null) => void }) {
  const undo = useUndoDraft();
  const canUndo = useCanUndo(draft.undoUntil);
  return (
    <div className="space-y-1">
      <SentRow
        summary={T.queued}
        canUndo={draft.status === 'sending' && canUndo}
        busy={undo.isPending}
        onUndo={() => undo.mutate(draft.id, { onSuccess: ({ draft: d }) => onDone(d) })}
      />
      {undo.isError && <p role="alert" className="text-xs text-axiom-destructive-ink">{(undo.error as Error).message}</p>}
    </div>
  );
}

function Composer({ clientId, name }: { clientId: string; name: string }) {
  const [text, setText] = useState('');
  const [queued, setQueued] = useState<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const message = useMessageClient(clientId);
  const drafter = useDraftInboxReply(clientId);

  if (draft) {
    return (
      <div className="space-y-2">
        <DraftReply draft={draft} label={T.composer(name)} onChange={setDraft}>
          {draft.status === 'pending' && <Button type="button" variant="ghost" className="h-11 rounded-xl md:h-10" onClick={() => setDraft(null)}>{T.discardDraft}</Button>}
        </DraftReply>
        {draft.status !== 'pending' && <Button type="button" variant="ghost" className="h-9 rounded-lg text-xs" onClick={() => setDraft(null)}>{T.another}</Button>}
      </div>
    );
  }

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || message.isPending) return;
    message.mutate(body, {
      onSuccess: ({ draft: d }) => { setQueued(d); setText(''); },
    });
  };

  return (
    <form onSubmit={send} className="space-y-2">
      {queued && <QueuedMessage draft={queued} onDone={(d) => { if (d && d.status === 'pending') setText(d.text); setQueued(null); }} />}
      <label htmlFor="inbox-composer" className="sr-only">{T.composer(name)}</label>
      <Textarea
        id="inbox-composer" rows={3} maxLength={2000} value={text} placeholder={T.composer(name)}
        onChange={(e) => setText(e.target.value)} className="min-h-20 rounded-xl text-sm leading-relaxed"
      />
      {message.isError && <p role="alert" className="text-xs text-axiom-destructive-ink">{(message.error as Error).message || T.sendFailed}</p>}
      {drafter.isError && <p role="alert" className="text-xs text-axiom-destructive-ink">{(drafter.error as Error).message || T.draftFailed}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" className="h-11 rounded-xl md:h-10" disabled={!text.trim() || message.isPending}>{T.send}</Button>
        <Button
          type="button" variant="secondary" className="h-11 rounded-xl md:h-10" disabled={drafter.isPending}
          onClick={() => drafter.mutate(undefined, { onSuccess: ({ draft: d }) => setDraft(d) })}
        >
          <Sparkles className="size-4" aria-hidden /> {drafter.isPending ? T.drafting : T.draft}
        </Button>
      </div>
    </form>
  );
}

function Conversation({ clientId }: { clientId: string }) {
  const convo = useInboxThread(clientId);
  const back = (
    <Link href="/personal-training/inbox" className={cn('mb-3 inline-flex min-h-11 items-center gap-1.5 rounded-lg text-[13px] font-semibold text-axiom-zinc-600 md:hidden', focusRing)}>
      <ArrowLeft className="size-4" aria-hidden /> {T.back}
    </Link>
  );
  if (convo.isPending) return <div aria-busy="true">{back}<SkeletonBlock className="mb-3 h-28 w-full rounded-2xl" /><SkeletonBlock className="mb-2 h-12 w-2/3 rounded-2xl" /><SkeletonBlock className="ml-auto h-12 w-1/2 rounded-2xl" /></div>;
  if (convo.isError) return <div>{back}<Notice alert action={<Button variant="secondary" className="h-10 rounded-xl" onClick={() => convo.refetch()}>{T.retry}</Button>}>{T.loadFailed}</Notice></div>;
  const c = convo.data;
  return (
    <div>
      {back}
      <div className="mb-3 flex items-center gap-3">
        <Avatar initials={c.client.initials} size={44} />
        <div className="min-w-0">
          <h2 className="truncate text-[17px] font-semibold tracking-[-0.01em]">{c.client.name}</h2>
          {c.client.channel === 'webLink' && <Pill tone="zinc">{T.webLink}</Pill>}
        </div>
      </div>
      <ContextStrip clientId={c.client.id} context={c.context} />
      <Messages convo={c} />
      <div className="border-t border-border pt-4">
        <Composer key={clientId} clientId={clientId} name={c.client.name.split(/\s+/)[0] || c.client.name} />
      </div>
    </div>
  );
}

function InboxView({ me }: { me: MeResponse }) {
  const [, params] = useRoute('/personal-training/inbox/:clientId');
  const clientId = params?.clientId ? decodeURIComponent(params.clientId) : null;
  return (
    <Shell me={me} active="inbox" title={T.title}>
      <h1 className="mb-6 hidden text-[30px] font-bold leading-tight tracking-[-0.02em] md:block">{T.title}</h1>
      <div className="md:grid md:grid-cols-[320px_minmax(0,1fr)] md:gap-8">
        <div className={cn(clientId && 'hidden md:block')}><ThreadList selectedId={clientId} /></div>
        <div className={cn(!clientId && 'hidden md:block')}>
          {clientId ? <Conversation key={clientId} clientId={clientId} /> : <Notice><p className="font-semibold text-foreground">{T.pick}</p><p className="mt-1">{T.pickBody}</p></Notice>}
        </div>
      </div>
    </Shell>
  );
}

export default function InboxPage() {
  return <Gate>{(me) => <InboxView me={me} />}</Gate>;
}
