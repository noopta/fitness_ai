// The program builder (handoff B1) and the one rule that governs it: a
// program reaches a client only by a trainer publishing it, and publishing is
// refused while the rules engine finds a conflict with the client's
// contraindications. The same check runs on every save, on AI drafts, at
// publish time (contraindications may have changed since) and again when an
// app client chooses to run the program in the app.
//
// Templates and drafts may be saved with problems — the canvas is a work
// surface — but they are shown, never hidden.

import { randomUUID } from 'crypto';
import { audit, createDraft, requestSend } from './drafts.js';
import { prisma } from './db.js';
import { validateProgramForClient } from './contraindications.js';
import { currentLink, issueLink } from './links.js';
import { PROSPECT_PREFIX, loadClients } from './roster.js';
import type {
  BlockKind, LoadType, ProgramAnnotation, ProgramCheck, ProgramDoc, ProgramIssue, ProgramSummary, TrainerProgram,
} from './types.js';

export class ProgramError extends Error {
  status: number;
  check?: ProgramCheck;
  constructor(message: string, status: number, check?: ProgramCheck) {
    super(message);
    this.name = 'ProgramError';
    this.status = status;
    this.check = check;
  }
}

export const LIMITS = { weeks: 16, days: 7, blocks: 12, items: 10, sets: 20 };
const BLOCK_KINDS: BlockKind[] = ['single', 'superset', 'circuit', 'amrap', 'emom'];
const LOAD_TYPES: LoadType[] = ['percent1rm', 'rpe', 'rir', 'kg', 'lb', 'bodyweight', 'none'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v: unknown, lo: number, hi: number): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n) : undefined;
};

/**
 * Coerce whatever the canvas (or the model) sent into a well-formed document.
 * Throws only for what cannot be made sense of; everything else is clamped,
 * trimmed or dropped so a half-built program still saves.
 */
export function normaliseDoc(raw: unknown): ProgramDoc {
  const weeksIn = Array.isArray((raw as any)?.weeks) ? (raw as any).weeks : null;
  if (!weeksIn) throw new ProgramError('A program needs a weeks list', 400);
  if (weeksIn.length > LIMITS.weeks) throw new ProgramError(`At most ${LIMITS.weeks} weeks`, 400);
  return {
    weeks: weeksIn.map((w: any, wi: number) => {
      const days = Array.isArray(w?.days) ? w.days : [];
      if (days.length > LIMITS.days) throw new ProgramError(`At most ${LIMITS.days} days in a week`, 400);
      return {
        id: str(w?.id, 64) || randomUUID(),
        ...(str(w?.label, 60) ? { label: str(w.label, 60) } : {}),
        days: days.map((d: any, di: number) => {
          const blocks = Array.isArray(d?.blocks) ? d.blocks : [];
          if (blocks.length > LIMITS.blocks) throw new ProgramError(`At most ${LIMITS.blocks} blocks in a day`, 400);
          const weekday = d?.weekday === null || d?.weekday === undefined ? null : int(d.weekday, 0, 6) ?? null;
          return {
            id: str(d?.id, 64) || randomUUID(),
            name: str(d?.name, 60) || `Day ${di + 1}`,
            weekday,
            ...(str(d?.notes, 500) ? { notes: str(d.notes, 500) } : {}),
            blocks: blocks.map((b: any) => {
              const items = Array.isArray(b?.items) ? b.items : [];
              if (items.length > LIMITS.items) throw new ProgramError(`At most ${LIMITS.items} exercises in a block`, 400);
              const kind: BlockKind = BLOCK_KINDS.includes(b?.kind) ? b.kind : items.length > 1 ? 'superset' : 'single';
              return {
                id: str(b?.id, 64) || randomUUID(),
                kind,
                ...(int(b?.rounds, 1, 20) ? { rounds: int(b.rounds, 1, 20) } : {}),
                ...(int(b?.timeCapMin, 1, 90) ? { timeCapMin: int(b.timeCapMin, 1, 90) } : {}),
                items: items
                  .filter((it: any) => str(it?.name, 80))
                  .map((it: any) => {
                    const loadType: LoadType | undefined = LOAD_TYPES.includes(it?.load?.type) ? it.load.type : undefined;
                    const loadValue = Number(it?.load?.value);
                    return {
                      id: str(it?.id, 64) || randomUUID(),
                      ...(str(it?.exerciseId, 80) ? { exerciseId: str(it.exerciseId, 80) } : {}),
                      name: str(it.name, 80),
                      sets: int(it?.sets, 1, LIMITS.sets) ?? 3,
                      reps: str(it?.reps, 20) || '8',
                      ...(loadType ? { load: { type: loadType, ...(Number.isFinite(loadValue) ? { value: Math.round(loadValue * 10) / 10 } : {}) } } : {}),
                      ...(int(it?.restSec, 0, 900) !== undefined ? { restSec: int(it.restSec, 0, 900) } : {}),
                      ...(str(it?.tempo, 12) ? { tempo: str(it.tempo, 12) } : {}),
                      ...(str(it?.notes, 300) ? { notes: str(it.notes, 300) } : {}),
                    };
                  }),
              };
            }),
          };
        }),
      };
    }).map((w: any, wi: number) => ({ ...w, label: w.label ?? `Week ${wi + 1}` })),
  };
}

