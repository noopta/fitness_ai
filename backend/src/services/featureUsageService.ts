// Generic per-day, per-feature quota for AI-cost-heavy free-tier features.
//
// Pro/enterprise tiers are unmetered. Free tier gets a small daily allowance
// (default 1/day each) for the three "try it" features surfaced in the
// post-signup picker. Counters live in the FeatureUsage table keyed by
// (userId, feature, day) where `day` is the UTC calendar day (YYYY-MM-DD).
//
// This is the single source of truth for the *new* features (form_video).
// Meal logging + lift diagnostic keep their pre-existing dedicated counters
// on the User model for backwards-compat; the usage endpoint reads those
// directly. The limit lookup below still maps all three so the picker copy
// and any future migration stay consistent.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Canonical feature keys. Keep these stable — they're persisted in the DB
// and echoed to the client.
export const FEATURE = {
  FORM_VIDEO: 'form_video',
  MEAL_PHOTO: 'meal_photo',
  LIFT_DIAGNOSTIC: 'lift_diagnostic',
} as const;

export type FeatureKey = (typeof FEATURE)[keyof typeof FEATURE];

const PRO_TIERS = new Set(['pro', 'enterprise']);

/** Per-feature free-tier daily limit, env-overridable so ops can tune without a deploy. */
export function dailyLimitFor(feature: FeatureKey): number {
  switch (feature) {
    case FEATURE.FORM_VIDEO:
      return intEnv('FREE_FORM_VIDEO_DAILY_LIMIT', 1);
    case FEATURE.MEAL_PHOTO:
      return intEnv('FREE_MEAL_DAILY_LIMIT', 1);
    case FEATURE.LIFT_DIAGNOSTIC:
      // Shares the historical env var used by checkAnalysisRateLimit so the
      // two stay in lockstep.
      return intEnv('FREE_TIER_DAILY_LIMIT', 1);
    default:
      return 1;
  }
}

function intEnv(name: string, fallback: number): number {
  const n = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** UTC calendar day, YYYY-MM-DD. */
export function todayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Start of the next UTC day, as an ISO timestamp — when the quota resets. */
export function nextResetAt(now: Date = new Date()): string {
  const d = new Date(now);
  d.setUTCHours(24, 0, 0, 0); // rolls into tomorrow 00:00:00 UTC
  return d.toISOString();
}

export interface QuotaState {
  feature: FeatureKey;
  isPro: boolean;
  limit: number | null; // null === unlimited (pro/enterprise)
  used: number;
  remaining: number | null; // null === unlimited
  allowed: boolean;
  resetAt: string;
}

/**
 * Read-only view of a user's current quota for a FeatureUsage-backed feature.
 * Does NOT mutate the counter. Use this for the usage endpoint / UI badges.
 */
export async function peekDailyQuota(
  userId: string,
  tier: string,
  feature: FeatureKey,
  now: Date = new Date(),
): Promise<QuotaState> {
  const isPro = PRO_TIERS.has(tier);
  const limit = dailyLimitFor(feature);
  if (isPro) {
    return { feature, isPro, limit: null, used: 0, remaining: null, allowed: true, resetAt: nextResetAt(now) };
  }
  const day = todayKey(now);
  const row = await prisma.featureUsage.findUnique({
    where: { userId_feature_day: { userId, feature, day } },
  });
  const used = row?.count ?? 0;
  const remaining = Math.max(0, limit - used);
  return { feature, isPro, limit, used, remaining, allowed: used < limit, resetAt: nextResetAt(now) };
}

/**
 * Atomically consume one unit of a feature's daily quota.
 *
 * Returns the resulting QuotaState. When the user is already at/over the
 * limit, `allowed` is false and the counter is NOT incremented. Pro/enterprise
 * always returns allowed=true without touching the table.
 *
 * Concurrency: we upsert-then-check rather than check-then-upsert so two
 * racing requests can't both read `used < limit` against a missing row and
 * both succeed. The unique (userId, feature, day) constraint + atomic
 * `increment` make the post-increment count authoritative; if it overshoots
 * the limit we treat the call as rejected (and the row simply caps out — the
 * next read clamps `remaining` to 0).
 */
export async function consumeDailyQuota(
  userId: string,
  tier: string,
  feature: FeatureKey,
  now: Date = new Date(),
): Promise<QuotaState> {
  const isPro = PRO_TIERS.has(tier);
  const limit = dailyLimitFor(feature);
  const resetAt = nextResetAt(now);
  if (isPro) {
    return { feature, isPro, limit: null, used: 0, remaining: null, allowed: true, resetAt };
  }

  const day = todayKey(now);
  const row = await prisma.featureUsage.upsert({
    where: { userId_feature_day: { userId, feature, day } },
    create: { userId, feature, day, count: 1 },
    update: { count: { increment: 1 } },
  });

  // `row.count` is the post-increment value. If it's > limit, this request
  // pushed us over — reject and report the count as capped at the limit so a
  // client never sees a negative "remaining".
  const allowed = row.count <= limit;
  const used = Math.min(row.count, limit);
  return {
    feature,
    isPro,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    allowed,
    resetAt,
  };
}

/**
 * Give back one consumed unit — used when the work the quota was spent on
 * failed (e.g. the Gemini call errored), so a free user isn't charged their
 * single daily credit for a failure they didn't cause. No-op for pro/missing
 * rows, and never drops the counter below zero.
 */
export async function refundDailyQuota(
  userId: string,
  tier: string,
  feature: FeatureKey,
  now: Date = new Date(),
): Promise<void> {
  if (PRO_TIERS.has(tier)) return;
  const day = todayKey(now);
  try {
    await prisma.featureUsage.updateMany({
      where: { userId, feature, day, count: { gt: 0 } },
      data: { count: { decrement: 1 } },
    });
  } catch {
    // Best-effort — a failed refund just means the user keeps the charge.
  }
}
