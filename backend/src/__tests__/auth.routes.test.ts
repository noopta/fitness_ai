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

vi.mock('@prisma/client', () => {
  const PrismaClient = vi.fn(function (this: any) {
    this.user = prismaUserMock;
  });
  return { PrismaClient };
});

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

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'bad' }); // missing name, password
    expect(res.status).toBe(400);
  });

  it('returns 409 when email is already in use', async () => {
    prismaUserMock.findUnique.mockResolvedValueOnce(mockUser);

    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Test', email: 'test@example.com', password: 'password123' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already in use/i);
  });

  it('returns 200 with user and sets cookie on success', async () => {
    prismaUserMock.findUnique.mockResolvedValueOnce(null); // no existing user
    prismaUserMock.create.mockResolvedValueOnce({
      ...mockUser,
      name: 'New User',
      email: 'new@example.com',
    });

    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'New User', email: 'new@example.com', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe('new@example.com');
    // Cookie should be set
    const cookies = (res.headers['set-cookie'] as unknown) as string[] | undefined;
    expect(cookies?.some(c => c.includes('liftoff_jwt'))).toBe(true);
  });

  it('returns 400 for invalid email format', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Test', email: 'not-an-email', password: 'password123' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when password is shorter than 8 characters', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Test', email: 'test@example.com', password: 'short' });
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

  it('returns 200 with user and sets cookie on valid credentials', async () => {
    // Use bcrypt to hash a known password for a realistic test
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.default.hash('mypassword123', 12);

    prismaUserMock.findUnique.mockResolvedValueOnce({
      ...mockUser,
      hashedPassword: hash,
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
