// Contraindications as stored data, and the bridge from what clients wrote.
//
// Two sources meet here. Rows in PtContraindication are what the practice
// curates: structured, with a clearance. What a client told the app about
// their injuries (constraintsText / coachProfile, see readInjuries) or what a
// trainer's spreadsheet said is free text; until a trainer confirms it, it is
// read into the same shape by inference and enforced as NOT CLEARED. Nothing a
// client reported is ever ignored for want of review.

import { createHash } from 'crypto';
import { parseBlob, readInjuries } from '../../agent/profile/coachProfile.js';
import { audit } from './drafts.js';
import { prisma } from './db.js';
import {
  BODY_PARTS, PATTERNS, inferBodyPart, inferSeverity, inferSide, programExerciseNames, validateExercises,
  type BodyPart, type Clearance, type Pattern, type RuleInput, type Severity, type ValidationResult,
} from './contraindicationRules.js';
import type { Contraindication } from './types.js';

export class ContraindicationError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ContraindicationError';
    this.status = status;
  }
}

const SOURCES = ['trainer', 'client_reported', 'intake', 'import', 'medical'] as const;
const CLEARANCES: Clearance[] = ['not_cleared', 'modified', 'cleared'];
const SEVERITIES: Severity[] = ['mild', 'moderate', 'severe'];
const SIDES = ['left', 'right', 'both'] as const;

const parseList = (raw: string | null | undefined): Pattern[] => {
  try {
    const v = JSON.parse(raw ?? '[]');
    return Array.isArray(v) ? v.filter((p): p is Pattern => (PATTERNS as readonly string[]).includes(p)) : [];
  } catch {
    return [];
  }
};

/** A stable key for one piece of client-written injury text, so re-reading it never makes a second row. */
export function textRef(origin: 'client' | 'import', text: string): string {
  const norm = text.toLowerCase().replace(/\s+/g, ' ').trim();
  return `${origin}:${createHash('sha256').update(norm).digest('hex').slice(0, 16)}`;
}

type Row = Awaited<ReturnType<typeof prisma.ptContraindication.findMany>>[number];

export function rowToWire(r: Row): Contraindication {
  return {
    id: r.id,
    label: r.condition,
    ...(r.notes ? { note: r.notes } : {}),
    active: !r.archivedAt && r.clearance !== 'cleared',
    bodyPart: r.bodyPart as BodyPart,
    side: (r.side as Contraindication['side']) ?? null,
    severity: r.severity as Severity,
    clearance: r.clearance as Clearance,
    source: r.source as Contraindication['source'],
    ...(r.onsetDate ? { onsetDate: r.onsetDate } : {}),
    extraBlocks: parseList(r.extraBlocksJson),
    allow: parseList(r.allowJson),
    needsReview: !r.reviewedAt,
  };
}

/** Free text read into the structured shape; enforced as not cleared until a trainer confirms it. */
export function inferredToWire(origin: 'client' | 'import', text: string, note: string | undefined, active: boolean): Contraindication {
  const ref = textRef(origin, text);
  return {
    id: `inferred:${ref}`,
    label: text,
    ...(note ? { note } : {}),
    active,
    bodyPart: inferBodyPart(`${text} ${note ?? ''}`),
    side: inferSide(text),
    severity: inferSeverity(`${text} ${note ?? ''}`),
    clearance: 'not_cleared',
    source: origin === 'client' ? 'client_reported' : 'import',
    extraBlocks: [],
    allow: [],
    needsReview: true,
  };
}

export function toRuleInput(c: Contraindication): RuleInput {
  return {
    id: c.id ?? `label:${c.label}`,
    // Contraindications from before the structured model carry only a label.
    bodyPart: c.bodyPart ?? inferBodyPart(`${c.label} ${c.note ?? ''}`),
    condition: c.label,
    clearance: c.clearance ?? (c.active ? 'not_cleared' : 'cleared'),
    severity: c.severity ?? inferSeverity(c.label),
    extraBlocks: (c.extraBlocks ?? []) as Pattern[],
    allow: (c.allow ?? []) as Pattern[],
    active: c.active,
  };
}

