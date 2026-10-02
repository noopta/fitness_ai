// The client dossier's Overview, Program and Notes tabs, and the Message
// dialog (design handoff §6.3). Everything on the Overview is derived by the
// server from the same rules as the roster and briefing; the Program is read
// as the client has it, not edited here.

import { useState } from 'react';
import { Link } from 'wouter';
import { COPY, relativeDay, shortDate, type ClientNote, type ClientOverview, type ClientProgramView, type Draft } from '@axiom/personal-training-core';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useCanUndo, useMessageClient, useNoteActions, useNotes, useOverview, useProgram, useUndoDraft } from '../hooks';
import { SentRow } from './DraftReply';
import { EvidenceList, Eyebrow, Notice, Pill, SkeletonBlock } from './primitives';

const Loading = () => <div aria-busy="true" className="space-y-3"><SkeletonBlock className="h-28 w-full" /><SkeletonBlock className="h-40 w-full" /></div>;
const Failed = ({ retry }: { retry: () => void }) => (
  <Notice alert action={<Button variant="secondary" className="h-10 rounded-xl" onClick={retry}>{COPY.roster.retry}</Button>}>{COPY.dossier.loadFailed}</Notice>
);

// ── Overview ─────────────────────────────────────────────────────────────────

function OverviewBody({ overview }: { overview: ClientOverview }) {
  const { block } = overview;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-6">
        <section className="rounded-2xl border border-border p-5">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <Eyebrow>{COPY.dossier.summary}</Eyebrow>
            <p className="text-xs text-axiom-zinc-500">{COPY.dossier.updated(relativeDay(overview.summary.updatedAt)?.toLowerCase() ?? '')}</p>
          </div>
          <p className="text-[15px] leading-relaxed">{overview.summary.text}</p>
          <details className="mt-3">
            <summary className="cursor-pointer text-xs font-semibold text-axiom-zinc-600">{COPY.dossier.summaryBasis}</summary>
            <div className="mt-2"><EvidenceList reasons={overview.summary.evidence.reasons} sources={overview.summary.evidence.sources} /></div>
          </details>
        </section>

        <section>
          <Eyebrow className="mb-2">{COPY.dossier.openItems}</Eyebrow>
          {overview.openItems.length === 0 ? <p className="text-sm text-axiom-zinc-500">{COPY.dossier.noOpenItems}</p> : (
            <>
              <ul className="divide-y divide-border rounded-2xl border border-border">
                {overview.openItems.map((item) => (
                  <li key={item.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="text-[13px] font-semibold">{item.headline}</p>
                      <Pill tone={item.severity === 'attention' ? 'red' : 'amber'}>{item.severity === 'attention' ? COPY.briefing.attention : COPY.briefing.look}</Pill>
                    </div>
                    <p className="mt-0.5 text-sm leading-relaxed text-axiom-zinc-600">{item.detail}</p>
                  </li>
                ))}
              </ul>
              <Link href="/personal-training" className="mt-2 inline-block text-[13px] font-semibold underline-offset-2 hover:underline">{COPY.dossier.openBriefing}</Link>
            </>
          )}
        </section>
      </div>

      <aside className="space-y-6">
        {block && (
          <section>
            <Eyebrow className="mb-2">{COPY.dossier.currentBlock}</Eyebrow>
            <div className="rounded-2xl border border-border p-4">
              <p className="text-[13px] font-semibold">{block.blockLabel}</p>
              <p className="text-xs text-axiom-zinc-500 tabular-nums">{COPY.dossier.blockProgress(block.week, block.weeks)}</p>
              <div
                role="progressbar" aria-valuemin={0} aria-valuemax={block.weeks} aria-valuenow={block.week}
                aria-label={COPY.dossier.blockProgress(block.week, block.weeks)} className="mt-3 flex gap-1"
              >
                {/* Four segments, as in the handoff: quarters of the block rather than one bar per week. */}
                {[1, 2, 3, 4].map((q) => (
                  <span key={q} className={cn('h-1.5 flex-1 rounded-full', block.week / block.weeks > (q - 1) / 4 ? 'bg-foreground' : 'bg-axiom-zinc-100')} />
                ))}
              </div>
            </div>
          </section>
        )}
        <section>
          <Eyebrow className="mb-2">{COPY.dossier.keyStats}</Eyebrow>
          <dl className="grid grid-cols-2 gap-2">
            {overview.stats.map((s) => (
              <div key={s.label} className="rounded-xl border border-border p-3">
                <dd className="text-[20px] font-bold leading-none tracking-[-0.02em] tabular-nums">{s.value}</dd>
                <dt className="mt-1.5 text-xs text-axiom-zinc-500">{s.label}</dt>
                {s.delta && <p className="mt-0.5 text-xs text-axiom-zinc-600 tabular-nums">{s.delta}</p>}
              </div>
            ))}
          </dl>
        </section>
        {overview.recentPrs.length > 0 && (
          <section>
            <Eyebrow className="mb-2">{COPY.dossier.recentPrs}</Eyebrow>
            <ul className="divide-y divide-border rounded-xl border border-border">
              {overview.recentPrs.map((p, i) => (
                <li key={`${p.lift}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2.5 text-[13px]">
                  <span className="min-w-0 truncate font-semibold">{p.lift}</span>
                  <span className="shrink-0 tabular-nums text-axiom-zinc-600">{p.value} · {p.date}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </aside>
    </div>
  );
}

export function OverviewTab({ clientId }: { clientId: string }) {
  const overview = useOverview(clientId);
  if (overview.isPending) return <Loading />;
  if (overview.isError) return <Failed retry={() => overview.refetch()} />;
  return <OverviewBody overview={overview.data} />;
}

// ── Program ──────────────────────────────────────────────────────────────────

function ProgramBody({ program }: { program: ClientProgramView }) {
  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border p-5">
        {program.goal && (
          <>
            <Eyebrow>{COPY.dossier.programGoal}</Eyebrow>
            <p className="mt-1 text-[17px] font-semibold tracking-[-0.01em]">{program.goal}</p>
          </>
        )}
        <p className="mt-1 text-sm text-axiom-zinc-600 tabular-nums">
          {COPY.dossier.programWeek(program.currentWeek, program.totalWeeks)} · {COPY.dossier.programDays(program.daysPerWeek)}
          {program.startedAt ? ` · started ${shortDate(new Date(program.startedAt))}` : ''}
        </p>
        <p className="mt-3 text-xs text-axiom-zinc-500">{COPY.dossier.programReadOnly}</p>
      </section>

      {program.pending.length > 0 && (
        <section>
          <Eyebrow className="mb-1">{COPY.dossier.pendingChanges}</Eyebrow>
          <p className="mb-2 text-xs text-axiom-zinc-500">{COPY.dossier.pendingHelp}</p>
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {program.pending.map((p) => (
              <li key={p.id} className="px-4 py-3">
                <p className="text-[13px] font-semibold">{p.title}</p>
                <p className="text-sm leading-relaxed text-axiom-zinc-600">{p.reasoning}</p>
                <p className="mt-0.5 text-xs text-axiom-zinc-500">{relativeDay(p.proposedAt)}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3">
        {program.phases.map((phase) => (
          <details key={`${phase.name}-${phase.weeksLabel}`} open={phase.current} className="rounded-2xl border border-border">
            <summary className="flex min-h-12 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
              <span className="text-[13px] font-semibold">{phase.name}</span>
              <span className="text-xs text-axiom-zinc-500 tabular-nums">{phase.weeksLabel}</span>
              {phase.current && <Pill tone="zinc">{COPY.dossier.currentPhase}</Pill>}
            </summary>
            <div className="border-t border-border p-4">
              {phase.rationale && <p className="mb-4 text-sm leading-relaxed text-axiom-zinc-600">{phase.rationale}</p>}
              <div className="grid gap-4 sm:grid-cols-2">
                {phase.days.map((day, i) => (
                  <div key={`${day.day}-${i}`}>
                    <p className="text-[13px] font-semibold">{day.day}{day.focus ? <span className="font-normal text-axiom-zinc-500"> · {day.focus}</span> : null}</p>
                    <ul className="mt-1.5 space-y-1">
                      {day.exercises.map((e, j) => (
                        <li key={`${e.name}-${j}`} className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="min-w-0">{e.name}</span>
                          <span className="shrink-0 text-xs tabular-nums text-axiom-zinc-600">{[e.scheme, e.target].filter(Boolean).join(' · ')}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </details>
        ))}
      </section>
    </div>
  );
}

export function ProgramTab({ clientId }: { clientId: string }) {
  const program = useProgram(clientId);
  if (program.isPending) return <Loading />;
  if (program.isError) return <Failed retry={() => program.refetch()} />;
  return program.data.program ? <ProgramBody program={program.data.program} /> : <Notice>{COPY.dossier.noProgram}</Notice>;
}

// ── Notes ────────────────────────────────────────────────────────────────────

function NoteRow({ note, clientId }: { note: ClientNote; clientId: string }) {
  const { update, remove } = useNoteActions(clientId);
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(note.body);
  return (
    <li className="px-4 py-3">
      <p className="text-xs text-axiom-zinc-500">{note.authorName} · {relativeDay(note.createdAt)}{note.updatedAt !== note.createdAt ? ' · edited' : ''}</p>
      {editing ? (
        <form className="mt-2 space-y-2" onSubmit={(e) => { e.preventDefault(); update.mutate({ noteId: note.id, body }, { onSuccess: () => setEditing(false) }); }}>
          <Textarea aria-label={COPY.dossier.editNote} value={body} rows={3} maxLength={4000} onChange={(e) => setBody(e.target.value)} className="rounded-xl text-sm" autoFocus />
          <div className="flex gap-2">
            <Button type="submit" className="h-9 rounded-xl" disabled={!body.trim() || update.isPending}>{COPY.dossier.saveNote}</Button>
            <Button type="button" variant="ghost" className="h-9 rounded-xl" onClick={() => { setBody(note.body); setEditing(false); }}>{COPY.dossier.cancel}</Button>
          </div>
        </form>
      ) : (
        <>
          <p className="mt-1 whitespace-pre-line break-words text-sm leading-relaxed">{note.body}</p>
          <div className="mt-1 flex gap-1">
            <Button variant="ghost" className="h-8 rounded-lg px-2 text-xs text-axiom-zinc-600" onClick={() => setEditing(true)}>{COPY.dossier.editNote}</Button>
            <Button variant="ghost" className="h-8 rounded-lg px-2 text-xs text-axiom-zinc-600" disabled={remove.isPending} onClick={() => { if (window.confirm('Delete this note?')) remove.mutate(note.id); }}>
              {COPY.dossier.deleteNote}
            </Button>
          </div>
        </>
      )}
      {(update.isError || remove.isError) && <p role="alert" className="mt-1 text-xs text-axiom-destructive-ink">{((update.error ?? remove.error) as Error).message}</p>}
    </li>
  );
}

export function NotesTab({ clientId }: { clientId: string }) {
  const notes = useNotes(clientId);
  const { add } = useNoteActions(clientId);
  const [body, setBody] = useState('');
  return (
    <div className="space-y-5">
      <form onSubmit={(e) => { e.preventDefault(); if (body.trim()) add.mutate(body.trim(), { onSuccess: () => setBody('') }); }}>
        <Textarea aria-label={COPY.dossier.addNote} value={body} rows={3} maxLength={4000} placeholder={COPY.dossier.notePlaceholder} onChange={(e) => setBody(e.target.value)} className="rounded-xl text-sm" />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Button type="submit" className="h-10 rounded-xl" disabled={!body.trim() || add.isPending}>{COPY.dossier.addNote}</Button>
          <p className="text-xs text-axiom-zinc-500">{COPY.dossier.notesHelp}</p>
        </div>
        {add.isError && <p role="alert" className="mt-1 text-xs text-axiom-destructive-ink">{(add.error as Error).message}</p>}
      </form>
      {notes.isPending ? <Loading />
        : notes.isError ? <Failed retry={() => notes.refetch()} />
        : notes.data.notes.length === 0 ? <p className="text-sm text-axiom-zinc-500">{COPY.dossier.noNotes}</p>
        : <ul className="divide-y divide-border rounded-2xl border border-border">{notes.data.notes.map((n) => <NoteRow key={n.id} note={n} clientId={clientId} />)}</ul>}
    </div>
  );
}

// ── Message ──────────────────────────────────────────────────────────────────

function SentState({ draft, onUndone }: { draft: Draft; onUndone: (d: Draft) => void }) {
  const undo = useUndoDraft();
  const canUndo = useCanUndo(draft.undoUntil);
  return (
    <div className="space-y-2">
      <p className="whitespace-pre-line rounded-xl border border-border p-3 text-sm leading-relaxed text-axiom-zinc-600">{draft.text}</p>
      <SentRow summary={COPY.draft.sent} canUndo={canUndo} busy={undo.isPending} onUndo={() => undo.mutate(draft.id, { onSuccess: ({ draft: d }) => onUndone(d) })} />
      {undo.isError && <p role="alert" className="text-xs text-axiom-destructive-ink">{(undo.error as Error).message}</p>}
    </div>
  );
}

export function MessageDialog({ clientId, clientName, open, onOpenChange }: { clientId: string; clientName: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [text, setText] = useState('');
  const [sent, setSent] = useState<Draft | null>(null);
  const send = useMessageClient(clientId);
  const close = (next: boolean) => { if (!next) { setText(''); setSent(null); send.reset(); } onOpenChange(next); };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-[17px] font-semibold tracking-[-0.01em]">{COPY.dossier.messageTitle(clientName)}</DialogTitle>
          <DialogDescription className="text-xs text-axiom-zinc-500">{COPY.briefing.nothingSends}</DialogDescription>
        </DialogHeader>
        {sent ? (
          // Undo puts the text back in the box rather than losing it.
          <SentState draft={sent} onUndone={(d) => { setText(d.text); setSent(null); }} />
        ) : (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (text.trim()) send.mutate(text.trim(), { onSuccess: ({ draft }) => setSent(draft) }); }}>
            <Textarea aria-label={COPY.dossier.messagePlaceholder} value={text} rows={5} maxLength={2000} placeholder={COPY.dossier.messagePlaceholder} onChange={(e) => setText(e.target.value)} className="rounded-xl text-sm leading-relaxed" autoFocus />
            {send.isError && <p role="alert" className="text-sm text-axiom-destructive-ink">{(send.error as Error).message}</p>}
            <Button type="submit" className="h-11 w-full rounded-xl md:h-10" disabled={!text.trim() || send.isPending}>{COPY.dossier.messageSend}</Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
