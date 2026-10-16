import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { noteTimezone, TZ_HEADER } from '../services/userTimezone.js';
import { getCachedAuth, setCachedAuth, invalidateAuthCache, type AuthRow, type AuthCacheValue } from './authSessionCache.js';

const prisma = new PrismaClient();

export interface AuthUser {
  id: string;
  email: string | null;
  tier: string;
}

/** Claims we put in (or find in) a session JWT. */
export interface TokenClaims extends AuthUser {
  /** User.tokenVersion at issue time. Bumping the column revokes the token. */
  tv?: number;
  /** Scoped token (e.g. 'export'). Never accepted as a general login. */
  purpose?: string;
  /** First-party in-process token (agent/loopback.ts mints `via: 'agent'`). */
  via?: string;
  jti?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// Throttle lastActiveAt DB writes to once per 30 min per user (in-memory)
const lastActiveSent = new Map<string, number>();
const ACTIVE_THROTTLE_MS = 30 * 60 * 1000;

function touchLastActive(userId: string): void {
  const now = Date.now();
  const last = lastActiveSent.get(userId) ?? 0;
  if (now - last < ACTIVE_THROTTLE_MS) return;
  lastActiveSent.set(userId, now);
  // Fire-and-forget — never blocks the request
  setImmediate(() => {
    prisma.user.update({
      where: { id: userId },
      data: { lastActiveAt: new Date() },
    }).catch(() => {});
  });
}

// ─── Session state lookup ────────────────────────────────────────────────────
//
// A JWT used to be self-contained: its `tier` claim gated Pro features for up
// to 30 days after a refund, and nothing could revoke it (password reset,
// logout-all, account deletion). Every authenticated request now checks the
// token's `tv` against User.tokenVersion and takes the tier from the DB.
//
// One raw, parameterised SELECT keeps this independent of the generated client
// (it works before and after `prisma generate` picks up tokenVersion) and cheap.
// A 60 s per-user cache keeps it off the DB for chatty screens; anything that
// revokes or changes tier calls invalidateAuthCache so it takes effect now.

export { invalidateAuthCache };

let lookupFailureLogged = false;

async function loadAuthRow(userId: string): Promise<AuthCacheValue> {
  const cached = getCachedAuth(userId);
  if (cached !== undefined) return cached;

  let row: AuthRow | null | 'unavailable';
  try {
    const rows = await (prisma as any).$queryRaw`SELECT tokenVersion, tier, email FROM User WHERE id = ${userId} LIMIT 1`;
    if (!Array.isArray(rows)) {
      row = 'unavailable';
    } else if (rows.length === 0) {
      row = null;
    } else {
      const r = rows[0];
      row = { tokenVersion: Number(r.tokenVersion ?? 0) || 0, tier: r.tier ?? null, email: r.email ?? null };
    }
  } catch (err: any) {
    // DB unreachable, or the tokenVersion column isn't pushed yet. Fail open to
    // the token's own claims rather than 401 every user (mobile clears its
    // session on 401); revocation is best-effort until the lookup works again.
    if (!lookupFailureLogged) {
      lookupFailureLogged = true;
      console.error('[auth] session lookup failed; falling back to token claims:', err?.message ?? err);
    }
    row = 'unavailable';
  }
  setCachedAuth(userId, row);
  return row;
}

export type AuthResult =
  | { ok: true; user: AuthUser; claims: TokenClaims }
  | { ok: false; status: number; error: string };

/**
 * Verify a session token and reconcile it with the user's current DB state.
 * `allowPurpose` admits one scoped token type; scoped tokens are otherwise
 * refused, so an export link can never be replayed as a login.
 */
export async function resolveAuthToken(token: string, opts: { allowPurpose?: string } = {}): Promise<AuthResult> {
  let claims: TokenClaims;
  try {
    claims = jwt.verify(token, process.env.JWT_SECRET!) as TokenClaims;
  } catch {
    return { ok: false, status: 401, error: 'Invalid or expired token' };
  }
  if (!claims || typeof claims !== 'object' || typeof claims.id !== 'string' || !claims.id) {
    return { ok: false, status: 401, error: 'Invalid or expired token' };
  }
  if (claims.purpose !== undefined && claims.purpose !== opts.allowPurpose) {
    return { ok: false, status: 401, error: 'Invalid or expired token' };
  }

  const row = await loadAuthRow(claims.id);
  if (row === null) {
    // The account is gone (deleted). Its tokens die with it.
    return { ok: false, status: 401, error: 'Invalid or expired token' };
  }
  if (row === 'unavailable') {
    return { ok: true, claims, user: { id: claims.id, email: claims.email ?? null, tier: claims.tier } };
  }

  // Loopback tokens are minted in-process from a fresh DB read and live 2
  // minutes; they carry no tv and must survive a logout-all.
  if (claims.via !== 'agent') {
    // Tokens issued before tv existed count as version 0, so the first bump
    // (reset / logout-all / delete) revokes them too. AUTH_REQUIRE_TV=1 makes
    // a missing tv a hard reject once every client holds a fresh token.
    if (typeof claims.tv !== 'number' && process.env.AUTH_REQUIRE_TV === '1') {
      return { ok: false, status: 401, error: 'Session expired. Please sign in again.' };
    }
    const tv = typeof claims.tv === 'number' ? claims.tv : 0;
    if (tv < row.tokenVersion) {
      return { ok: false, status: 401, error: 'Session expired. Please sign in again.' };
    }
  }

  return {
    ok: true,
    claims,
    user: {
      id: claims.id,
      email: row.email ?? claims.email ?? null,
      // Tier from the DB, not the claim: a refund or cancel takes effect now.
      tier: row.tier ?? claims.tier,
    },
  };
}

export function tokenFromRequest(req: Request): string | undefined {
  return req.cookies?.liftoff_jwt || req.headers.authorization?.replace('Bearer ', '') || undefined;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = tokenFromRequest(req);

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  resolveAuthToken(token).then(
    (r) => {
      if (!r.ok) return res.status(r.status).json({ error: r.error });
      req.user = r.user;
      touchLastActive(r.user.id);
      noteTimezone(r.user.id, req.headers[TZ_HEADER]);
      next();
    },
    () => res.status(401).json({ error: 'Invalid or expired token' }),
  ).catch(next);
}

// ─── Export download tokens ──────────────────────────────────────────────────
//
// A browser opening the data export can't send the app's bearer token, so
// /auth/export-link hands out a URL carrying a 5-minute, single-use,
// purpose:'export' token. Only the export route accepts it (requireExportToken).

export const EXPORT_TOKEN_TTL_SEC = 5 * 60;
const consumedExportJti = new Map<string, number>(); // jti → expiry (ms)

function sweepConsumed(now: number) {
  for (const [jti, exp] of consumedExportJti) if (exp < now) consumedExportJti.delete(jti);
}

/**
 * Accepts `?t=<export token>` (single use) or, without one, a normal session.
 */
export function requireExportToken(req: Request, res: Response, next: NextFunction) {
  const t = typeof req.query.t === 'string' ? req.query.t : null;
  if (!t) return requireAuth(req, res, next);
  const expired = () => res.status(401).json({ error: 'This download link has expired. Ask again for a new one.' });
  resolveAuthToken(t, { allowPurpose: 'export' }).then((r) => {
    if (!r.ok || r.claims.purpose !== 'export' || !r.claims.jti) return expired();
    const now = Date.now();
    sweepConsumed(now);
    if (consumedExportJti.has(r.claims.jti)) return expired();
    const expMs = typeof (r.claims as any).exp === 'number' ? (r.claims as any).exp * 1000 : now + EXPORT_TOKEN_TTL_SEC * 1000;
    consumedExportJti.set(r.claims.jti, expMs);
    req.user = r.user;
    next();
  }, expired).catch(next);
}
