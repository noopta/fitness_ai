// Spreadsheet imports: store the upload, propose and revise its mapping,
// show the trainer exactly what would come in, then import it as one batch
// that can be undone. Clients without an Axiom account become "Not joined"
// prospects of the practice; nothing is written to anyone's own account.

import { formatWeight, type UnitPreference } from '../weightUnits.js';
import { prisma } from './db.js';
import { audit } from './drafts.js';
import { proposeMappings } from './importMapping.js';
import { extract, nameKey, sanitiseGrids, suggestMapping, summariseWorkout, validateMapping, type Extracted, type Grid } from './importParse.js';
import { PROSPECT_PREFIX } from './roster.js';
import { estDateString } from './status.js';
import type { ImportPreview, ImportSummary, SheetMapping } from './types.js';

export { PROSPECT_PREFIX };
export const isProspectId = (id: string) => id.startsWith(PROSPECT_PREFIX);
export const prospectDbId = (id: string) => id.slice(PROSPECT_PREFIX.length);

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://axiomtraining.io';
const MAX_UPLOAD_CELLS = 400_000;

export class ImportError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ImportError';
    this.status = status;
  }
}

const defaultsFor = (pref: UnitPreference) => ({ unit: pref === 'metric' ? 'kg' as const : 'lb' as const, dateOrder: pref === 'metric' ? 'dmy' as const : 'mdy' as const });
/** A date-only string as an instant: noon UTC, so it stays on the same calendar day in any timezone. */
const atNoon = (date: string) => new Date(`${date}T12:00:00Z`);

async function owned(importId: string, practiceId: string) {
  const row = await prisma.ptImport.findUnique({ where: { id: importId } });
  if (!row || row.practiceId !== practiceId) throw new ImportError('Import not found', 404);
  return row;
}

/** Emails of people already on the roster, so their imported history attaches to them rather than to a duplicate. */
async function rosterEmails(practiceId: string): Promise<Map<string, string>> {
  const members = await prisma.institutionMember.findMany({
    where: { institutionId: practiceId, role: 'athlete', active: true },
    select: { user: { select: { id: true, email: true } } },
  });
  return new Map(members.filter((m) => m.user.email).map((m) => [m.user.email!.toLowerCase(), m.user.id]));
}

function preview(
  row: { id: string; fileName: string; status: string; createdAt: Date; importedAt: Date | null },
  grids: Grid[], mappings: SheetMapping[], extracted: Extracted, existing: Map<string, string>, pref: UnitPreference, dropped: string[] = [],
): ImportPreview {
  const fmt = (kg: number) => formatWeight(kg, pref) ?? '';
  return {
    id: row.id,
    fileName: row.fileName,
    status: row.status as ImportPreview['status'],
    createdAt: row.createdAt.toISOString(),
    ...(row.importedAt ? { importedAt: row.importedAt.toISOString() } : {}),
    sheets: grids.map((g, i) => ({ name: g.name, rowCount: g.rows.length, sample: g.rows.slice(0, 12).map((r) => r.slice(0, 24)), mapping: mappings[i] })),
    summary: {
      clients: extracted.clients.length,
      workouts: extracted.clients.reduce((n, c) => n + c.workouts.length, 0),
      bodyweights: extracted.clients.reduce((n, c) => n + c.weights.length, 0),
      skippedRows: extracted.skippedRows,
    },
    assumptions: extracted.assumptions,
    warnings: [...dropped, ...extracted.warnings],
    clients: extracted.clients.map((c) => ({
      key: c.key,
      name: c.name,
      email: c.email,
      workouts: c.workouts.length,
      bodyweights: c.weights.length,
      firstDate: c.workouts[0]?.date ?? c.weights[0]?.date ?? null,
      lastDate: c.workouts[c.workouts.length - 1]?.date ?? c.weights[c.weights.length - 1]?.date ?? null,
      matchesExisting: !!c.email && existing.has(c.email),
      ...(c.goal ? { goal: c.goal } : {}),
      ...(c.injuries ? { injuries: c.injuries } : {}),
      sample: c.workouts.slice(-3).reverse().map((w) => ({ date: w.date, summary: summariseWorkout(w, fmt) })),
    })),
  };
}

