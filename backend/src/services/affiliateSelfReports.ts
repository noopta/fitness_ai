// Self-reported referrals: people an affiliate brought in before they had a
// code. The affiliate logs them from their dashboard (per-affiliate opt-in,
// Affiliate.selfReportEnabled); the Axiom team reviews them. Recording a
// decision here never touches User.referredByCode or commissions — commission
// attribution for these stays a founder decision. Storage: affiliateSelfReportsRepo.
import { z } from 'zod';
import * as repo from './affiliateSelfReportsRepo.js';

export const SELF_REPORT_STATUSES = ['submitted', 'matched', 'approved', 'rejected'] as const;
export const MAX_SELF_REPORTS_PER_AFFILIATE = 500;

const DAY_MS = 24 * 60 * 60 * 1000;
const EARLIEST_DATE_MS = Date.parse('2000-01-01T00:00:00Z');

const optText = (max: number) =>
  z.union([z.string().trim().max(max), z.null()]).optional().transform(v => (v === undefined ? undefined : v ? v : null));

const optEmail = z
  .union([z.literal(''), z.string().trim().toLowerCase().max(254).email('must be a valid email'), z.null()])
  .optional()
  .transform(v => (v === undefined ? undefined : v ? v : null));

// Approximate sign-up date: an ISO date (or date-time) that isn't in the
// future. One day of slack so a date-only value in any timezone passes today.
const optPastDate = z
  .union([z.string().trim().max(40), z.null()])
  .optional()
  .refine(v => v == null || v === '' || !Number.isNaN(Date.parse(v)), 'must be an ISO date')
  .refine(v => v == null || v === '' || Date.parse(v) <= Date.now() + DAY_MS, 'cannot be in the future')
  .refine(v => v == null || v === '' || Date.parse(v) >= EARLIEST_DATE_MS, 'is too far in the past')
  .transform(v => (v === undefined ? undefined : v ? new Date(v) : null));

export const selfReportCreateSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(120),
  email: optEmail,
  note: optText(1000),
  approxSignupDate: optPastDate,
}).strict();
export const selfReportUpdateSchema = selfReportCreateSchema.partial().strict();

export const selfReportAdminUpdateSchema = z.object({
  status: z.enum(SELF_REPORT_STATUSES).optional(),
  adminNote: optText(1000),
  matchedUserId: optText(64),
}).strict();

export const selfReportToggleSchema = z.object({ enabled: z.boolean() }).strict();

function iso(d: unknown): string | null {
  if (d === null || d === undefined || d === '') return null;
  const v = d instanceof Date ? d : new Date(typeof d === 'bigint' ? Number(d) : (d as any));
  return Number.isNaN(v.getTime()) ? null : v.toISOString();
}

function stripUndefined<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** What the affiliate sees: never matchedUserId or adminNote. */
export function serializeForAffiliate(r: any) {
  return {
    id: r.id,
    name: r.name,
    email: r.email ?? null,
    note: r.note ?? null,
    approxSignupDate: iso(r.approxSignupDate),
    status: r.status,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

export function serializeForAdmin(r: any) {
  return { ...serializeForAffiliate(r), matchedUserId: r.matchedUserId ?? null, adminNote: r.adminNote ?? null };
}

export async function isSelfReportEnabled(affiliate: { id: string; selfReportEnabled?: unknown }): Promise<boolean> {
  if (typeof affiliate.selfReportEnabled === 'boolean') return affiliate.selfReportEnabled;
  try {
    return (await repo.getSelfReportEnabled(affiliate.id)) === true;
  } catch (err: any) {
    // Column not pushed yet → feature off, never a broken dashboard.
    console.warn('[affiliates] selfReportEnabled unreadable:', err?.message ?? err);
    return false;
  }
}

export async function setSelfReportEnabled(affiliateId: string, enabled: boolean): Promise<boolean> {
  return (await repo.setSelfReportEnabled(affiliateId, enabled)) > 0;
}

export async function listForAffiliate(affiliateId: string) {
  return (await repo.listSelfReportRows(affiliateId)).map(serializeForAffiliate);
}

export type SelfReportResult<T> = { ok: true; value: T } | { ok: false; status: 404 | 409; error: string };

const NOT_FOUND = { ok: false as const, status: 404 as const, error: 'Entry not found' };
const LOCKED = { ok: false as const, status: 409 as const, error: 'This entry has already been reviewed and can no longer be changed.' };

export async function createForAffiliate(affiliateId: string, data: z.infer<typeof selfReportCreateSchema>): Promise<SelfReportResult<ReturnType<typeof serializeForAffiliate>>> {
  if ((await repo.countSelfReportRows(affiliateId)) >= MAX_SELF_REPORTS_PER_AFFILIATE) {
    return { ok: false, status: 409, error: `You can log up to ${MAX_SELF_REPORTS_PER_AFFILIATE} people. Contact the Axiom team to add more.` };
  }
  const row = await repo.insertSelfReportRow(affiliateId, stripUndefined(data));
  return { ok: true, value: serializeForAffiliate(row) };
}

export async function updateForAffiliate(affiliateId: string, id: string, data: z.infer<typeof selfReportUpdateSchema>): Promise<SelfReportResult<ReturnType<typeof serializeForAffiliate>>> {
  const existing = await repo.getSelfReportRow(affiliateId, id);
  if (!existing) return NOT_FOUND;
  if (existing.status !== 'submitted') return LOCKED;
  const row = await repo.updateSelfReportRowAsAffiliate(affiliateId, id, stripUndefined(data));
  // Null here means the status changed between the read and the write.
  return row ? { ok: true, value: serializeForAffiliate(row) } : LOCKED;
}

export async function deleteForAffiliate(affiliateId: string, id: string): Promise<SelfReportResult<true>> {
  const existing = await repo.getSelfReportRow(affiliateId, id);
  if (!existing) return NOT_FOUND;
  if (existing.status !== 'submitted') return LOCKED;
  return (await repo.deleteSubmittedSelfReportRow(affiliateId, id)) > 0 ? { ok: true, value: true } : LOCKED;
}

/** Admin view: every field plus a best-effort match on the logged email. */
export async function listForAdmin(affiliateId: string) {
  const rows = await repo.listSelfReportRows(affiliateId);
  const emails = rows.map(r => r.email).filter((e): e is string => typeof e === 'string' && !!e);
  const users = emails.length ? await repo.usersByEmails(emails) : [];
  const byEmail = new Map(users.map(u => [String(u.email ?? '').toLowerCase(), u]));
  return rows.map(r => {
    const u = r.email ? byEmail.get(String(r.email).toLowerCase()) : undefined;
    return {
      ...serializeForAdmin(r),
      suggestedMatch: u
        ? { userId: u.id, name: u.name ?? null, tier: u.tier ?? null, createdAt: iso(u.createdAt), referredByCode: u.referredByCode ?? null }
        : null,
    };
  });
}

export async function updateForAdmin(affiliateId: string, id: string, data: z.infer<typeof selfReportAdminUpdateSchema>) {
  const row = await repo.updateSelfReportRowAsAdmin(affiliateId, id, stripUndefined(data));
  return row ? serializeForAdmin(row) : null;
}

export async function matchedUserExists(userId: string): Promise<boolean> {
  return repo.userExists(userId);
}
