// The builder canvas: one week at a time, its days stacked, each day's blocks
// and their exercises. Everything edits through the document reducer in
// programDoc.ts. Reordering is native drag-and-drop on the grip handles, with
// up/down buttons beside every block and exercise as the keyboard path.
// Guardrail badges and "Why" notes come from the program's check and
// annotations; the canvas only reads them.

import { createContext, useContext, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, Copy, GripVertical, Plus, Trash2 } from 'lucide-react';
import type { BlockKind, GuardrailViolation, LoadType, ProgramAnnotation, ProgramBlock, ProgramCheck, ProgramDayDoc, ProgramDoc, ProgramItem } from '@axiom/personal-training-core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { PRG } from '../copyPrograms';
import {
  BLOCK_KINDS, LIMITS, LOAD_TYPES, WEEKDAYS, annotationsFor, issuesFor, violationsByItem, worstLevel, type DocAction,
} from '../programDoc';
import { selectClass } from './ChipInput';
import { ExercisePicker } from './ExercisePicker';
import { Pill } from './primitives';

const B = PRG.builder;
const C = PRG.check;
const iconBtn = 'size-9 shrink-0 rounded-lg p-0 text-axiom-zinc-500 hover:text-foreground';
const smallSelect = cn(selectClass, 'h-9 text-[13px]');

// ── Drag state ───────────────────────────────────────────────────────────────

type Dragging = { type: 'item' | 'block'; id: string } | null;
type DropMark = { id: string; pos: 'before' | 'after' | 'end' } | null;

interface Ctx {
  dispatch: (a: DocAction) => void;
  dragging: React.MutableRefObject<Dragging>;
  mark: DropMark;
  setMark: (m: DropMark) => void;
  violations: Map<string, GuardrailViolation[]>;
  check: ProgramCheck | null;
  annotations: ProgramAnnotation[];
}
const CanvasCtx = createContext<Ctx | null>(null);
const useCanvas = () => useContext(CanvasCtx)!;

/** Above or below the middle of the element under the pointer. */
const half = (e: React.DragEvent) => {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  return e.clientY < r.top + r.height / 2 ? 'before' : 'after';
};

function Grip({ type, id, rowRef }: { type: 'item' | 'block'; id: string; rowRef: React.RefObject<HTMLElement | null> }) {
  const { dragging, setMark } = useCanvas();
  return (
    <span
      draggable
      aria-hidden
      title={B.drag}
      onDragStart={(e) => {
        dragging.current = { type, id };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', id);
        if (rowRef.current) e.dataTransfer.setDragImage(rowRef.current, 16, 16);
      }}
      onDragEnd={() => { dragging.current = null; setMark(null); }}
      className="hidden cursor-grab touch-none text-axiom-zinc-400 hover:text-foreground active:cursor-grabbing md:inline-flex"
    >
      <GripVertical className="size-4" />
    </span>
  );
}

const DropLine = ({ show }: { show: boolean }) => (show ? <div aria-hidden className="my-1 h-0.5 rounded-full bg-foreground" /> : null);

// ── Annotations ──────────────────────────────────────────────────────────────

function Why({ target }: { target: string }) {
  const { annotations } = useCanvas();
  const notes = annotationsFor(annotations, target, 'rationale');
  if (notes.length === 0) return null;
  return (
    <details className="mt-1 text-xs">
      <summary className="cursor-pointer font-semibold text-axiom-zinc-600">{B.why}</summary>
      {notes.map((n, i) => <p key={i} className="mt-1 leading-relaxed text-axiom-zinc-600">{n.text}</p>)}
    </details>
  );
}

function Issues({ id }: { id: string }) {
  const { check } = useCanvas();
  const list = issuesFor(check, id);
  if (list.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5">
      {list.map((i, k) => (
        <li key={k} className={cn('text-xs', i.level === 'block' ? 'text-axiom-destructive-ink' : 'text-axiom-warning-ink')}>{i.text}</li>
      ))}
    </ul>
  );
}

// ── Item ─────────────────────────────────────────────────────────────────────

export function GuardrailBadge({ violations }: { violations: GuardrailViolation[] | undefined }) {
  const level = worstLevel(violations);
  if (!level) return null;
  return (
    <span title={violations!.map((v) => v.reason).join('\n')}>
      <Pill tone={level === 'block' ? 'red' : 'amber'}>{level === 'block' ? C.refusedBadge : C.warnBadge}</Pill>
    </span>
  );
}

