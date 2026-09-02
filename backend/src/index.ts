// MUST be first — Sentry auto-instruments imports it observes after init.
// dotenv.config() in this file populates process.env, but instrument.ts
// reads SENTRY_DSN at module-load time, so we load env vars before this
// import by side-effect — see instrument.ts header for why this is OK.
import 'dotenv/config';
import './instrument.js';
import * as Sentry from '@sentry/node';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import { PrismaClient } from '@prisma/client';
import posthog from './services/posthogClient.js';
import { errorReporting, reportServerError } from './middleware/errorReporting.js';
import libraryRoutes from './routes/library.js';
import sessionsRoutes from './routes/sessions.js';
import waitlistRoutes from './routes/waitlist.js';
import authRoutes from './routes/auth.js';
import paymentsRoutes from './routes/payments.js';
import appleIapRoutes from './routes/appleIap.js';
import googleIapRoutes from './routes/googleIap.js';
import coachRoutes from './routes/coach.js';
import nutritionRoutes from './routes/nutrition.js';
import nutritionGutRoutes from './routes/nutritionGut.js';
import recipesRoutes from './routes/recipes.js';
import nutritionProfileRoutes from './routes/nutritionProfile.js';
import wellnessRoutes from './routes/wellness.js';
import workoutsRoutes from './routes/workouts.js';
import adaptationRoutes from './routes/adaptation.js';
import strengthRoutes from './routes/strength.js';
import affiliatesRoutes from './routes/affiliates.js';
import adminRoutes from './routes/admin.js';
import socialRoutes from './routes/social.js';
import agentRoutes from './routes/agent.js';
import groupsRoutes from './routes/groups.js';
import institutionsRoutes from './routes/institutions.js';
import activityRoutes from './routes/activity.js';
import formAnalysisRoutes, { sweepStalePendingFormAnalyses } from './routes/formAnalysis.js';

import instagramWebhookRoutes from './routes/instagramWebhook.js';
import trainTogetherRoutes from './routes/trainTogether.js';
import { runPartnerWorkoutMorningReminders } from './services/trainTogetherService.js';
// Growth pipeline modules are untracked in some checkouts (see
// project docs: growth source lives outside this branch). Load them
// dynamically so a clean-tree build boots without them — routes and
// schedulers below no-op when absent.
const growth = await (async () => {
  try {
    const [routes, digest, autoShip, impact] = await Promise.all([
      import('./routes/growth.js'),
      import('./services/growth/dailyDigestRunner.js'),
      import('./services/growth/autoShipPipeline.js'),
      import('./services/growth/impactMeasurement.js'),
    ]);
    return {
      routes: routes.default,
      runDailyDigest: digest.runDailyDigest,
      runAutoShipSweep: autoShip.runAutoShipSweep,
      runImpactSweep: impact.runImpactSweep,
    };
  } catch {
    console.warn('[growth] modules not present in this build — growth surface disabled.');
    return null;
  }
})();
import { runNightlyNotifications, runWeeklySummary, runStreakAtRiskCheck } from './services/notificationService.js';
import { runReengagementCheck } from './services/reengagementService.js';
import { runDailyFeedFetch } from './services/feedService.js';
import { runAnakinGroupSweep } from './services/groupAccountability.js';
import { runProgramRescueSweep } from './services/programRescueService.js';
import { alertUncaughtException } from './services/errorAlertService.js';
import { securityHeaders } from './middleware/securityHeaders.js';
import { globalLimiter } from './middleware/rateLimiter.js';
import OpenAI from 'openai';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// nginx terminates TLS and proxies to us, so without this req.ip is always
// nginx's address — which would make every IP-keyed rate limit below a single
// global bucket shared by the entire internet.
app.set('trust proxy', 1);

// No ETags on API responses.
//
// Express sends a weak ETag on every res.json, so a repeat request answers
// 304 with an empty body. The mobile client's apiFetch treats any response
// where `!res.ok` as a failure — and res.ok is false for 304 — so a normal
// cache revalidation is thrown as an error inside the app.
//
// This is reachable on the brand-new-user path: after POST /auth/set-dob the
// app re-requests /coach/program, /coach/messages, /social/notifications/counts
// and /form-analysis, and prod answered 304 to all four for the signups that
// stalled before the intake quiz (2026-08-16 onward, 0/6 converted).
//
// The payloads here are small since the feed slimming work, so conditional
// revalidation buys little; correctness on a shipped client that mishandles
// 304 is worth more than the bytes. Fixing apiFetch is the real fix, but that
// needs an app release — this reaches every install already out there.
app.set('etag', false);

