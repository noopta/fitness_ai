// Import clients from a spreadsheet. The file is read in the browser, Axiom
// proposes how each sheet is laid out, and the trainer checks what was found
// — and corrects the layout if it was read wrongly — before anything is
// imported. An import can be undone as a whole afterwards.

import { useRef, useState } from 'react';
import { Link } from 'wouter';
import { ChevronRight, FileSpreadsheet } from 'lucide-react';
import {
  COPY, PersonalTrainingApiError, shortDate,
  type ImportField, type ImportPreview, type ImportSheetKind, type ImportSheetPreview, type ImportSummary, type MeResponse, type SheetMapping,
} from '@axiom/personal-training-core';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Gate } from '../components/Gate';
import { Eyebrow, PageTitle, Pill, SkeletonBlock } from '../components/primitives';
import { Shell } from '../components/Shell';
import { useImportActions, useImports } from '../hooks';
import { readSpreadsheet, SpreadsheetError } from '../spreadsheet';

const selectClass = 'h-10 w-full rounded-xl border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15';

const FIELDS: Record<ImportSheetKind, ImportField[]> = {
  clients: ['client', 'email', 'phone', 'goal', 'injuries', 'notes', 'bodyweight'],
  workouts: ['client', 'date', 'exercise', 'sets', 'reps', 'weight', 'rpe', 'sessionTitle', 'notes'],
  bodyweight: ['client', 'date', 'bodyweight'],
  ignore: [],
};

const columnLetter = (i: number) => (i >= 26 ? String.fromCharCode(64 + Math.floor(i / 26)) : '') + String.fromCharCode(65 + (i % 26));
const day = (iso: string) => shortDate(new Date(`${iso.slice(0, 10)}T12:00:00`));
const errorText = (err: unknown) => (err instanceof PersonalTrainingApiError && err.status < 500 ? err.message : COPY.import.failed);

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-border p-4">
      <p className="text-[22px] font-bold leading-tight tracking-[-0.02em] tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs text-axiom-zinc-500">{label}</p>
    </div>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs font-semibold text-axiom-zinc-600">{label}</span>
      {children}
    </label>
  );
}

