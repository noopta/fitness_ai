/**
 * Integration-style tests for the auth routes.
 * Uses vitest mocks to stub Prisma and bcrypt so no real DB is needed.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

// ─── Env setup (must happen before route import) ─────────────────────────────
process.env.JWT_SECRET = 'test_secret_key_at_least_32_chars_long!!';
process.env.JWT_EXPIRES_IN = '1h';
// The verification-required code paths only fire when this flag is on.
// Production keeps it off by default until SendGrid + the mobile OTA are
// both ready; tests turn it on so we exercise both branches.
process.env.EMAIL_VERIFICATION_ENABLED = 'true';

// ─── Mock @prisma/client ──────────────────────────────────────────────────────
const mockUser = {
  id: 'user_123',
  name: 'Test User',
  email: 'test@example.com',
  hashedPassword: '$2a$12$placeholder', // will be overridden per test
  googleId: null,
  tier: 'free',
  heightCm: null,
  weightKg: null,
  trainingAge: null,
  equipment: null,
  constraintsText: null,
  dateOfBirth: null,
  stripeCustomerId: null,
  stripeSubStatus: null,
  dailyAnalysisCount: 0,
  dailyAnalysisDate: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const prismaUserMock = {
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
};
// The register/login routes now also touch the EmailVerificationCode model
// via emailVerificationService (upsert for new codes, findUnique for cooldown).
const prismaEmailCodeMock = {
  findUnique: vi.fn(),
  upsert: vi.fn().mockResolvedValue({}),
  update: vi.fn().mockResolvedValue({}),
};

vi.mock('@prisma/client', () => {
  const PrismaClient = vi.fn(function (this: any) {
    this.user = prismaUserMock;
    this.emailVerificationCode = prismaEmailCodeMock;
  });
  return { PrismaClient };
});

// Don't actually hit SendGrid/Gmail when register tests trigger code emails.
vi.mock('../services/mailService.js', () => ({
  sendEmail: vi.fn(async () => ({ sent: true, provider: 'sendgrid' as const })),
  isMailConfigured: () => true,
}));

// ─── Build test app ───────────────────────────────────────────────────────────
async function buildApp() {
  const { default: authRoutes } = await import('../routes/auth.js');
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use('/api', authRoutes);
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/auth/register', () => {
  let app: express.Express;

  beforeAll(async () => {
    app = await buildApp();
  });

  // Targeted reset on the per-prisma-method mocks (not vi.clearAllMocks /
  // resetAllMocks): clearAllMocks doesn't drain queued
  // mockResolvedValueOnce implementations (which previously leaked stale
  // returns into the login suite), and resetAllMocks would wipe the
  // PrismaClient constructor mock and break every subsequent test.
  afterEach(() => {
    prismaUserMock.findUnique.mockReset();
    prismaUserMock.create.mockReset();
    prismaUserMock.update.mockReset();
    prismaEmailCodeMock.findUnique.mockReset();
    prismaEmailCodeMock.upsert.mockReset(); prismaEmailCodeMock.upsert.mockResolvedValue({});
    prismaEmailCodeMock.update.mockReset(); prismaEmailCodeMock.update.mockResolvedValue({});
  });

  // Helper — every register request must carry a valid dateOfBirth now
  // (registerSchema added it). Tests that don't care about DOB use this
  // default; tests covering DOB validation override per-call.
  const VALID_DOB = '1995-01-01';

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'bad' }); // missing name, password, dob
    expect(res.status).toBe(400);
  });

  it('returns 409 when email is already in use AND verified', async () => {
    // Only verified rows can be "already in use" — an unverified row triggers
    // the recovery path instead (see the next test).
    prismaUserMock.findUnique.mockResolvedValueOnce({ ...mockUser, emailVerified: true });

    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Test', email: 'test@example.com', password: 'password123', dateOfBirth: VALID_DOB });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already in use/i);
  });

  it('returns 200 + requiresVerification when the email exists but is unverified (resend path)', async () => {
    prismaUserMock.findUnique.mockResolvedValueOnce({ ...mockUser, emailVerified: false });
    prismaEmailCodeMock.findUnique.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Test', email: 'test@example.com', password: 'password123', dateOfBirth: VALID_DOB });
    expect(res.status).toBe(200);
    expect(res.body.requiresVerification).toBe(true);
    expect(res.body.email).toBe('test@example.com');
  });

  it('returns 202 + requiresVerification on fresh signup (NO cookie/JWT yet)', async () => {
    prismaUserMock.findUnique.mockResolvedValueOnce(null); // no existing user
    prismaUserMock.create.mockResolvedValueOnce({
      ...mockUser,
      name: 'New User',
      email: 'new@example.com',
    });
    prismaEmailCodeMock.findUnique.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'New User', email: 'new@example.com', password: 'password123', dateOfBirth: VALID_DOB });

    expect(res.status).toBe(202);
    expect(res.body.requiresVerification).toBe(true);
    expect(res.body.email).toBe('new@example.com');
    expect(res.body.codeSent).toBe(true);
    // No JWT issued until the user enters their 6-digit OTP.
    const cookies = (res.headers['set-cookie'] as unknown) as string[] | undefined;
    expect(cookies?.some(c => c.includes('liftoff_jwt'))).toBeFalsy();
    expect(res.body.token).toBeUndefined();
  });

  it('returns 400 for invalid email format', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Test', email: 'not-an-email', password: 'password123', dateOfBirth: VALID_DOB });
    expect(res.status).toBe(400);
  });

  it('returns 400 when password is shorter than 8 characters', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Test', email: 'test@example.com', password: 'short', dateOfBirth: VALID_DOB });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/login', () => {
  let app: express.Express;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when user does not exist', async () => {
    prismaUserMock.findUnique.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'password123' });
    expect(res.status).toBe(401);
  });

  it('returns 401 when password is wrong', async () => {
    // Return a user with a real bcrypt hash for "correct_password"
    prismaUserMock.findUnique.mockResolvedValueOnce({
      ...mockUser,
      // bcrypt hash for "correct_password" (pre-computed, no actual hashing needed)
      hashedPassword: '$2a$12$invalidhashWillNotMatchAnything',
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'wrong_password' });
    expect(res.status).toBe(401);
  });

  it('returns 200 with user and sets cookie on valid credentials (verified user)', async () => {
    // Use bcrypt to hash a known password for a realistic test
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.default.hash('mypassword123', 12);

    prismaUserMock.findUnique.mockResolvedValueOnce({
      ...mockUser,
      hashedPassword: hash,
      emailVerified: true, // gates JWT issuance now
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'mypassword123' });

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe('test@example.com');
    const cookies = (res.headers['set-cookie'] as unknown) as string[] | undefined;
    expect(cookies?.some(c => c.includes('liftoff_jwt'))).toBe(true);
  });

  it('returns 200 + requiresVerification (no cookie) when password is right but email not verified', async () => {
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.default.hash('mypassword123', 12);

    prismaUserMock.findUnique.mockResolvedValueOnce({
      ...mockUser,
      hashedPassword: hash,
      emailVerified: false,
    });
    prismaEmailCodeMock.findUnique.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'mypassword123' });

    expect(res.status).toBe(200);
    expect(res.body.requiresVerification).toBe(true);
    expect(res.body.email).toBe('test@example.com');
    const cookies = (res.headers['set-cookie'] as unknown) as string[] | undefined;
    expect(cookies?.some(c => c.includes('liftoff_jwt'))).toBeFalsy();
    expect(res.body.token).toBeUndefined();
  });
});

describe('POST /api/auth/logout', () => {
  let app: express.Express;

  beforeAll(async () => {
    app = await buildApp();
  });

  it('returns 200 and clears the cookie', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Should clear the cookie (Set-Cookie with empty value / max-age=0)
    const cookies = (res.headers['set-cookie'] as unknown) as string[] | undefined;
    if (cookies) {
      const jwtCookie = cookies.find(c => c.includes('liftoff_jwt'));
      // Cleared cookie has empty value or max-age=0
      if (jwtCookie) {
        expect(
          jwtCookie.includes('liftoff_jwt=;') ||
          jwtCookie.includes('Max-Age=0') ||
          jwtCookie.includes('Expires=')
        ).toBe(true);
      }
    }
  });
});

describe('GET /api/auth/me', () => {
  let app: express.Express;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when no token is provided', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns 401 with an invalid token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', 'liftoff_jwt=invalid.token.here');
    expect(res.status).toBe(401);
  });
});
