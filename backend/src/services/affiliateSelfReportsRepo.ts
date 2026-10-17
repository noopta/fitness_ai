// Storage for Affiliate.selfReportEnabled and AffiliateSelfReportedReferral:
// people an affiliate says they referred before they had a code.
//
// Parameterised raw SQL for the same reason as affiliateExtrasRepo.ts: the
// column/model is newer than the generated Prisma client in some environments,
// and an ungenerated delegate is `undefined` at runtime. DateTime columns are
// written as integer epoch milliseconds (Prisma's SQLite format) — numbers are
// bound explicitly so the stored form never depends on driver Date handling.
// Column names come from fixed whitelists below — never from input.
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

const prisma = new PrismaClient();

type Row = Record<string, any>;

async function q(sql: string, ...params: unknown[]): Promise<Row[]> {
  return (await prisma.$queryRawUnsafe(sql, ...params)) as Row[];
}
async function x(sql: string, ...params: unknown[]): Promise<number> {
  return Number(await prisma.$executeRawUnsafe(sql, ...params));
}

/** Date | null → epoch ms | null (other values pass through untouched). */
function ms(v: unknown): unknown {
  return v instanceof Date ? v.getTime() : v;
}

function setClause(patch: Row, allowed: readonly string[]) {
  const cols = Object.keys(patch).filter(k => allowed.includes(k) && patch[k] !== undefined);
  return { sql: cols.map(c => `"${c}" = ?`).join(', '), values: cols.map(c => ms(patch[c])), cols };
}

export function sqliteBool(v: unknown): boolean {
  if (typeof v === 'number' || typeof v === 'bigint') return Number(v) === 1;
  return v === true || v === '1' || v === 'true';
}

// ─── Opt-in flag ──────────────────────────────────────────────────────────────

/** null when the affiliate doesn't exist. */
export async function getSelfReportEnabled(affiliateId: string): Promise<boolean | null> {
  const rows = await q(`SELECT "selfReportEnabled" FROM "Affiliate" WHERE "id" = ?`, affiliateId);
  return rows[0] ? sqliteBool(rows[0].selfReportEnabled) : null;
}

export async function setSelfReportEnabled(affiliateId: string, enabled: boolean): Promise<number> {
  return x(`UPDATE "Affiliate" SET "selfReportEnabled" = ?, "updatedAt" = ? WHERE "id" = ?`, enabled ? 1 : 0, Date.now(), affiliateId);
}

// ─── Self-reported referrals ──────────────────────────────────────────────────

/** Columns the affiliate may write. */
export const SELF_REPORT_AFFILIATE_COLUMNS = ['name', 'email', 'note', 'approxSignupDate'] as const;
/** Columns an admin may write. */
export const SELF_REPORT_ADMIN_COLUMNS = ['status', 'adminNote', 'matchedUserId'] as const;

export async function listSelfReportRows(affiliateId: string): Promise<Row[]> {
  return q(`SELECT * FROM "AffiliateSelfReportedReferral" WHERE "affiliateId" = ? ORDER BY "createdAt" DESC, "id" DESC`, affiliateId);
}

export async function countSelfReportRows(affiliateId: string): Promise<number> {
  const rows = await q(`SELECT COUNT(*) AS "n" FROM "AffiliateSelfReportedReferral" WHERE "affiliateId" = ?`, affiliateId);
  return Number(rows[0]?.n ?? 0);
}

export async function getSelfReportRow(affiliateId: string, id: string): Promise<Row | null> {
  const rows = await q(`SELECT * FROM "AffiliateSelfReportedReferral" WHERE "id" = ? AND "affiliateId" = ?`, id, affiliateId);
  return rows[0] ?? null;
}

export async function insertSelfReportRow(affiliateId: string, data: Row): Promise<Row> {
  const id = randomUUID();
  const now = Date.now();
  const cols = SELF_REPORT_AFFILIATE_COLUMNS.filter(c => data[c] !== undefined);
  await x(
    `INSERT INTO "AffiliateSelfReportedReferral" ("id", "affiliateId", ${cols.map(c => `"${c}"`).join(', ')}${cols.length ? ', ' : ''}"status", "createdAt", "updatedAt")
     VALUES (?, ?, ${cols.map(() => '?').join(', ')}${cols.length ? ', ' : ''}?, ?, ?)`,
    id, affiliateId, ...cols.map(c => ms(data[c])), 'submitted', now, now,
  );
  return (await getSelfReportRow(affiliateId, id))!;
}

/**
 * Patch a row. `onlyIfStatus` makes the write conditional (the affiliate may
 * only edit while 'submitted') so a concurrent admin decision can't be raced.
 */
async function updateRow(affiliateId: string, id: string, patch: Row, allowed: readonly string[], onlyIfStatus?: string): Promise<Row | null> {
  const { sql, values } = setClause(patch, allowed);
  const guard = onlyIfStatus ? ` AND "status" = ?` : '';
  const n = await x(
    `UPDATE "AffiliateSelfReportedReferral" SET ${sql ? `${sql}, ` : ''}"updatedAt" = ? WHERE "id" = ? AND "affiliateId" = ?${guard}`,
    ...values, Date.now(), id, affiliateId, ...(onlyIfStatus ? [onlyIfStatus] : []),
  );
  return n ? getSelfReportRow(affiliateId, id) : null;
}

export function updateSelfReportRowAsAffiliate(affiliateId: string, id: string, patch: Row): Promise<Row | null> {
  return updateRow(affiliateId, id, patch, SELF_REPORT_AFFILIATE_COLUMNS, 'submitted');
}

export function updateSelfReportRowAsAdmin(affiliateId: string, id: string, patch: Row): Promise<Row | null> {
  return updateRow(affiliateId, id, patch, SELF_REPORT_ADMIN_COLUMNS);
}

/** Deletes only while 'submitted'. */
export async function deleteSubmittedSelfReportRow(affiliateId: string, id: string): Promise<number> {
  return x(`DELETE FROM "AffiliateSelfReportedReferral" WHERE "id" = ? AND "affiliateId" = ? AND "status" = 'submitted'`, id, affiliateId);
}

// ─── Match suggestions (admin) ────────────────────────────────────────────────

/** Users whose email (case-insensitive) is one of `emails`. */
export async function usersByEmails(emails: string[]): Promise<Row[]> {
  const list = [...new Set(emails.map(e => e.trim().toLowerCase()).filter(Boolean))].slice(0, 500);
  if (!list.length) return [];
  return q(
    `SELECT "id", "name", "email", "tier", "createdAt", "referredByCode" FROM "User" WHERE lower("email") IN (${list.map(() => '?').join(', ')})`,
    ...list,
  );
}

export async function userExists(id: string): Promise<boolean> {
  const rows = await q(`SELECT "id" FROM "User" WHERE "id" = ?`, id);
  return rows.length > 0;
}
