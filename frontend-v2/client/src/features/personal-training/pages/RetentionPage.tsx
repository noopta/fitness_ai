// "Clients who might need you": the people a word from the trainer would
// help this week, the reasons in plain terms, and a drafted message that goes
// through the same edit / send / undo flow as every other draft.

import { useState } from 'react';
import { Link } from 'wouter';
import { HeartHandshake, Sparkles } from 'lucide-react';
import type { Draft, MeResponse, RetentionRow } from '@axiom/personal-training-core';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useDraftOutreach, useRetention } from '../businessHooks';
import { BCOPY } from '../copyBusiness';
import { DraftReply } from '../components/DraftReply';
import { Gate } from '../components/Gate';
import { Avatar, Notice, PageTitle, Pill, SkeletonBlock, Sparkline } from '../components/primitives';
import { Shell } from '../components/Shell';

const T = BCOPY.retention;
/** Calm by design: amber at most, never red — this is a list of people to help, not a warning board. */
const LEVEL_TONE: Record<RetentionRow['level'], 'amber' | 'zinc'> = { high: 'amber', medium: 'zinc', low: 'zinc' };

function Row({ row }: { row: RetentionRow }) {
  const drafter = useDraftOutreach(row.clientId);
  const [draft, setDraft] = useState<Draft | null>(null);
  const first = row.client.name.split(/\s+/)[0] || row.client.name;
  return (
    <li className="rounded-2xl border border-border p-4">
      <div className="flex items-start gap-3">
        <Avatar initials={row.client.initials} size={36} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/personal-training/clients/${encodeURIComponent(row.clientId)}/overview`} className="rounded text-[15px] font-semibold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15">
              {row.client.name}
            </Link>
            <Pill tone={LEVEL_TONE[row.level]}>{T.level[row.level]}</Pill>
          </div>
          {row.reasons.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {row.reasons.map((r) => <li key={r} className="flex gap-2 text-sm text-axiom-zinc-600"><span aria-hidden className="text-axiom-zinc-400">→</span><span>{r}</span></li>)}
            </ul>
          )}
        </div>
        {row.engagement8w.length > 1 && (
          <Sparkline series={row.engagement8w} width={72} height={24} tone="ink" label={T.engagement(first)} domain={[0, Math.max(10, ...row.engagement8w)]} />
        )}
      </div>
      <div className="mt-3 rounded-xl bg-axiom-zinc-50 px-3 py-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-axiom-zinc-500">{T.suggestion}</p>
        <p className="mt-0.5 text-sm">{row.intervention.text}</p>
      </div>
      <div className="mt-3">
        {draft ? (
          <DraftReply draft={draft} label={`${T.draft}: ${row.client.name}`} onChange={setDraft}>
            <Button type="button" variant="ghost" className="h-11 rounded-xl md:h-10" onClick={() => setDraft(null)}>{T.close}</Button>
          </DraftReply>
        ) : (
          <>
            <Button
              type="button" variant="secondary" className="h-11 rounded-xl md:h-10" disabled={drafter.isPending}
              onClick={() => drafter.mutate(undefined, { onSuccess: ({ draft: d }) => setDraft(d) })}
              aria-label={`${T.draft} to ${row.client.name}`}
            >
              <Sparkles className="size-4" aria-hidden /> {drafter.isPending ? T.drafting : T.draft}
            </Button>
            {drafter.isError && <p role="alert" className="mt-2 text-xs text-axiom-destructive-ink">{(drafter.error as Error).message || T.draftFailed}</p>}
          </>
        )}
      </div>
    </li>
  );
}

function RetentionView({ me }: { me: MeResponse }) {
  const q = useRetention();
  return (
    <Shell me={me} active="atRisk" title={T.title} width="narrow">
      <PageTitle sub={T.sub}>{T.title}</PageTitle>
      {q.isPending ? (
        <div aria-busy="true" className="space-y-3">{[0, 1, 2].map((i) => <SkeletonBlock key={i} className="h-36 w-full rounded-2xl" />)}</div>
      ) : q.isError ? (
        <Notice alert action={<Button variant="secondary" className="h-10 rounded-xl" onClick={() => q.refetch()}>{BCOPY.inbox.retry}</Button>}>{T.loadFailed}</Notice>
      ) : q.data.clients.length === 0 ? (
        <div className="rounded-2xl border border-border p-8 text-center">
          <HeartHandshake aria-hidden className="mx-auto mb-3 size-8 text-axiom-success" />
          <p className="text-[15px] font-semibold">{T.emptyTitle}</p>
          <p className="mt-1 text-sm text-axiom-zinc-600">{T.emptyBody}</p>
        </div>
      ) : (
        <ul className={cn('space-y-3')}>{q.data.clients.map((r) => <Row key={r.clientId} row={r} />)}</ul>
      )}
    </Shell>
  );
}

export default function RetentionPage() {
  return <Gate>{(me) => <RetentionView me={me} />}</Gate>;
}