async function build(row: Awaited<ReturnType<typeof owned>>, pref: UnitPreference): Promise<ImportPreview> {
  const grids: Grid[] = JSON.parse(row.sheetsJson);
  const mappings: SheetMapping[] = JSON.parse(row.mappingJson);
  const extracted = extract(grids, mappings, estDateString(new Date()));
  return preview(row, grids, mappings, extracted, await rosterEmails(row.practiceId), pref);
}

export async function createImport(input: { practiceId: string; trainerId: string; fileName: unknown; sheets: unknown; pref: UnitPreference }): Promise<ImportPreview> {
  const fileName = typeof input.fileName === 'string' && input.fileName.trim() ? input.fileName.trim().slice(0, 120) : 'Spreadsheet';
  const { grids, dropped } = sanitiseGrids(input.sheets);
  if (grids.length === 0) throw new ImportError('That file has no rows to read', 400);
  const cells = grids.reduce((n, g) => n + g.rows.reduce((m, r) => m + r.length, 0), 0);
  if (cells > MAX_UPLOAD_CELLS) throw new ImportError('That file is too large to import in one go. Split it into smaller files.', 413);

  const { mappings } = await proposeMappings(grids, defaultsFor(input.pref));
  const row = await prisma.ptImport.create({
    data: { practiceId: input.practiceId, trainerId: input.trainerId, fileName, sheetsJson: JSON.stringify(grids), mappingJson: JSON.stringify(mappings) },
  });
  const extracted = extract(grids, mappings, estDateString(new Date()));
  return preview(row, grids, mappings, extracted, await rosterEmails(input.practiceId), input.pref, dropped);
}

export async function getImport(importId: string, practiceId: string, pref: UnitPreference): Promise<ImportPreview> {
  return build(await owned(importId, practiceId), pref);
}

/** The trainer's corrections to how the sheets are read. Only while the import is still in review. */
export async function updateMappings(importId: string, practiceId: string, raw: unknown, pref: UnitPreference): Promise<ImportPreview> {
  const row = await owned(importId, practiceId);
  if (row.status !== 'review') throw new ImportError('This import has already been completed', 409);
  const grids: Grid[] = JSON.parse(row.sheetsJson);
  const given = Array.isArray(raw) ? raw : [];
  const defaults = defaultsFor(pref);
  const mappings = grids.map((g) => validateMapping(given.find((m: any) => m?.sheet === g.name), g, suggestMapping(g, defaults)));
  const updated = await prisma.ptImport.update({ where: { id: row.id }, data: { mappingJson: JSON.stringify(mappings) } });
  return build(updated, pref);
}

export async function listImports(practiceId: string): Promise<ImportSummary[]> {
  const rows = await prisma.ptImport.findMany({
    where: { practiceId, status: { in: ['imported', 'undone'] } },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { id: true, fileName: true, status: true, summaryJson: true, createdAt: true, importedAt: true },
  });
  return rows.map((r) => {
    let s: any = {};
    try { s = JSON.parse(r.summaryJson); } catch { /* an unreadable summary shows as zeros */ }
    return {
      id: r.id, fileName: r.fileName, status: r.status as ImportSummary['status'], clients: s.clients ?? 0, workouts: s.workouts ?? 0,
      createdAt: r.createdAt.toISOString(), ...(r.importedAt ? { importedAt: r.importedAt.toISOString() } : {}),
    };
  });
}

/**
 * Import the reviewed sheet as one batch. A client whose email matches someone
 * already on the roster has their history attached to that person; everyone
 * else becomes (or is added to) a "Not joined" prospect of the practice.
 */
