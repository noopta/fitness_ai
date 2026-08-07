// In-process sliding-window rate limiter.
//
// Dependency-free by design (see securityHeaders.ts for the same reasoning).
// The backend runs as a single systemd process — no cluster, no PM2 fork mode —
// so an in-memory counter is authoritative. If that ever changes, this needs to
// move behind a shared store; the `RateLimiter` interface below is the seam.
//
// Why this exists: before it, there was no rate limiting anywhere in the app.
// The concrete exposures were:
//   POST /auth/login     — unlimited credential stuffing, and a CPU DoS in its
//                          own right (bcrypt cost 12 on a 3.7 GB box).
//   POST /auth/register  — unlimited account creation, and every signup fires a
//                          Twilio SMS to NOTIFICATION_PHONE. That's a billing
//                          attack with a phone-flood side effect.
//   POST /waitlist       — unauthenticated, fires an SMS *and* a SendGrid mail.
//   LLM routes           — per-day counters existed, but nothing stopped a
//                          burst from exhausting the day's quota in seconds.
//
// Keying: authenticated requests key on user id (so one user behind CGNAT can't
// exhaust the limit for a whole carrier's worth of other users, and so a single
// user can't dodge the limit by rotating IPs). Unauthenticated requests fall
// back to IP. `app.set('trust proxy', 1)` in index.ts makes req.ip the real
// client address rather than nginx's.

import { Request, Response, NextFunction } from 'express';

interface Hit {
  /** Timestamps (ms) of requests inside the current window, oldest first. */
  times: number[];
}

export interface RateLimitOptions {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Max requests permitted per key per window. */
  max: number;
  /** Message returned in the 429 body. */
  message?: string;
  /**
   * Key derivation. Defaults to user-id-then-IP. Override for limits that
   * should be scoped to something else (e.g. the target email on a resend).
   */
  keyFn?: (req: Request) => string;
  /**
   * When true, a successful (< 400) response does not consume a slot. Use for
   * credential endpoints so a legitimate user who logs in repeatedly isn't
   * penalised, while a brute-forcer — who by definition gets 401s — is.
   */
  skipSuccessful?: boolean;
}

/** One bucket store per limiter instance, so limits never bleed across routes. */
function createStore() {
  const store = new Map<string, Hit>();

  // Periodic sweep. Without this the map grows unbounded with one entry per
  // distinct IP ever seen — a slow memory leak that a scanner would accelerate.
  // unref() so this timer never holds the process open on shutdown.
  const sweep = setInterval(() => {
    const cutoff = Date.now() - 60 * 60 * 1000; // an hour covers every window below
    for (const [key, hit] of store) {
      if (hit.times.length === 0 || hit.times[hit.times.length - 1] < cutoff) {
        store.delete(key);
      }
    }
  }, 10 * 60 * 1000);
  sweep.unref?.();

  return store;
}

function defaultKey(req: Request): string {
  return req.user?.id ? `u:${req.user.id}` : `ip:${req.ip ?? 'unknown'}`;
}

/**
 * Global kill switch, read per-request rather than at construction so it can be
 * flipped without a restart.
 *
 * Route tests drive many requests through one process from a single synthetic
 * IP and would otherwise trip these limits — a test asserting a 400 on a short
 * password gets a 429 from the sixth registration attempt onward. vitest.config
 * sets this, so limits are off by default under test; rateLimiter.test.ts turns
 * it back on explicitly to exercise the real behaviour.
 */
function limitingDisabled(): boolean {
  return process.env.RATE_LIMIT_DISABLED === 'true';
}