// Middleware
app.use(securityHeaders);
app.use(cookieParser());
const ALLOWED_ORIGINS = [
  process.env.FRONTEND_URL || 'https://axiomtraining.io',
  'https://liftoffmvp.io',
  'https://www.liftoffmvp.io',
  'https://axiomtraining.io',
  'https://www.axiomtraining.io',
  // Allow localhost ports for local development
  'http://localhost:5000',
  'http://localhost:5173',
  'http://localhost:3000',
  // Allow any Replit preview URLs
  ...(process.env.EXTRA_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, mobile apps, Postman)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    // Allow any Replit dev preview / deploy URL (.replit.app is the newer
    // production-deploy domain Replit uses; .replit.dev is dev previews; .repl.co
    // is the legacy domain).
    if (origin.endsWith('.replit.dev') || origin.endsWith('.repl.co') || origin.endsWith('.replit.app')) return callback(null, true);
    // Tag the error with status:403 + a CORS marker so the global error
    // middleware returns a clean 403 (instead of the default 500) and skips
    // the stack trace + Sentry/PostHog noise — these get triggered constantly
    // by nmap-style scanners using `Origin: example.com` to probe for misconfig.
    const corsErr: any = new Error(`CORS: origin ${origin} not allowed`);
    corsErr.status = 403;
    corsErr._isCors = true;
    callback(corsErr);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
// Body size. The 10MB ceiling exists for base64 image payloads (meal photos,
// post images, avatars) and is applied only to the routes that need it; every
// other endpoint gets a 1MB limit, so a JSON flood against, say, /auth/login
// can't push 10MB per request through the parser.
const jsonVerify = (req: any, _res: any, buf: Buffer) => {
  // Stripe and Meta both sign the raw bytes, so those two need the untouched
  // buffer stashed before JSON.parse gets to it.
  if (req.url === '/api/payments/webhook' || req.url?.startsWith('/api/webhooks/instagram')) {
    req.rawBody = buf;
  }
};

const LARGE_BODY_PATHS = [
  '/api/nutrition/analyze-photo',
  '/api/nutrition/transcribe',
  '/api/social/share',
  '/api/auth/avatar',
  '/api/recipes',
];

const largeJson = express.json({ limit: '10mb', verify: jsonVerify });
const standardJson = express.json({ limit: '1mb', verify: jsonVerify });

app.use((req, res, next) => {
  const parser = LARGE_BODY_PATHS.some((p) => req.path.startsWith(p)) ? largeJson : standardJson;
  return parser(req, res, next);
});

// Catch 5xx responses that routes send themselves. Sits above every handler
// (health check and rate limiter included) so nothing can answer 5xx without
// being reported; see middleware/errorReporting.ts for why the central error
// handler below isn't sufficient on its own.
app.use(errorReporting);

// Health check — before the rate limiter so uptime probes are never throttled.
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Axiom API is running' });
});

// Global backstop on the whole API surface. Per-route limiters (auth, register,
// AI, social writes) are stricter and applied at their own definitions.
app.use('/api', globalLimiter);

// Routes
app.use('/api', authRoutes);
app.use('/api', paymentsRoutes);
app.use('/api', appleIapRoutes);
app.use('/api', googleIapRoutes);
app.use('/api', coachRoutes);
app.use('/api', nutritionRoutes);
app.use('/api', nutritionGutRoutes);
app.use('/api', recipesRoutes);
app.use('/api', nutritionProfileRoutes);
app.use('/api', wellnessRoutes);
app.use('/api', workoutsRoutes);
app.use('/api', adaptationRoutes);
app.use('/api', strengthRoutes);
app.use('/api', libraryRoutes);
app.use('/api', sessionsRoutes);
app.use('/api', waitlistRoutes);
app.use('/api', affiliatesRoutes);
app.use('/api', adminRoutes);
app.use('/', adminRoutes);
app.use('/api', socialRoutes);
// Agentic Anakin (flag-gated via AGENT_ENABLED; 404s when off).
app.use('/api', agentRoutes);
// Groups + formAnalysis must be mounted BEFORE institutionsRoutes —
// institutions has a GET /:slug handler that otherwise swallows
// single-segment paths like /api/groups, /api/form-analysis.
app.use('/api', groupsRoutes);
// Workout form-video analysis (Gemini 3.1 Pro via Vertex AI). Multipart
// uploads; free tier rate-limited via featureUsageService.
app.use('/api', formAnalysisRoutes);
if (growth) app.use('/api', growth.routes);
app.use('/api', institutionsRoutes);
app.use('/api', activityRoutes);
app.use('/api', instagramWebhookRoutes);
app.use('/api', trainTogetherRoutes);

