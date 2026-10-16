// The program builder's document logic, as pure functions: a reducer over a
// ProgramDoc (weeks → days → blocks → items), the moves drag-and-drop and the
// up/down buttons make, and how the rules engine's `check` maps onto the
// canvas. Every node has a globally unique id, so actions address nodes by id
// alone and never by position.

import type {
  BlockKind, GuardrailViolation, LoadType, ProgramAnnotation, ProgramBlock, ProgramCheck, ProgramDayDoc, ProgramDoc, ProgramIssue,
  ProgramItem, ProgramWeekDoc, TrainerProgram,
} from '@axiom/personal-training-core';

/** Mirrors the server's limits (programs.ts LIMITS) so the canvas never offers what a save would refuse. */
export const LIMITS = { weeks: 16, days: 7, blocks: 12, items: 10, sets: 20 } as const;

export const newId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;

export const blankItem = (over: Partial<ProgramItem> = {}): ProgramItem => ({ id: newId(), name: '', sets: 3, reps: '8', ...over });
export const blankBlock = (kind: BlockKind = 'single'): ProgramBlock => ({
  id: newId(), kind, ...(kind === 'superset' || kind === 'circuit' ? { rounds: 3 } : {}), ...(kind === 'amrap' || kind === 'emom' ? { timeCapMin: 10 } : {}),
  items: [blankItem()],
});
export const blankDay = (n: number): ProgramDayDoc => ({ id: newId(), name: `Day ${n}`, weekday: null, blocks: [] });

/** Fresh ids all the way down: a duplicate must never share ids with its source. */
export function reIdWeek(w: ProgramWeekDoc): ProgramWeekDoc {
  return { ...w, id: newId(), days: w.days.map(reIdDay) };
}
export function reIdDay(d: ProgramDayDoc): ProgramDayDoc {
  return { ...d, id: newId(), blocks: d.blocks.map((b) => ({ ...b, id: newId(), items: b.items.map((it) => ({ ...it, id: newId() })) })) };
}

// ── Reducer ──────────────────────────────────────────────────────────────────

export type DocAction =
  | { type: 'replace'; doc: ProgramDoc }
  | { type: 'addWeek' }
  | { type: 'duplicateWeek'; weekId: string }
  | { type: 'deleteWeek'; weekId: string }
  | { type: 'renameWeek'; weekId: string; label: string }
  | { type: 'addDay'; weekId: string }
  | { type: 'updateDay'; dayId: string; patch: Partial<Pick<ProgramDayDoc, 'name' | 'weekday' | 'notes'>> }
  | { type: 'deleteDay'; dayId: string }
  | { type: 'copyDayToWeek'; dayId: string; weekId: string }
  | { type: 'addBlock'; dayId: string; kind: BlockKind }
  | { type: 'updateBlock'; blockId: string; patch: Partial<Pick<ProgramBlock, 'kind' | 'rounds' | 'timeCapMin'>> }
  | { type: 'deleteBlock'; blockId: string }
  | { type: 'moveBlock'; blockId: string; toDayId: string; toIndex: number }
  | { type: 'nudgeBlock'; blockId: string; dir: -1 | 1 }
  | { type: 'addItem'; blockId: string }
  | { type: 'updateItem'; itemId: string; patch: Partial<Omit<ProgramItem, 'id'>> }
  | { type: 'deleteItem'; itemId: string }
  | { type: 'moveItem'; itemId: string; toBlockId: string; toIndex: number }
  | { type: 'nudgeItem'; itemId: string; dir: -1 | 1 };

const mapDays = (doc: ProgramDoc, fn: (d: ProgramDayDoc) => ProgramDayDoc): ProgramDoc =>
  ({ weeks: doc.weeks.map((w) => ({ ...w, days: w.days.map(fn) })) });
const mapBlocks = (doc: ProgramDoc, fn: (b: ProgramBlock) => ProgramBlock): ProgramDoc =>
  mapDays(doc, (d) => ({ ...d, blocks: d.blocks.map(fn) }));

