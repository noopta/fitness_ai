// Affiliate extras beyond the automatic consumer-Pro commission pipeline:
// personal terms, trainer referrals (recorded by the Axiom team, plus coach
// beta sign-ups attributed from the affiliate's ?ref= link) and payouts made
// outside Stripe (UGC fees, bonuses). Storage lives in affiliateExtrasRepo.
import { z } from 'zod';
import { AFFILIATE_PAYMENT_STRUCTURE } from './affiliatePaymentStructure.js';
import * as repo from './affiliateExtrasRepo.js';

// ─── Enums + validation ───────────────────────────────────────────────────────

export const TRAINER_PLANS = ['free', 'coach', 'pro', 'unknown'] as const;
export const TRAINER_STATUSES = ['lead', 'contacted', 'signed_up', 'onboarded', 'active', 'lost'] as const;
export const MANUAL_PAYOUT_KINDS = ['ugc', 'trainer_bonus', 'campaign', 'discretionary', 'other'] as const;
export const MANUAL_PAYOUT_STATUSES = ['pending', 'paid'] as const;

const trimmed = (max: number) => z.string().trim().max(max);
/** Optional text: '' / null clears the field. */
const optText = (max: number) =>
  z.union([trimmed(max), z.null()]).optional().transform(v => (v === undefined ? undefined : v ? v : null));
const optDate = z
  .union([z.string().trim().max(40), z.null()])
  .optional()
  .refine(v => v == null || v === '' || !Number.isNaN(Date.parse(v)), 'must be an ISO date')
  .transform(v => (v === undefined ? undefined : v ? new Date(v) : null));
const rate = z.number().finite().min(0).max(1);
const cents = z.number().int().min(0).max(100_000_000);

export const trainerReferralCreateSchema = z.object({
  trainerName: trimmed(120).min(1, 'trainerName is required'),
  organization: optText(160),
  contact: optText(200),
  plan: z.union([z.enum(TRAINER_PLANS), z.null()]).optional(),
  status: z.enum(TRAINER_STATUSES).optional(),
  coachBetaSignupId: optText(64),
  startedAt: optDate,
  note: optText(1000),
}).strict();
export const trainerReferralUpdateSchema = trainerReferralCreateSchema.partial().strict();

export const manualPayoutCreateSchema = z.object({
  kind: z.enum(MANUAL_PAYOUT_KINDS),
  description: trimmed(300).min(1, 'description is required'),
  amountCents: cents,
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional(),
  status: z.enum(MANUAL_PAYOUT_STATUSES).optional(),
  paidAt: optDate,
  reference: optText(120),
  note: optText(1000),
}).strict();
export const manualPayoutUpdateSchema = manualPayoutCreateSchema.partial().strict();

export const termsUpdateSchema = z.object({
  commissionRate: rate.optional(),
  trainerCommissionRate: z.union([rate, z.null()]).optional(),
  campaignRate: z.union([rate, z.null()]).optional(),
  perVideoFeeCents: z.union([cents, z.null()]).optional(),
  agreementNote: optText(2000),
}).strict();

export function zodMessage(err: z.ZodError): string {
  return err.issues.map(i => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)).join('; ');
}

// ─── Terms ────────────────────────────────────────────────────────────────────

export function personalTerms(a: any) {
  return {
    commissionRate: a.commissionRate,
    trainerCommissionRate: a.trainerCommissionRate ?? null,
    campaignRate: a.campaignRate ?? null,
    perVideoFeeCents: a.perVideoFeeCents ?? null,
    agreementNote: a.agreementNote ?? null,
    agreementUpdatedAt: iso(a.agreementUpdatedAt),
  };
}

/** Personal terms + the published general structure, or null for an unknown affiliate. */
export async function getTerms(affiliateId: string) {
  const row = await repo.getTermsRow(affiliateId);
  return row ? { terms: personalTerms(row), structure: AFFILIATE_PAYMENT_STRUCTURE } : null;
}

export async function updateTerms(affiliateId: string, data: z.infer<typeof termsUpdateSchema>) {
  const patch: Record<string, unknown> = stripUndefined(data);
  patch.agreementUpdatedAt = new Date();
  const n = await repo.updateTermsRow(affiliateId, patch);
  if (!n) return null;
  return personalTerms(await repo.getTermsRow(affiliateId));
}

// ─── Trainer referrals ────────────────────────────────────────────────────────

function iso(d: unknown): string | null {
  if (!d) return null;
  const x = d instanceof Date ? d : new Date(typeof d === 'bigint' ? Number(d) : (d as any));
  return Number.isNaN(x.getTime()) ? null : x.toISOString();
}

