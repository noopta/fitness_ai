// Storage for CoachBetaSignup (/coaches launch list).
//
// Parameterised raw SQL on purpose, same as affiliateExtrasRepo.ts: the model
// is newer than the generated Prisma client in some environments (worktrees
// and the preview backend share prod's node_modules/.prisma), and an
// ungenerated delegate is simply `undefined` at runtime. Raw SQL works against
// the pushed schema whatever client is installed. Column names come from the
// fixed whitelist below — never from input.
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

const prisma = new PrismaClient();

export type CoachBetaRow = Record<string, any>;

export const COACH_BETA_COLUMNS = [
  'name', 'socialPlatform', 'socialHandle', 'coachingType', 'clientCount', 'website', 'platformToday',
  'message', 'marketingConsentAt', 'source', 'ip', 'userAgent', 'notifiedAt', 'unsubscribedAt', 'invitedAt',
] as const;

const isUnique = (err: any) => /UNIQUE constraint failed/i.test(String(err?.message ?? err));

const DATE_COLUMNS = ['createdAt', 'marketingConsentAt', 'notifiedAt', 'unsubscribedAt', 'invitedAt'] as const;

/** Raw reads can surface SQLite DateTime as integer ms (number/bigint) or text; always hand back Date. */
function normalise(row: CoachBetaRow): CoachBetaRow {
  for (const c of DATE_COLUMNS) {
    const v = row[c];
    if (v == null || v instanceof Date) continue;
    const d = typeof v === 'bigint' ? new Date(Number(v)) : new Date(typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v);
    if (!Number.isNaN(d.getTime())) row[c] = d;
  }
  return row;
}

async function q(sql: string, ...params: unknown[]): Promise<CoachBetaRow[]> {
  return ((await prisma.$queryRawUnsafe(sql, ...params)) as CoachBetaRow[]).map(normalise);
}
async function x(sql: string, ...params: unknown[]): Promise<number> {
  return Number(await prisma.$executeRawUnsafe(sql, ...params));
}

function pick(patch: CoachBetaRow) {
  const cols = COACH_BETA_COLUMNS.filter(c => patch[c] !== undefined);
  return { cols, values: cols.map(c => patch[c]) };
}

export async function findSignupByEmail(email: string): Promise<CoachBetaRow | null> {
  return (await q(`SELECT * FROM "CoachBetaSignup" WHERE "email" = ? LIMIT 1`, email))[0] ?? null;
}

export async function findSignupById(id: string): Promise<CoachBetaRow | null> {
  return (await q(`SELECT * FROM "CoachBetaSignup" WHERE "id" = ? LIMIT 1`, id))[0] ?? null;
}

/** Update whitelisted columns on a row. Returns rows changed. */
export async function updateSignup(id: string, patch: CoachBetaRow): Promise<number> {
  const { cols, values } = pick(patch);
  if (!cols.length) return 0;
  return x(`UPDATE "CoachBetaSignup" SET ${cols.map(c => `"${c}" = ?`).join(', ')} WHERE "id" = ?`, ...values, id);
}

/**
 * Insert-or-update by (lowercased) email. `update` is applied to an existing
 * row, `create` to a new one. A concurrent insert of the same email falls back
 * to the update path.
 */
export async function upsertSignupByEmail(email: string, create: CoachBetaRow, update: CoachBetaRow): Promise<CoachBetaRow> {
  const existing = await findSignupByEmail(email);
  if (existing) {
    await updateSignup(existing.id, update);
    return (await findSignupById(existing.id))!;
  }
  const id = randomUUID();
  const { cols, values } = pick(create);
  try {
    await x(
      `INSERT INTO "CoachBetaSignup" ("id", "email", ${cols.map(c => `"${c}"`).join(', ')}${cols.length ? ', ' : ''}"createdAt")
       VALUES (?, ?, ${cols.map(() => '?').join(', ')}${cols.length ? ', ' : ''}?)`,
      id, email, ...values, new Date(),
    );
  } catch (err) {
    if (!isUnique(err)) throw err;
    const raced = await findSignupByEmail(email);
    if (!raced) throw err;
    await updateSignup(raced.id, update);
    return (await findSignupById(raced.id))!;
  }
  return (await findSignupById(id))!;
}

export async function listSignupRows(limit = 10_000): Promise<CoachBetaRow[]> {
  return q(`SELECT * FROM "CoachBetaSignup" ORDER BY "createdAt" DESC LIMIT ?`, limit);
}

/** Set unsubscribedAt on a still-subscribed row. Returns rows changed. */
export async function markUnsubscribed(id: string, at = new Date()): Promise<number> {
  return x(`UPDATE "CoachBetaSignup" SET "unsubscribedAt" = ? WHERE "id" = ? AND "unsubscribedAt" IS NULL`, at, id);
}
