// The dossier's Health tab: the client's injuries and conditions as the rules
// engine enforces them. Each record shows what it refuses, so the trainer can
// see the effect of a clearance. Readings of the client's own words come in
// as "Needs your review" and are confirmed, never silently accepted. Below,
// "Check exercises" asks the engine about a list without saving anything.

import { useState } from 'react';
import {
  COPY, shortDate,
  type BodyPartMeta, type Clearance, type Contraindication, type ContraindicationInput, type GuardrailReport,
} from '@axiom/personal-training-core';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { PCOPY } from '../copyPlatform';
import { clearanceOf, groupContraindications, isInferred, patternLabel, refusalsFor } from '../platform';
import { useCheckGuardrails, useContraindicationActions, useContraindicationMeta, useContraindications } from '../platformHooks';
import { errorText, selectClass } from './ChipInput';
import { Eyebrow, Notice, Pill, SegmentedControl, SkeletonBlock } from './primitives';

const H = PCOPY.health;
const CLEARANCES: Clearance[] = ['not_cleared', 'modified', 'cleared'];
const SEVERITIES = ['mild', 'moderate', 'severe'] as const;
const SIDES = ['none', 'left', 'right', 'both'] as const;
const CLEARANCE_TONE = { not_cleared: 'red', modified: 'amber', cleared: 'green' } as const;

const Loading = () => <div aria-busy="true" className="space-y-3"><SkeletonBlock className="h-20 w-full" /><SkeletonBlock className="h-20 w-full" /></div>;

const listPatterns = (keys: string[]) => keys.map(patternLabel).join(', ');

/** What a record refuses and warns on, in words. */
function Effect({ c, meta }: { c: Parameters<typeof refusalsFor>[0]; meta: BodyPartMeta | undefined }) {
  const { refused, warned } = refusalsFor(c, meta);
  if (refused.length === 0 && warned.length === 0) return <p className="text-xs text-axiom-zinc-500">{H.nothingRefused}</p>;
  return (
    <dl className="space-y-0.5 text-xs leading-relaxed">
      {refused.length > 0 && <div className="flex gap-1.5"><dt className="shrink-0 font-semibold text-axiom-destructive-ink">{H.refuses}</dt><dd className="text-axiom-zinc-600">{listPatterns(refused)}</dd></div>}
      {warned.length > 0 && <div className="flex gap-1.5"><dt className="shrink-0 font-semibold text-axiom-warning-ink">{H.warns}</dt><dd className="text-axiom-zinc-600">{listPatterns(warned)}</dd></div>}
    </dl>
  );
}

// ── Editor ───────────────────────────────────────────────────────────────────

type Mode = 'add' | 'edit' | 'confirm';
interface Form {
  bodyPart: string; side: (typeof SIDES)[number]; condition: string; severity: (typeof SEVERITIES)[number]; clearance: Clearance;
  onsetDate: string; notes: string; extraBlocks: string[]; allow: string[];
}

export function formFrom(c: Contraindication | null): Form {
  return {
    // An inferred reading may not have found a body part; the trainer must choose one.
    bodyPart: c?.bodyPart && c.bodyPart !== 'unknown' ? c.bodyPart : '',
    side: c?.side ?? 'none',
    condition: c?.label ?? '',
    severity: c?.severity ?? 'moderate',
    clearance: c ? clearanceOf(c) : 'not_cleared',
    onsetDate: c?.onsetDate ?? '',
    notes: c?.note ?? '',
    extraBlocks: c?.extraBlocks ?? [],
    allow: c?.allow ?? [],
  };
}

export function inputFrom(f: Form, mode: Mode, source?: Contraindication): ContraindicationInput {
  return {
    bodyPart: f.bodyPart,
    side: f.side === 'none' ? null : f.side,
    condition: f.condition.trim(),
    severity: f.severity,
    clearance: f.clearance,
    onsetDate: f.onsetDate || null,
    notes: f.notes.trim() || null,
    extraBlocks: f.extraBlocks,
    allow: f.allow,
    ...(mode === 'confirm' && source?.id ? { fromInferred: source.id } : {}),
  };
}