interface ClientText { coachProfile: string | null; constraintsText: string | null }

/**
 * Merge the practice's rows with each client's own injury text. A row made
 * from a piece of text (its sourceRef) replaces the inferred reading of that
 * text, even after the row is archived — the trainer has decided about it.
 */
export function mergeContraindications(rows: Row[], fromText: { origin: 'client' | 'import'; text: string; note?: string; active: boolean }[]): Contraindication[] {
  const decided = new Set(rows.map((r) => r.sourceRef).filter(Boolean));
  const live = rows.filter((r) => !r.archivedAt).map(rowToWire);
  const inferred = fromText
    .filter((t) => t.text.trim() && !decided.has(textRef(t.origin, t.text)))
    .map((t) => inferredToWire(t.origin, t.text.trim(), t.note, t.active));
  const seen = new Set<string>();
  return [...live, ...inferred].filter((c) => {
    const k = c.id!;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function clientInjuryTexts(user: ClientText) {
  return readInjuries(parseBlob(user.coachProfile), user.constraintsText)
    .filter((i) => i && typeof i.area === 'string' && i.area.trim())
    .map((i) => ({ origin: 'client' as const, text: i.area.trim(), note: i.note, active: !i.resolvedAt }));
}

export function prospectInjuryTexts(injuries: string | null) {
  return (injuries ?? '').split(/[;,\n]/).map((s) => s.trim()).filter((s) => s && !/^(none|no|n\/a|-)$/i.test(s))
    .map((text) => ({ origin: 'import' as const, text, active: true }));
}

/** Rows for many clients at once, grouped by client id. */
export async function loadRows(practiceId: string, clientIds: string[]): Promise<Map<string, Row[]>> {
  const out = new Map<string, Row[]>();
  if (clientIds.length === 0) return out;
  const rows = await prisma.ptContraindication.findMany({ where: { practiceId, clientId: { in: clientIds } }, orderBy: { createdAt: 'asc' } });
  for (const r of rows) {
    const list = out.get(r.clientId) ?? [];
    list.push(r);
    out.set(r.clientId, list);
  }
  return out;
}

/** Everything the rules engine should enforce for one client of a practice. */
export async function contraindicationsFor(practiceId: string, clientId: string): Promise<Contraindication[]> {
  const rows = (await loadRows(practiceId, [clientId])).get(clientId) ?? [];
  if (clientId.startsWith('prospect:')) {
    const p = await prisma.ptProspect.findUnique({ where: { id: clientId.slice('prospect:'.length) }, select: { injuries: true } });
    return mergeContraindications(rows, prospectInjuryTexts(p?.injuries ?? null));
  }
  const user = await prisma.user.findUnique({ where: { id: clientId }, select: { coachProfile: true, constraintsText: true } });
  return mergeContraindications(rows, user ? clientInjuryTexts(user) : []);
}

/**
 * Every contraindication that applies to a user across all practices they
 * train with, for the user's OWN program generation. A trainer's "not cleared"
 * follows the client into the app.
 */
export async function practiceContraindicationsForUser(userId: string): Promise<RuleInput[]> {
  const memberships = await prisma.institutionMember.findMany({ where: { userId, role: 'athlete', active: true }, select: { institutionId: true } });
  if (memberships.length === 0) return [];
  const rows = await prisma.ptContraindication.findMany({
    where: { clientId: userId, practiceId: { in: memberships.map((m) => m.institutionId) }, archivedAt: null },
  });
  return rows.map(rowToWire).map(toRuleInput);
}

export async function validateForClient(practiceId: string, clientId: string, exercises: string[], acknowledged?: Set<string>): Promise<ValidationResult> {
  const contras = await contraindicationsFor(practiceId, clientId);
  return validateExercises(contras.map(toRuleInput), exercises, acknowledged);
}

export async function validateProgramForClient(practiceId: string, clientId: string, program: unknown, acknowledged?: Set<string>) {
  return validateForClient(practiceId, clientId, programExerciseNames(program), acknowledged);
}

// ── Writes ───────────────────────────────────────────────────────────────────

export interface ContraindicationInput {
  bodyPart?: unknown; side?: unknown; condition?: unknown; severity?: unknown; source?: unknown; onsetDate?: unknown;
  clearance?: unknown; extraBlocks?: unknown; allow?: unknown; notes?: unknown; fromInferred?: unknown;
}

function pick<T extends string>(v: unknown, allowed: readonly T[], field: string): T | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || !allowed.includes(v as T)) throw new ContraindicationError(`${field} must be one of ${allowed.join(', ')}`, 400);
  return v as T;
}

function patternList(v: unknown, field: string): string | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.some((p) => !(PATTERNS as readonly string[]).includes(p))) throw new ContraindicationError(`${field} must be a list of movement patterns`, 400);
  return JSON.stringify([...new Set(v)]);
}

