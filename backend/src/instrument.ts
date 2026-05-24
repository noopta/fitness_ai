// Sentry instrumentation — MUST be imported as the very first thing in
// index.ts (before any other import that could throw). Auto-instruments
// Express, Prisma, and the standard HTTP client so traces and errors are
// captured without per-route boilerplate.
//
// When SENTRY_DSN is missing (local dev, test runs), Sentry.init is a
// no-op — the SDK's capture functions just discard events. So this file
// is safe to import unconditionally.

import * as Sentry from '@sentry/node';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    // 10% trace sampling is plenty for the auto-fix loop — we only need
    // errors + enough context to reproduce. Up this only if you start
    // wanting performance data.
    tracesSampleRate: 0.1,
    // Capture the request body on errors so the auto-fix workflow has
    // the actual payload to reproduce. Excludes auth headers + cookies
    // automatically.
    sendDefaultPii: false,
    integrations: [
      // Express + Node HTTP are auto-detected by the SDK.
    ],
    // Tag every event with the git commit so Sentry's "regression"
    // detection and Claude's auto-fix prompt both know which commit
    // introduced the error.
    release: process.env.GIT_SHA || process.env.GITHUB_SHA || undefined,
  });
  // eslint-disable-next-line no-console
  console.log(`✓ Sentry initialised (env=${process.env.NODE_ENV ?? 'dev'})`);
} else {
  // eslint-disable-next-line no-console
  console.log('· Sentry skipped — SENTRY_DSN not set');
}
