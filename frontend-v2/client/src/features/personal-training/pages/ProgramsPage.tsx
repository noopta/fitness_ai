// Programs (handoff B1): every client program and template in the practice,
// newest first, with where each came from. New programs start blank, from a
// template, or drafted by Axiom; all of them open on the builder canvas.

import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { MoreHorizontal } from 'lucide-react';
import { COPY, relativeDay, type MeResponse, type ProgramSummary } from '@axiom/personal-training-core';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { errorText } from '../components/ChipInput';
import { Gate } from '../components/Gate';
import { FilterChip, Notice, PageTitle, Pill, SkeletonBlock } from '../components/primitives';
import { CopyProgramDialog, GenerateDialog, NewProgramDialog } from '../components/ProgramDialogs';
import { ProgramsNav } from '../components/ProgramsNav';
import { Shell } from '../components/Shell';
import { PRG } from '../copyPrograms';
import { useArchiveProgram, useCopyProgram, usePrograms } from '../programHooks';

const L = PRG.list;
type Filter = 'all' | 'draft' | 'published' | 'templates';
const FILTERS: Filter[] = ['all', 'draft', 'published', 'templates'];

export function matchesFilter(p: ProgramSummary, f: Filter): boolean {
  if (f === 'templates') return p.isTemplate;
  if (f === 'draft') return !p.isTemplate && p.status === 'draft';
  if (f === 'published') return !p.isTemplate && p.status === 'published';
  return true;
}

const STATUS_TONE = { draft: 'zinc', published: 'green', archived: 'zinc' } as const;

function Row({ p, onCopy }: { p: ProgramSummary; onCopy: (p: ProgramSummary) => void }) {
  const archive = useArchiveProgram();
  const asTemplate = useCopyProgram();
  const href = `/personal-training/programs/${p.id}`;
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <Link href={href} className="min-w-0 flex-1 rounded-lg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="min-w-0 truncate text-[13px] font-semibold">{p.name}</p>
          {p.isTemplate ? <Pill tone="zinc">{L.template}</Pill> : <Pill tone={STATUS_TONE[p.status]}>{PRG.status[p.status]}</Pill>}
          <span className="rounded-md border border-border px-1.5 py-px text-[10px] font-semibold text-axiom-zinc-600">{PRG.source[p.source]}</span>
        </div>
        <p className="mt-0.5 truncate text-xs text-axiom-zinc-500">
          {[p.isTemplate ? null : p.clientName ?? L.noClient, L.shape(p.weeks, p.daysPerWeek), L.updated(relativeDay(p.updatedAt)?.toLowerCase() ?? '')].filter(Boolean).join(' · ')}
        </p>
        {asTemplate.isSuccess && <p role="status" className="mt-0.5 text-xs text-axiom-success-ink">{L.savedTemplate}</p>}
        {(archive.isError || asTemplate.isError) && <p role="alert" className="mt-0.5 text-xs text-axiom-destructive-ink">{errorText(archive.error ?? asTemplate.error, L.failed)}</p>}
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="size-10 shrink-0 rounded-xl p-0 text-axiom-zinc-600" aria-label={`${L.actions}: ${p.name}`}><MoreHorizontal aria-hidden /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52 rounded-xl">
          <DropdownMenuItem asChild><Link href={href}>{L.open}</Link></DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onCopy(p)}>{L.copyTo}</DropdownMenuItem>
          {!p.isTemplate && <DropdownMenuItem onSelect={() => asTemplate.mutate({ id: p.id, asTemplate: true })}>{L.saveTemplate}</DropdownMenuItem>}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-axiom-destructive-ink" onSelect={() => { if (window.confirm(L.archiveConfirm)) archive.mutate(p.id); }}>{L.archive}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function Page({ me }: { me: MeResponse }) {
  const programs = usePrograms();
  const [filter, setFilter] = useState<Filter>('all');
  const [newOpen, setNewOpen] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [copying, setCopying] = useState<ProgramSummary | null>(null);
  const all = programs.data?.programs ?? [];
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f, all.filter((p) => matchesFilter(p, f)).length])) as Record<Filter, number>, [all]);
  const visible = all.filter((p) => matchesFilter(p, filter));

  return (
    <Shell me={me} active="programs" title={L.title}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <PageTitle sub={L.sub}>{L.title}</PageTitle>
        <div className="mb-6 flex shrink-0 flex-wrap gap-2">
          <Button variant="secondary" className="h-11 rounded-xl md:h-10" onClick={() => setGenOpen(true)}>{L.generate}</Button>
          <Button className="h-11 rounded-xl md:h-10" onClick={() => setNewOpen(true)}>{L.newProgram}</Button>
        </div>
      </div>
      <ProgramsNav active="programs" />

      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0" role="group" aria-label={L.title}>
        {FILTERS.map((f) => <FilterChip key={f} active={filter === f} onClick={() => setFilter(f)} count={programs.data ? counts[f] : undefined}>{L.filters[f]}</FilterChip>)}
      </div>

      {programs.isPending ? (
        <div aria-busy="true" className="space-y-2">{[0, 1, 2].map((i) => <SkeletonBlock key={i} className="h-16 w-full" />)}</div>
      ) : programs.isError ? (
        <Notice alert action={<Button variant="secondary" className="h-10 rounded-xl" onClick={() => programs.refetch()}>{COPY.roster.retry}</Button>}>{L.loadFailed}</Notice>
      ) : all.length === 0 ? (
        <Notice action={<Button className="h-10 rounded-xl" onClick={() => setGenOpen(true)}>{L.generate}</Button>}>{L.empty}</Notice>
      ) : visible.length === 0 ? (
        <Notice>{L.emptyFiltered}</Notice>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border">
          {visible.map((p) => <Row key={p.id} p={p} onCopy={setCopying} />)}
        </ul>
      )}

      <NewProgramDialog open={newOpen} onOpenChange={setNewOpen} />
      <GenerateDialog open={genOpen} onOpenChange={setGenOpen} />
      {copying && <CopyProgramDialog program={copying} open onOpenChange={(o) => { if (!o) setCopying(null); }} />}
    </Shell>
  );
}

export default function ProgramsPage() {
  return <Gate>{(me) => <Page me={me} />}</Gate>;
}