/** Where a node is, by id. */
export function locate(doc: ProgramDoc, id: string): { week: number; day: number; block?: number; item?: number } | null {
  for (let wi = 0; wi < doc.weeks.length; wi++) {
    const days = doc.weeks[wi].days;
    for (let di = 0; di < days.length; di++) {
      const d = days[di];
      if (d.id === id) return { week: wi, day: di };
      for (let bi = 0; bi < d.blocks.length; bi++) {
        const b = d.blocks[bi];
        if (b.id === id) return { week: wi, day: di, block: bi };
        const ii = b.items.findIndex((it) => it.id === id);
        if (ii >= 0) return { week: wi, day: di, block: bi, item: ii };
      }
    }
  }
  return null;
}

const insertAt = <T>(list: T[], index: number, value: T) => {
  const next = list.slice();
  next.splice(Math.max(0, Math.min(index, next.length)), 0, value);
  return next;
};

export function docReducer(doc: ProgramDoc, a: DocAction): ProgramDoc {
  switch (a.type) {
    case 'replace': return a.doc;
    case 'addWeek': {
      if (doc.weeks.length >= LIMITS.weeks) return doc;
      // A new week starts with the same day names as the last, empty, so the shape carries on.
      const last = doc.weeks[doc.weeks.length - 1];
      const days = last ? last.days.map((d) => ({ id: newId(), name: d.name, weekday: d.weekday ?? null, blocks: [] })) : [blankDay(1)];
      return { weeks: [...doc.weeks, { id: newId(), label: `Week ${doc.weeks.length + 1}`, days }] };
    }
    case 'duplicateWeek': {
      const i = doc.weeks.findIndex((w) => w.id === a.weekId);
      if (i < 0 || doc.weeks.length >= LIMITS.weeks) return doc;
      const copy = { ...reIdWeek(doc.weeks[i]), label: `Week ${doc.weeks.length + 1}` };
      return { weeks: [...doc.weeks, copy] };
    }
    case 'deleteWeek':
      return doc.weeks.length <= 1 ? doc : { weeks: doc.weeks.filter((w) => w.id !== a.weekId) };
    case 'renameWeek':
      return { weeks: doc.weeks.map((w) => (w.id === a.weekId ? { ...w, label: a.label } : w)) };
    case 'addDay':
      return { weeks: doc.weeks.map((w) => (w.id === a.weekId && w.days.length < LIMITS.days ? { ...w, days: [...w.days, blankDay(w.days.length + 1)] } : w)) };
    case 'updateDay':
      return mapDays(doc, (d) => (d.id === a.dayId ? { ...d, ...a.patch } : d));
    case 'deleteDay':
      return { weeks: doc.weeks.map((w) => ({ ...w, days: w.days.filter((d) => d.id !== a.dayId) })) };
    case 'copyDayToWeek': {
      const at = locate(doc, a.dayId);
      if (!at) return doc;
      const source = doc.weeks[at.week].days[at.day];
      return { weeks: doc.weeks.map((w) => (w.id === a.weekId && w.days.length < LIMITS.days ? { ...w, days: [...w.days, reIdDay(source)] } : w)) };
    }
    case 'addBlock':
      return mapDays(doc, (d) => (d.id === a.dayId && d.blocks.length < LIMITS.blocks ? { ...d, blocks: [...d.blocks, blankBlock(a.kind)] } : d));
    case 'updateBlock':
      return mapBlocks(doc, (b) => {
        if (b.id !== a.blockId) return b;
        const next = { ...b, ...a.patch };
        // Rounds belong to supersets and circuits; a time cap to AMRAP and EMOM.
        if (a.patch.kind) {
          if (!(next.kind === 'superset' || next.kind === 'circuit')) delete next.rounds;
          else next.rounds ??= 3;
          if (!(next.kind === 'amrap' || next.kind === 'emom')) delete next.timeCapMin;
          else next.timeCapMin ??= 10;
        }
        return next;
      });
    case 'deleteBlock':
      return mapDays(doc, (d) => ({ ...d, blocks: d.blocks.filter((b) => b.id !== a.blockId) }));
    case 'moveBlock': {
      const at = locate(doc, a.blockId);
      if (!at || at.block === undefined) return doc;
      const fromDay = doc.weeks[at.week].days[at.day];
      const target = locate(doc, a.toDayId);
      if (!target || target.block !== undefined) return doc;
      const toDay = doc.weeks[target.week].days[target.day];
      if (toDay.id !== fromDay.id && toDay.blocks.length >= LIMITS.blocks) return doc;
      const block = fromDay.blocks[at.block];
      let index = a.toIndex;
      // Moving down within the same day: removing it first shifts the target up by one.
      if (fromDay.id === toDay.id && at.block < index) index -= 1;
      const removed = mapDays(doc, (d) => (d.id === fromDay.id ? { ...d, blocks: d.blocks.filter((b) => b.id !== a.blockId) } : d));
      return mapDays(removed, (d) => (d.id === toDay.id ? { ...d, blocks: insertAt(d.blocks, index, block) } : d));
    }
    case 'nudgeBlock': {
      const at = locate(doc, a.blockId);
      if (!at || at.block === undefined) return doc;
      const day = doc.weeks[at.week].days[at.day];
      const to = at.block + a.dir;
      if (to < 0 || to >= day.blocks.length) return doc;
      return docReducer(doc, { type: 'moveBlock', blockId: a.blockId, toDayId: day.id, toIndex: a.dir === 1 ? to + 1 : to });
    }
    case 'addItem':
      return mapBlocks(doc, (b) => (b.id === a.blockId && b.items.length < LIMITS.items ? { ...b, items: [...b.items, blankItem()] } : b));
    case 'updateItem':
      return mapBlocks(doc, (b) => ({ ...b, items: b.items.map((it) => (it.id === a.itemId ? { ...it, ...a.patch } : it)) }));
    case 'deleteItem':
      return mapBlocks(doc, (b) => ({ ...b, items: b.items.filter((it) => it.id !== a.itemId) }));
    case 'moveItem': {
      const at = locate(doc, a.itemId);
      const target = locate(doc, a.toBlockId);
      if (!at || at.item === undefined || !target || target.block === undefined || target.item !== undefined) return doc;
      const fromBlock = doc.weeks[at.week].days[at.day].blocks[at.block!];
      const toBlock = doc.weeks[target.week].days[target.day].blocks[target.block];
      if (fromBlock.id !== toBlock.id && toBlock.items.length >= LIMITS.items) return doc;
      const item = fromBlock.items[at.item];
      let index = a.toIndex;
      if (fromBlock.id === toBlock.id && at.item < index) index -= 1;
      const removed = mapBlocks(doc, (b) => (b.id === fromBlock.id ? { ...b, items: b.items.filter((it) => it.id !== a.itemId) } : b));
      return mapBlocks(removed, (b) => (b.id === toBlock.id ? { ...b, items: insertAt(b.items, index, item) } : b));
    }
    case 'nudgeItem': {
      // Within the block first; past its edge, into the neighbouring block of the same day.
      const at = locate(doc, a.itemId);
      if (!at || at.item === undefined || at.block === undefined) return doc;
      const day = doc.weeks[at.week].days[at.day];
      const block = day.blocks[at.block];
      const to = at.item + a.dir;
      if (to >= 0 && to < block.items.length) return docReducer(doc, { type: 'moveItem', itemId: a.itemId, toBlockId: block.id, toIndex: a.dir === 1 ? to + 1 : to });
      const neighbour = day.blocks[at.block + a.dir];
      if (!neighbour) return doc;
      return docReducer(doc, { type: 'moveItem', itemId: a.itemId, toBlockId: neighbour.id, toIndex: a.dir === 1 ? 0 : neighbour.items.length });
    }
    default:
      return doc;
  }
}