function validateFields(input: ContraindicationInput, creating: boolean) {
  const condition = input.condition === undefined ? undefined : typeof input.condition === 'string' ? input.condition.trim().slice(0, 200) : '';
  if ((creating && !condition) || condition === '') throw new ContraindicationError('Describe the injury or condition', 400);
  const onsetDate = input.onsetDate === undefined || input.onsetDate === null ? (input.onsetDate as null | undefined)
    : typeof input.onsetDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.onsetDate) ? input.onsetDate : (() => { throw new ContraindicationError('onsetDate must be YYYY-MM-DD', 400); })();
  const notes = input.notes === undefined ? undefined : input.notes === null ? null : typeof input.notes === 'string' ? input.notes.trim().slice(0, 1000) || null : (() => { throw new ContraindicationError('notes must be text', 400); })();
  return {
    bodyPart: pick(input.bodyPart, BODY_PARTS, 'bodyPart'),
    side: input.side === null ? null : pick(input.side, SIDES, 'side'),
    condition,
    severity: pick(input.severity, SEVERITIES, 'severity'),
    source: pick(input.source, SOURCES, 'source'),
    clearance: pick(input.clearance, CLEARANCES, 'clearance'),
    onsetDate,
    notes,
    extraBlocksJson: patternList(input.extraBlocks, 'extraBlocks'),
    allowJson: patternList(input.allow, 'allow'),
  };
}

const snapshot = (r: Row) => ({ bodyPart: r.bodyPart, condition: r.condition, severity: r.severity, clearance: r.clearance, side: r.side });

/**
 * Create a contraindication. With `fromInferred` (an `inferred:<ref>` id from
 * the dossier) it confirms one read from the client's own text: the row takes
 * that text's sourceRef so the inferred copy disappears.
 */
export async function createContraindication(practiceId: string, trainerId: string, clientId: string, input: ContraindicationInput) {
  const f = validateFields(input, true);
  let sourceRef: string | null = null;
  let source = f.source ?? 'trainer';
  if (typeof input.fromInferred === 'string' && input.fromInferred.startsWith('inferred:')) {
    sourceRef = input.fromInferred.slice('inferred:'.length);
    source = sourceRef.startsWith('client:') ? 'client_reported' : 'import';
    const existing = await prisma.ptContraindication.findFirst({ where: { practiceId, clientId, sourceRef } });
    if (existing) throw new ContraindicationError('This one has already been confirmed', 409);
  }
  if (!f.bodyPart) throw new ContraindicationError('Choose the body part', 400);
  const now = new Date();
  const row = await prisma.ptContraindication.create({
    data: {
      practiceId, clientId, bodyPart: f.bodyPart, side: f.side ?? null, condition: f.condition!, severity: f.severity ?? 'moderate',
      source, sourceRef, onsetDate: f.onsetDate ?? null, clearance: f.clearance ?? 'not_cleared', notes: f.notes ?? null,
      extraBlocksJson: f.extraBlocksJson ?? '[]', allowJson: f.allowJson ?? '[]', createdById: trainerId, reviewedAt: now,
      ...(f.clearance && f.clearance !== 'not_cleared' ? { clearedById: trainerId, clearedAt: now } : {}),
    },
  });
  await audit({ practiceId, trainerId, clientId, action: 'contraindication_created', itemType: 'contraindication', itemId: row.id, meta: snapshot(row) });
  return rowToWire(row);
}