function ItemRow({ item, block, index, first, last }: { item: ProgramItem; block: ProgramBlock; index: number; first: boolean; last: boolean }) {
  const { dispatch, dragging, mark, setMark, violations } = useCanvas();
  const [more, setMore] = useState(!!(item.tempo || item.notes));
  const ref = useRef<HTMLLIElement>(null);
  const vs = violations.get(item.id);
  const level = worstLevel(vs);
  const set = (patch: Partial<Omit<ProgramItem, 'id'>>) => dispatch({ type: 'updateItem', itemId: item.id, patch });
  const loadType: LoadType = item.load?.type ?? 'none';
  const name = item.name || B.exercise;
  const reasonId = `why-${item.id}`;

  return (
    <li
      ref={ref}
      onDragOver={(e) => { if (dragging.current?.type !== 'item') return; e.preventDefault(); e.stopPropagation(); setMark({ id: item.id, pos: half(e) }); }}
      onDrop={(e) => {
        if (dragging.current?.type !== 'item') return;
        e.preventDefault(); e.stopPropagation();
        dispatch({ type: 'moveItem', itemId: dragging.current.id, toBlockId: block.id, toIndex: half(e) === 'before' ? index : index + 1 });
        dragging.current = null; setMark(null);
      }}
    >
      <DropLine show={mark?.id === item.id && mark.pos === 'before'} />
      <div className={cn(
        'rounded-xl border bg-background p-3',
        level === 'block' ? 'border-axiom-destructive bg-axiom-destructive-soft/40' : level === 'warn' ? 'border-axiom-warning' : 'border-border',
      )}>
        <div className="flex items-start gap-2">
          <span className="pt-2.5"><Grip type="item" id={item.id} rowRef={ref} /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1 basis-48">
                <ExercisePickerSlot item={item} describedBy={vs ? reasonId : undefined} invalid={level === 'block'} />
              </div>
              <GuardrailBadge violations={vs} />
            </div>
            {vs && (
              <ul id={reasonId} className="mt-1 space-y-0.5">
                {vs.map((v, i) => <li key={i} className={cn('text-xs', v.level === 'block' ? 'text-axiom-destructive-ink' : 'text-axiom-warning-ink')}>{v.reason}</li>)}
              </ul>
            )}
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-[72px_88px_minmax(0,1fr)_80px_80px]">
              <div>
                <Label htmlFor={`sets-${item.id}`} className="text-[11px] text-axiom-zinc-500">{B.sets}</Label>
                <Input id={`sets-${item.id}`} type="number" inputMode="numeric" min={1} max={LIMITS.sets} value={item.sets}
                  onChange={(e) => set({ sets: Math.max(1, Math.min(LIMITS.sets, Number(e.target.value) || 1)) })} className="h-9 rounded-lg text-sm tabular-nums" />
              </div>
              <div>
                <Label htmlFor={`reps-${item.id}`} className="text-[11px] text-axiom-zinc-500">{B.reps}</Label>
                <Input id={`reps-${item.id}`} value={item.reps} maxLength={20} onChange={(e) => set({ reps: e.target.value })} className="h-9 rounded-lg text-sm" />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <Label htmlFor={`load-${item.id}`} className="text-[11px] text-axiom-zinc-500">{B.load}</Label>
                <div className="flex gap-1.5">
                  <select id={`load-${item.id}`} className={cn(smallSelect, 'min-w-0 flex-1')} value={loadType}
                    onChange={(e) => { const t = e.target.value as LoadType; set({ load: t === 'none' ? undefined : { type: t, ...(item.load?.value !== undefined && t !== 'bodyweight' ? { value: item.load.value } : {}) } }); }}>
                    {LOAD_TYPES.map((t) => <option key={t} value={t}>{PRG.loadTypes[t]}</option>)}
                  </select>
                  {loadType !== 'none' && loadType !== 'bodyweight' && (
                    <Input aria-label={`${B.loadValue} (${PRG.loadTypes[loadType]})`} type="number" inputMode="decimal" step="any" value={item.load?.value ?? ''}
                      onChange={(e) => set({ load: { type: loadType, ...(e.target.value === '' ? {} : { value: Number(e.target.value) }) } })} className="h-9 w-20 shrink-0 rounded-lg text-sm tabular-nums" />
                  )}
                </div>
              </div>
              <div>
                <Label htmlFor={`rest-${item.id}`} className="text-[11px] text-axiom-zinc-500">{B.rest}</Label>
                <Input id={`rest-${item.id}`} type="number" inputMode="numeric" min={0} max={900} value={item.restSec ?? ''}
                  onChange={(e) => set({ restSec: e.target.value === '' ? undefined : Math.max(0, Math.min(900, Number(e.target.value))) })} className="h-9 rounded-lg text-sm tabular-nums" />
              </div>
              <div className="flex items-end">
                <Button type="button" variant="ghost" className="h-9 w-full rounded-lg px-2 text-xs text-axiom-zinc-600" aria-expanded={more} onClick={() => setMore((m) => !m)}>
                  {B.more}<ChevronDown className={cn('size-3.5 transition-transform', more && 'rotate-180')} aria-hidden />
                </Button>
              </div>
            </div>
            {more && (
              <div className="mt-2 grid gap-2 sm:grid-cols-[100px_minmax(0,1fr)]">
                <div>
                  <Label htmlFor={`tempo-${item.id}`} className="text-[11px] text-axiom-zinc-500">{B.tempo}</Label>
                  <Input id={`tempo-${item.id}`} value={item.tempo ?? ''} maxLength={12} placeholder="3-1-1-0" onChange={(e) => set({ tempo: e.target.value || undefined })} className="h-9 rounded-lg text-sm" />
                </div>
                <div>
                  <Label htmlFor={`notes-${item.id}`} className="text-[11px] text-axiom-zinc-500">{B.notes}</Label>
                  <Input id={`notes-${item.id}`} value={item.notes ?? ''} maxLength={300} onChange={(e) => set({ notes: e.target.value || undefined })} className="h-9 rounded-lg text-sm" />
                </div>
              </div>
            )}
            <Issues id={item.id} />
            <Why target={item.id} />
          </div>
          <div className="flex shrink-0 flex-col">
            <Button type="button" variant="ghost" className={iconBtn} aria-label={`${B.moveUp}: ${name}`} disabled={first} onClick={() => dispatch({ type: 'nudgeItem', itemId: item.id, dir: -1 })}><ArrowUp aria-hidden /></Button>
            <Button type="button" variant="ghost" className={iconBtn} aria-label={`${B.moveDown}: ${name}`} disabled={last} onClick={() => dispatch({ type: 'nudgeItem', itemId: item.id, dir: 1 })}><ArrowDown aria-hidden /></Button>
            <Button type="button" variant="ghost" className={iconBtn} aria-label={`${B.deleteItem}: ${name}`} onClick={() => dispatch({ type: 'deleteItem', itemId: item.id })}><Trash2 aria-hidden /></Button>
          </div>
        </div>
      </div>
      <DropLine show={mark?.id === item.id && mark.pos === 'after'} />
    </li>
  );
}

