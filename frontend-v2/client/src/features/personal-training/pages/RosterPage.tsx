// Client roster (design handoff §6.2). Desktop is a table that scrolls inside
// its own card so it can never widen the page; below 768px it becomes a list
// of rows. Each row leads to the client's timeline.

import { useMemo, useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { Search } from 'lucide-react';
import {
  COPY, FILTER_LABEL, ROSTER_FILTERS, TREND_LABEL, countByStatus, filterClients, matchesQuery, reasonLine, relativeDay,
  type Client, type MeResponse, type RosterFilter,
} from '@axiom/personal-training-core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Gate } from '../components/Gate';
import { InvitePanel } from '../components/InvitePanel';
import { Avatar, Eyebrow, FilterChip, SkeletonBlock, Sparkline, StatusPill } from '../components/primitives';
import { Shell } from '../components/Shell';
import { useAnakinFilter, useRoster } from '../hooks';

const timelineHref = (c: Client) => `/personal-training/clients/${c.id}/timeline`;

function ClientCell({ client, evidence }: { client: Client; evidence?: string }) {
  // Under an Ask Anakin filter the reason line is Anakin's evidence for this client.
  const reason = evidence ?? reasonLine(client);
  return (
    <div className="min-w-0">
      <p className="truncate text-[13px] font-semibold">{client.name}</p>
      {/* The reason is the evidence for the status, so it wraps rather than truncates. */}
      {reason && <p className="line-clamp-2 text-xs text-axiom-zinc-500">{reason}</p>}
    </div>
  );
}

function RosterTable({ clients, evidence }: { clients: Client[]; evidence: Map<string, string> | null }) {
  const th = 'whitespace-nowrap px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-[0.12em] text-axiom-zinc-500';
  return (
    <div className="hidden overflow-x-auto rounded-2xl border border-border md:block">
      <table className="w-full min-w-[880px] border-collapse">
        <thead className="bg-axiom-zinc-50">
          <tr>
            <th scope="col" className={th}>{COPY.roster.columns.client}</th>
            <th scope="col" className={th}>{COPY.roster.columns.status}</th>
            <th scope="col" className={th}>{COPY.roster.columns.program}</th>
            <th scope="col" className={th}>{COPY.roster.columns.engagement}</th>
            <th scope="col" className={th}>{COPY.roster.columns.lastCheckIn}</th>
          </tr>
        </thead>
        <tbody>
          {clients.map((c) => (
            <tr key={c.id} className="border-t border-border transition-colors duration-200 hover:bg-axiom-zinc-50">
              <td className="w-[34%] min-w-[260px] px-4 py-3">
                <Link href={timelineHref(c)} className="flex items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15">
                  <Avatar initials={c.initials} size={36} />
                  <ClientCell client={c} evidence={evidence?.get(c.id)} />
                </Link>
              </td>
              <td className="px-4 py-3"><StatusPill status={c.status} /></td>
              <td className="max-w-[240px] px-4 py-3">
                {c.program ? (
                  <>
                    <p className="truncate text-[13px]">{c.program.blockLabel} · week <span className="tabular-nums">{c.program.week}</span> of <span className="tabular-nums">{c.program.weeks}</span></p>
                    {c.program.goal && <p className="truncate text-xs text-axiom-zinc-500">{c.program.goal}</p>}
                  </>
                ) : <p className="text-[13px] text-axiom-zinc-500">{COPY.roster.noProgram}</p>}
              </td>
              <td className="px-4 py-3">
                {/* Someone who has not joined has no engagement to chart. */}
                {c.status === 'notJoined' ? <span className="text-xs text-axiom-zinc-500">—</span> : (
                  <div className="flex items-center gap-3">
                    <Sparkline series={c.engagement8w} trend={c.engagementTrend} />
                    <span className="text-xs text-axiom-zinc-600">{TREND_LABEL[c.engagementTrend]}</span>
                  </div>
                )}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-[13px] tabular-nums text-axiom-zinc-600">
                {relativeDay(c.lastCheckInAt) ?? COPY.roster.never}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RosterList({ clients, evidence }: { clients: Client[]; evidence: Map<string, string> | null }) {
  return (
    <ul className="divide-y divide-border rounded-2xl border border-border md:hidden">
      {clients.map((c) => (
        <li key={c.id}>
          <Link href={timelineHref(c)} className="flex min-h-16 items-center gap-3 px-3 py-2.5 active:scale-[.98] motion-reduce:active:scale-100">
            <Avatar initials={c.initials} size={36} status={c.status} />
            <div className="min-w-0 flex-1"><ClientCell client={c} evidence={evidence?.get(c.id)} /></div>
            {c.status === 'notJoined' ? <StatusPill status={c.status} /> : <Sparkline series={c.engagement8w} trend={c.engagementTrend} />}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Roster({ me }: { me: MeResponse }) {
  const roster = useRoster();
  const [filter, setFilter] = useState<RosterFilter>('all');
  const [q, setQ] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);

  // "Apply as roster filter" from Ask Anakin: the filter lives in the URL
  // (?anakin=threadId:messageId) so it survives a reload and can be shared.
  const search = useSearch();
  const [, navigate] = useLocation();
  const [filterThread, filterMessage] = (new URLSearchParams(search).get('anakin') ?? '').split(':');
  const anakin = useAnakinFilter(filterThread ?? '', filterMessage ?? '');
  const evidence = useMemo(() => (anakin.data ? new Map(anakin.data.rows.map((r) => [r.clientId, r.evidence])) : null), [anakin.data]);

  const everyone = roster.data?.clients ?? [];
  const all = useMemo(() => (evidence ? everyone.filter((c) => evidence.has(c.id)) : everyone), [everyone, evidence]);
  // Counts follow the search box but not the chip, so each chip keeps showing how many it would reveal.
  const counts = useMemo(() => countByStatus(all.filter((c) => matchesQuery(c, q))), [all, q]);
  const visible = useMemo(() => filterClients(all, filter, q), [all, filter, q]);

  return (
    <Shell me={me} active="clients" title={COPY.roster.title}>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="hidden text-[30px] font-bold leading-tight tracking-[-0.02em] md:block">{COPY.roster.title}</h1>
          {roster.data && <p className="text-sm text-axiom-zinc-600 md:mt-1">{COPY.roster.countLine(all.length)}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <Button asChild variant="secondary" className="h-11 rounded-xl md:h-10"><Link href="/personal-training/import">{COPY.import.entry}</Link></Button>
          <Button className="h-11 rounded-xl md:h-10" onClick={() => setInviteOpen(true)}>{COPY.roster.invite}</Button>
        </div>
      </div>

      {filterThread && (anakin.data || anakin.isError) && (
        <div role="status" className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-foreground px-4 py-3 text-background">
          <p className="min-w-0 text-[13px] font-semibold">
            {anakin.data ? COPY.anakin.filterBanner(anakin.data.question) : COPY.anakin.failed}
          </p>
          <Button variant="secondary" className="h-8 shrink-0 rounded-lg px-3 text-[13px]" onClick={() => navigate('/personal-training/clients')}>{COPY.anakin.clearFilter}</Button>
        </div>
      )}

      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative md:w-64 md:shrink-0">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-axiom-zinc-500" />
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={COPY.roster.searchPlaceholder}
            aria-label={COPY.roster.searchPlaceholder}
            className="h-10 rounded-xl pl-9"
          />
        </div>
        <div className="-mx-4 flex min-w-0 gap-2 overflow-x-auto px-4 md:mx-0 md:px-0" role="group" aria-label={COPY.roster.columns.status}>
          {ROSTER_FILTERS.map((f) => (
            <FilterChip key={f} active={filter === f} onClick={() => setFilter(f)} count={counts[f]}>{FILTER_LABEL[f]}</FilterChip>
          ))}
        </div>
      </div>

      {roster.isPending ? (
        <div aria-busy="true" className="space-y-2">
          {[0, 1, 2, 3].map((i) => <SkeletonBlock key={i} className="h-16 w-full" />)}
        </div>
      ) : roster.isError ? (
        <div role="alert" className="rounded-2xl border border-border p-8 text-center">
          <p className="text-sm text-axiom-zinc-600">{COPY.roster.loadFailed}</p>
          <Button variant="secondary" className="mt-4 h-10 rounded-xl" onClick={() => roster.refetch()}>{COPY.roster.retry}</Button>
        </div>
      ) : everyone.length === 0 ? (
        <div className="rounded-2xl border border-border p-10 text-center">
          <p className="text-[17px] font-semibold tracking-[-0.01em]">{COPY.roster.emptyTitle}</p>
          <p className="mt-1 text-sm text-axiom-zinc-600">{COPY.roster.emptyBody}</p>
        </div>
      ) : visible.length === 0 ? (
        <div className={cn('rounded-2xl border border-border p-8 text-center')}>
          <Eyebrow>{FILTER_LABEL[filter]}</Eyebrow>
          <p className="mt-2 text-sm text-axiom-zinc-600">{COPY.roster.noMatches}</p>
        </div>
      ) : (
        <>
          <RosterTable clients={visible} evidence={evidence} />
          <RosterList clients={visible} evidence={evidence} />
        </>
      )}

      <InvitePanel open={inviteOpen} onOpenChange={setInviteOpen} />
    </Shell>
  );
}

export default function RosterPage() {
  return <Gate>{(me) => <Roster me={me} />}</Gate>;
}
