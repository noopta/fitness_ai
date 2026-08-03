// Daily metrics collector for the growth-digest pipeline.
//
// Pulls from three sources:
//   1. PostHog HogQL queries — event-based funnels + DAU / engagement
//   2. Stripe — revenue + active subs (Apple/Google IAP is invisible here;
//      add later via App Store Connect API once that's wired)
//   3. Our DB — users + activity counts that are cheaper to count locally
//      than to round-trip through PostHog.
//
// Returns a single structured snapshot the digest generator passes to Gemini.

import { PrismaClient } from '@prisma/client';
import { stripe } from '../stripeService.js';

const prisma = new PrismaClient();

const POSTHOG_HOST = (process.env.POSTHOG_HOST || 'https://us.i.posthog.com').replace(/\/$/, '');
const POSTHOG_PROJECT_ID = process.env.POSTHOG_PROJECT_ID || '';
// Personal API key (read access). Different from the WRITE key used by
// posthog-node. See PostHog → Personal API keys to create one.
const POSTHOG_READ_KEY = process.env.POSTHOG_PERSONAL_API_KEY || '';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MetricsSnapshot {
  date: string;              // YYYY-MM-DD (the day this digest is FOR — typically "yesterday")
  generatedAt: string;       // ISO timestamp the snapshot was taken
  windows: {
    yesterday:  DateRange;   // 24h ending at digest time
    last7d:     DateRange;
    last30d:    DateRange;
    prior7d:    DateRange;   // 7 days before last7d, for week-over-week deltas
  };
  users: UsersSnapshot;
  engagement: EngagementSnapshot;
  funnel: FunnelSnapshot;
  revenue: RevenueSnapshot;
  features: FeatureAdoptionSnapshot;
  errors: ErrorsSnapshot;
}

interface DateRange { from: string; to: string }

interface UsersSnapshot {
  totalRegistered: number;
  registeredYesterday: number;
  registeredLast7d: number;
  registeredPrior7d: number;
  weekOverWeekChangePct: number;
  freeTier: number;
  proTier: number;
  enterpriseTier: number;
}

interface EngagementSnapshot {
  dauYesterday: number | null;
  wauLast7d: number | null;
  d1Retention7dCohort: number | null;
  d7Retention30dCohort: number | null;
  appOpensYesterday: number | null;
}

interface FunnelSnapshot {
  authScreenShown7d: number | null;
  authProviderTapped7d: number | null;
  registerCompleted7d: number | null;
  diagnosticStarted7d: number | null;
  diagnosticCompleted7d: number | null;
  workoutPlanGenerated7d: number | null;
}

interface RevenueSnapshot {
  activeSubsTotal: number;
  newSubsLast7d: number;
  canceledSubsLast7d: number;
  mrrEstimateCents: number;
  trailingRevenueLast30dCents: number;
  perDay: Array<{ date: string; revenueCents: number }>;
}

interface FeatureAdoptionSnapshot {
  formVideoAnalyzed7d: number | null;
  barcodeScans7d: number | null;
  coachMessagesSent7d: number | null;
  workoutsLogged7d: number | null;
  foodPhotoLogged7d: number | null;
  socialPosts7d: number | null;
}

interface ErrorsSnapshot {
  jsExceptionsLast24h: number | null;
  coachErrorBoundaryLast7d: number | null;
}

// ─── Date helpers ────────────────────────────────────────────────────────────

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dayWindow(daysAgo: number): DateRange {
  const to = new Date();
  to.setUTCHours(0, 0, 0, 0);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - daysAgo);
  return { from: from.toISOString(), to: to.toISOString() };
}

function rangeBetween(daysAgoStart: number, daysAgoEnd: number): DateRange {
  const to = new Date();
  to.setUTCHours(0, 0, 0, 0);
  to.setUTCDate(to.getUTCDate() - daysAgoEnd);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (daysAgoStart - daysAgoEnd));
  return { from: from.toISOString(), to: to.toISOString() };
}

// ─── PostHog HogQL ──────────────────────────────────────────────────────────