function ExercisePickerSlot({ item, describedBy, invalid }: { item: ProgramItem; describedBy?: string; invalid?: boolean }) {
  const { dispatch } = useCanvas();
  return (
    <ExercisePicker
      label={B.exercise}
      value={item.name}
      invalid={invalid}
      describedBy={describedBy}
      onChange={({ name, exerciseId }) => dispatch({ type: 'updateItem', itemId: item.id, patch: { name, exerciseId } })}
    />
  );
}

// ── Block ────────────────────────────────────────────────────────────────────

function BlockCard({ block, day, index, count, firstItemGlobal, lastItemGlobal }: {
  block: ProgramBlock; day: ProgramDayDoc; index: number; count: number; firstItemGlobal: boolean; lastItemGlobal: boolean;
}) {
  const { dispatch, dragging, mark, setMark } = useCanvas();
  const ref = useRef<HTMLDivElement>(null);
  const kindLabel = PRG.blockKinds[block.kind];
  const label = `${kindLabel} ${String.fromCharCode(65 + index)}`;
  const grouped = block.kind !== 'single';

  return (
    <div
      onDragOver={(e) => { if (dragging.current?.type !== 'block') return; e.preventDefault(); setMark({ id: block.id, pos: half(e) }); }}
      onDrop={(e) => {
        if (dragging.current?.type !== 'block') return;
        e.preventDefault();
        dispatch({ type: 'moveBlock', blockId: dragging.current.id, toDayId: day.id, toIndex: half(e) === 'before' ? index : index + 1 });
        dragging.current = null; setMark(null);
      }}
    >
      <DropLine show={mark?.id === block.id && mark.pos === 'before'} />
      <section ref={ref} aria-label={label} className={cn('rounded-2xl p-3', grouped ? 'border border-dashed border-axiom-border-strong bg-axiom-zinc-50' : 'bg-axiom-zinc-50/60')}>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Grip type="block" id={block.id} rowRef={ref} />
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-axiom-zinc-500">{String.fromCharCode(65 + index)}</span>
          <select aria-label={`${B.blockKind}, ${label}`} className={cn(smallSelect, 'w-auto')} value={block.kind}
            onChange={(e) => dispatch({ type: 'updateBlock', blockId: block.id, patch: { kind: e.target.value as BlockKind } })}>
            {BLOCK_KINDS.map((k) => <option key={k} value={k}>{PRG.blockKinds[k]}</option>)}
          </select>
          {(block.kind === 'superset' || block.kind === 'circuit') && (
            <label className="flex items-center gap-1.5 text-xs text-axiom-zinc-600">
              {B.rounds}
              <Input type="number" min={1} max={20} value={block.rounds ?? ''} onChange={(e) => dispatch({ type: 'updateBlock', blockId: block.id, patch: { rounds: e.target.value === '' ? undefined : Math.max(1, Math.min(20, Number(e.target.value))) } })} className="h-9 w-16 rounded-lg text-sm tabular-nums" />
            </label>
          )}
          {(block.kind === 'amrap' || block.kind === 'emom') && (
            <label className="flex items-center gap-1.5 text-xs text-axiom-zinc-600">
              {B.timeCap}
              <Input type="number" min={1} max={90} value={block.timeCapMin ?? ''} onChange={(e) => dispatch({ type: 'updateBlock', blockId: block.id, patch: { timeCapMin: e.target.value === '' ? undefined : Math.max(1, Math.min(90, Number(e.target.value))) } })} className="h-9 w-16 rounded-lg text-sm tabular-nums" />
            </label>
          )}
          <div className="ml-auto flex">
            <Button type="button" variant="ghost" className={iconBtn} aria-label={`${B.moveUp}: ${label}`} disabled={index === 0} onClick={() => dispatch({ type: 'nudgeBlock', blockId: block.id, dir: -1 })}><ArrowUp aria-hidden /></Button>
            <Button type="button" variant="ghost" className={iconBtn} aria-label={`${B.moveDown}: ${label}`} disabled={index === count - 1} onClick={() => dispatch({ type: 'nudgeBlock', blockId: block.id, dir: 1 })}><ArrowDown aria-hidden /></Button>
            <Button type="button" variant="ghost" className={iconBtn} aria-label={`${B.deleteBlock}: ${label}`} onClick={() => dispatch({ type: 'deleteBlock', blockId: block.id })}><Trash2 aria-hidden /></Button>
          </div>
        </div>
        <Issues id={block.id} />
        <ol className="space-y-2">
          {block.items.map((it, i) => (
            <ItemRow key={it.id} item={it} block={block} index={i} first={firstItemGlobal && i === 0} last={lastItemGlobal && i === block.items.length - 1} />
          ))}
        </ol>
        {/* The end of the list takes drops too, including into an empty block. */}
        <div
          onDragOver={(e) => { if (dragging.current?.type !== 'item') return; e.preventDefault(); e.stopPropagation(); setMark({ id: block.id, pos: 'end' }); }}
          onDrop={(e) => {
            if (dragging.current?.type !== 'item') return;
            e.preventDefault(); e.stopPropagation();
            dispatch({ type: 'moveItem', itemId: dragging.current.id, toBlockId: block.id, toIndex: block.items.length });
            dragging.current = null; setMark(null);
          }}
          className="pt-2"
        >
          <DropLine show={mark?.id === block.id && mark.pos === 'end'} />
          <Button type="button" variant="ghost" className="h-9 rounded-lg px-2 text-xs" disabled={block.items.length >= LIMITS.items} onClick={() => dispatch({ type: 'addItem', blockId: block.id })}>
            <Plus aria-hidden />{block.items.length >= LIMITS.items ? B.limit : B.addExercise}
          </Button>
        </div>
      </section>
      <DropLine show={mark?.id === block.id && mark.pos === 'after'} />
    </div>
  );
}