/** Structural and progression checks that do not depend on the client. Pure. */
export function structuralIssues(doc: ProgramDoc): ProgramIssue[] {
  const issues: ProgramIssue[] = [];
  const allItems = doc.weeks.flatMap((w) => w.days.flatMap((d) => d.blocks.flatMap((b) => b.items)));
  if (allItems.length === 0) issues.push({ level: 'block', where: 'program', text: 'Add at least one exercise' });

  for (const w of doc.weeks) for (const d of w.days) {
    const sets = d.blocks.reduce((s, b) => s + b.items.reduce((t, it) => t + it.sets * (b.rounds ?? 1), 0), 0);
    if (sets > 40) issues.push({ level: 'warn', where: d.id, text: `${w.label} ${d.name}: ${sets} working sets in one session` });
    for (const b of d.blocks) {
      if ((b.kind === 'amrap' || b.kind === 'emom') && !b.timeCapMin) issues.push({ level: 'warn', where: b.id, text: `${d.name}: ${b.kind.toUpperCase()} block has no time cap` });
      if (b.kind === 'superset' && b.items.length < 2) issues.push({ level: 'warn', where: b.id, text: `${d.name}: a superset needs two or more exercises` });
      for (const it of b.items) {
        const v = it.load?.value;
        if (it.load?.type === 'rpe' && v !== undefined && (v < 1 || v > 10)) issues.push({ level: 'block', where: it.id, text: `${it.name}: RPE must be between 1 and 10` });
        if (it.load?.type === 'rir' && v !== undefined && (v < 0 || v > 10)) issues.push({ level: 'block', where: it.id, text: `${it.name}: RIR must be between 0 and 10` });
        if (it.load?.type === 'percent1rm' && v !== undefined) {
          if (v < 20 || v > 110) issues.push({ level: 'block', where: it.id, text: `${it.name}: ${v}% of 1RM is outside 20–110%` });
          else if (v > 100) issues.push({ level: 'warn', where: it.id, text: `${it.name}: ${v}% of 1RM is above a true max` });
        }
      }
    }
  }

  // Progression bounds: the same exercise, week to week.
  const loads = (w: ProgramDoc['weeks'][number]) => {
    const m = new Map<string, { type: LoadType; value: number }>();
    for (const d of w.days) for (const b of d.blocks) for (const it of b.items) {
      if (it.load?.value === undefined) continue;
      const k = `${d.name.toLowerCase()}|${it.name.toLowerCase()}`;
      const prev = m.get(k);
      if (!prev || it.load.value > prev.value) m.set(k, { type: it.load.type, value: it.load.value });
    }
    return m;
  };
  for (let i = 1; i < doc.weeks.length; i++) {
    const before = loads(doc.weeks[i - 1]);
    for (const [k, now] of loads(doc.weeks[i])) {
      const was = before.get(k);
      if (!was || was.type !== now.type) continue;
      const name = k.split('|')[1];
      if (now.type === 'percent1rm' && now.value - was.value > 10) issues.push({ level: 'warn', where: doc.weeks[i].id, text: `${doc.weeks[i].label}: ${name} jumps ${Math.round(now.value - was.value)} points of 1RM in a week` });
      if ((now.type === 'kg' || now.type === 'lb') && was.value > 0 && (now.value - was.value) / was.value > 0.15) issues.push({ level: 'warn', where: doc.weeks[i].id, text: `${doc.weeks[i].label}: ${name} load rises ${Math.round(((now.value - was.value) / was.value) * 100)}% in a week` });
      if (now.type === 'rpe' && now.value - was.value > 1.5) issues.push({ level: 'warn', where: doc.weeks[i].id, text: `${doc.weeks[i].label}: ${name} effort rises ${now.value - was.value} RPE in a week` });
    }
  }
  return issues;
}

