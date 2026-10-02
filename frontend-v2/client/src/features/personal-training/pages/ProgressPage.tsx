// Progress and the client report (design handoff §6.5). Roster: KPI tiles,
// lift chips, and either a table or a small-multiples grid. Report: the PR
// log and measurements beside the report exactly as the client will get it.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import {
  COPY, seriesDomain,
  type LiftKey, type MeResponse, type ProgressRow, type ProgressStatus, type Report, type Tone,
} from '@axiom/personal-training-core';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { SentRow } from '../components/DraftReply';
import { Gate } from '../components/Gate';
import { Avatar, Eyebrow, FilterChip, Notice, PageTitle, Pill, SegmentedControl, SkeletonBlock, Sparkline } from '../components/primitives';
import { Shell } from '../components/Shell';
import { useCanUndo, useProgress, useReport, useReportActions, useRoster } from '../hooks';

const WEEKS = 6;
const STATUS_TONE: Record<ProgressStatus, Tone> = { progressing: 'green', plateau: 'amber', regressing: 'red', noData: 'zinc' };
const LINE_TONE: Record<ProgressStatus, 'red' | 'amber' | 'ink'> = { progressing: 'ink', plateau: 'amber', regressing: 'red', noData: 'ink' };
const selectClass = 'h-10 rounded-xl border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15';
const timelineHref = (id: string) => `/personal-training/clients/${id}/timeline`;
const signed = (n: number, unit: string) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)} ${unit}`;

function Trend({ row, width, height, band }: { row: ProgressRow; width: number; height: number; band?: boolean }) {
  if (row.series.length === 0) return <span className="text-xs text-axiom-zinc-500">—</span>;
  return (
    <Sparkline
      series={row.series} width={width} height={height} domain={seriesDomain(row.series)} tone={LINE_TONE[row.status]} band={band}
      label={COPY.progress.seriesAlt(row.client.name, row.lift, COPY.progress.status[row.status])}
    />
  );
}

function ProgressTable({ rows, unit }: { rows: ProgressRow[]; unit: string }) {
  const th = 'whitespace-nowrap px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-[0.12em] text-axiom-zinc-500';
  return (
    <div className="overflow-x-auto rounded-2xl border border-border">
      <table className="w-full min-w-[760px] border-collapse">
        <thead className="bg-axiom-zinc-50">
          <tr>
            <th scope="col" className={th}>{COPY.progress.columns.client}</th>
            <th scope="col" className={cn(th, 'text-right')}>{COPY.progress.columns.e1rm}</th>
            <th scope="col" className={th}>{COPY.progress.columns.trend(WEEKS)}</th>
            <th scope="col" className={cn(th, 'text-right')}>{COPY.progress.columns.change}</th>
            <th scope="col" className={cn(th, 'text-right')}>{COPY.progress.columns.adherence}</th>
            <th scope="col" className={th}>{COPY.progress.columns.status}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.clientId} className="border-t border-border transition-colors duration-200 hover:bg-axiom-zinc-50">
              <td className="px-4 py-3">
                <Link href={timelineHref(r.clientId)} className="flex items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15">
                  <Avatar initials={r.client.initials} size={36} />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold">{r.client.name}</span>
                    <span className="block truncate text-xs text-axiom-zinc-500">{r.note ?? r.lift}</span>
                  </span>
                </Link>
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right text-[15px] font-bold tabular-nums">{r.e1rm === null ? '—' : `${r.e1rm} ${unit}`}</td>
              <td className="px-4 py-3"><Trend row={r} width={120} height={28} /></td>
              <td className="whitespace-nowrap px-4 py-3 text-right text-[13px] tabular-nums text-axiom-zinc-600">{r.change === null ? '—' : signed(r.change, unit)}</td>
              <td className="whitespace-nowrap px-4 py-3 text-right text-[13px] tabular-nums text-axiom-zinc-600">{r.adherence}%</td>
              <td className="px-4 py-3"><Pill tone={STATUS_TONE[r.status]}>{COPY.progress.status[r.status]}</Pill></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProgressGrid({ rows, unit }: { rows: ProgressRow[]; unit: string }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((r) => {
        const stalled = r.status === 'plateau' || r.status === 'regressing';
        return (
          <li key={r.clientId}>
            <Link href={timelineHref(r.clientId)} className={cn('block rounded-2xl border bg-background p-4 transition-shadow duration-200 hover:shadow-sm', stalled ? 'border-axiom-warning' : 'border-border')}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[13px] font-semibold">{r.client.name}</span>
                <Pill tone={STATUS_TONE[r.status]}>{COPY.progress.status[r.status]}</Pill>
              </div>
              <div className="mt-3 flex items-end justify-between gap-3">
                <div>
                  <p className="text-[22px] font-bold leading-none tracking-[-0.02em] tabular-nums">{r.e1rm === null ? '—' : r.e1rm}<span className="ml-1 text-xs font-normal text-axiom-zinc-500">{r.e1rm === null ? '' : unit}</span></p>
                  <p className="mt-1 text-xs text-axiom-zinc-500 tabular-nums">{r.change === null ? r.note : `${signed(r.change, unit)} · ${r.adherence}% adherence`}</p>
                </div>
                <Trend row={r} width={120} height={36} band={r.status === 'plateau'} />
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function RosterTab() {
  const [lift, setLift] = useState<LiftKey>('squat');
  const [only, setOnly] = useState(false);
  const [view, setView] = useState<'table' | 'grid'>('table');
  const progress = useProgress(lift, WEEKS);
  const rows = useMemo(() => (progress.data?.rows ?? []).filter((r) => !only || r.status === 'plateau' || r.status === 'regressing'), [only, progress.data]);

  if (progress.isError) return <Notice alert action={<Button variant="secondary" className="h-10 rounded-xl" onClick={() => progress.refetch()}>{COPY.roster.retry}</Button>}>{COPY.progress.loadFailed}</Notice>;
  const kpis = progress.data?.kpis;
  const tiles: [string, number | undefined][] = [[COPY.progress.kpiProgressing, kpis?.progressing], [COPY.progress.kpiPlateau, kpis?.plateau], [COPY.progress.kpiPrs, kpis?.prsThisMonth]];

  return (
    <>
      <dl className="mb-6 grid grid-cols-3 gap-3">
        {tiles.map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-border p-4">
            <dd className="text-[26px] font-bold leading-none tracking-[-0.02em] tabular-nums">{value ?? '—'}</dd>
            <dt className="mt-1.5 text-xs text-axiom-zinc-500">{label}</dt>
          </div>
        ))}
      </dl>

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0" role="group" aria-label="Lift">
          {(progress.data?.lifts ?? [{ key: 'squat' as LiftKey, label: 'Squat' }]).map((l) => (
            <FilterChip key={l.key} active={lift === l.key} onClick={() => setLift(l.key)}>{l.label}</FilterChip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch id="pt-only-plateaus" checked={only} onCheckedChange={setOnly} />
            <Label htmlFor="pt-only-plateaus" className="text-[13px] font-normal text-axiom-zinc-600">{COPY.progress.onlyPlateaus}</Label>
          </div>
          <SegmentedControl size="sm" label="View" value={view} onChange={setView} options={[{ value: 'table', label: COPY.progress.viewTable }, { value: 'grid', label: COPY.progress.viewGrid }]} />
        </div>
      </div>

      {progress.isPending
        ? <div aria-busy="true" className="space-y-2">{[0, 1, 2, 3].map((i) => <SkeletonBlock key={i} className="h-14 w-full" />)}</div>
        : rows.length === 0
          ? <Notice>{COPY.progress.empty}</Notice>
          : view === 'table' ? <ProgressTable rows={rows} unit={progress.data.unit} /> : <ProgressGrid rows={rows} unit={progress.data.unit} />}
    </>
  );
}

// ── Client report ────────────────────────────────────────────────────────────

const monthOf = (offset: number) => {
  const d = new Date();
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1));
  return { value: `${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, '0')}`, label: m.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }) };
};

function ReportPreview({ report, clientId, month }: { report: Report; clientId: string; month: string }) {
  const { patch, send, undo } = useReportActions(clientId, month);
  const [note, setNote] = useState(report.coachNote);
  const canUndo = useCanUndo(report.undoUntil);
  useEffect(() => setNote(report.coachNote), [report.id, report.coachNote]);
  const sent = report.status === 'sent';
  const first = report.trainerName.split(' ')[0];

  return (
    <section aria-label={COPY.progress.preview} className="min-w-0 flex-1">
      <div className="mb-2 flex items-center justify-between gap-2">
        <Eyebrow>{COPY.progress.preview}</Eyebrow>
        <Pill tone={sent ? 'green' : 'zinc'}>{sent ? COPY.progress.statusSent : COPY.progress.statusDraft}</Pill>
      </div>
      <div className="rounded-2xl border border-border p-5 shadow-xs md:p-6">
        <p className="text-xs text-axiom-zinc-500">{report.practiceName} · {report.trainerName}</p>
        <h2 className="mt-2 text-[22px] font-bold leading-tight tracking-[-0.02em]">{report.title}</h2>
        <p className="mt-3 text-sm leading-relaxed text-axiom-zinc-600">{report.narrative}</p>
        <dl className="mt-5 grid grid-cols-3 gap-3">
          {report.stats.headline.map((h) => (
            <div key={h.label} className="rounded-xl bg-axiom-zinc-50 p-3">
              <dd className="text-[22px] font-bold leading-none tracking-[-0.02em] tabular-nums">{h.value}</dd>
              <dt className="mt-1 text-xs text-axiom-zinc-500">{h.label}</dt>
            </div>
          ))}
        </dl>
        <div className="mt-5">
          <Label htmlFor="pt-report-note" className="text-[13px] font-semibold">{COPY.progress.note(first)}</Label>
          {sent
            ? <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-axiom-zinc-600">{report.coachNote || '—'}</p>
            : <Textarea id="pt-report-note" rows={3} maxLength={1500} value={note} placeholder={COPY.progress.notePlaceholder} onChange={(e) => setNote(e.target.value)} className="mt-1.5 rounded-xl text-sm" />}
        </div>
        {report.nextLine && <p className="mt-4 text-sm font-semibold">{report.nextLine}</p>}
      </div>

      <div className="mt-4 space-y-2">
        {sent ? (
          <SentRow summary={`${COPY.progress.statusSent} to ${report.client.name}`} canUndo={canUndo} busy={undo.isPending} onUndo={() => undo.mutate(report.id)} />
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              className="h-11 rounded-xl md:h-10" disabled={send.isPending || patch.isPending}
              onClick={async () => { if (note !== report.coachNote) await patch.mutateAsync({ id: report.id, patch: { coachNote: note } }); send.mutate(report.id); }}
            >
              {COPY.progress.approveSend}
            </Button>
            <Button variant="secondary" className="h-11 rounded-xl md:h-10" disabled={note === report.coachNote || patch.isPending} onClick={() => patch.mutate({ id: report.id, patch: { coachNote: note } })}>
              {COPY.progress.saveNote}
            </Button>
            <p className="text-xs text-axiom-zinc-500">{COPY.briefing.nothingSends}</p>
          </div>
        )}
        {(send.isError || patch.isError || undo.isError) && <p role="alert" className="text-xs text-axiom-destructive-ink">{((send.error ?? patch.error ?? undo.error) as Error).message}</p>}
      </div>
    </section>
  );
}

function ReportTab() {
  const roster = useRoster();
  const months = useMemo(() => [monthOf(-1), monthOf(0)], []);
  const [clientId, setClientId] = useState('');
  const [month, setMonth] = useState(months[0].value);
  const report = useReport(clientId, month);
  const clients = roster.data?.clients ?? [];
  const r = report.data?.report;

  return (
    <>
      <div className="mb-6 flex flex-wrap gap-3">
        <select aria-label={COPY.progress.reportClient} className={selectClass} value={clientId} onChange={(e) => setClientId(e.target.value)}>
          <option value="">{COPY.progress.reportClient}</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select aria-label={COPY.progress.reportMonth} className={selectClass} value={month} onChange={(e) => setMonth(e.target.value)}>
          {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>

      {!clientId ? <Notice>{COPY.progress.pickClient}</Notice>
        : report.isPending ? <div aria-busy="true"><SkeletonBlock className="h-72 w-full" /></div>
        : report.isError || !r ? <Notice alert action={<Button variant="secondary" className="h-10 rounded-xl" onClick={() => report.refetch()}>{COPY.roster.retry}</Button>}>{COPY.progress.loadFailed}</Notice>
        : (
          <div className="flex flex-col gap-6 lg:flex-row">
            <div className="space-y-6 lg:w-[320px] lg:shrink-0">
              <section>
                <Eyebrow className="mb-2">{COPY.progress.prLog}</Eyebrow>
                {r.stats.prs.length === 0 ? <p className="text-sm text-axiom-zinc-500">{COPY.progress.noPrs}</p> : (
                  <ul className="divide-y divide-border rounded-xl border border-border">
                    {r.stats.prs.map((p, i) => (
                      <li key={`${p.lift}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2.5 text-[13px]">
                        <span className="min-w-0 truncate font-semibold">{p.lift}</span>
                        <span className="shrink-0 tabular-nums text-axiom-zinc-600">{p.value} · {p.date}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section>
                <Eyebrow className="mb-2">{COPY.progress.measurements}</Eyebrow>
                {r.stats.measurements.length === 0 ? <p className="text-sm text-axiom-zinc-500">{COPY.progress.noMeasurements}</p> : (
                  <>
                    {r.stats.bodyweight && <p className="mb-2 text-sm tabular-nums">{r.stats.bodyweight.start} → {r.stats.bodyweight.end} <span className="text-axiom-zinc-500">({r.stats.bodyweight.change})</span></p>}
                    <ul className="divide-y divide-border rounded-xl border border-border">
                      {r.stats.measurements.map((m) => (
                        <li key={m.date} className="flex justify-between px-3 py-2 text-[13px] tabular-nums"><span className="text-axiom-zinc-600">{m.date}</span><span>{m.value}</span></li>
                      ))}
                    </ul>
                  </>
                )}
              </section>
            </div>
            <ReportPreview report={r} clientId={clientId} month={month} />
          </div>
        )}
    </>
  );
}

function Progress({ me }: { me: MeResponse }) {
  const [tab, setTab] = useState<'roster' | 'report'>('roster');
  return (
    <Shell me={me} active="progress" title={COPY.progress.title}>
      <PageTitle>{COPY.progress.title}</PageTitle>
      <div className="mb-6">
        <SegmentedControl label={COPY.progress.title} value={tab} onChange={setTab} options={[{ value: 'roster', label: COPY.progress.roster }, { value: 'report', label: COPY.progress.report }]} />
      </div>
      {tab === 'roster' ? <RosterTab /> : <ReportTab />}
    </Shell>
  );
}

export default function ProgressPage() {
  return <Gate>{(me) => <Progress me={me} />}</Gate>;
}
