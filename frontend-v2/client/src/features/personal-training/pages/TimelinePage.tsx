// Client timeline (design handoff §6.3): header with injuries, type filter
// chips and a day-grouped feed, newest first, with cursor-based "Load earlier".
// The other dossier tabs are out of scope for v1 and render disabled.

import { useMemo, useState } from 'react';
import { Link, useRoute } from 'wouter';
import {
  Activity, ChevronRight, ClipboardCheck, CreditCard, Dumbbell, Image as ImageIcon, MessageSquare, Scale, Sparkles, StickyNote,
  type LucideIcon,
} from 'lucide-react';
import {
  COPY, KIND_LABEL, PersonalTrainingApiError, TIMELINE_FILTER_KINDS, clockTime, groupByDay, mergePages, shortDate,
  type Client, type MeResponse, type TimelineEvent, type TimelineKind,
} from '@axiom/personal-training-core';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Gate } from '../components/Gate';
import { Avatar, Eyebrow, FilterChip, Pill, SkeletonBlock, StatusPill } from '../components/primitives';
import { Shell } from '../components/Shell';
import { useClient, useTimeline } from '../hooks';

const KIND_ICON: Record<TimelineKind, LucideIcon> = {
  workout: Dumbbell,
  checkin: ClipboardCheck,
  message: MessageSquare,
  measurement: Scale,
  photos: ImageIcon,
  program: Activity,
  note: StickyNote,
  billing: CreditCard,
};

const DOSSIER_TABS = ['Overview', COPY.timeline.tab, 'Program', 'Notes'];

function ClientHeader({ client }: { client: Client }) {
  const line = [
    client.program?.goal,
    client.program ? `${client.program.blockLabel} · week ${client.program.week} of ${client.program.weeks}` : COPY.roster.noProgram,
    COPY.timeline.tenure(shortDate(new Date(client.joinedAt))),
  ].filter(Boolean).join(' · ');

  return (
    <header className="mb-6">
      <div className="flex items-start gap-4">
        <Avatar initials={client.initials} size={56} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-[22px] font-bold leading-tight tracking-[-0.02em] md:text-[30px]">{client.name}</h1>
            <StatusPill status={client.status} />
          </div>
          {client.statusReason && <p className="mt-1 text-sm text-axiom-zinc-600">{client.statusReason}</p>}
          <p className="mt-1 text-xs text-axiom-zinc-500">{line}</p>
        </div>
      </div>
      <ul className="mt-4 flex flex-wrap gap-2" aria-label="Injuries">
        {client.contraindications.length === 0 && <li className="text-xs text-axiom-zinc-500">{COPY.timeline.noContraindications}</li>}
        {client.contraindications.map((c) => (
          <li
            key={c.label}
            title={c.note}
            className={cn(
              'rounded-lg px-2 py-0.5 text-[11px] font-semibold',
              c.active ? 'bg-axiom-destructive-soft text-axiom-destructive-ink' : 'bg-axiom-zinc-100 text-axiom-zinc-600',
            )}
          >
            {c.label}{c.active ? '' : ` · ${COPY.timeline.cleared}`}
          </li>
        ))}
      </ul>
    </header>
  );
}

function EventRow({ event, last }: { event: TimelineEvent; last: boolean }) {
  const Icon = event.ai ? Sparkles : KIND_ICON[event.kind];
  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg', event.ai ? 'bg-foreground text-background' : 'bg-axiom-zinc-100 text-foreground')}>
          <Icon className="size-4" aria-hidden />
        </span>
        {!last && <span aria-hidden className="w-px flex-1 bg-border" />}
      </div>
      <div className={cn('min-w-0 flex-1', last ? 'pb-1' : 'pb-5')}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-[13px] font-semibold">{event.title}</p>
          {event.flag && <Pill tone={event.flag.tone}>{event.flag.label}</Pill>}
        </div>
        <p className="text-xs text-axiom-zinc-500">
          <time dateTime={event.at}>{clockTime(event.at)}</time> · {KIND_LABEL[event.kind]}
        </p>
        {event.body && <p className="mt-1 whitespace-pre-line break-words text-sm leading-relaxed text-axiom-zinc-600">{event.body}</p>}
      </div>
    </li>
  );
}