export async function checkProgram(practiceId: string, clientId: string | null, doc: ProgramDoc, acknowledged: string[]): Promise<ProgramCheck> {
  const issues = structuralIssues(doc);
  const guardrails = clientId ? await validateProgramForClient(practiceId, clientId, doc, new Set(acknowledged)) : null;
  const refused = issues.some((i) => i.level === 'block') || !!guardrails?.violations.length;
  return { guardrails, issues, publishable: !!clientId && !refused };
}

// ── Reading ──────────────────────────────────────────────────────────────────

type Row = NonNullable<Awaited<ReturnType<typeof prisma.ptProgram.findUnique>>>;
const parse = <T>(raw: string | null | undefined, fallback: T): T => { try { return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; } };

export async function toProgram(row: Row): Promise<TrainerProgram> {
  const doc = parse<ProgramDoc>(row.docJson, { weeks: [] });
  const acknowledged = parse<string[]>(row.acknowledgedJson, []);
  return {
    id: row.id, clientId: row.clientId, name: row.name, description: row.description ?? '', status: row.status as TrainerProgram['status'],
    isTemplate: row.isTemplate, doc, source: row.source as TrainerProgram['source'],
    annotations: parse<ProgramAnnotation[]>(row.annotationsJson, []), acknowledged, startDate: row.startDate, version: row.version,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    ...(row.publishedAt ? { publishedAt: row.publishedAt.toISOString() } : {}),
    ...(row.appliedAt ? { appliedAt: row.appliedAt.toISOString() } : {}),
    ...(row.aiRequestJson ? { aiRequest: parse(row.aiRequestJson, undefined as any) } : {}),
    check: await checkProgram(row.practiceId, row.clientId, doc, acknowledged),
  };
}

export function summarise(row: Row, clientName?: string): ProgramSummary {
  const doc = parse<ProgramDoc>(row.docJson, { weeks: [] });
  return {
    id: row.id, clientId: row.clientId, ...(clientName ? { clientName } : {}), name: row.name, status: row.status as ProgramSummary['status'],
    isTemplate: row.isTemplate, weeks: doc.weeks.length, daysPerWeek: Math.max(0, ...doc.weeks.map((w) => w.days.length)),
    source: row.source as ProgramSummary['source'], updatedAt: row.updatedAt.toISOString(), ...(row.publishedAt ? { publishedAt: row.publishedAt.toISOString() } : {}),
  };
}

export async function loadOwned(practiceId: string, id: string): Promise<Row> {
  const row = await prisma.ptProgram.findUnique({ where: { id } });
  if (!row || row.practiceId !== practiceId) throw new ProgramError('Program not found', 404);
  return row;
}

export async function listPrograms(practiceId: string, filter: { clientId?: string; templates?: boolean }): Promise<ProgramSummary[]> {
  const rows = await prisma.ptProgram.findMany({
    where: { practiceId, status: { not: 'archived' }, ...(filter.templates ? { isTemplate: true } : {}), ...(filter.clientId ? { clientId: filter.clientId } : {}) },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  });
  const clientIds = [...new Set(rows.map((r) => r.clientId).filter((x): x is string => !!x))];
  const clients = clientIds.length ? await loadClients(practiceId, { ids: clientIds, includeArchived: true }) : [];
  const names = new Map(clients.map((c) => [c.id, c.name]));
  return rows.map((r) => summarise(r, r.clientId ? names.get(r.clientId) : undefined));
}