export async function confirmImport(importId: string, practiceId: string, trainerId: string): Promise<ImportSummary> {
  const row = await owned(importId, practiceId);
  if (row.status !== 'review') throw new ImportError('This import has already been completed', 409);
  const grids: Grid[] = JSON.parse(row.sheetsJson);
  const extracted = extract(grids, JSON.parse(row.mappingJson), estDateString(new Date()));
  if (extracted.clients.length === 0) throw new ImportError('There is nothing to import. Check how the sheets were read.', 400);
  const existing = await rosterEmails(practiceId);

  const summary = { clients: extracted.clients.length, workouts: 0, bodyweights: 0, linkedToExisting: 0 };
  await prisma.$transaction(async (tx) => {
    // Claimed first, so a double-click cannot import the same file twice.
    const claimed = await tx.ptImport.updateMany({ where: { id: row.id, status: 'review' }, data: { status: 'imported', importedAt: new Date() } });
    if (claimed.count !== 1) throw new ImportError('This import has already been completed', 409);

    for (const c of extracted.clients) {
      const linkedUserId = c.email ? existing.get(c.email) ?? null : null;
      if (linkedUserId) summary.linkedToExisting += 1;
      const details = { email: c.email, phone: c.phone ?? null, goal: c.goal ?? null, injuries: c.injuries ?? null, notes: c.notes ?? null };
      const prior = await tx.ptProspect.findUnique({ where: { practiceId_nameKey: { practiceId, nameKey: c.key } } });
      // The same person in a second file adds to their record; details already on file are kept unless the new sheet has them.
      const prospect = prior
        ? await tx.ptProspect.update({
            where: { id: prior.id },
            data: {
              ...Object.fromEntries(Object.entries(details).filter(([, v]) => v)),
              ...(linkedUserId && !prior.userId ? { userId: linkedUserId, joinedAt: new Date() } : {}),
            },
          })
        : await tx.ptProspect.create({
            data: { practiceId, importId: row.id, nameKey: c.key, name: c.name, ...details, ...(linkedUserId ? { userId: linkedUserId, joinedAt: new Date() } : {}) },
          });

      if (c.workouts.length) {
        // A date this client already has from an earlier import is not imported twice.
        const have = new Set((await tx.ptImportedWorkout.findMany({ where: { prospectId: prospect.id }, select: { date: true } })).map((w) => w.date));
        const fresh = c.workouts.filter((w) => !have.has(w.date));
        await tx.ptImportedWorkout.createMany({
          data: fresh.map((w) => ({
            practiceId, prospectId: prospect.id, importId: row.id, date: w.date, at: atNoon(w.date),
            title: w.title ?? null, notes: w.notes ?? null, exercises: JSON.stringify(w.exercises),
          })),
        });
        summary.workouts += fresh.length;
      }
      if (c.weights.length) {
        const have = new Set((await tx.ptImportedWeight.findMany({ where: { prospectId: prospect.id }, select: { date: true } })).map((w) => w.date));
        const fresh = c.weights.filter((w) => !have.has(w.date));
        await tx.ptImportedWeight.createMany({
          data: fresh.map((w) => ({ practiceId, prospectId: prospect.id, importId: row.id, date: w.date, at: atNoon(w.date), weightKg: w.weightKg })),
        });
        summary.bodyweights += fresh.length;
      }
    }
    await tx.ptImport.update({ where: { id: row.id }, data: { summaryJson: JSON.stringify(summary) } });
  }, { timeout: 120_000 });

  await audit({ practiceId, trainerId, action: 'import_confirmed', itemType: 'import', itemId: row.id, meta: { fileName: row.fileName, ...summary } });
  return { id: row.id, fileName: row.fileName, status: 'imported', clients: summary.clients, workouts: summary.workouts, createdAt: row.createdAt.toISOString(), importedAt: new Date().toISOString() };
}