export function serializeTrainerReferral(r: any) {
  return {
    id: r.id,
    trainerName: r.trainerName,
    organization: r.organization ?? null,
    contact: r.contact ?? null,
    plan: r.plan ?? null,
    status: r.status,
    coachBetaSignupId: r.coachBetaSignupId ?? null,
    startedAt: iso(r.startedAt),
    note: r.note ?? null,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

export async function listTrainerReferrals(affiliateId: string) {
  return (await repo.listTrainerReferralRows(affiliateId)).map(serializeTrainerReferral);
}

/** True when a CoachBetaSignup.source names this referral code: `ref=CODE`
 *  or the bare code as a token ("CODE", "CODE utm/x/y"). Case-insensitive. */
export function sourceMatchesCode(source: string | null | undefined, code: string): boolean {
  if (!source || !code) return false;
  const want = code.trim().toLowerCase();
  if (!want) return false;
  return source
    .toLowerCase()
    .split(/[\s/&?=,;:#|]+/)
    .some(tok => tok === want);
}

/** "Jane Doe" → "Jane D."; "jane@gym.com" → "@gym.com". */
export function maskName(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Coach';
  const first = parts[0].slice(0, 40);
  return parts.length > 1 ? `${first} ${parts[parts.length - 1][0].toUpperCase()}.` : first;
}
export function maskEmail(email: string | null | undefined): string | null {
  const at = (email ?? '').lastIndexOf('@');
  return at >= 0 ? `@${(email as string).slice(at + 1).toLowerCase()}` : null;
}

/** Coach beta sign-ups whose captured source names this affiliate's code. */
export async function autoSignupsForCode(referralCode: string) {
  if (!referralCode) return [];
  const rows = await repo.coachSignupsWithSource();
  return rows
    .filter((r: any) => sourceMatchesCode(r.source, referralCode))
    .map((r: any) => ({
      id: r.id,
      name: maskName(r.name),
      emailDomain: maskEmail(r.email),
      createdAt: iso(r.createdAt),
      invitedAt: iso(r.invitedAt),
    }));
}

export async function createTrainerReferral(affiliateId: string, data: z.infer<typeof trainerReferralCreateSchema>) {
  const row = await repo.insertTrainerReferralRow(affiliateId, { ...stripUndefined(data), status: data.status ?? 'lead' });
  return serializeTrainerReferral(row);
}

export async function updateTrainerReferral(affiliateId: string, refId: string, data: z.infer<typeof trainerReferralUpdateSchema>) {
  const row = await repo.updateTrainerReferralRow(affiliateId, refId, stripUndefined(data));
  return row ? serializeTrainerReferral(row) : null;
}

export async function deleteTrainerReferral(affiliateId: string, refId: string): Promise<boolean> {
  return (await repo.deleteTrainerReferralRow(affiliateId, refId)) > 0;
}

// ─── Manual payouts ───────────────────────────────────────────────────────────

export function serializeManualPayout(p: any) {
  return {
    id: p.id,
    kind: p.kind,
    description: p.description,
    amountCents: p.amountCents,
    currency: p.currency ?? 'CAD',
    status: p.status,
    paidAt: iso(p.paidAt),
    reference: p.reference ?? null,
    note: p.note ?? null,
    createdAt: iso(p.createdAt),
    updatedAt: iso(p.updatedAt),
  };
}

export function totalsOf(rows: Array<{ status: string; amountCents: number }>) {
  let paidCents = 0;
  let pendingCents = 0;
  for (const r of rows) {
    if (r.status === 'paid') paidCents += r.amountCents;
    else if (r.status === 'pending') pendingCents += r.amountCents;
  }
  return { paidCents, pendingCents };
}

export async function listManualPayouts(affiliateId: string) {
  const rows = await repo.listManualPayoutRows(affiliateId);
  // Newest first by the date that matters to the affiliate (paid date, else recorded date).
  const payouts = rows.map(serializeManualPayout).sort(
    (a: any, b: any) => Date.parse(b.paidAt ?? b.createdAt) - Date.parse(a.paidAt ?? a.createdAt),
  );
  return { payouts, totals: totalsOf(rows) };
}

/** Totals for the dashboard tile. Never fails the dashboard. */
export async function manualPayoutTotals(affiliateId: string) {
  try {
    return totalsOf(await repo.listManualPayoutRows(affiliateId));
  } catch (err: any) {
    console.error('[affiliates] manual payout totals failed:', err?.message ?? err);
    return { paidCents: 0, pendingCents: 0 };
  }
}

/** Status transitions: → paid stamps paidAt (unless given); → pending clears it. */
function withPaidAt(data: Record<string, unknown>, prevStatus?: string) {
  const out = { ...data };
  if (out.status === 'paid' && out.paidAt === undefined && prevStatus !== 'paid') out.paidAt = new Date();
  if (out.status === 'pending' && out.paidAt === undefined) out.paidAt = null;
  return out;
}

export async function createManualPayout(affiliateId: string, data: z.infer<typeof manualPayoutCreateSchema>) {
  const row = await repo.insertManualPayoutRow(
    affiliateId,
    withPaidAt({ ...stripUndefined(data), currency: data.currency ?? 'CAD', status: data.status ?? 'pending' }),
  );
  return serializeManualPayout(row);
}

export async function updateManualPayout(affiliateId: string, payoutId: string, data: z.infer<typeof manualPayoutUpdateSchema>) {
  const existing = await repo.getManualPayoutRow(affiliateId, payoutId);
  if (!existing) return null;
  const row = await repo.updateManualPayoutRow(affiliateId, payoutId, withPaidAt(stripUndefined(data), existing.status));
  return row ? serializeManualPayout(row) : null;
}

export async function deleteManualPayout(affiliateId: string, payoutId: string): Promise<boolean> {
  return (await repo.deleteManualPayoutRow(affiliateId, payoutId)) > 0;
}

function stripUndefined<T extends Record<string, unknown>>(o: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
}