// ── The check, on the canvas ─────────────────────────────────────────────────

/** The key the server accepts to acknowledge a warning. */
export const ackKey = (v: Pick<GuardrailViolation, 'exercise' | 'contraindicationId'>) => `${v.exercise.trim().toLowerCase()}|${v.contraindicationId}`;

/**
 * Guardrail violations per item id. The engine reports by exercise name, so
 * every item with that name carries the badge — the same exercise is refused
 * wherever it appears.
 */
export function violationsByItem(doc: ProgramDoc, check: ProgramCheck | null | undefined): Map<string, GuardrailViolation[]> {
  const out = new Map<string, GuardrailViolation[]>();
  const violations = check?.guardrails?.violations ?? [];
  if (violations.length === 0) return out;
  const byName = new Map<string, GuardrailViolation[]>();
  for (const v of violations) {
    const k = v.exercise.trim().toLowerCase();
    byName.set(k, [...(byName.get(k) ?? []), v]);
  }
  for (const w of doc.weeks) for (const d of w.days) for (const b of d.blocks) for (const it of b.items) {
    const hit = byName.get(it.name.trim().toLowerCase());
    if (hit) out.set(it.id, hit);
  }
  return out;
}

/** The worst level among an item's violations, for its badge colour. */
export const worstLevel = (vs: GuardrailViolation[] | undefined): 'block' | 'warn' | null =>
  !vs || vs.length === 0 ? null : vs.some((v) => v.level === 'block') ? 'block' : 'warn';