async function hogql<T = any>(query: string): Promise<T | null> {
  if (!POSTHOG_PROJECT_ID || !POSTHOG_READ_KEY) {
    console.warn('[metrics] POSTHOG_PROJECT_ID or POSTHOG_PERSONAL_API_KEY not set — skipping PostHog query');
    return null;
  }
  try {
    const res = await fetch(`${POSTHOG_HOST}/api/projects/${POSTHOG_PROJECT_ID}/query/`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${POSTHOG_READ_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.warn(`[metrics] PostHog HogQL ${res.status}: ${await res.text().catch(() => '')}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err: any) {
    console.warn('[metrics] PostHog HogQL request failed:', err?.message ?? err);
    return null;
  }
}

// Counts a single event over a window. Returns null when PostHog is
// unconfigured (so the digest can still render with explicit "n/a" markers).
async function countEvent(eventName: string, days: number): Promise<number | null> {
  const sql = `SELECT count() FROM events WHERE event = '${eventName.replace(/'/g, "''")}' AND timestamp >= now() - INTERVAL ${days} DAY`;
  const r = await hogql<{ results: any[][] }>(sql);
  if (!r?.results?.[0]?.[0]) return r === null ? null : 0;
  const v = Number(r.results[0][0]);
  return Number.isFinite(v) ? v : 0;
}

async function distinctUsers(eventName: string, days: number): Promise<number | null> {
  const sql = `SELECT uniq(distinct_id) FROM events WHERE event = '${eventName.replace(/'/g, "''")}' AND timestamp >= now() - INTERVAL ${days} DAY`;
  const r = await hogql<{ results: any[][] }>(sql);
  if (!r?.results?.[0]?.[0]) return r === null ? null : 0;
  const v = Number(r.results[0][0]);
  return Number.isFinite(v) ? v : 0;
}

// ─── DB helpers ─────────────────────────────────────────────────────────────

async function usersSnapshot(): Promise<UsersSnapshot> {
  const now = new Date();
  const yest = new Date(now.getTime() - 86400_000);
  const yestStart = new Date(yest);
  yestStart.setUTCHours(0, 0, 0, 0);
  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);

  const last7Start = new Date(todayStart.getTime() - 7 * 86400_000);
  const last14Start = new Date(todayStart.getTime() - 14 * 86400_000);

  const [total, yestCount, last7, prior7, byTier] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: yestStart, lt: todayStart } } }),
    prisma.user.count({ where: { createdAt: { gte: last7Start } } }),
    prisma.user.count({ where: { createdAt: { gte: last14Start, lt: last7Start } } }),
    prisma.user.groupBy({ by: ['tier'], _count: true }),
  ]);

  const tierCounts: Record<string, number> = {};
  for (const row of byTier) tierCounts[row.tier ?? 'free'] = row._count;

  const wow = prior7 === 0 ? (last7 > 0 ? 100 : 0) : ((last7 - prior7) / prior7) * 100;
  return {
    totalRegistered: total,
    registeredYesterday: yestCount,
    registeredLast7d: last7,
    registeredPrior7d: prior7,
    weekOverWeekChangePct: Math.round(wow * 10) / 10,
    freeTier: tierCounts.free ?? 0,
    proTier: tierCounts.pro ?? 0,
    enterpriseTier: tierCounts.enterprise ?? 0,
  };
}

// ─── Stripe ──────────────────────────────────────────────────────────────────