// Sentry error handler — MUST come before our own error middleware, but
// after all routes. The SDK marks the response as handled even though
// our middleware below still owns the actual response body.
Sentry.setupExpressErrorHandler(app);

// Error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  const status: number = err?.status ?? err?.statusCode ?? 500;

  // CORS rejections + other expected 4xx errors don't need Sentry/PostHog
  // noise or a stack trace in the logs — they're constant scanner traffic.
  const noisy = !err?._isCors && status >= 500;
  if (noisy) {
    // Goes through the shared latch so the res.json interceptor doesn't
    // report this same response a second time. Errors that reach here still
    // carry their real stack, unlike ones a route already swallowed.
    reportServerError(err, req, res, status);
  }

  res.status(status).json({ error: err?.message ?? 'Internal server error' });
});

// Uncaught exceptions and unhandled rejections
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  alertUncaughtException('uncaughtException', err).finally(() => process.exit(1));
});

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
  alertUncaughtException('unhandledRejection', reason).catch(() => {});
});

app.listen(PORT, () => {
  console.log(`🚀 Axiom API running on http://localhost:${PORT}`);
  console.log(`📚 API endpoints available at http://localhost:${PORT}/api`);
});

process.on('SIGINT', async () => {
  await posthog.shutdown();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  await posthog.shutdown();
  process.exit(0);
});

// ── Daily coach thread cleanup ─────────────────────────────────────────────
// Clears OpenAI Assistants threads once every 24h to reduce token storage costs.
// Users will get a fresh thread on their next chat message.
const prisma = new PrismaClient();

// ── SQLite tuning ──────────────────────────────────────────────────────────
// WAL mode lets readers proceed while a write is in flight. In the default
// `delete`/rollback-journal mode, any write — e.g. the on-demand feed research
// fetch writing FeedItem rows — takes a database-wide exclusive lock that
// blocks every concurrent read, which was turning ~150ms social-feed loads
// into multi-second ones whenever a fetch was running. journal_mode=WAL is a
// persistent property of the DB file, so this single call converts it for
// every PrismaClient connection in the process (and stays set across restarts).
// busy_timeout gives a writer a grace window to retry on momentary contention
// instead of failing immediately. NOTE: busy_timeout is per-connection, so this
// only covers this client; consolidating the ~40 scattered `new PrismaClient()`
// instances behind one shared module — and setting the pragma there — is a
// recommended follow-up.
prisma.$queryRawUnsafe('PRAGMA journal_mode=WAL;')
  .then(() => prisma.$queryRawUnsafe('PRAGMA busy_timeout=5000;'))
  .then(() => console.log('✓ SQLite: WAL mode + busy_timeout=5000ms enabled'))
  .catch((err) => console.error('SQLite pragma setup failed:', err));

const openaiForCleanup = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function clearCoachThreads() {
  try {
    const users = await prisma.user.findMany({
      where: { coachThreadId: { not: null } },
      select: { id: true, coachThreadId: true },
    });

    let cleared = 0;
    for (const u of users) {
      try {
        await openaiForCleanup.beta.threads.del(u.coachThreadId!);
      } catch {
        // Thread may already be deleted — continue
      }
      await prisma.user.update({ where: { id: u.id }, data: { coachThreadId: null } });
      cleared++;
    }
    if (cleared > 0) console.log(`✓ Daily cleanup: cleared ${cleared} coach thread(s)`);
  } catch (err) {
    console.error('Coach thread cleanup error:', err);
  }
}

// Run once on startup (clears any stale threads), then every 24 hours
clearCoachThreads();
setInterval(clearCoachThreads, 24 * 60 * 60 * 1000);

// Sweep orphaned 'pending' form-analysis rows every 2 minutes. Marks rows
// that have been pending >10m as failed so the polling client gets a clean
// terminal state instead of an infinite spinner after a server restart.
sweepStalePendingFormAnalyses().catch((err) => console.error('[form-analysis sweep] startup:', err));
setInterval(() => {
  sweepStalePendingFormAnalyses().catch((err) => console.error('[form-analysis sweep] tick:', err));
}, 2 * 60 * 1000);

// Program rescue: users who finished intake >30m ago but never generated a
// program get one built server-side + a "your program is ready" push. First
// pass 3 minutes after boot (picks up anyone stranded during downtime),
// then every 30 minutes.
setTimeout(() => {
  runProgramRescueSweep().catch((err) => console.error('[program-rescue] startup:', err));
}, 3 * 60 * 1000);
setInterval(() => {
  runProgramRescueSweep().catch((err) => console.error('[program-rescue] tick:', err));
}, 30 * 60 * 1000);

