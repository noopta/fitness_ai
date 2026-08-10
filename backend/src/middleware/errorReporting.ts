// Makes every 5xx reportable, no matter how the route produced it.
//
// Why this exists: index.ts already has a central error handler that captures
// to PostHog and SMS-alerts via alertServerError(). But it only runs when a
// route calls next(err) — and across src/routes/ there are ~147 hand-rolled
// `res.status(500).json(...)` returns and *zero* next(err) calls. Every one of
// those swallows its error, logs to console, and answers 500 without the
// alerting pipeline ever seeing it.
//
// That is exactly how the 2026-08-07 incident stayed invisible for three days:
// GET /workouts/:date caught its own JSON.parse SyntaxError, console.error'd
// it, and returned 500. No PostHog event, no SMS. A Pro user's history was
// permanently broken and nothing told us.
//
// Rewriting 147 call sites is a big, risky diff and does nothing for the 148th
// one somebody writes next week. Instead this intercepts the response: any 5xx
// leaving the process gets reported exactly once, whoever sent it and however
// they sent it.

import type { Request, Response, NextFunction } from 'express';
import posthog from '../services/posthogClient.js';
import { alertServerError } from '../services/errorAlertService.js';

// Per-response latch. A Symbol so it can't collide with anything Express or a
// route puts on the object.
const REPORTED = Symbol('axiom.errorReported');

function alreadyReported(res: Response): boolean {
  return (res as any)[REPORTED] === true;
}

/**
 * Report a 5xx once per response.
 *
 * Safe to call from anywhere — a route's catch block, the central error
 * handler, or the interceptor below. The first caller wins, so a route that
 * reports its own error with a real stack is never double-counted by the
 * interceptor that fires later on the same response.
 *
 * Never throws: reporting failures must not turn a 500 into a crash.
 */
export function reportServerError(
  err: unknown,
  req: Request,
  res: Response,
  status = 500,
): void {
  try {
    if (alreadyReported(res)) return;
    (res as any)[REPORTED] = true;

    const userId = (req as any).user?.id;
    // req.route?.path keeps the parameterised form (/workouts/:date) so the
    // alert fingerprint groups by endpoint rather than exploding per date.
    const route = (req as any).route?.path ?? req.path ?? 'unknown';

    posthog.captureException(err, userId);
    console.error(`[5xx] ${req.method} ${route}${userId ? ` user=${userId}` : ''}:`, err);
    void alertServerError(err, route, req.method, status).catch(() => {});
  } catch {
    /* reporting must never break the response */
  }
}

/** Mark a response as reported without sending anything (used by tests). */
export function markReported(res: Response): void {
  (res as any)[REPORTED] = true;
}

/**
 * Turn whatever a route passed to res.json() into something with a message.
 * These bodies look like `{ error: 'Failed to fetch workout log' }`, so the
 * original Error (and its stack) is already gone — the route swallowed it.
 * A synthesised Error still gives us endpoint, method, user and frequency,
 * which is the difference between knowing and not knowing.
 */
function errorFromBody(body: unknown, status: number): Error {
  let detail = '';
  if (typeof body === 'string') detail = body;
  else if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    detail = String(b.error ?? b.message ?? '');
  }
  const e = new Error(detail || `HTTP ${status}`);
  e.name = 'UnreportedServerError';
  return e;
}

/**
 * Install the interceptor. Register BEFORE the routes so the patched methods
 * are in place by the time a handler responds.
 */
export function errorReporting(req: Request, res: Response, next: NextFunction): void {
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);

  const intercept = (body: unknown): void => {
    // res.json() delegates to res.send() internally, so both fire for one
    // response — the latch inside reportServerError collapses that to one
    // report.
    if (res.statusCode >= 500 && !alreadyReported(res)) {
      reportServerError(errorFromBody(body, res.statusCode), req, res, res.statusCode);
    }
  };

  res.json = function patchedJson(body?: unknown) {
    intercept(body);
    return originalJson(body);
  } as Response['json'];

  res.send = function patchedSend(body?: unknown) {
    intercept(body);
    return originalSend(body);
  } as Response['send'];

  next();
}