async function revenueSnapshot(): Promise<RevenueSnapshot> {
  try {
    const subs = await stripe.subscriptions.list({ status: 'active', limit: 100 });
    const activeSubsTotal = subs.data.length;
    const mrrEstimateCents = subs.data.reduce((acc, s) => {
      const amount = s.items.data[0]?.price?.unit_amount ?? 0;
      const interval = s.items.data[0]?.price?.recurring?.interval ?? 'month';
      const monthly = interval === 'year' ? amount / 12 : interval === 'week' ? amount * 4.33 : amount;
      return acc + Math.round(monthly);
    }, 0);

    const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 86400;
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 86400;
    const [newSubs, canceledSubs, charges30d] = await Promise.all([
      stripe.subscriptions.list({ created: { gte: sevenDaysAgo }, limit: 100 }),
      stripe.subscriptions.list({ status: 'canceled', limit: 100 }),
      stripe.charges.list({ created: { gte: thirtyDaysAgo }, limit: 100 }),
    ]);

    const canceled7dCount = canceledSubs.data.filter(
      (s) => (s.canceled_at ?? 0) >= sevenDaysAgo,
    ).length;

    const trailingRevenueLast30dCents = charges30d.data
      .filter((c) => c.status === 'succeeded' && !c.refunded)
      .reduce((acc, c) => acc + (c.amount ?? 0), 0);

    // Daily revenue buckets
    const perDayMap = new Map<string, number>();
    for (const c of charges30d.data) {
      if (c.status !== 'succeeded' || c.refunded) continue;
      const day = new Date((c.created ?? 0) * 1000).toISOString().slice(0, 10);
      perDayMap.set(day, (perDayMap.get(day) ?? 0) + (c.amount ?? 0));
    }
    const perDay = Array.from(perDayMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, revenueCents]) => ({ date, revenueCents }));

    return {
      activeSubsTotal,
      newSubsLast7d: newSubs.data.length,
      canceledSubsLast7d: canceled7dCount,
      mrrEstimateCents,
      trailingRevenueLast30dCents,
      perDay,
    };
  } catch (err: any) {
    console.warn('[metrics] Stripe snapshot failed:', err?.message ?? err);
    return {
      activeSubsTotal: 0,
      newSubsLast7d: 0,
      canceledSubsLast7d: 0,
      mrrEstimateCents: 0,
      trailingRevenueLast30dCents: 0,
      perDay: [],
    };
  }
}

// ─── Main entry ──────────────────────────────────────────────────────────────

export async function collectDailyMetrics(): Promise<MetricsSnapshot> {
  const now = new Date();
  const yesterdayDate = new Date(now.getTime() - 86400_000);

  const [users, revenue, dau, wau, appOpens, formAnalyzed, barcodeScans, coachMessages, workouts, foodPhoto, posts, authShown, authTapped, register, diagStart, diagDone, planGen, jsExc, errBoundary] = await Promise.all([
    usersSnapshot(),
    revenueSnapshot(),
    distinctUsers('Application Opened', 1),
    distinctUsers('Application Opened', 7),
    countEvent('Application Opened', 1),
    countEvent('form_video_analyzed', 7),
    countEvent('food_barcode_logged', 7),
    countEvent('coach_chat_message_sent', 7),
    countEvent('workout_logged', 7),
    countEvent('food_scanned_logged', 7),
    countEvent('text_post_made', 7),
    countEvent('auth_screen_shown', 7),
    countEvent('auth_provider_tapped', 7),
    countEvent('register', 7),
    countEvent('diagnostic_started', 7),
    countEvent('diagnostic_completed', 7),
    countEvent('workout_plan_generated', 7),
    countEvent('$exception', 1),
    countEvent('$exception', 7),
  ]);

  const snapshot: MetricsSnapshot = {
    date: isoDay(yesterdayDate),
    generatedAt: now.toISOString(),
    windows: {
      yesterday: dayWindow(1),
      last7d:    dayWindow(7),
      last30d:   dayWindow(30),
      prior7d:   rangeBetween(14, 7),
    },
    users,
    engagement: {
      dauYesterday: dau,
      wauLast7d: wau,
      d1Retention7dCohort: null,  // requires cohort query; add later
      d7Retention30dCohort: null,
      appOpensYesterday: appOpens,
    },
    funnel: {
      authScreenShown7d: authShown,
      authProviderTapped7d: authTapped,
      registerCompleted7d: register,
      diagnosticStarted7d: diagStart,
      diagnosticCompleted7d: diagDone,
      workoutPlanGenerated7d: planGen,
    },
    revenue,
    features: {
      formVideoAnalyzed7d: formAnalyzed,
      barcodeScans7d: barcodeScans,
      coachMessagesSent7d: coachMessages,
      workoutsLogged7d: workouts,
      foodPhotoLogged7d: foodPhoto,
      socialPosts7d: posts,
    },
    errors: {
      jsExceptionsLast24h: jsExc,
      coachErrorBoundaryLast7d: errBoundary,
    },
  };

  return snapshot;
}