export function rateLimit(opts: RateLimitOptions) {
  const { windowMs, max, message, keyFn = defaultKey, skipSuccessful = false } = opts;
  const store = createStore();

  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
    if (limitingDisabled()) return next();

    const key = keyFn(req);
    const now = Date.now();
    const cutoff = now - windowMs;

    let hit = store.get(key);
    if (!hit) {
      hit = { times: [] };
      store.set(key, hit);
    }

    // Drop timestamps that have aged out of the window. Times are appended in
    // order, so everything before the first in-window entry can go at once.
    let firstFresh = 0;
    while (firstFresh < hit.times.length && hit.times[firstFresh] <= cutoff) firstFresh++;
    if (firstFresh > 0) hit.times.splice(0, firstFresh);

    if (hit.times.length >= max) {
      const retryAfterSec = Math.max(1, Math.ceil((hit.times[0] + windowMs - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.setHeader('X-RateLimit-Limit', String(max));
      res.setHeader('X-RateLimit-Remaining', '0');
      return res.status(429).json({
        error: message ?? 'Too many requests. Please slow down and try again shortly.',
        retryAfterSeconds: retryAfterSec,
      });
    }

    // Reserve the slot up-front so concurrent requests can't both slip through.
    hit.times.push(now);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - hit.times.length)));

    if (skipSuccessful) {
      // Refund the slot iff the request succeeded. Hooked on 'finish' so it
      // reflects the real status code rather than guessing up-front.
      res.on('finish', () => {
        if (res.statusCode < 400) {
          const current = store.get(key);
          if (!current) return;
          const idx = current.times.indexOf(now);
          if (idx !== -1) current.times.splice(idx, 1);
        }
      });
    }

    next();
  };
}

// ─── Preset limiters ─────────────────────────────────────────────────────────
//
// Every value is env-overridable so a limit can be relaxed in an incident
// without a redeploy. Defaults are chosen to be invisible to real usage: the
// mobile app's chattiest screen (the feed) makes well under 60 calls/min.

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Global backstop on every /api route. Generous — this exists to stop a
 * scripted flood, not to shape normal traffic.
 */
export const globalLimiter = rateLimit({
  windowMs: 60_000,
  max: envInt('RATE_LIMIT_GLOBAL_PER_MIN', 300),
});

/**
 * Credential endpoints. skipSuccessful means a user who genuinely logs in over
 * and over is unaffected, while failed attempts burn the budget fast.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: envInt('RATE_LIMIT_AUTH_PER_15MIN', 10),
  skipSuccessful: true,
  message: 'Too many sign-in attempts. Please wait a few minutes and try again.',
});

/**
 * Account creation. Low and IP-keyed: each signup sends an SMS on our bill, so
 * this is a cost control as much as an abuse control.
 */
export const registerLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: envInt('RATE_LIMIT_REGISTER_PER_HOUR', 5),
  keyFn: (req) => `ip:${req.ip ?? 'unknown'}`,
  message: 'Too many accounts created from this network. Please try again later.',
});

/**
 * Unauthenticated endpoints that spend money on a third party per call
 * (Twilio + SendGrid): waitlist, verification resend.
 */
export const outboundNotifyLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: envInt('RATE_LIMIT_OUTBOUND_PER_HOUR', 5),
  keyFn: (req) => `ip:${req.ip ?? 'unknown'}`,
  message: 'Too many requests from this network. Please try again later.',
});

/**
 * LLM / vision / transcription routes. The per-day tier quotas still apply on
 * top of this; this only bounds the burst rate so a day's quota can't be
 * drained in one scripted second.
 */
export const aiLimiter = rateLimit({
  windowMs: 60_000,
  max: envInt('RATE_LIMIT_AI_PER_MIN', 12),
  message: 'You are sending requests too quickly. Give it a moment and try again.',
});

/**
 * User-to-user writes (DMs, comments, posts, friend requests). Bounds spam and
 * harassment throughput independently of content moderation.
 */
export const socialWriteLimiter = rateLimit({
  windowMs: 60_000,
  max: envInt('RATE_LIMIT_SOCIAL_WRITE_PER_MIN', 30),
  message: 'You are posting too quickly. Take a breath and try again.',
});
