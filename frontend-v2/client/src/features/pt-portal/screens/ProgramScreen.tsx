// The client's program. The trainer's published program comes first (weeks →
// days → blocks); without one, the client's own app program; else an empty state.

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Dumbbell } from 'lucide-react';
import type { ClientProgramView, PortalProgram, ProgramBlock, ProgramItem } from '@axiom/personal-training-core';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { errorMessage } from '../api';
import { Card, EmptyState, Eyebrow, InlineError, ListSkeleton, LoadFailed, PortalButton, ScreenTitle } from '../components';
import {
  blockHeading, currentWeekIndex, formatDay, formatLoad, formatRest, formatSetsReps, itemLabels, WEEKDAY,
} from '../helpers';
import { useApplyProgram, usePrograms } from '../hooks';

// ─── Trainer program ─────────────────────────────────────────────────────────

function Item({ item, label, skip }: { item: ProgramItem; label: string; skip: boolean }) {
  const details = [formatSetsReps(item), formatLoad(item.load), formatRest(item.restSec), item.tempo ? `Tempo ${item.tempo}` : null].filter(Boolean);
  return (
    <li className={cn('flex gap-3 py-2.5 first:pt-0 last:pb-0', skip && 'opacity-90')}>
      <span aria-hidden className="mt-0.5 w-7 shrink-0 text-xs font-bold tabular-nums text-axiom-zinc-500">{label}</span>
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm font-medium', skip && 'line-through decoration-axiom-zinc-400')}>
          <span className="sr-only">{label}. </span>{item.name}
        </p>
        {details.length > 0 && <p className="mt-0.5 text-xs tabular-nums text-axiom-zinc-600">{details.join(' · ')}</p>}
        {item.notes && <p className="mt-0.5 text-xs text-axiom-zinc-500">{item.notes}</p>}
        {skip && (
          <p className="mt-1.5 inline-flex items-start gap-1.5 rounded-lg bg-axiom-warning-soft px-2 py-1 text-xs font-semibold text-axiom-warning-ink">
            <AlertTriangle aria-hidden className="mt-px size-3.5 shrink-0" />
            Skip this for now: your trainer is updating it
          </p>
        )}
      </div>
    </li>
  );
}

function Block({ block, labels, skip }: { block: ProgramBlock; labels: string[]; skip: Set<string> }) {
  const heading = blockHeading(block);
  const list = (
    <ul className="divide-y divide-border">
      {block.items.map((it, i) => <Item key={it.id} item={it} label={labels[i]} skip={skip.has(it.name.trim().toLowerCase())} />)}
    </ul>
  );
  if (!heading) return list;
  return (
    <div role="group" aria-label={heading} className="rounded-xl border border-border bg-axiom-zinc-50 p-3">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.1em] text-axiom-zinc-600">{heading}</p>
      {list}
    </div>
  );
}

