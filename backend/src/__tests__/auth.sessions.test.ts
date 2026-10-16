/**
 * Oct-2026 audit remediation: session revocation and credential throttling.
 *  - requireAuth/optionalAuth: stale `tv` refused, tier read from the DB,
 *    scoped (`purpose`) tokens refused, deleted accounts refused
 *  - export tokens: only on the export route, single use
 *  - IPv6 rate-limit buckets are the /64
 *  - password reset: per-address daily caps; reset bumps tokenVersion
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test_secret_key_at_least_32_chars_long!!';
process.env.NODE_ENV = 'test'; // auth cache TTL 0

const queryRaw = vi.fn();
const userMock = { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn().mockResolvedValue({}) };
const resetMock = { findUnique: vi.fn(), upsert: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}) };

vi.mock('@prisma/client', () => {
  const PrismaClient = vi.fn(function (this: any) {
    this.$queryRaw = queryRaw;
    this.user = userMock;
    this.passwordResetCode = resetMock;
  });
  return { PrismaClient };
});
vi.mock('../services/mailService.js', () => ({
  sendEmail: vi.fn(async () => ({ sent: true, provider: 'sendgrid' as const })),
  isMailConfigured: () => true,
}));

const sign = (claims: Record<string, unknown>, opts: jwt.SignOptions = { expiresIn: '1h' }) =>
  jwt.sign(claims, process.env.JWT_SECRET!, opts);

async function app() {
  const { requireAuth, requireExportToken } = await import('../middleware/requireAuth.js');
  const { optionalAuth } = await import('../middleware/optionalAuth.js');
  const a = express();
  a.use(cookieParser());
  a.get('/me', requireAuth, (req, res) => res.json(req.user));
  a.get('/maybe', optionalAuth, (req, res) => res.json({ user: req.user ?? null }));
  a.get('/export', requireExportToken, (req, res) => res.json(req.user));
  return a;
}

beforeEach(() => {
  queryRaw.mockReset();
});

describe('requireAuth session checks', () => {
  it('accepts a current token and takes tier from the DB, not the claim', async () => {
    queryRaw.mockResolvedValue([{ tokenVersion: 2, tier: 'free', email: 'a@x.com' }]);
    const res = await request(await app()).get('/me').set('Authorization', `Bearer ${sign({ id: 'u1', email: 'a@x.com', tier: 'pro', tv: 2 })}`);
    expect(res.status).toBe(200);
    expect(res.body.tier).toBe('free');
  });

  it('rejects a token whose tv is older than User.tokenVersion', async () => {
    queryRaw.mockResolvedValue([{ tokenVersion: 3, tier: 'pro', email: 'a@x.com' }]);
    const res = await request(await app()).get('/me').set('Authorization', `Bearer ${sign({ id: 'u1', tier: 'pro', tv: 2 })}`);
    expect(res.status).toBe(401);
  });

  it('treats a token without tv as version 0 (revoked by the first bump)', async () => {
    queryRaw.mockResolvedValue([{ tokenVersion: 1, tier: 'pro', email: null }]);
    const res = await request(await app()).get('/me').set('Authorization', `Bearer ${sign({ id: 'u1', tier: 'pro' })}`);
    expect(res.status).toBe(401);
  });

  it('rejects scoped (purpose) tokens on normal routes', async () => {
    queryRaw.mockResolvedValue([{ tokenVersion: 0, tier: 'free', email: null }]);
    const res = await request(await app()).get('/me').set('Authorization', `Bearer ${sign({ id: 'u1', purpose: 'export', tv: 0, jti: 'j' })}`);
    expect(res.status).toBe(401);
  });

  it('rejects tokens for a deleted account', async () => {
    queryRaw.mockResolvedValue([]);
    const res = await request(await app()).get('/me').set('Authorization', `Bearer ${sign({ id: 'gone', tier: 'free', tv: 0 })}`);
    expect(res.status).toBe(401);
  });

  it('optionalAuth stays anonymous for a revoked token', async () => {
    queryRaw.mockResolvedValue([{ tokenVersion: 5, tier: 'free', email: null }]);
    const res = await request(await app()).get('/maybe').set('Authorization', `Bearer ${sign({ id: 'u1', tier: 'free', tv: 1 })}`);
    expect(res.status).toBe(200);
    expect(res.body.user).toBeNull();
  });
});

describe('export tokens', () => {
  it('are accepted once on the export route, then refused', async () => {
    queryRaw.mockResolvedValue([{ tokenVersion: 0, tier: 'free', email: null }]);
    const a = await app();
    const t = sign({ id: 'u1', purpose: 'export', tv: 0, jti: 'jti-1' }, { expiresIn: 300 });
    const first = await request(a).get(`/export?t=${encodeURIComponent(t)}`);
    expect(first.status).toBe(200);
    expect(first.body.id).toBe('u1');
    const second = await request(a).get(`/export?t=${encodeURIComponent(t)}`);
    expect(second.status).toBe(401);
  });

  it('refuses a normal session token passed as ?t=', async () => {
    queryRaw.mockResolvedValue([{ tokenVersion: 0, tier: 'free', email: null }]);
    const t = sign({ id: 'u1', tier: 'free', tv: 0 });
    const res = await request(await app()).get(`/export?t=${encodeURIComponent(t)}`);
    expect(res.status).toBe(401);
  });

  it('export TTL is 5 minutes', async () => {
    const { EXPORT_TOKEN_TTL_SEC } = await import('../middleware/requireAuth.js');
    expect(EXPORT_TOKEN_TTL_SEC).toBe(300);
  });
});

describe('ipBucket', () => {
  it('keys IPv6 by /64 and unwraps IPv4-mapped addresses', async () => {
    const { ipBucket } = await import('../middleware/rateLimiter.js');
    expect(ipBucket('2001:db8:1:2:aaaa::1')).toBe(ipBucket('2001:db8:1:2:ffff:ffff:ffff:ffff'));
    expect(ipBucket('2001:db8:1:2::1')).toBe('2001:db8:1:2::/64');
    expect(ipBucket('2001:db8:1:3::1')).not.toBe(ipBucket('2001:db8:1:2::1'));
    expect(ipBucket('::ffff:203.0.113.9')).toBe('203.0.113.9');
    expect(ipBucket('203.0.113.9')).toBe('203.0.113.9');
    expect(ipBucket(undefined)).toBe('unknown');
  });
});

describe('password reset daily caps', () => {
  beforeEach(async () => {
    const svc = await import('../services/passwordResetService.js');
    svc.__resetDailyBudgetsForTests();
    userMock.findFirst.mockReset();
    userMock.update.mockReset().mockResolvedValue({});
    resetMock.findUnique.mockReset();
    resetMock.upsert.mockClear();
    resetMock.update.mockClear();
  });

  it('stops mailing an address after RESET_MAX_CODES_PER_DAY codes', async () => {
    const svc = await import('../services/passwordResetService.js');
    userMock.findFirst.mockResolvedValue({ id: 'u1', hashedPassword: 'h' });
    resetMock.findUnique.mockResolvedValue(null); // no cooldown row
    for (let i = 0; i < svc.RESET_MAX_CODES_PER_DAY + 3; i++) await svc.requestReset('Cap@Example.com');
    expect(resetMock.upsert).toHaveBeenCalledTimes(svc.RESET_MAX_CODES_PER_DAY);
  });

  it('locks an address after RESET_MAX_WRONG_PER_DAY wrong guesses across codes', async () => {
    const svc = await import('../services/passwordResetService.js');
    const crypto = await import('node:crypto');
    const codeHash = crypto.createHash('sha256').update('123456').digest('hex');
    resetMock.findUnique.mockResolvedValue({ email: 'g@x.com', codeHash, attempts: 0, consumedAt: null, expiresAt: new Date(Date.now() + 60_000) });
    for (let i = 0; i < svc.RESET_MAX_WRONG_PER_DAY; i++) {
      expect((await svc.resetPassword('g@x.com', '000000', 'newpassword1')).ok).toBe(false);
    }
    // Even the right code is refused once the daily budget is spent.
    const r = await svc.resetPassword('g@x.com', '123456', 'newpassword1');
    expect(r).toEqual({ ok: false, reason: 'too_many_attempts' });
  });

  it('a successful reset bumps tokenVersion', async () => {
    const svc = await import('../services/passwordResetService.js');
    const crypto = await import('node:crypto');
    const codeHash = crypto.createHash('sha256').update('654321').digest('hex');
    resetMock.findUnique.mockResolvedValue({ email: 'r@x.com', codeHash, attempts: 0, consumedAt: null, expiresAt: new Date(Date.now() + 60_000) });
    userMock.findFirst.mockResolvedValue({ id: 'u9' });
    const r = await svc.resetPassword('r@x.com', '654321', 'newpassword1');
    expect(r.ok).toBe(true);
    expect(userMock.update.mock.calls[0][0].data.tokenVersion).toEqual({ increment: 1 });
  }, 20_000);
});

describe('rate limiter configuration', () => {
  it('only the password-login limiter refunds successful requests', async () => {
    const src = (await import('node:fs')).readFileSync(new URL('../middleware/rateLimiter.ts', import.meta.url), 'utf8');
    expect(src.match(/skipSuccessful:\s*true/g)?.length).toBe(1);
    const auth = (await import('node:fs')).readFileSync(new URL('../routes/auth.ts', import.meta.url), 'utf8');
    for (const route of ['verify-email', 'forgot-password', 'reset-password', 'resend-verification']) {
      const line = auth.split('\n').find((l) => l.includes(`router.post('/auth/${route}'`));
      expect(line, route).toBeDefined();
      expect(line, route).not.toMatch(/authLimiter/);
    }
  });
});

describe('web Google callback', () => {
  it('hands the token over in the URL fragment, never the query string', async () => {
    const auth = (await import('node:fs')).readFileSync(new URL('../routes/auth.ts', import.meta.url), 'utf8');
    expect(auth).toContain('/login#auth=success&token=${encodeURIComponent(token)}');
    expect(auth).not.toMatch(/\/login\?auth=success&token=/);
  });
});