/** One sheet's layout: what it holds, where the headers are, and which column is which. */
function SheetEditor({ sheet, mapping, onChange }: { sheet: ImportSheetPreview; mapping: SheetMapping; onChange: (next: SheetMapping) => void }) {
  const width = Math.max(1, ...sheet.sample.map((r) => r.length));
  const header = sheet.sample[mapping.headerRow] ?? [];
  const set = (patch: Partial<SheetMapping>) => onChange({ ...mapping, ...patch });
  const setColumn = (field: ImportField, value: string) => {
    const columns = { ...mapping.columns };
    if (value === '') delete columns[field];
    else {
      // A column can only mean one thing; taking it for this field releases it from any other.
      for (const f of Object.keys(columns) as ImportField[]) if (columns[f] === Number(value)) delete columns[f];
      columns[field] = Number(value);
    }
    set({ columns });
  };
  const mapped = new Map(Object.entries(mapping.columns).map(([f, i]) => [i as number, f as ImportField]));

  return (
    <section aria-label={sheet.name} className="rounded-2xl border border-border p-4 md:p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-semibold tracking-[-0.01em]">{sheet.name}</h3>
        <p className="text-xs text-axiom-zinc-500 tabular-nums">{sheet.rowCount} rows</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Labelled label={COPY.import.kind}>
          <select className={selectClass} value={mapping.kind} onChange={(e) => set({ kind: e.target.value as ImportSheetKind })}>
            {(['workouts', 'bodyweight', 'clients', 'ignore'] as ImportSheetKind[]).map((k) => <option key={k} value={k}>{COPY.import.kinds[k]}</option>)}
          </select>
        </Labelled>
        {mapping.kind !== 'ignore' && (
          <>
            <Labelled label={COPY.import.headerRow}>
              <select className={selectClass} value={mapping.headerRow} onChange={(e) => set({ headerRow: Number(e.target.value) })}>
                {sheet.sample.slice(0, 12).map((r, i) => (
                  <option key={i} value={i}>{`${i + 1}: ${r.filter(Boolean).slice(0, 4).join(', ').slice(0, 60) || '—'}`}</option>
                ))}
              </select>
            </Labelled>
            {mapping.kind !== 'clients' && (
              <Labelled label={COPY.import.clientFrom}>
                <select className={selectClass} value={mapping.clientFrom} onChange={(e) => set({ clientFrom: e.target.value as SheetMapping['clientFrom'] })}>
                  <option value="column">{COPY.import.clientFromOptions.column}</option>
                  <option value="sheetName">{`${COPY.import.clientFromOptions.sheetName} (${sheet.name})`}</option>
                </select>
              </Labelled>
            )}
            <Labelled label={COPY.import.unit}>
              <select className={selectClass} value={mapping.unit} onChange={(e) => set({ unit: e.target.value as SheetMapping['unit'] })}>
                <option value="kg">{COPY.import.units.kg}</option>
                <option value="lb">{COPY.import.units.lb}</option>
              </select>
            </Labelled>
            {mapping.kind !== 'clients' && (
              <Labelled label={COPY.import.dateOrder}>
                <select className={selectClass} value={mapping.dateOrder} onChange={(e) => set({ dateOrder: e.target.value as SheetMapping['dateOrder'] })}>
                  {(['dmy', 'mdy', 'ymd'] as const).map((o) => <option key={o} value={o}>{COPY.import.dateOrders[o]}</option>)}
                </select>
              </Labelled>
            )}
          </>
        )}
      </div>

      {mapping.kind !== 'ignore' && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FIELDS[mapping.kind].filter((f) => !(f === 'client' && mapping.clientFrom === 'sheetName' && mapping.kind !== 'clients')).map((f) => (
            <Labelled key={f} label={COPY.import.fields[f]}>
              <select className={selectClass} value={mapping.columns[f] ?? ''} onChange={(e) => setColumn(f, e.target.value)}>
                <option value="">{COPY.import.notInSheet}</option>
                {Array.from({ length: width }, (_, i) => (
                  <option key={i} value={i}>{`${columnLetter(i)}${header[i] ? ` · ${header[i].slice(0, 40)}` : ''}`}</option>
                ))}
              </select>
            </Labelled>
          ))}
        </div>
      )}

      <div className="mt-4">
        <Eyebrow className="mb-2">{COPY.import.sheetSample}</Eyebrow>
        {/* Scrolls inside its own box so a wide sheet cannot widen the page. */}
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full border-collapse text-xs">
            <thead className="bg-axiom-zinc-50">
              <tr>
                <th scope="col" className="w-8 px-2 py-1.5 text-left font-semibold text-axiom-zinc-500"><span className="sr-only">Row</span></th>
                {Array.from({ length: width }, (_, i) => (
                  <th key={i} scope="col" className="whitespace-nowrap px-2 py-1.5 text-left font-semibold text-axiom-zinc-500">
                    {columnLetter(i)}{mapping.kind !== 'ignore' && mapped.has(i) ? ` · ${COPY.import.fields[mapped.get(i)!]}` : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sheet.sample.slice(0, 8).map((r, i) => (
                <tr key={i} className={cn('border-t border-border', i === mapping.headerRow && mapping.kind !== 'ignore' && 'bg-axiom-zinc-50 font-semibold')}>
                  <td className="px-2 py-1.5 tabular-nums text-axiom-zinc-500">{i + 1}</td>
                  {Array.from({ length: width }, (_, j) => <td key={j} className="max-w-[180px] truncate whitespace-nowrap px-2 py-1.5 text-axiom-zinc-600">{r[j] ?? ''}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Review({ preview, onPreview, onDone, onCancel }: {
  preview: ImportPreview; onPreview: (p: ImportPreview) => void; onDone: (s: ImportSummary) => void; onCancel: () => void;
}) {
  const { remap, confirm } = useImportActions();
  const [mappings, setMappings] = useState<SheetMapping[]>(() => preview.sheets.map((s) => s.mapping));
  const dirty = JSON.stringify(mappings) !== JSON.stringify(preview.sheets.map((s) => s.mapping));
  const { summary } = preview;
  const nothing = summary.clients === 0;
  const newClients = preview.clients.filter((c) => !c.matchesExisting).length;
  const th = 'whitespace-nowrap px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-[0.12em] text-axiom-zinc-500';

  const apply = () => remap.mutate({ id: preview.id, mappings }, { onSuccess: (p) => { onPreview(p); setMappings(p.sheets.map((s) => s.mapping)); } });

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-[22px] font-bold leading-tight tracking-[-0.02em]">{COPY.import.review}</h2>
        <p className="mt-1 text-sm text-axiom-zinc-600">
          <span className="font-semibold text-foreground">{preview.fileName}</span> · {nothing ? COPY.import.nothing : COPY.import.found(summary.clients, summary.workouts, summary.bodyweights)}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={COPY.import.statClients} value={summary.clients} />
        <Stat label={COPY.import.statSessions} value={summary.workouts} />
        <Stat label={COPY.import.statWeights} value={summary.bodyweights} />
        <Stat label={COPY.import.statSkipped} value={summary.skippedRows} />
      </div>

      {(preview.assumptions.length > 0 || preview.warnings.length > 0) && (
        <div className="grid gap-4 md:grid-cols-2">
          {preview.assumptions.length > 0 && (
            <section className="rounded-2xl border border-border p-4">
              <Eyebrow className="mb-2">{COPY.import.assumptions}</Eyebrow>
              <ul className="space-y-1 text-sm leading-relaxed text-axiom-zinc-600">{preview.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
            </section>
          )}
          {preview.warnings.length > 0 && (
            <section className="rounded-2xl border border-border p-4">
              <Eyebrow className="mb-2">{COPY.import.warnings}</Eyebrow>
              <ul className="space-y-1 text-sm leading-relaxed text-axiom-zinc-600">{preview.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </section>
          )}
        </div>
      )}

      {preview.clients.length > 0 && (
        <section aria-label={COPY.import.clients}>
          <Eyebrow className="mb-1">{COPY.import.clients}</Eyebrow>
          <p className="mb-3 text-sm text-axiom-zinc-600">{COPY.import.notJoinedHelp}</p>
          <div className="overflow-x-auto rounded-2xl border border-border">
            <table className="w-full min-w-[640px] border-collapse">
              <thead className="bg-axiom-zinc-50">
                <tr>
                  <th scope="col" className={th}>{COPY.import.columns.client}</th>
                  <th scope="col" className={th}>{COPY.import.columns.sessions}</th>
                  <th scope="col" className={th}>{COPY.import.columns.range}</th>
                  <th scope="col" className={th}>{COPY.import.columns.weights}</th>
                </tr>
              </thead>
              <tbody>
                {preview.clients.map((c) => (
                  <tr key={c.key} className="border-t border-border align-top">
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="text-[13px] font-semibold">{c.name}</p>
                        {c.matchesExisting && <span title={COPY.import.alreadyClientHelp}><Pill tone="green">{COPY.import.alreadyClient}</Pill></span>}
                      </div>
                      <p className="text-xs text-axiom-zinc-500">{c.email ?? COPY.import.noEmail}</p>
                      {c.sample.length > 0 && (
                        <details className="mt-1 text-xs text-axiom-zinc-600">
                          <summary className="cursor-pointer rounded font-semibold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15">{COPY.import.latest}</summary>
                          <ul className="mt-1 space-y-0.5">
                            {c.sample.map((s) => <li key={`${s.date}${s.summary}`}><span className="tabular-nums text-axiom-zinc-500">{day(s.date)}</span> · {s.summary}</li>)}
                          </ul>
                        </details>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[13px] tabular-nums">{c.workouts}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-[13px] tabular-nums text-axiom-zinc-600">
                      {c.firstDate && c.lastDate ? (c.firstDate === c.lastDate ? day(c.firstDate) : `${day(c.firstDate)} – ${day(c.lastDate)}`) : '—'}
                    </td>
                    <td className="px-4 py-3 text-[13px] tabular-nums">{c.bodyweights}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section aria-label={COPY.import.sheets}>
        <Eyebrow className="mb-1">{COPY.import.sheets}</Eyebrow>
        <p className="mb-3 text-sm text-axiom-zinc-600">{COPY.import.sheetsHelp}</p>
        <div className="space-y-4">
          {preview.sheets.map((s, i) => (
            <SheetEditor key={s.name} sheet={s} mapping={mappings[i]} onChange={(next) => setMappings((prev) => prev.map((m, j) => (j === i ? next : m)))} />
          ))}
        </div>
      </section>

      {(remap.isError || confirm.isError) && <p role="alert" className="text-sm text-axiom-destructive-ink">{errorText(remap.error ?? confirm.error)}</p>}

      <div className="sticky bottom-16 z-10 -mx-4 flex flex-wrap items-center gap-2 border-t border-border bg-background px-4 py-3 md:bottom-0 md:mx-0 md:px-0">
        {dirty ? (
          <Button className="h-11 rounded-xl md:h-10" disabled={remap.isPending} onClick={apply}>{COPY.import.apply}</Button>
        ) : (
          <Button className="h-11 rounded-xl md:h-10" disabled={nothing || confirm.isPending} onClick={() => confirm.mutate(preview.id, { onSuccess: (r) => onDone(r.import) })}>
            {COPY.import.confirm(summary.clients)}
          </Button>
        )}
        <Button variant="secondary" className="h-11 rounded-xl md:h-10" onClick={onCancel}>{COPY.import.cancel}</Button>
        {!dirty && !nothing && newClients > 0 && <p className="text-xs text-axiom-zinc-500">{COPY.import.willAdd(newClients)}</p>}
      </div>
    </div>
  );
}

function PastImports() {
  const imports = useImports();
  const { undo } = useImportActions();
  const [confirming, setConfirming] = useState<string | null>(null);
  const past = (imports.data?.imports ?? []).filter((i) => i.status !== 'review');
  if (imports.isPending) return <SkeletonBlock className="mt-8 h-16 w-full" />;
  if (past.length === 0) return null;

  return (
    <section aria-label={COPY.import.past} className="mt-10">
      <Eyebrow className="mb-3">{COPY.import.past}</Eyebrow>
      <ul className="divide-y divide-border rounded-2xl border border-border">
        {past.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold">{i.fileName}</p>
              <p className="text-xs text-axiom-zinc-500">
                {COPY.import.counts(i.clients, i.workouts)} · {i.importedAt ? COPY.import.importedOn(shortDate(new Date(i.importedAt))) : COPY.import.notImported}
              </p>
            </div>
            {i.status === 'undone' ? (
              <Pill tone="zinc">{COPY.import.pastUndone}</Pill>
            ) : confirming === i.id ? (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs text-axiom-zinc-600">{COPY.import.undoConfirm}</p>
                <Button variant="destructive" className="h-9 rounded-xl px-3 text-[13px]" disabled={undo.isPending} onClick={() => undo.mutate(i.id, { onSettled: () => setConfirming(null) })}>{COPY.import.undo}</Button>
              </div>
            ) : (
              <Button variant="secondary" className="h-9 rounded-xl px-3 text-[13px]" onClick={() => setConfirming(i.id)}>{COPY.import.undo}</Button>
            )}
          </li>
        ))}
      </ul>
      {undo.isError && <p role="alert" className="mt-2 text-sm text-axiom-destructive-ink">{errorText(undo.error)}</p>}
    </section>
  );
}

type Stage = { at: 'pick' } | { at: 'reading'; label: string } | { at: 'review'; preview: ImportPreview } | { at: 'done'; result: ImportSummary };

function Import({ me }: { me: MeResponse }) {
  const [stage, setStage] = useState<Stage>({ at: 'pick' });
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { create } = useImportActions();

  async function take(file: File | undefined) {
    if (!file) return;
    setProblem(null);
    setStage({ at: 'reading', label: COPY.import.reading });
    try {
      const upload = await readSpreadsheet(file);
      setStage({ at: 'reading', label: COPY.import.working });
      setStage({ at: 'review', preview: await create.mutateAsync(upload) });
    } catch (err) {
      setProblem(err instanceof SpreadsheetError ? COPY.import[err.problem] : errorText(err));
      setStage({ at: 'pick' });
    } finally {
      if (input.current) input.current.value = '';
    }
  }

  return (
    <Shell me={me} active="clients" title={COPY.import.title}>
      <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1 text-xs text-axiom-zinc-500">
        <Link href="/personal-training/clients" className="rounded font-semibold hover:text-foreground focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15">{COPY.timeline.breadcrumb}</Link>
        <ChevronRight className="size-3" aria-hidden />
        <span aria-current="page">{COPY.import.title}</span>
      </nav>

      {stage.at === 'review' ? (
        <Review
          key={stage.preview.id}
          preview={stage.preview}
          onPreview={(preview) => setStage({ at: 'review', preview })}
          onDone={(result) => setStage({ at: 'done', result })}
          onCancel={() => setStage({ at: 'pick' })}
        />
      ) : stage.at === 'done' ? (
        <div>
          <div role="status" className="rounded-2xl border border-border p-8 text-center">
            <p className="text-[17px] font-semibold tracking-[-0.01em]">{COPY.import.done(stage.result.clients, stage.result.workouts)}</p>
            <p className="mt-1 text-sm text-axiom-zinc-600">{COPY.import.doneHelp}</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button asChild className="h-11 rounded-xl md:h-10"><Link href="/personal-training/clients">{COPY.import.viewRoster}</Link></Button>
              <Button variant="secondary" className="h-11 rounded-xl md:h-10" onClick={() => setStage({ at: 'pick' })}>{COPY.import.choose}</Button>
            </div>
          </div>
          <PastImports />
        </div>
      ) : (
        <>
          <PageTitle sub={COPY.import.intro}>{COPY.import.title}</PageTitle>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); void take(e.dataTransfer.files[0]); }}
            className={cn('rounded-2xl border border-dashed border-border p-10 text-center transition-colors duration-200', dragging && 'bg-axiom-zinc-50')}
          >
            {stage.at === 'reading' ? (
              <p role="status" aria-busy="true" className="text-sm font-semibold motion-safe:animate-[pt-pulse_1.6s_ease-in-out_infinite]">{stage.label}</p>
            ) : (
              <>
                <FileSpreadsheet aria-hidden className="mx-auto mb-3 size-6 text-axiom-zinc-500" />
                <input
                  ref={input}
                  id="pt-import-file"
                  type="file"
                  className="sr-only"
                  accept=".xlsx,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                  aria-label={COPY.import.choose}
                  onChange={(e) => void take(e.target.files?.[0])}
                />
                <Button className="h-11 rounded-xl md:h-10" onClick={() => input.current?.click()}>{COPY.import.choose}</Button>
                <p className="mt-2 hidden text-xs text-axiom-zinc-500 md:block">{COPY.import.drop}</p>
                <p className="mt-3 text-xs text-axiom-zinc-500">{COPY.import.formats}</p>
              </>
            )}
          </div>
          {problem && <p role="alert" className="mt-3 text-sm text-axiom-destructive-ink">{problem}</p>}
          <PastImports />
        </>
      )}
    </Shell>
  );
}

export default function ImportPage() {
  return <Gate>{(me) => <Import me={me} />}</Gate>;
}
