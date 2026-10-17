// Storage for affiliate terms columns, AffiliateTrainerReferral and
// AffiliateManualPayout.
//
// Parameterised raw SQL on purpose: these columns/models are newer than the
// generated Prisma client in some environments (worktrees and the preview
// backend share prod's node_modules/.prisma), and an ungenerated delegate is
// simply `undefined` at runtime. Raw SQL works against the pushed schema
// whatever client is installed. SQLite stores DateTime as integer ms; Prisma
// binds Date params that way and reads DATETIME columns back as Date.
// Column names below come from fixed whitelists — never from input.
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

const prisma = new PrismaClient();

type Row = Record<string, any>;

export class UniqueConstraintError extends Error {
  code = 'P2002';
}

function rethrow(err: any): never {
  const msg = String(err?.message ?? err);
  if (/UNIQUE constraint failed/i.test(msg)) throw new UniqueConstraintError(msg);
  throw err;
}

async function q(sql: string, ...params: unknown[]): Promise<Row[]> {
  try {
    return (await prisma.$queryRawUnsafe(sql, ...params)) as Row[];
  } catch (err) {
    rethrow(err);
  }
}
async function x(sql: string, ...params: unknown[]): Promise<number> {
  try {
    return Number(await prisma.$executeRawUnsafe(sql, ...params));
  } catch (err) {
    rethrow(err);
  }
}

function setClause(patch: Row, allowed: readonly string[]) {
  const cols = Object.keys(patch).filter(k => allowed.includes(k) && patch[k] !== undefined);
  return { sql: cols.map(c => `"${c}" = ?`).join(', '), values: cols.map(c => patch[c]), cols };
}

// ─── Affiliate terms ──────────────────────────────────────────────────────────

export const TERMS_COLUMNS = ['commissionRate', 'trainerCommissionRate', 'campaignRate', 'perVideoFeeCents', 'agreementNote', 'agreementUpdatedAt'] as const;

export async function getTermsRow(affiliateId: string): Promise<Row | null> {
  const rows = await q(`SELECT ${TERMS_COLUMNS.map(c => `"${c}"`).join(', ')} FROM "Affiliate" WHERE "id" = ?`, affiliateId);
  return rows[0] ?? null;
}

export async function updateTermsRow(affiliateId: string, patch: Row): Promise<number> {
  const { sql, values, cols } = setClause(patch, TERMS_COLUMNS);
  if (!cols.length) return 0;
  return x(`UPDATE "Affiliate" SET ${sql}, "updatedAt" = ? WHERE "id" = ?`, ...values, new Date(), affiliateId);
}

// ─── Trainer referrals ────────────────────────────────────────────────────────

export const TRAINER_REFERRAL_COLUMNS = ['trainerName', 'organization', 'contact', 'plan', 'status', 'coachBetaSignupId', 'startedAt', 'note'] as const;

export async function listTrainerReferralRows(affiliateId: string): Promise<Row[]> {
  return q(`SELECT * FROM "AffiliateTrainerReferral" WHERE "affiliateId" = ? ORDER BY "createdAt" DESC`, affiliateId);
}

export async function getTrainerReferralRow(affiliateId: string, id: string): Promise<Row | null> {
  const rows = await q(`SELECT * FROM "AffiliateTrainerReferral" WHERE "id" = ? AND "affiliateId" = ?`, id, affiliateId);
  return rows[0] ?? null;
}

export async function insertTrainerReferralRow(affiliateId: string, data: Row): Promise<Row> {
  const id = randomUUID();
  const now = new Date();
  const cols = TRAINER_REFERRAL_COLUMNS.filter(c => data[c] !== undefined);
  await x(
    `INSERT INTO "AffiliateTrainerReferral" ("id", "affiliateId", ${cols.map(c => `"${c}"`).join(', ')}${cols.length ? ', ' : ''}"createdAt", "updatedAt")
     VALUES (?, ?, ${cols.map(() => '?').join(', ')}${cols.length ? ', ' : ''}?, ?)`,
    id, affiliateId, ...cols.map(c => data[c]), now, now,
  );
  return (await getTrainerReferralRow(affiliateId, id))!;
}