/** The program a client is on now, if their trainer published one. */
export async function publishedFor(practiceId: string, clientId: string): Promise<Row | null> {
  return prisma.ptProgram.findFirst({ where: { practiceId, clientId, status: 'published' }, orderBy: { publishedAt: 'desc' } });
}

// ── Writing ──────────────────────────────────────────────────────────────────

async function assertClient(practiceId: string, clientId: string) {
  if (clientId.startsWith(PROSPECT_PREFIX)) throw new ProgramError('Give this client a link or invite them before programming for them', 409);
  const [c] = await loadClients(practiceId, { ids: [clientId], includeArchived: true });
  if (!c) throw new ProgramError('Client not found', 404);
  return c;
}

const blankDoc = (days = 3): ProgramDoc => ({ weeks: [{ id: randomUUID(), label: 'Week 1', days: Array.from({ length: days }, (_, i) => ({ id: randomUUID(), name: `Day ${i + 1}`, weekday: null, blocks: [] })) }] });

/** Give every week, day, block and item a fresh id: a copy must never share ids with its source. */
export function reId(doc: ProgramDoc): ProgramDoc {
  return {
    weeks: doc.weeks.map((w) => ({
      ...w, id: randomUUID(),
      days: w.days.map((d) => ({ ...d, id: randomUUID(), blocks: d.blocks.map((b) => ({ ...b, id: randomUUID(), items: b.items.map((it) => ({ ...it, id: randomUUID() })) })) })),
    })),
  };
}

export async function createProgram(practiceId: string, trainerId: string, body: Record<string, unknown>): Promise<TrainerProgram> {
  const isTemplate = body.isTemplate === true;
  const clientId = typeof body.clientId === 'string' && body.clientId ? body.clientId : null;
  if (!isTemplate && !clientId) throw new ProgramError('Choose a client, or save it as a template', 400);
  if (clientId) await assertClient(practiceId, clientId);
  let doc: ProgramDoc;
  let source: TrainerProgram['source'] = 'manual';
  let name = str(body.name, 80);
  if (typeof body.fromProgramId === 'string') {
    const from = await loadOwned(practiceId, body.fromProgramId);
    doc = reId(parse<ProgramDoc>(from.docJson, { weeks: [] }));
    source = from.isTemplate ? 'template' : 'copy';
    name ||= from.name;
  } else {
    doc = body.doc ? normaliseDoc(body.doc) : blankDoc(int(body.daysPerWeek, 1, 7) ?? 3);
  }
  const row = await prisma.ptProgram.create({
    data: {
      practiceId, clientId: isTemplate ? null : clientId, name: name || 'New program', description: str(body.description, 1000) || null,
      isTemplate, docJson: JSON.stringify(doc), source, createdById: trainerId,
      startDate: typeof body.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.startDate) ? body.startDate : null,
    },
  });
  await audit({ practiceId, trainerId, clientId: row.clientId, action: 'program_created', itemType: 'program', itemId: row.id, meta: { source, isTemplate } });
  return toProgram(row);
}

export async function updateProgram(practiceId: string, trainerId: string, id: string, body: Record<string, unknown>): Promise<TrainerProgram> {
  const row = await loadOwned(practiceId, id);
  if (row.status === 'archived') throw new ProgramError('This program is archived', 409);
  const data: Record<string, unknown> = {};
  let doc = parse<ProgramDoc>(row.docJson, { weeks: [] });
  if (body.doc !== undefined) { doc = normaliseDoc(body.doc); data.docJson = JSON.stringify(doc); }
  if (body.name !== undefined) data.name = str(body.name, 80) || row.name;
  if (body.description !== undefined) data.description = str(body.description, 1000) || null;
  if (body.startDate !== undefined) data.startDate = typeof body.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.startDate) ? body.startDate : null;
  // A published program is live for the client: an edit that the rules engine refuses is not saved.
  if (row.status === 'published' && body.doc !== undefined) {
    const check = await checkProgram(practiceId, row.clientId, doc, parse<string[]>(row.acknowledgedJson, []));
    if (!check.publishable) throw new ProgramError('This change conflicts with the client\'s contraindications or has a problem to fix first. Nothing was saved.', 409, check);
    data.version = row.version + 1;
  }
  const updated = await prisma.ptProgram.update({ where: { id }, data });
  if (body.doc !== undefined && row.status === 'published') {
    await audit({ practiceId, trainerId, clientId: row.clientId, action: 'program_edited_live', itemType: 'program', itemId: id, meta: { version: updated.version } });
  }
  return toProgram(updated);
}