function PatternPicker({ legend, help, patterns, value, onChange, name }: {
  legend: string; help?: string; patterns: string[]; value: string[]; onChange: (v: string[]) => void; name: string;
}) {
  return (
    <fieldset>
      <legend className="text-[13px] font-semibold">{legend}</legend>
      {help && <p className="text-xs text-axiom-zinc-500">{help}</p>}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {patterns.map((p) => {
          const on = value.includes(p);
          return (
            <label key={p} className="cursor-pointer">
              <input
                type="checkbox" name={name} className="peer sr-only" checked={on}
                onChange={() => onChange(on ? value.filter((v) => v !== p) : [...value, p])}
              />
              <span className={cn(
                'inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-semibold transition-colors duration-200',
                'peer-focus-visible:ring-4 peer-focus-visible:ring-ring/15',
                on ? 'border-foreground bg-foreground text-background' : 'border-border text-axiom-zinc-600 hover:bg-axiom-zinc-50',
              )}>
                {patternLabel(p)}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function Editor({ clientId, mode, source, bodyParts, patterns, open, onOpenChange }: {
  clientId: string; mode: Mode; source: Contraindication | null; bodyParts: BodyPartMeta[]; patterns: string[];
  open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const [form, setForm] = useState<Form>(() => formFrom(source));
  const { add, update } = useContraindicationActions(clientId);
  const save = mode === 'edit' ? update : add;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const meta = bodyParts.find((b) => b.key === form.bodyPart);
  const valid = !!form.bodyPart && !!form.condition.trim();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    const input = inputFrom(form, mode, source ?? undefined);
    const done = { onSuccess: () => onOpenChange(false) };
    if (mode === 'edit' && source?.id) update.mutate({ cid: source.id, input }, done);
    else add.mutate(input, done);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-[17px] font-semibold tracking-[-0.01em]">{H.editorTitle[mode]}</DialogTitle>
          {mode === 'confirm' && <DialogDescription className="text-sm leading-relaxed text-axiom-zinc-600">{H.confirmHelp}</DialogDescription>}
          {mode !== 'confirm' && <DialogDescription className="sr-only">{H.intro}</DialogDescription>}
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="pt-ci-condition">{H.condition}</Label>
            <Input id="pt-ci-condition" required maxLength={200} value={form.condition} placeholder={H.conditionPlaceholder} onChange={(e) => set('condition', e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="pt-ci-part">{H.bodyPart}</Label>
              <select id="pt-ci-part" required className={selectClass} value={form.bodyPart} onChange={(e) => set('bodyPart', e.target.value)}>
                <option value="">{H.choosePart}</option>
                {bodyParts.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pt-ci-side">{H.sideLabel}</Label>
              <select id="pt-ci-side" className={selectClass} value={form.side} onChange={(e) => set('side', e.target.value as Form['side'])}>
                {SIDES.map((s) => <option key={s} value={s}>{H.side[s]}</option>)}
              </select>
            </div>
          </div>
          {meta && <p className="text-xs leading-relaxed text-axiom-zinc-500">{H.defaultEffect(meta.label.toLowerCase())} {listPatterns([...meta.primary, ...meta.secondary]).toLowerCase()}.</p>}

          <div className="space-y-2">
            <p className="text-[13px] font-semibold">{H.clearanceLabel}</p>
            <SegmentedControl label={H.clearanceLabel} value={form.clearance} onChange={(v) => set('clearance', v)} options={CLEARANCES.map((c) => ({ value: c, label: H.clearance[c] }))} />
            <p className="text-xs text-axiom-zinc-500">{H.clearanceHelp[form.clearance]}</p>
          </div>
          <div className="space-y-2">
            <p className="text-[13px] font-semibold">{H.severityLabel}</p>
            <SegmentedControl label={H.severityLabel} value={form.severity} onChange={(v) => set('severity', v)} options={SEVERITIES.map((s) => ({ value: s, label: H.severity[s] }))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pt-ci-onset">{H.onset}</Label>
            <Input id="pt-ci-onset" type="date" value={form.onsetDate} onChange={(e) => set('onsetDate', e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pt-ci-notes">{H.notes}</Label>
            <Textarea id="pt-ci-notes" rows={3} maxLength={1000} value={form.notes} onChange={(e) => set('notes', e.target.value)} className="rounded-xl text-sm" />
          </div>

          <details className="rounded-xl border border-border px-4 py-3" open={form.extraBlocks.length > 0 || form.allow.length > 0}>
            <summary className="cursor-pointer text-[13px] font-semibold">{H.advanced}</summary>
            <div className="mt-3 space-y-4">
              <PatternPicker name="extraBlocks" legend={H.extraBlocks} patterns={patterns} value={form.extraBlocks} onChange={(v) => set('extraBlocks', v)} />
              <PatternPicker name="allow" legend={H.allow} help={H.allowHelp} patterns={patterns} value={form.allow} onChange={(v) => set('allow', v)} />
            </div>
          </details>

          <div className="rounded-xl bg-axiom-zinc-50 px-4 py-3">
            <Eyebrow className="mb-1">{H.effect}</Eyebrow>
            <Effect c={{ ...form, bodyPart: (form.bodyPart || 'unknown') as Contraindication['bodyPart'], active: true }} meta={meta} />
          </div>

          {save.isError && <p role="alert" className="text-sm text-axiom-destructive-ink">{errorText(save.error, H.failed)}</p>}
          <Button type="submit" className="h-10 w-full rounded-xl" disabled={!valid || save.isPending}>{mode === 'confirm' ? H.confirm : H.save}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── List ─────────────────────────────────────────────────────────────────────

function Row({ c, meta, onEdit, clientId }: { c: Contraindication; meta: BodyPartMeta | undefined; onEdit: (mode: Mode, c: Contraindication) => void; clientId: string }) {
  const { archive } = useContraindicationActions(clientId);
  const inferred = isInferred(c);
  const clearance = clearanceOf(c);
  const part = c.bodyPart && c.bodyPart !== 'unknown' ? meta?.label ?? patternLabel(c.bodyPart) : H.unknownPart;
  const facts = [
    [c.side ? H.side[c.side] : null, part].filter(Boolean).join(' '),
    c.severity ? H.severity[c.severity] : null,
    c.source ? H.source[c.source] : null,
    c.onsetDate ? H.since(shortDate(new Date(`${c.onsetDate}T12:00:00`))) : null,
  ].filter(Boolean).join(' · ');

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="min-w-0 break-words text-[13px] font-semibold">{c.label}</p>
        <Pill tone={c.active ? CLEARANCE_TONE[clearance] : 'zinc'}>{c.active ? H.clearance[clearance] : COPY.timeline.cleared}</Pill>
        {c.needsReview && <Pill tone="amber">{H.review}</Pill>}
      </div>
      <p className={cn('mt-0.5 text-xs', c.bodyPart === 'unknown' ? 'text-axiom-warning-ink' : 'text-axiom-zinc-500')}>{facts}</p>
      {c.note && <p className="mt-1 whitespace-pre-line break-words text-sm leading-relaxed text-axiom-zinc-600">{c.note}</p>}
      {inferred && <p className="mt-1 text-xs text-axiom-zinc-500">{H.reviewHelp}</p>}
      <div className="mt-2"><Effect c={c} meta={meta} /></div>
      <div className="mt-2 flex flex-wrap gap-1">
        {inferred ? (
          <Button className="h-9 rounded-xl" onClick={() => onEdit('confirm', c)}>{H.confirm}</Button>
        ) : (
          <>
            <Button variant="ghost" className="h-9 rounded-lg px-2 text-xs text-axiom-zinc-600" onClick={() => onEdit('edit', c)}>{H.edit}</Button>
            <Button
              variant="ghost" className="h-9 rounded-lg px-2 text-xs text-axiom-zinc-600" disabled={archive.isPending}
              onClick={() => { if (c.id && window.confirm(H.archiveConfirm)) archive.mutate(c.id); }}
            >
              {H.archive}
            </Button>
          </>
        )}
      </div>
      {archive.isError && <p role="alert" className="mt-1 text-xs text-axiom-destructive-ink">{errorText(archive.error, H.failed)}</p>}
    </li>
  );
}

// ── Check exercises ──────────────────────────────────────────────────────────

function ReportView({ report }: { report: GuardrailReport }) {
  const blocks = report.violations.filter((v) => v.level === 'block');
  const warns = report.violations.filter((v) => v.level === 'warn');
  const section = (title: string, tone: 'red' | 'amber' | 'zinc', rows: { key: string; head: string; body?: string }[]) => rows.length > 0 && (
    <section aria-label={title}>
      <Pill tone={tone} className="mb-2">{title} · {rows.length}</Pill>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {rows.map((r) => (
          <li key={r.key} className="px-3 py-2">
            <p className="text-[13px] font-semibold">{r.head}</p>
            {r.body && <p className="text-xs leading-relaxed text-axiom-zinc-600">{r.body}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
  return (
    <div className="space-y-4" aria-live="polite">
      {report.ok && report.unclassified.length === 0 && <p role="status" className="text-sm text-axiom-success-ink">{H.allClear(report.label)}</p>}
      {section(H.blocked, 'red', blocks.map((v, i) => ({ key: `b${i}`, head: v.exercise, body: v.reason })))}
      {section(H.warned, 'amber', warns.map((v, i) => ({ key: `w${i}`, head: v.exercise, body: v.reason })))}
      {report.unclassified.length > 0 && (
        <div>
          {section(H.unclassified, 'zinc', report.unclassified.map((e) => ({ key: e, head: e })))}
          <p className="mt-1 text-xs text-axiom-zinc-500">{H.unclassifiedHelp}</p>
        </div>
      )}
      {report.unclassifiedConditions.length > 0 && section(H.unclassifiedConditions, 'zinc', report.unclassifiedConditions.map((c) => ({ key: c, head: c })))}
    </div>
  );
}

function CheckExercises({ clientId }: { clientId: string }) {
  const [text, setText] = useState('');
  const check = useCheckGuardrails(clientId);
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  return (
    <section aria-labelledby="pt-check-title" className="rounded-2xl border border-border p-5">
      <h2 id="pt-check-title" className="text-[15px] font-semibold tracking-[-0.01em]">{H.checkTitle}</h2>
      <p className="mt-0.5 text-xs text-axiom-zinc-500">{H.checkHelp}</p>
      <form className="mt-3 space-y-3" onSubmit={(e) => { e.preventDefault(); if (lines.length) check.mutate(lines); }}>
        <Textarea aria-label={H.checkTitle} rows={5} value={text} placeholder={H.checkPlaceholder} onChange={(e) => setText(e.target.value)} className="rounded-xl text-sm" />
        <Button type="submit" variant="secondary" className="h-10 rounded-xl" disabled={lines.length === 0 || check.isPending}>{H.checkSubmit}</Button>
      </form>
      {check.isError && <p role="alert" className="mt-3 text-sm text-axiom-destructive-ink">{errorText(check.error, H.checkFailed)}</p>}
      {check.data && <div className="mt-4"><ReportView report={check.data.report} /></div>}
    </section>
  );
}

// ── Tab ──────────────────────────────────────────────────────────────────────

export function HealthTab({ clientId }: { clientId: string }) {
  const list = useContraindications(clientId);
  const meta = useContraindicationMeta();
  const [editing, setEditing] = useState<{ mode: Mode; c: Contraindication | null; key: number } | null>(null);
  const bodyParts = meta.data?.bodyParts ?? [];
  const metaFor = (c: Contraindication) => bodyParts.find((b) => b.key === c.bodyPart);
  const open = (mode: Mode, c: Contraindication | null) => setEditing({ mode, c, key: Date.now() });

  const failed = list.isError || meta.isError;
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="text-sm leading-relaxed text-axiom-zinc-600 sm:max-w-[60ch]">{H.intro}</p>
        <Button className="h-11 shrink-0 rounded-xl md:h-10" disabled={!meta.data} onClick={() => open('add', null)}>{H.add}</Button>
      </div>

      {list.isPending || meta.isPending ? <Loading />
        : failed ? (
          <Notice alert action={<Button variant="secondary" className="h-10 rounded-xl" onClick={() => { void list.refetch(); void meta.refetch(); }}>{COPY.roster.retry}</Button>}>{H.loadFailed}</Notice>
        ) : list.data.contraindications.length === 0 ? <Notice>{H.empty}</Notice>
        : groupContraindications(list.data.contraindications).map(({ group, items }) => (
          <section key={group} aria-label={H.groups[group]}>
            <Eyebrow className="mb-2">{H.groups[group]} · {items.length}</Eyebrow>
            <ul className="divide-y divide-border rounded-2xl border border-border">
              {items.map((c) => <Row key={c.id ?? c.label} c={c} meta={metaFor(c)} clientId={clientId} onEdit={open} />)}
            </ul>
          </section>
        ))}

      <CheckExercises clientId={clientId} />

      {editing && meta.data && (
        <Editor
          key={editing.key}
          clientId={clientId} mode={editing.mode} source={editing.c} bodyParts={bodyParts} patterns={meta.data.patterns}
          open onOpenChange={(o) => { if (!o) setEditing(null); }}
        />
      )}
    </div>
  );
}
