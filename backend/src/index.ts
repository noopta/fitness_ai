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
import libraryRoutes from './routes/library.js';
import sessionsRoutes from './routes/sessions.js';
import waitlistRoutes from './routes/waitlist.js';
import authRoutes from './routes/auth.js';
import paymentsRoutes from './routes/payments.js';
import appleIapRoutes from './routes/appleIap.js';
import googleIapRoutes from './routes/googleIap.js';
import coachRoutes from './routes/coach.js';
import nutritionRoutes from './routes/nutrition.js';
import wellnessRoutes from './routes/wellness.js';
import workoutsRoutes from './routes/workouts.js';
import strengthRoutes from './routes/strength.js';
import affiliatesRoutes from './routes/affiliates.js';
import socialRoutes from './routes/social.js';
import agentRoutes from './routes/agent.js';
import groupsRoutes from './routes/groups.js';
import institutionsRoutes from './routes/institutions.js';
import activityRoutes from './routes/activity.js';
import { runNightlyNotifications, runWeeklySummary, runStreakAtRiskCheck } from './services/notificationService.js';
import { runReengagementCheck } from './services/reengagementService.js';
import { runDailyFeedFetch } from './services/feedService.js';
import { alertServerError, alertUncaughtException } from './services/errorAlertService.js';
import OpenAI from 'openai';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
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
app.use(express.json({
  limit: '10mb',
  verify: (req: any, _res, buf) => {
    if (req.url === '/api/payments/webhook') {
      req.rawBody = buf;
    }
  },
}));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Axiom API is running' });
});

// Routes
app.use('/api', authRoutes);
app.use('/api', paymentsRoutes);
app.use('/api', appleIapRoutes);
app.use('/api', googleIapRoutes);
app.use('/api', coachRoutes);
app.use('/api', nutritionRoutes);
app.use('/api', wellnessRoutes);
app.use('/api', workoutsRoutes);
app.use('/api', strengthRoutes);
app.use('/api', libraryRoutes);
app.use('/api', sessionsRoutes);
app.use('/api', waitlistRoutes);
app.use('/api', affiliatesRoutes);
app.use('/api', socialRoutes);
// Agentic Anakin (flag-gated via AGENT_ENABLED; 404s when off).
app.use('/api', agentRoutes);
// Groups must be mounted BEFORE institutionsRoutes — institutions has a
// GET /:slug handler that otherwise swallows /api/groups as "slug=groups".
app.use('/api', groupsRoutes);
app.use('/api', institutionsRoutes);
app.use('/api', activityRoutes);

// Sentry error handler — MUST come before our own error middleware, but
// after all routes. The SDK marks the response as handled even though
// our middleware below still owns the actual response body.
Sentry.setupExpressErrorHandler(app);

// Error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  const userId = (req as any).user?.id;
  const status: number = err?.status ?? err?.statusCode ?? 500;

  // CORS rejections + other expected 4xx errors don't need Sentry/PostHog
  // noise or a stack trace in the logs — they're constant scanner traffic.
  const noisy = !err?._isCors && status >= 500;
  if (noisy) {
    posthog.captureException(err, userId);
    console.error('Error:', err);
    alertServerError(err, req.path, req.method, status).catch(() => {});
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
scheduleAt(20, 0,    () => runWeeklySummary().catch(err => console.error('[scheduler] weekly error:', err)));
scheduleAt(18, null, () => runReengagementCheck().catch(err => console.error('[scheduler] reengagement error:', err)));
// Streak-at-risk loss-aversion pass — runs at 7pm and 9pm so we cover both
// "evening loggers" and "late-night loggers" without waking up the early crowd.
scheduleAt(19, null, () => runStreakAtRiskCheck().catch(err => console.error('[scheduler] streak-at-risk 19h error:', err)));
scheduleAt(21, null, () => runStreakAtRiskCheck().catch(err => console.error('[scheduler] streak-at-risk 21h error:', err)));
// Research/article feed — fetch new content daily at 6am
scheduleAt(6,  null, () => runDailyFeedFetch().catch(err => console.error('[scheduler] feed fetch error:', err)));
// Run once on startup to seed the feed if empty
runDailyFeedFetch().catch(err => console.error('[feedService] initial fetch error:', err));
console.log('✓ Notification schedulers registered (nightly + Sunday weekly summary + 6pm reengagement + 7pm/9pm streak-at-risk + 6am feed fetch)');