/** Accept warnings the rules engine raised. Never clears a refusal (the engine ignores acknowledgements of blocks). */
export async function acknowledge(practiceId: string, trainerId: string, id: string, keys: unknown): Promise<TrainerProgram> {
  const row = await loadOwned(practiceId, id);
  if (!Array.isArray(keys) || keys.some((k) => typeof k !== 'string' || !k.includes('|') || k.length > 200)) throw new ProgramError('keys must be exercise|contraindication pairs', 400);
  const acknowledged = [...new Set([...parse<string[]>(row.acknowledgedJson, []), ...keys.map((k: string) => k.toLowerCase())])];
  const updated = await prisma.ptProgram.update({ where: { id }, data: { acknowledgedJson: JSON.stringify(acknowledged) } });
  for (const k of keys as string[]) {
    await audit({ practiceId, trainerId, clientId: row.clientId, action: 'guardrail_acknowledged', itemType: 'program', itemId: id, meta: { key: k } });
  }
  return toProgram(updated);
}

/**
 * Publish to the client. Refused unless the rules engine passes it now.
 * The previous published program is archived; the client is told through the
 * usual draft pipeline (undo window, audit), with a link to view it.
 */
export async function publishProgram(practiceId: string, trainerId: string, id: string, now: Date = new Date()): Promise<TrainerProgram> {
  const row = await loadOwned(practiceId, id);
  if (row.isTemplate || !row.clientId) throw new ProgramError('Templates are not published. Copy it to a client first.', 409);
  if (row.status === 'archived') throw new ProgramError('This program is archived', 409);
  const client = await assertClient(practiceId, row.clientId);
  const doc = parse<ProgramDoc>(row.docJson, { weeks: [] });
  const check = await checkProgram(practiceId, row.clientId, doc, parse<string[]>(row.acknowledgedJson, []));
  if (!check.publishable) throw new ProgramError('This program cannot be published until the conflicts are resolved', 409, check);

  await prisma.ptProgram.updateMany({ where: { practiceId, clientId: row.clientId, status: 'published', id: { not: id } }, data: { status: 'archived' } });
  const updated = await prisma.ptProgram.update({ where: { id }, data: { status: 'published', publishedAt: now, publishedById: trainerId } });
  await audit({
    practiceId, trainerId, clientId: row.clientId, action: 'program_published', itemType: 'program', itemId: id,
    // Handoff §2.3: what the AI suggested, what the trainer approved, when.
    meta: { source: row.source, suggestedBy: row.source === 'ai' ? 'ai' : 'trainer', approvedBy: trainerId, approvedAt: now.toISOString(), checked: check.guardrails?.checked ?? 0, acknowledged: parse<string[]>(row.acknowledgedJson, []).length },
  });

  const link = (await currentLink(practiceId, row.clientId)) ?? (await issueLink(practiceId, row.clientId, trainerId));
  const first = client.name.split(' ')[0];
  const draft = await createDraft({
    practiceId, trainerId, clientId: row.clientId, kind: 'program', sourceId: id,
    text: `${first}, your new program "${updated.name}" is ready. You can see it here: ${link.url}?tab=program`,
  });
  await requestSend({ draftId: draft.id, practiceId, trainerId });
  return toProgram(updated);
}

export async function archiveProgram(practiceId: string, trainerId: string, id: string) {
  const row = await loadOwned(practiceId, id);
  await prisma.ptProgram.update({ where: { id }, data: { status: 'archived' } });
  await audit({ practiceId, trainerId, clientId: row.clientId, action: 'program_archived', itemType: 'program', itemId: id });
}