// ── Notification schedulers ────────────────────────────────────────────────
// Nightly at 8pm ET: contextual push notifications (session reminders, re-engagement, streaks)
// Weekly on Sunday at 8pm ET: weekly progress summary

function scheduleAt(hour: number, dayOfWeek: number | null, fn: () => void) {
  function getNextMs() {
    const now = new Date();
    const target = new Date();
    target.setHours(hour, 0, 0, 0);
    if (dayOfWeek !== null) {
      const diff = (dayOfWeek - now.getDay() + 7) % 7;
      target.setDate(now.getDate() + (diff === 0 && now >= target ? 7 : diff));
    } else if (now >= target) {
      target.setDate(target.getDate() + 1);
    }
    return target.getTime() - now.getTime();
  }
  function schedule() {
    setTimeout(() => { fn(); schedule(); }, getNextMs());
  }
  schedule();
}

scheduleAt(20, null, () => runNightlyNotifications().catch(err => console.error('[scheduler] nightly error:', err)));
// Affiliate payouts — 1st of each month, 14:00 UTC (10am ET). Idempotent:
// commissions flip to 'paid' as they're bundled into a payout, so a re-run
// (or the admin pressing the button the same day) can never pay twice.
scheduleAt(14, null, () => {
  if (new Date().getDate() !== 1) return;
  import('./services/affiliateService.js')
    .then(m => m.runMonthlyPayouts())
    .then(r => {
      if (r.affiliatesPaid === 0 && r.errors.length === 0) return;
      const msg = `[affiliates] monthly payout run: ${r.affiliatesPaid} affiliate(s) paid, $${(r.totalCents / 100).toFixed(2)} total${r.errors.length ? `, ERRORS: ${r.errors.join('; ')}` : ''}`;
      console.log(msg);
      import('./services/smsService.js').then(sms => sms.sendCoachSMS(`💸 ${msg}`)).catch(() => {});
    })
    .catch(err => console.error('[scheduler] affiliate payout error:', err));
});
scheduleAt(20, 0,    () => runWeeklySummary().catch(err => console.error('[scheduler] weekly error:', err)));
scheduleAt(18, null, () => runReengagementCheck().catch(err => console.error('[scheduler] reengagement error:', err)));
// Streak-at-risk loss-aversion pass — runs at 7pm and 9pm so we cover both
// "evening loggers" and "late-night loggers" without waking up the early crowd.
scheduleAt(19, null, () => runStreakAtRiskCheck().catch(err => console.error('[scheduler] streak-at-risk 19h error:', err)));
scheduleAt(21, null, () => runStreakAtRiskCheck().catch(err => console.error('[scheduler] streak-at-risk 21h error:', err)));
// Research/article feed — fetch new content daily at 6am
scheduleAt(6,  null, () => runDailyFeedFetch().catch(err => console.error('[scheduler] feed fetch error:', err)));
// Anakin group accountability — drops into every opted-in group chat each
// morning at 8am with a check-in. runAnakinGroupCheckin gates on
// anakinDailyEnabled and only posts when there's something worth saying.
scheduleAt(8,  null, () => runAnakinGroupSweep().catch(err => console.error('[scheduler] anakin group sweep error:', err)));
// Train Together — morning-of reminder for confirmed partner workouts today.
scheduleAt(8,  null, () => runPartnerWorkoutMorningReminders().catch(err => console.error('[scheduler] partner workout reminders error:', err)));

// Growth digest — 13:00 UTC = 8am EST. Idempotent per day (the runner
// upserts on date, no-op if today's digest is already sent).
if (growth) scheduleAt(13, null, () => growth.runDailyDigest().catch(err => console.error('[scheduler] growth digest error:', err)));

// Auto-ship sweep — 14:00 UTC, after the digest has been read and any
// approvals have come in via Telegram. Reads approved recs and either
// opens an auto-ship PR or drafts a spec PR. Always non-merging.
if (growth) scheduleAt(14, null, () => growth.runAutoShipSweep().catch(err => console.error('[scheduler] auto-ship sweep error:', err)));

// Impact measurement — 15:00 UTC. Snapshots shipped recs at 7d / 30d so
// the next digest can compare predicted vs actual delta and adjust.
if (growth) scheduleAt(15, null, () => growth.runImpactSweep().catch(err => console.error('[scheduler] impact sweep error:', err)));
// Run once on startup to seed the feed if empty
runDailyFeedFetch().catch(err => console.error('[feedService] initial fetch error:', err));
console.log('✓ Notification schedulers registered (nightly + Sunday weekly summary + 6pm reengagement + 7pm/9pm streak-at-risk + 6am feed fetch + 8am Anakin group check-in)');