export async function updateTrainerReferralRow(affiliateId: string, id: string, patch: Row): Promise<Row | null> {
  const { sql, values } = setClause(patch, TRAINER_REFERRAL_COLUMNS);
  const n = await x(
    `UPDATE "AffiliateTrainerReferral" SET ${sql ? `${sql}, ` : ''}"updatedAt" = ? WHERE "id" = ? AND "affiliateId" = ?`,
    ...values, new Date(), id, affiliateId,
  );
  return n ? getTrainerReferralRow(affiliateId, id) : null;
}

export async function deleteTrainerReferralRow(affiliateId: string, id: string): Promise<number> {
  return x(`DELETE FROM "AffiliateTrainerReferral" WHERE "id" = ? AND "affiliateId" = ?`, id, affiliateId);
}

// ─── Manual payouts ───────────────────────────────────────────────────────────

export const MANUAL_PAYOUT_COLUMNS = ['kind', 'description', 'amountCents', 'currency', 'status', 'paidAt', 'reference', 'note'] as const;

export async function listManualPayoutRows(affiliateId: string): Promise<Row[]> {
  return q(`SELECT * FROM "AffiliateManualPayout" WHERE "affiliateId" = ? ORDER BY COALESCE("paidAt", "createdAt") DESC, "createdAt" DESC`, affiliateId);
}

export async function getManualPayoutRow(affiliateId: string, id: string): Promise<Row | null> {
  const rows = await q(`SELECT * FROM "AffiliateManualPayout" WHERE "id" = ? AND "affiliateId" = ?`, id, affiliateId);
  return rows[0] ?? null;
}

export async function findManualPayoutByReference(affiliateId: string, reference: string): Promise<Row | null> {
  const rows = await q(`SELECT * FROM "AffiliateManualPayout" WHERE "affiliateId" = ? AND "reference" = ? LIMIT 1`, affiliateId, reference);
  return rows[0] ?? null;
}

export async function insertManualPayoutRow(affiliateId: string, data: Row): Promise<Row> {
  const id = randomUUID();
  const now = new Date();
  const cols = MANUAL_PAYOUT_COLUMNS.filter(c => data[c] !== undefined);
  await x(
    `INSERT INTO "AffiliateManualPayout" ("id", "affiliateId", ${cols.map(c => `"${c}"`).join(', ')}, "createdAt", "updatedAt")
     VALUES (?, ?, ${cols.map(() => '?').join(', ')}, ?, ?)`,
    id, affiliateId, ...cols.map(c => data[c]), now, now,
  );
  return (await getManualPayoutRow(affiliateId, id))!;
}

export async function updateManualPayoutRow(affiliateId: string, id: string, patch: Row): Promise<Row | null> {
  const { sql, values } = setClause(patch, MANUAL_PAYOUT_COLUMNS);
  const n = await x(
    `UPDATE "AffiliateManualPayout" SET ${sql ? `${sql}, ` : ''}"updatedAt" = ? WHERE "id" = ? AND "affiliateId" = ?`,
    ...values, new Date(), id, affiliateId,
  );
  return n ? getManualPayoutRow(affiliateId, id) : null;
}

export async function deleteManualPayoutRow(affiliateId: string, id: string): Promise<number> {
  return x(`DELETE FROM "AffiliateManualPayout" WHERE "id" = ? AND "affiliateId" = ?`, id, affiliateId);
}

// ─── Coach beta sign-ups (attribution source) ─────────────────────────────────

export async function coachSignupsWithSource(limit = 5000): Promise<Row[]> {
  return q(
    `SELECT "id", "name", "email", "source", "createdAt", "invitedAt" FROM "CoachBetaSignup"
     WHERE "source" IS NOT NULL AND "source" <> '' ORDER BY "createdAt" DESC LIMIT ?`,
    limit,
  );
}
