// A monthly report the trainer sent: the headline numbers, the story, a
// personal note and what comes next.

import { ArrowLeft } from 'lucide-react';
import { Card, EmptyState, Eyebrow, LoadFailed, PortalButton, SkeletonBlock } from '../components';
import { formatMonth } from '../helpers';
import { usePortalNav, useReport } from '../hooks';

export function ReportScreen({ id, trainerName }: { id: string; trainerName: string }) {
  const { go } = usePortalNav();
  const q = useReport(id);
  const back = <PortalButton variant="ghost" className="-ml-3 mb-2" onClick={() => go({ tab: 'home' })}><ArrowLeft /> Home</PortalButton>;

  if (q.isPending) return <div>{back}<div aria-busy="true" aria-label="Loading report" className="space-y-3"><SkeletonBlock className="h-7 w-48" /><SkeletonBlock className="h-24 w-full rounded-2xl" /><SkeletonBlock className="h-40 w-full rounded-2xl" /></div></div>;
  if (q.isError) {
    return <div>{back}{(q.error as { status?: number }).status === 404 ? <EmptyState title="This report isn't available.">Your trainer may not have sent it yet.</EmptyState> : <LoadFailed onRetry={() => q.refetch()} />}</div>;
  }
  const r = q.data.report;
  const headline = r.stats?.headline ?? [];
  const paragraphs = r.narrative.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  return (
    <article className="space-y-4">
      {back}
      <div>
        <Eyebrow>Monthly report</Eyebrow>
        <h1 className="mt-1 text-[24px] font-bold leading-tight tracking-[-0.02em]">{formatMonth(r.month)}</h1>
      </div>
      {headline.length > 0 && (
        <dl className="grid grid-cols-2 gap-3">
          {headline.map((h) => (
            <Card key={h.label} as="div" className="p-3">
              <dt className="text-xs text-axiom-zinc-600">{h.label}</dt>
              <dd className="mt-0.5 text-[20px] font-bold tabular-nums tracking-[-0.01em]">{h.value}</dd>
            </Card>
          ))}
        </dl>
      )}
      {paragraphs.length > 0 && (
        <div className="space-y-3 text-[15px] leading-relaxed">{paragraphs.map((p, i) => <p key={i}>{p}</p>)}</div>
      )}
      {r.coachNote.trim() && (
        <figure className="rounded-2xl border-l-4 border-[var(--portal-accent)] bg-axiom-zinc-50 p-4">
          <blockquote className="whitespace-pre-wrap text-[15px] leading-relaxed">{r.coachNote}</blockquote>
          <figcaption className="mt-2 text-xs font-semibold text-axiom-zinc-600">— {trainerName}</figcaption>
        </figure>
      )}
      {r.nextLine.trim() && (
        <Card>
          <Eyebrow className="mb-1">Next month</Eyebrow>
          <p className="text-[15px]">{r.nextLine}</p>
        </Card>
      )}
    </article>
  );
}
