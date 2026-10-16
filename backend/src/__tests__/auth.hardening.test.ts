/**
 * Regression tests for the Oct-2026 auth hardening:
 *  - /auth/verify-email must never issue a session without a verified code
 *  - the OAuth redirect allowlist must not accept registrable suffix domains
 *  - OAuth state is signed, stamped and nonce-bound
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

process.env.JWT_SECRET = 'test_secret_key_at_least_32_chars_long!!';
process.env.JWT_EXPIRES_IN = '1h';
process.env.EMAIL_VERIFICATION_ENABLED = 'true';
process.env.NODE_ENV = 'production';

const verifiedUser = {
  id: 'user_v', name: 'Verified', email: 'v@example.com', hashedPassword: '$2a$12$x',
  googleId: null, appleId: null, tier: 'free', emailVerified: true, emailVerifiedAt: new Date(),
  dateOfBirth: new Date('1990-01-01'), createdAt: new Date(), updatedAt: new Date(),
};

const prismaUserMock = { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() };
const prismaEmailCodeMock = { findUnique: vi.fn(), upsert: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue({}) };

vi.mock('@prisma/client', () => {
  const PrismaClient = vi.fn(function (this: any) {
    this.user = prismaUserMock;
    this.emailVerificationCode = prismaEmailCodeMock;
  });
  return { PrismaClient };
});
vi.mock('../services/mailService.js', () => ({
  sendEmail: vi.fn(async () => ({ sent: true, provider: 'sendgrid' as const })),
  isMailConfigured: () => true,
}));

async function buildApp() {
  const { default: authRoutes } = await import('../routes/auth.js');
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use('/api', authRoutes);
  return app;
}

describe('POST /api/auth/verify-email (no token without a verified code)', () => {
  let app: express.Express;
  beforeAll(async () => { app = await buildApp(); });
  afterEach(() => {
    prismaUserMock.findUnique.mockReset();
    prismaUserMock.update.mockReset();
    prismaEmailCodeMock.findUnique.mockReset();
  });

  it('returns 409 and NO token/cookie for an already-verified email with a bogus code', async () => {
    prismaUserMock.findUnique.mockResolvedValueOnce(verifiedUser);
    prismaEmailCodeMock.findUnique.mockResolvedValueOnce(null); // no active code row
    const res = await request(app).post('/api/auth/verify-email').send({ email: 'v@example.com', code: '123456' });
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('already_verified');
    expect(res.body.token).toBeUndefined();
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(prismaUserMock.update).not.toHaveBeenCalled();
  });

  it('returns 400 and no token for an unverified email with a wrong code', async () => {
    prismaUserMock.findUnique.mockResolvedValueOnce({ ...verifiedUser, emailVerified: false });
    prismaEmailCodeMock.findUnique.mockResolvedValueOnce(null);
    const res = await request(app).post('/api/auth/verify-email').send({ email: 'v@example.com', code: '123456' });
    expect(res.status).toBe(400);
    expect(res.body.token).toBeUndefined();
  });
});

describe('OAuth redirect allowlist', () => {
  it('rejects registrable preview-host suffixes and foreign hosts', async () => {
    const { isAllowedRedirectTarget } = await import('../routes/auth.js');
    expect(isAllowedRedirectTarget('https://evil.replit.app/cb')).toBe(false);
    expect(isAllowedRedirectTarget('https://evil.replit.dev/cb')).toBe(false);
    expect(isAllowedRedirectTarget('https://evil.repl.co/cb')).toBe(false);
    expect(isAllowedRedirectTarget('https://axiomtraining.io.evil.tld/')).toBe(false);
    expect(isAllowedRedirectTarget('https://evil.tld/#axiomtraining.io')).toBe(false);
    expect(isAllowedRedirectTarget('http://localhost:5000/cb')).toBe(false); // prod: no localhost
    expect(isAllowedRedirectTarget('exp://127.0.0.1:8081')).toBe(false);     // prod: no Expo Go
  });
  it('accepts our own hosts and app schemes', async () => {
    const { isAllowedRedirectTarget } = await import('../routes/auth.js');
    expect(isAllowedRedirectTarget('https://axiomtraining.io/login')).toBe(true);
    expect(isAllowedRedirectTarget('https://www.axiomtraining.io/login')).toBe(true);
    expect(isAllowedRedirectTarget('axiom://auth/callback')).toBe(true);
  });
});

describe('OAuth state', () => {
  it('round-trips a redirect with a matching nonce', async () => {
    const { encodeOAuthState, decodeOAuthState } = await import('../routes/auth.js');
    const st = encodeOAuthState('axiom://auth/callback', 'nonce1');
    const out = decodeOAuthState(st, 'nonce1');
    expect(out.ok).toBe(true);
    expect(out.mobileRedirect).toBe('axiom://auth/callback');
  });
  it('rejects a tampered redirect', async () => {
    const { encodeOAuthState, decodeOAuthState } = await import('../routes/auth.js');
    const st = encodeOAuthState('axiom://auth/callback', 'nonce1');
    const [payload] = st.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), r: 'https://evil.tld' })).toString('base64url');
    const out = decodeOAuthState(`${forged}.${st.split('.')[1]}`, 'nonce1');
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('bad_signature');
  });
  it('rejects legacy unsigned state and still yields a safe error redirect', async () => {
    const { decodeOAuthState } = await import('../routes/auth.js');
    const legacy = Buffer.from(JSON.stringify({ mobileRedirect: 'https://evil.replit.app' })).toString('base64');
    const out = decodeOAuthState(legacy, undefined);
    expect(out.ok).toBe(false);
    expect(out.mobileRedirect).toBeNull();
  });
});