/** Copy to clients (each gets a draft) or save as a template. */
export async function copyProgram(practiceId: string, trainerId: string, id: string, body: Record<string, unknown>) {
  const from = await loadOwned(practiceId, id);
  const targets = Array.isArray(body.clientIds) ? body.clientIds.filter((x): x is string => typeof x === 'string').slice(0, 50) : [];
  const asTemplate = body.asTemplate === true;
  if (!asTemplate && targets.length === 0) throw new ProgramError('Choose clients to copy to, or save as a template', 400);
  const made: TrainerProgram[] = [];
  if (asTemplate) made.push(await createProgram(practiceId, trainerId, { isTemplate: true, fromProgramId: from.id, name: str(body.name, 80) || from.name }));
  for (const clientId of targets) made.push(await createProgram(practiceId, trainerId, { clientId, fromProgramId: from.id }));
  return made;
}

// ── Running a trainer's program in the app ───────────────────────────────────

function intensityOf(load: { type: LoadType; value?: number } | undefined): string {
  if (!load || load.value === undefined) return load?.type === 'bodyweight' ? 'Bodyweight' : '';
  switch (load.type) {
    case 'percent1rm': return `${load.value}% 1RM`;
    case 'rpe': return `RPE ${load.value}`;
    case 'rir': return `${load.value} RIR`;
    case 'kg': return `${load.value} kg`;
    case 'lb': return `${load.value} lb`;
    default: return '';
  }
}

/**
 * The app's saved-program shape from a builder document. Consecutive weeks
 * that are written identically become one phase repeated; a week that differs
 * (new loads, new exercises) starts a new phase, so nothing the trainer wrote
 * is averaged away.
 */
export function toAppProgram(doc: ProgramDoc, name: string, goal: string) {
  const dayOf = (d: ProgramDoc['weeks'][number]['days'][number]) => ({
    day: d.weekday != null ? `${WEEKDAYS[d.weekday]} — ${d.name}` : d.name,
    focus: d.name,
    warmup: [] as string[],
    cooldown: [] as string[],
    exercises: d.blocks.flatMap((b, bi) => b.items.map((it, ii) => {
      const label = b.kind === 'single' ? '' : `${b.kind === 'superset' ? 'Superset' : b.kind.toUpperCase()} ${String.fromCharCode(65 + bi)}${ii + 1}${b.rounds ? ` · ${b.rounds} rounds` : ''}${b.timeCapMin ? ` · ${b.timeCapMin} min` : ''}`;
      return {
        exercise: it.name, sets: it.sets, reps: it.reps, intensity: intensityOf(it.load),
        ...([label, it.tempo ? `Tempo ${it.tempo}` : '', it.restSec ? `Rest ${it.restSec}s` : '', it.notes ?? ''].filter(Boolean).length
          ? { notes: [label, it.tempo ? `Tempo ${it.tempo}` : '', it.restSec ? `Rest ${it.restSec}s` : '', it.notes ?? ''].filter(Boolean).join(' · ') } : {}),
      };
    })),
  });
  const signature = (w: ProgramDoc['weeks'][number]) => JSON.stringify(w.days.map((d) => [d.name, d.weekday, d.blocks.map((b) => [b.kind, b.rounds, b.timeCapMin, b.items.map((it) => [it.name, it.sets, it.reps, it.load, it.restSec, it.tempo])])]));
  const phases: any[] = [];
  let start = 0;
  for (let i = 1; i <= doc.weeks.length; i++) {
    if (i < doc.weeks.length && signature(doc.weeks[i]) === signature(doc.weeks[start])) continue;
    const span = i - start;
    phases.push({
      phaseNumber: phases.length + 1,
      phaseName: span > 1 ? `Weeks ${start + 1}–${i}` : doc.weeks[start].label ?? `Week ${start + 1}`,
      rationale: `Written by your trainer as part of ${name}.`,
      durationWeeks: span,
      weeksLabel: span > 1 ? `Weeks ${start + 1}-${i}` : `Week ${start + 1}`,
      trainingDays: doc.weeks[start].days.map(dayOf),
      progressionNotes: [],
      deloadProtocol: '',
    });
    start = i;
  }
  return {
    goal: goal || name,
    daysPerWeek: Math.max(1, ...doc.weeks.map((w) => w.days.length)),
    durationWeeks: doc.weeks.length,
    phases,
    autoregulationRules: [],
    trackingMetrics: [],
    source: 'personal_trainer',
    trainerProgram: { name },
  };
}