function ApplyInApp({ program }: { program: PortalProgram }) {
  const apply = useApplyProgram();
  const [open, setOpen] = useState(false);
  const appliedAt = program.appliedAt;
  return (
    <Card>
      {appliedAt ? (
        <p className="flex items-center gap-2 text-sm text-axiom-zinc-600">
          <CheckCircle2 aria-hidden className="size-4 shrink-0 text-axiom-success" />
          In your Axiom app since {formatDay(appliedAt)}.
        </p>
      ) : (
        <p className="text-sm text-axiom-zinc-600">Prefer to train from the app? It can run this program and log your sessions.</p>
      )}
      {apply.isError && <div className="mt-3"><InlineError>{errorMessage(apply.error)}</InlineError></div>}
      {apply.isSuccess && <p role="status" className="mt-2 text-sm font-semibold text-axiom-success-ink">Done. Open the Axiom app to start.</p>}
      <PortalButton variant={appliedAt ? 'secondary' : 'accent'} className="mt-3 w-full" onClick={() => setOpen(true)} disabled={apply.isPending}>
        {apply.isPending ? 'Setting it up…' : appliedAt ? 'Update it in the Axiom app' : 'Use this program in the Axiom app'}
      </PortalButton>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Use this program in the app?</AlertDialogTitle>
            <AlertDialogDescription>This replaces the program in your Axiom app with "{program.name}". Your past workouts stay as they are.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Not now</AlertDialogCancel>
            <AlertDialogAction className="min-h-11" onClick={() => apply.mutate()}>Replace my program</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export function TrainerProgramView({ program }: { program: PortalProgram }) {
  const weeks = program.doc.weeks;
  const [week, setWeek] = useState(() => currentWeekIndex(program.startDate, weeks.length));
  const skip = new Set(program.skip.map((s) => s.trim().toLowerCase()));
  const current = weeks[Math.min(week, weeks.length - 1)];
  const skipCount = weeks.flatMap((w) => w.days.flatMap((d) => d.blocks.flatMap((b) => b.items))).filter((i) => skip.has(i.name.trim().toLowerCase())).length;

  return (
    <div className="space-y-4">
      <ScreenTitle sub={program.startDate ? `Starts ${formatDay(program.startDate)}` : undefined}>{program.name}</ScreenTitle>
      {program.description && <p className="-mt-2 whitespace-pre-wrap text-sm text-axiom-zinc-600">{program.description}</p>}
      {skipCount > 0 && (
        <p role="note" className="flex items-start gap-2 rounded-xl bg-axiom-warning-soft px-3 py-2 text-sm text-axiom-warning-ink">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          Your trainer is updating {skipCount === 1 ? 'one exercise' : `${skipCount} exercises`} in this program. Skip {skipCount === 1 ? 'it' : 'them'} for now.
        </p>
      )}

      {weeks.length > 1 && (
        <div role="tablist" aria-label="Weeks" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {weeks.map((w, i) => (
            <button
              key={w.id} type="button" role="tab" aria-selected={i === week} onClick={() => setWeek(i)}
              className={cn(
                'min-h-11 shrink-0 rounded-xl border px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/20',
                i === week ? 'border-[var(--portal-accent)] bg-[var(--portal-accent)] text-[var(--portal-on-accent)]' : 'border-border bg-background text-axiom-zinc-600 hover:bg-axiom-zinc-50',
              )}
            >
              {w.label?.trim() || `Week ${i + 1}`}
            </button>
          ))}
        </div>
      )}

      {!current || current.days.length === 0 ? (
        <EmptyState title="Nothing scheduled this week">Rest up, or message your trainer if that looks wrong.</EmptyState>
      ) : (
        <div className="space-y-3" role={weeks.length > 1 ? 'tabpanel' : undefined} aria-label={weeks.length > 1 ? current.label?.trim() || `Week ${week + 1}` : undefined}>
          {current.days.map((day) => {
            const labels = itemLabels(day.blocks);
            return (
              <Card key={day.id} as="article">
                {day.weekday != null && day.weekday >= 0 && day.weekday <= 6 && <Eyebrow>{WEEKDAY[day.weekday]}</Eyebrow>}
                <h2 className="mt-0.5 text-[15px] font-semibold">{day.name}</h2>
                {day.notes && <p className="mt-1 text-xs text-axiom-zinc-600">{day.notes}</p>}
                <div className="mt-3 space-y-3">
                  {day.blocks.map((b, bi) => <Block key={b.id} block={b} labels={labels[bi]} skip={skip} />)}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {program.canApplyInApp && <ApplyInApp program={program} />}
    </div>
  );
}

// ─── The client's own app program (fallback) ────────────────────────────────

function AppProgramView({ program }: { program: ClientProgramView }) {
  const sub = [
    program.goal,
    `${program.daysPerWeek} ${program.daysPerWeek === 1 ? 'day' : 'days'} a week`,
    program.totalWeeks > 0 ? `week ${Math.min(program.currentWeek, program.totalWeeks)} of ${program.totalWeeks}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="space-y-5">
      <ScreenTitle sub={sub}>Program</ScreenTitle>
      {program.phases.map((phase, pi) => (
        <section key={`${phase.name}-${pi}`} aria-labelledby={`phase-${pi}`}>
          <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
            <h2 id={`phase-${pi}`} className="text-[17px] font-semibold tracking-[-0.01em]">{phase.name}</h2>
            <span className="text-xs text-axiom-zinc-500">{phase.weeksLabel}</span>
            {phase.current && <span className="rounded-full bg-[var(--portal-accent)] px-2 py-0.5 text-[11px] font-semibold text-[var(--portal-on-accent)]">Now</span>}
          </div>
          {phase.rationale && <p className="mb-3 text-sm text-axiom-zinc-600">{phase.rationale}</p>}
          <div className="space-y-3">
            {phase.days.map((day, di) => (
              <Card key={`${day.day}-${di}`} as="article">
                <Eyebrow>{day.day}</Eyebrow>
                <h3 className="mt-0.5 text-[15px] font-semibold">{day.focus}</h3>
                <ul className="mt-3 divide-y divide-border">
                  {day.exercises.map((ex, ei) => (
                    <li key={`${ex.name}-${ei}`} className="py-2.5 first:pt-0 last:pb-0">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="min-w-0 text-sm font-medium">{ex.name}</p>
                        <p className="shrink-0 text-sm tabular-nums text-axiom-zinc-600">{ex.scheme}</p>
                      </div>
                      {ex.target && <p className="mt-0.5 text-xs text-axiom-zinc-600">Target: {ex.target}</p>}
                      {ex.notes && <p className="mt-0.5 text-xs text-axiom-zinc-500">{ex.notes}</p>}
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function ProgramScreen() {
  const q = usePrograms();
  if (q.isPending) return <div><ScreenTitle>Program</ScreenTitle><ListSkeleton rows={4} /></div>;
  if (q.isError) return <div><ScreenTitle>Program</ScreenTitle><LoadFailed onRetry={() => q.refetch()} /></div>;
  const { trainerProgram, program } = q.data;
  if (trainerProgram && trainerProgram.doc.weeks.length > 0) return <TrainerProgramView key={`${trainerProgram.id}-${trainerProgram.version}`} program={trainerProgram} />;
  if (program && program.phases.length > 0) return <AppProgramView program={program} />;
  return (
    <div>
      <ScreenTitle>Program</ScreenTitle>
      <EmptyState icon={<Dumbbell />} title="Your trainer hasn't shared a program here yet.">When they do, it shows up on this page.</EmptyState>
    </div>
  );
}