export const issuesFor = (check: ProgramCheck | null | undefined, id: string): ProgramIssue[] =>
  (check?.issues ?? []).filter((i) => i.where === id);

/** Unique warnings that can still be acknowledged. Blocks are never offered. */
export function acknowledgeable(check: ProgramCheck | null | undefined): GuardrailViolation[] {
  const seen = new Set<string>();
  return (check?.guardrails?.violations ?? []).filter((v) => {
    if (v.level !== 'warn') return false;
    const k = ackKey(v);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Why the Publish button is disabled, in one sentence; null when it can publish. */
export function publishBlocker(p: Pick<TrainerProgram, 'isTemplate' | 'clientId' | 'status' | 'check'>): string | null {
  if (p.isTemplate || !p.clientId) return 'Templates are not published. Copy it to a client first.';
  if (p.status === 'archived') return 'This program is archived.';
  const blocks = (p.check.guardrails?.violations ?? []).filter((v) => v.level === 'block').length + p.check.issues.filter((i) => i.level === 'block').length;
  const warns = (p.check.guardrails?.violations ?? []).filter((v) => v.level === 'warn').length;
  if (blocks > 0) return `Resolve ${blocks === 1 ? 'the refusal' : `${blocks} refusals`} before publishing.`;
  if (warns > 0) return `Acknowledge or change ${warns === 1 ? 'the warning' : `${warns} warnings`} before publishing.`;
  if (!p.check.publishable) return 'Fix the problems listed before publishing.';
  return null;
}

/** Annotations by target, and the program-level refusals shown at the top. */
export function annotationsFor(annotations: ProgramAnnotation[], target: string, kind?: ProgramAnnotation['kind']) {
  return annotations.filter((a) => a.target === target && (!kind || a.kind === kind));
}
export const refusalNotes = (annotations: ProgramAnnotation[]) => annotations.filter((a) => a.kind === 'removed' || a.kind === 'guardrail');

// ── Small helpers ────────────────────────────────────────────────────────────

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const BLOCK_KINDS: BlockKind[] = ['single', 'superset', 'circuit', 'amrap', 'emom'];
export const LOAD_TYPES: LoadType[] = ['none', 'percent1rm', 'rpe', 'rir', 'kg', 'lb', 'bodyweight'];

export const countItems = (doc: ProgramDoc) => doc.weeks.reduce((n, w) => n + w.days.reduce((m, d) => m + d.blocks.reduce((k, b) => k + b.items.length, 0), 0), 0);

/** Comparable form of a doc, for "is there anything unsaved". */
export const docSignature = (doc: ProgramDoc) => JSON.stringify(doc);