/** Take a whole import back out: its sessions and weigh-ins, and any prospect it created who has nothing else. */
export async function undoImport(importId: string, practiceId: string, trainerId: string): Promise<void> {
  const row = await owned(importId, practiceId);
  if (row.status !== 'imported') throw new ImportError('Only a completed import can be undone', 409);
  await prisma.$transaction(async (tx) => {
    await tx.ptImportedWorkout.deleteMany({ where: { importId: row.id } });
    await tx.ptImportedWeight.deleteMany({ where: { importId: row.id } });
    const created = await tx.ptProspect.findMany({ where: { importId: row.id }, select: { id: true } });
    for (const p of created) {
      const [workouts, weights] = await Promise.all([
        tx.ptImportedWorkout.count({ where: { prospectId: p.id } }),
        tx.ptImportedWeight.count({ where: { prospectId: p.id } }),
      ]);
      // Someone a later import added history to is kept, with that later history.
      if (workouts + weights === 0) {
        await tx.ptNote.deleteMany({ where: { practiceId, clientId: `${PROSPECT_PREFIX}${p.id}` } });
        await tx.ptProspect.delete({ where: { id: p.id } });
      }
    }
    await tx.ptImport.update({ where: { id: row.id }, data: { status: 'undone', undoneAt: new Date() } });
  }, { timeout: 60_000 });
  await audit({ practiceId, trainerId, action: 'import_undone', itemType: 'import', itemId: row.id, meta: { fileName: row.fileName } });
}

// ── Prospects: inviting, and linking when they join ──────────────────────────

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** An invite link for a "Not joined" client, bound to their email so only they can use it. */
export async function inviteProspect(input: { prospectId: string; practiceId: string; trainerId: string; email?: unknown }) {
  const prospect = await prisma.ptProspect.findUnique({ where: { id: input.prospectId } });
  if (!prospect || prospect.practiceId !== input.practiceId) throw new ImportError('Client not found', 404);
  if (prospect.userId) throw new ImportError('This client has already joined', 409);
  const email = (typeof input.email === 'string' && input.email.trim() ? input.email : prospect.email ?? '').trim().toLowerCase();
  if (!EMAIL.test(email)) throw new ImportError('Add this client\'s email address to invite them', 400);

  const invite = await prisma.institutionInvite.create({
    data: { institutionId: input.practiceId, invitedByUserId: input.trainerId, email, role: 'athlete', expiresAt: new Date(Date.now() + 14 * 86_400_000) },
  });
  await prisma.ptProspect.update({ where: { id: prospect.id }, data: { email, inviteToken: invite.token, invitedAt: new Date() } });
  return { token: invite.token, link: `${FRONTEND_URL}/personal-training/join/${invite.token}`, email, expiresAt: invite.expiresAt };
}

/**
 * Someone has just joined the practice. If they are a person the trainer
 * imported — matched by the invite they used or by their email — link the
 * record to their account. Their imported history then shows alongside what
 * they log; it is not copied into their account, so it cannot move their
 * streaks, trigger PR alerts or feed program changes.
 */
export async function linkProspectsOnJoin(practiceId: string, userId: string, token: string): Promise<number> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const email = user?.email?.toLowerCase().trim();
  const matches = await prisma.ptProspect.findMany({
    where: { practiceId, userId: null, OR: [{ inviteToken: token }, ...(email ? [{ email }] : [])] },
    select: { id: true },
  });
  for (const p of matches) {
    await prisma.ptProspect.update({ where: { id: p.id }, data: { userId, joinedAt: new Date() } });
    // Notes the trainer wrote while they were "Not joined" follow them to their real record.
    await prisma.ptNote.updateMany({ where: { practiceId, clientId: `${PROSPECT_PREFIX}${p.id}` }, data: { clientId: userId } });
  }
  return matches.length;
}

export { nameKey };