function Feed({ clientId }: { clientId: string }) {
  const [kind, setKind] = useState<TimelineKind | null>(null);
  const kinds = useMemo(() => (kind ? [kind] : []), [kind]);
  const timeline = useTimeline(clientId, kinds);
  const days = useMemo(() => groupByDay(mergePages(timeline.data?.pages ?? [])), [timeline.data]);

  return (
    <section aria-label={COPY.timeline.tab}>
      <div className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0" role="group" aria-label="Event type">
        <FilterChip active={kind === null} onClick={() => setKind(null)}>{COPY.timeline.allKinds}</FilterChip>
        {TIMELINE_FILTER_KINDS.map((k) => (
          <FilterChip key={k} active={kind === k} onClick={() => setKind(k)}>{KIND_LABEL[k]}</FilterChip>
        ))}
      </div>

      {timeline.isPending ? (
        <div aria-busy="true" className="space-y-3">
          {[0, 1, 2].map((i) => <SkeletonBlock key={i} className="h-14 w-full" />)}
        </div>
      ) : timeline.isError ? (
        <div role="alert" className="rounded-2xl border border-border p-8 text-center">
          <p className="text-sm text-axiom-zinc-600">{COPY.timeline.loadFailed}</p>
          <Button variant="secondary" className="mt-4 h-10 rounded-xl" onClick={() => timeline.refetch()}>{COPY.roster.retry}</Button>
        </div>
      ) : days.length === 0 ? (
        <p className="rounded-2xl border border-border p-8 text-center text-sm text-axiom-zinc-600">
          {kind ? COPY.timeline.emptyFiltered : COPY.timeline.empty}
        </p>
      ) : (
        <div className="space-y-6">
          {days.map((day) => (
            <div key={day.key}>
              <Eyebrow className="mb-3">{day.heading}</Eyebrow>
              <ol>
                {day.events.map((e, i) => <EventRow key={e.id} event={e} last={i === day.events.length - 1} />)}
              </ol>
            </div>
          ))}
          {timeline.hasNextPage && (
            <Button
              variant="secondary"
              className="h-11 w-full rounded-xl md:h-10 md:w-auto"
              disabled={timeline.isFetchingNextPage}
              onClick={() => timeline.fetchNextPage()}
            >
              {COPY.timeline.loadEarlier}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

function Timeline({ me, clientId }: { me: MeResponse; clientId: string }) {
  const client = useClient(clientId);
  const notFound = client.error instanceof PersonalTrainingApiError && client.error.status === 404;

  return (
    <Shell me={me} active="clients" title={client.data?.client.name ?? COPY.roster.title} width="narrow">
      <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1 text-xs text-axiom-zinc-500">
        <Link href="/personal-training/clients" className="rounded font-semibold hover:text-foreground focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15">
          {COPY.timeline.breadcrumb}
        </Link>
        <ChevronRight className="size-3" aria-hidden />
        <span aria-current="page">{client.data?.client.name ?? ''}</span>
      </nav>

      {client.isPending ? (
        <div aria-busy="true"><SkeletonBlock className="mb-6 h-14 w-72" /><SkeletonBlock className="h-14 w-full" /></div>
      ) : client.isError ? (
        <div role="alert" className="rounded-2xl border border-border p-8 text-center">
          <p className="text-sm text-axiom-zinc-600">{notFound ? COPY.timeline.notFound : COPY.timeline.loadFailed}</p>
          {!notFound && <Button variant="secondary" className="mt-4 h-10 rounded-xl" onClick={() => client.refetch()}>{COPY.roster.retry}</Button>}
        </div>
      ) : (
        <>
          <ClientHeader client={client.data.client} />
          <div className="mb-5 flex gap-5 border-b border-border" role="tablist" aria-label="Client dossier">
            {DOSSIER_TABS.map((tab) => {
              const active = tab === COPY.timeline.tab;
              return (
                <span
                  key={tab}
                  role="tab"
                  aria-selected={active}
                  aria-disabled={!active}
                  title={active ? undefined : COPY.nav.comingSoon}
                  className={cn('-mb-px border-b-2 pb-2 text-[13px] font-semibold', active ? 'border-foreground text-foreground' : 'cursor-default border-transparent text-axiom-zinc-600 opacity-40')}
                >
                  {tab}
                </span>
              );
            })}
          </div>
          <Feed clientId={clientId} />
        </>
      )}
    </Shell>
  );
}

export default function TimelinePage() {
  const [, params] = useRoute('/personal-training/clients/:id/timeline');
  const clientId = params?.id ?? '';
  return <Gate>{(me) => <Timeline me={me} clientId={clientId} />}</Gate>;
}
