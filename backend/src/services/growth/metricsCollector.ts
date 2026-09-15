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
  /** Client-side (mobile + web) exceptions, including every ErrorBoundary trip. */
  appExceptionsLast24h: number | null;
  appExceptionsLast7d: number | null;
  /** Only boundaries labelled coach-tab / coach:<tab>. */
  coachErrorBoundaryLast7d: number | null;
  /** Backend 5xx reports from posthog-node. Not a client crash. */
  serverExceptionsLast7d: number | null;
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
      signal: AbortSignal.timeout(45000),
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

// Every PostHog metric the digest needs, computed in ONE query.
//
// This used to be 17 separate HogQL requests fired in parallel at 13:00. PostHog
// throttles concurrent queries per project, so a few of them timed out most
// days and came back null — and the digest LLM read those "n/a"s as zeros
// ("0 diagnostic completions, the funnel is broken") when PostHog actually had
// the completions. One scan over 7 days of the relevant events is cheaper for
// PostHog and fails all-or-nothing, which is much easier to reason about.
export interface EventMetric {
  key: string;
  event: string;
  days: 1 | 7;
  agg: 'count' | 'users';
  /** Extra HogQL predicate, trusted (static strings only). */
  where?: string;
}

const APP_LIB = `properties.$lib != 'posthog-node'`;

export const EVENT_METRICS: EventMetric[] = [
  { key: 'dau',          event: 'Application Opened',      days: 1, agg: 'users' },
  { key: 'wau',          event: 'Application Opened',      days: 7, agg: 'users' },
  { key: 'appOpens',     event: 'Application Opened',      days: 1, agg: 'count' },
  { key: 'formAnalyzed', event: 'form_video_analyzed',     days: 7, agg: 'count' },
  { key: 'barcodeScans', event: 'food_barcode_logged',     days: 7, agg: 'count' },
  { key: 'coachMessages',event: 'coach_chat_message_sent', days: 7, agg: 'count' },
  { key: 'workouts',     event: 'workout_logged',          days: 7, agg: 'count' },
  { key: 'foodPhoto',    event: 'food_scanned_logged',     days: 7, agg: 'count' },
  { key: 'posts',        event: 'text_post_made',          days: 7, agg: 'count' },
  { key: 'authShown',    event: 'auth_screen_shown',       days: 7, agg: 'count' },
  { key: 'authTapped',   event: 'auth_provider_tapped',    days: 7, agg: 'count' },
  { key: 'register',     event: 'register',                days: 7, agg: 'count' },
  { key: 'diagStart',    event: 'diagnostic_started',      days: 7, agg: 'count' },
  { key: 'diagDone',     event: 'diagnostic_completed',    days: 7, agg: 'count' },
  { key: 'planGen',      event: 'workout_plan_generated',  days: 7, agg: 'count' },
  { key: 'appExc24h',    event: '$exception', days: 1, agg: 'count', where: APP_LIB },
  { key: 'appExc7d',     event: '$exception', days: 7, agg: 'count', where: APP_LIB },
  { key: 'coachBoundary',event: '$exception', days: 7, agg: 'count',
    where: `${APP_LIB} AND (properties.boundary_label = 'coach-tab' OR startsWith(toString(properties.boundary_label), 'coach:'))` },
  { key: 'serverExc7d',  event: '$exception', days: 7, agg: 'count', where: `properties.$lib = 'posthog-node'` },
];

const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

export function buildEventMetricsQuery(metrics: EventMetric[]): string {
  const cols = metrics.map((m) => {
    const cond = [`event = ${q(m.event)}`, `timestamp >= now() - INTERVAL ${m.days} DAY`, m.where ? `(${m.where})` : '']
      .filter(Boolean).join(' AND ');
    return m.agg === 'users' ? `uniqIf(distinct_id, ${cond})` : `countIf(${cond})`;
  });
  const events = [...new Set(metrics.map((m) => q(m.event)))].join(', ');
  const maxDays = Math.max(...metrics.map((m) => m.days));
  return `SELECT ${cols.join(', ')} FROM events WHERE event IN (${events}) AND timestamp >= now() - INTERVAL ${maxDays} DAY`;
}

/** Map a result row back to keys. A failed query yields null for every key — never 0. */
export function parseEventMetrics(metrics: EventMetric[], row: unknown[] | null | undefined): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  metrics.forEach((m, i) => {
    const v = row ? Number(row[i]) : NaN;
    out[m.key] = Number.isFinite(v) ? v : null;
  });
  return out;
}

async function eventMetrics(): Promise<Record<string, number | null>> {
  const sql = buildEventMetricsQuery(EVENT_METRICS);
  // One retry: a single timeout shouldn't blank the whole digest.
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await hogql<{ results: any[][] }>(sql);
    if (r?.results?.[0]) return parseEventMetrics(EVENT_METRICS, r.results[0]);
  }
  return parseEventMetrics(EVENT_METRICS, null);
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

  const [users, revenue, ev] = await Promise.all([
    usersSnapshot(),
    revenueSnapshot(),
    eventMetrics(),
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
      dauYesterday: ev.dau,
      wauLast7d: ev.wau,
      d1Retention7dCohort: null,  // requires cohort query; add later
      d7Retention30dCohort: null,
      appOpensYesterday: ev.appOpens,
    },
    funnel: {
      authScreenShown7d: ev.authShown,
      authProviderTapped7d: ev.authTapped,
      registerCompleted7d: ev.register,
      diagnosticStarted7d: ev.diagStart,
      diagnosticCompleted7d: ev.diagDone,
      workoutPlanGenerated7d: ev.planGen,
    },
    revenue,
    features: {
      formVideoAnalyzed7d: ev.formAnalyzed,
      barcodeScans7d: ev.barcodeScans,
      coachMessagesSent7d: ev.coachMessages,
      workoutsLogged7d: ev.workouts,
      foodPhotoLogged7d: ev.foodPhoto,
      socialPosts7d: ev.posts,
    },
    errors: {
      appExceptionsLast24h: ev.appExc24h,
      appExceptionsLast7d: ev.appExc7d,
      coachErrorBoundaryLast7d: ev.coachBoundary,
      serverExceptionsLast7d: ev.serverExc7d,
    },
  };

  return snapshot;
}