export async function updateContraindication(practiceId: string, trainerId: string, clientId: string, id: string, input: ContraindicationInput) {
  const row = await prisma.ptContraindication.findUnique({ where: { id } });
  if (!row || row.practiceId !== practiceId || row.clientId !== clientId || row.archivedAt) throw new ContraindicationError('Not found', 404);
  const f = validateFields(input, false);
  const data: Record<string, unknown> = { reviewedAt: row.reviewedAt ?? new Date() };
  for (const [k, v] of Object.entries(f)) if (v !== undefined) data[k] = v;
  if (f.clearance && f.clearance !== row.clearance) {
    data.clearedById = f.clearance === 'not_cleared' ? null : trainerId;
    data.clearedAt = f.clearance === 'not_cleared' ? null : new Date();
  }
  const updated = await prisma.ptContraindication.update({ where: { id }, data });
  // A clearance change is the decision the rules engine turns on; it is always on the record.
  await audit({
    practiceId, trainerId, clientId, action: f.clearance && f.clearance !== row.clearance ? 'contraindication_clearance' : 'contraindication_updated',
    itemType: 'contraindication', itemId: id, meta: { before: snapshot(row), after: snapshot(updated) },
  });
  return rowToWire(updated);
}

/** Archive rather than delete: the record of what was known, and when, stays. */
export async function archiveContraindication(practiceId: string, trainerId: string, clientId: string, id: string) {
  const row = await prisma.ptContraindication.findUnique({ where: { id } });
  if (!row || row.practiceId !== practiceId || row.clientId !== clientId || row.archivedAt) throw new ContraindicationError('Not found', 404);
  await prisma.ptContraindication.update({ where: { id }, data: { archivedAt: new Date() } });
  await audit({ practiceId, trainerId, clientId, action: 'contraindication_archived', itemType: 'contraindication', itemId: id, meta: snapshot(row) });
}

/** Rows created on the trainer's behalf (intake answers). Never cleared; always needs review. */
export async function recordFromIntake(practiceId: string, clientId: string, items: { text: string; bodyPart?: BodyPart | 'unknown'; severity?: Severity; side?: string | null; onsetDate?: string | null }[]) {
  const made: Row[] = [];
  for (const item of items) {
    const sourceRef = textRef('client', item.text);
    const exists = await prisma.ptContraindication.findFirst({ where: { practiceId, clientId, sourceRef } });
    if (exists) continue;
    const part = item.bodyPart && item.bodyPart !== 'unknown' ? item.bodyPart : inferBodyPart(item.text);
    made.push(await prisma.ptContraindication.create({
      data: {
        practiceId, clientId, bodyPart: part === 'unknown' ? 'systemic' : part,
        side: item.side && (SIDES as readonly string[]).includes(item.side) ? item.side : inferSide(item.text),
        condition: item.text.slice(0, 200), severity: item.severity ?? inferSeverity(item.text), source: 'intake', sourceRef,
        onsetDate: item.onsetDate ?? null, clearance: 'not_cleared',
        notes: part === 'unknown' ? 'Body part could not be read from the intake answer; treated as a whole-body condition until reviewed.' : null,
      },
    }));
  }
  return made.map(rowToWire);
}