// ── Day ──────────────────────────────────────────────────────────────────────

function DayCard({ day, weekId, weeks }: { day: ProgramDayDoc; weekId: string; weeks: { id: string; label: string }[] }) {
  const { dispatch } = useCanvas();
  const [kind, setKind] = useState<BlockKind>('single');
  const [copied, setCopied] = useState<string | null>(null);
  const blockCount = day.blocks.length;
  // The first and last exercise of the day cannot move further; everything between can cross block edges.
  const firstBlockWithItems = day.blocks.findIndex((b) => b.items.length > 0);
  const lastBlockWithItems = day.blocks.length - 1 - [...day.blocks].reverse().findIndex((b) => b.items.length > 0);

  return (
    <article aria-label={day.name} className="rounded-2xl border border-border p-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 basis-40">
          <Label htmlFor={`day-${day.id}`} className="text-[11px] text-axiom-zinc-500">{B.dayName}</Label>
          <Input id={`day-${day.id}`} value={day.name} maxLength={60} onChange={(e) => dispatch({ type: 'updateDay', dayId: day.id, patch: { name: e.target.value } })} className="h-10 rounded-xl text-[15px] font-semibold" />
        </div>
        <div className="w-36">
          <Label htmlFor={`wd-${day.id}`} className="text-[11px] text-axiom-zinc-500">{B.weekday}</Label>
          <select id={`wd-${day.id}`} className={selectClass} value={day.weekday ?? ''} onChange={(e) => dispatch({ type: 'updateDay', dayId: day.id, patch: { weekday: e.target.value === '' ? null : Number(e.target.value) } })}>
            <option value="">{B.unscheduled}</option>
            {WEEKDAYS.map((w, i) => <option key={w} value={i}>{w}</option>)}
          </select>
        </div>
        <div className="flex items-end gap-1">
          {weeks.length > 1 && (
            <div>
              <Label htmlFor={`cp-${day.id}`} className="text-[11px] text-axiom-zinc-500">{B.copyDayTo}</Label>
              <select id={`cp-${day.id}`} className={cn(selectClass, 'w-36')} value=""
                onChange={(e) => {
                  const to = weeks.find((w) => w.id === e.target.value);
                  if (!to) return;
                  dispatch({ type: 'copyDayToWeek', dayId: day.id, weekId: to.id });
                  setCopied(to.label);
                  setTimeout(() => setCopied(null), 2500);
                }}>
                <option value="">{B.copyDayChoose}</option>
                {weeks.filter((w) => w.id !== weekId).map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
              </select>
            </div>
          )}
          <Button type="button" variant="ghost" className={cn(iconBtn, 'size-10')} aria-label={`${B.deleteDay}: ${day.name}`}
            onClick={() => { if (day.blocks.length === 0 || window.confirm(B.deleteDayConfirm)) dispatch({ type: 'deleteDay', dayId: day.id }); }}>
            <Trash2 aria-hidden />
          </Button>
        </div>
      </div>
      {copied && <p role="status" className="mt-2 text-xs text-axiom-success-ink"><Copy className="mr-1 inline size-3" aria-hidden />{B.copiedDay(copied)}</p>}
      <Issues id={day.id} />
      <Why target={day.id} />

      <div className="mt-3 space-y-3">
        {day.blocks.length === 0 && <p className="text-sm text-axiom-zinc-500">{B.noBlocks}</p>}
        {day.blocks.map((b, i) => (
          <BlockCard key={b.id} block={b} day={day} index={i} count={blockCount} firstItemGlobal={i === firstBlockWithItems} lastItemGlobal={i === lastBlockWithItems} />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select aria-label={B.blockKind} className={cn(smallSelect, 'w-auto')} value={kind} onChange={(e) => setKind(e.target.value as BlockKind)}>
          {BLOCK_KINDS.map((k) => <option key={k} value={k}>{PRG.blockKinds[k]}</option>)}
        </select>
        <Button type="button" variant="secondary" className="h-9 rounded-xl" disabled={blockCount >= LIMITS.blocks} onClick={() => dispatch({ type: 'addBlock', dayId: day.id, kind })}>
          <Plus aria-hidden />{B.addBlock}
        </Button>
      </div>
    </article>
  );
}

// ── Canvas ───────────────────────────────────────────────────────────────────

export function ProgramCanvas({ doc, dispatch, check, annotations, weekId, onWeekChange }: {
  doc: ProgramDoc;
  dispatch: (a: DocAction) => void;
  check: ProgramCheck | null;
  annotations: ProgramAnnotation[];
  weekId: string;
  onWeekChange: (id: string) => void;
}) {
  const dragging = useRef<Dragging>(null);
  const [mark, setMark] = useState<DropMark>(null);
  const violations = violationsByItem(doc, check);
  const week = doc.weeks.find((w) => w.id === weekId) ?? doc.weeks[0];
  const weekList = doc.weeks.map((w, i) => ({ id: w.id, label: w.label || `Week ${i + 1}` }));
  // A week tab shows a dot when anything in it is refused or warned.
  const weekLevel = (w: ProgramDoc['weeks'][number]) =>
    worstLevel(w.days.flatMap((d) => d.blocks.flatMap((b) => b.items.flatMap((it) => violations.get(it.id) ?? []))));

  return (
    <CanvasCtx.Provider value={{ dispatch, dragging, mark, setMark, violations, check, annotations }}>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <div role="tablist" aria-label={B.weeks} className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-1">
            {doc.weeks.map((w, i) => {
              const lvl = weekLevel(w);
              return (
                <button
                  key={w.id}
                  type="button"
                  role="tab"
                  aria-selected={w.id === week?.id}
                  onClick={() => onWeekChange(w.id)}
                  className={cn(
                    'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15',
                    w.id === week?.id ? 'border-foreground bg-foreground text-background' : 'border-border text-axiom-zinc-600 hover:bg-axiom-zinc-50',
                  )}
                >
                  {w.label || `Week ${i + 1}`}
                  {lvl && <span aria-label={lvl === 'block' ? C.refused : C.warning} role="img" className={cn('size-1.5 rounded-full', lvl === 'block' ? 'bg-axiom-destructive' : 'bg-axiom-warning')} />}
                </button>
              );
            })}
          </div>
          <Button type="button" variant="secondary" className="h-9 shrink-0 rounded-xl" disabled={doc.weeks.length >= LIMITS.weeks} onClick={() => dispatch({ type: 'addWeek' })}>
            <Plus aria-hidden /><span className="hidden sm:inline">{B.addWeek}</span><span className="sr-only sm:hidden">{B.addWeek}</span>
          </Button>
        </div>

        {week && (
          <div role="tabpanel" aria-label={week.label} className="space-y-4">
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1 basis-40">
                <Label htmlFor={`wk-${week.id}`} className="text-[11px] text-axiom-zinc-500">{B.weekLabel}</Label>
                <Input id={`wk-${week.id}`} value={week.label ?? ''} maxLength={60} onChange={(e) => dispatch({ type: 'renameWeek', weekId: week.id, label: e.target.value })} className="h-10 rounded-xl" />
              </div>
              <Button type="button" variant="ghost" className="h-10 rounded-xl" disabled={doc.weeks.length >= LIMITS.weeks} onClick={() => dispatch({ type: 'duplicateWeek', weekId: week.id })}>
                <Copy aria-hidden />{B.duplicateWeek}
              </Button>
              <Button type="button" variant="ghost" className="h-10 rounded-xl text-axiom-zinc-600" disabled={doc.weeks.length <= 1}
                onClick={() => { if (window.confirm(B.deleteWeekConfirm)) { const next = doc.weeks.find((w) => w.id !== week.id); dispatch({ type: 'deleteWeek', weekId: week.id }); if (next) onWeekChange(next.id); } }}>
                <Trash2 aria-hidden />{B.deleteWeek}
              </Button>
            </div>
            <Issues id={week.id} />
            <Why target={week.id} />
            {week.days.length === 0 && <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-axiom-zinc-500">{B.noDays}</p>}
            {week.days.map((d) => <DayCard key={d.id} day={d} weekId={week.id} weeks={weekList} />)}
            <Button type="button" variant="secondary" className="h-10 rounded-xl" disabled={week.days.length >= LIMITS.days} onClick={() => dispatch({ type: 'addDay', weekId: week.id })}>
              <Plus aria-hidden />{B.addDay}
            </Button>
          </div>
        )}
      </div>
    </CanvasCtx.Provider>
  );
}
