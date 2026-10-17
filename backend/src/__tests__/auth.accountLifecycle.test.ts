/**
 * Oct-2026 audit remediation: account lifecycle routes.
 *  - issueToken carries tv; POST /auth/logout-all bumps tokenVersion
 *  - consent capture on register and POST /auth/consent; /auth/me reports it
 *  - /auth/me reports needsDob
 *  - POST /auth/set-dob under 13 deletes the account
 *  - DELETE /auth/account: Stripe cancel, trust-and-safety + email-keyed rows,
 *    PostHog scrub, warnings for failed steps
 *  - display-name caps / moderation on register and Apple sign-in
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test_secret_key_at_least_32_chars_long!!';
process.env.JWT_EXPIRES_IN = '1h';
process.env.EMAIL_VERIFICATION_ENABLED = 'false';
process.env.STRIPE_SECRET_KEY = 'sk_test_x';

const userMock = { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() };
const memberMock = { findMany: vi.fn(), count: vi.fn() };
// Every model on the transaction client; records each call as `model.op`.
const txCalls: Array<{ model: string; op: string; args: any }> = [];
const failModels = new Set<string>();
const txClient: any = new Proxy({}, {
  get(_t, model: string) {
    if (model === 'user') return { delete: userMock.delete };
    return new Proxy({}, {
      get(_m, op: string) {
        return async (args: any) => {
          txCalls.push({ model, op, args });
          if (failModels.has(model)) throw new Error(`no such table: ${model}`);
          return op === 'findMany' ? [] : { count: 0 };
        };
      },
    });
  },
});

vi.mock('@prisma/client', () => {
  const PrismaClient = vi.fn(function (this: any) {
    this.user = userMock;
    this.institutionMember = memberMock;
    this.emailVerificationCode = { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() };
    this.$transaction = async (cb: any) => cb(txClient);
  });
  return { PrismaClient };
});
vi.mock('../middleware/requireAuth.js', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const id = req.headers['x-test-user'];
    if (!id) return res.status(401).json({ error: 'Authentication required' });
    req.user = { id, email: `${id}@example.com`, tier: 'free' };
    next();
  },
  requireExportToken: (_req: any, _res: any, next: any) => next(),
  EXPORT_TOKEN_TTL_SEC: 300,
}));
const posthog = { identify: vi.fn(), capture: vi.fn(), captureException: vi.fn() };
vi.mock('../services/posthogClient.js', () => ({ default: posthog }));
const cancelActiveSubscriptions = vi.fn(async () => 1);
vi.mock('../services/stripeService.js', () => ({ cancelActiveSubscriptions, liveSubscriptionEnd: vi.fn(async () => null) }));
const moderateText = vi.fn(async (_t: string, _s: string) => ({ allowed: true, message: null }));
vi.mock('../services/moderationService.js', () => ({
  moderateText: (t: string, s: string) => moderateText(t, s),
  moderateImageBase64: vi.fn(async () => ({ allowed: true })),
  checkReservedName: (n: string) => (/^axiom$/i.test(n.trim()) ? 'That name is reserved.' : null),
}));
vi.mock('../services/welcomeEmailService.js', () => ({ scheduleWelcomeEmail: vi.fn() }));
vi.mock('../services/mailService.js', () => ({ sendEmail: vi.fn(async () => ({ sent: true })), isMailConfigured: () => true }));
const appleVerify = vi.fn();
vi.mock('apple-signin-auth', () => ({ default: { verifyIdToken: (...a: any[]) => appleVerify(...a) } }));

let app: express.Express;
beforeAll(async () => {
  const { default: authRoutes } = await import('../routes/auth.js');
  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use('/api', authRoutes);
});
beforeEach(() => {
  for (const m of Object.values(userMock)) m.mockReset();
  memberMock.findMany.mockReset().mockResolvedValue([]);
  memberMock.count.mockReset().mockResolvedValue(0);
  posthog.identify.mockClear();
  posthog.capture.mockClear();
  cancelActiveSubscriptions.mockClear();
  moderateText.mockClear();
  txCalls.length = 0;
  failModels.clear();
});

const decode = (t: string) => jwt.verify(t, process.env.JWT_SECRET!) as any;

describe('register: consent + display name', () => {
  const body = { name: 'Sam', email: 'sam@example.com', password: 'password123', dateOfBirth: '1990-01-01' };

  it('records consent timestamps and termsVersion, and issues a token with tv', async () => {
    userMock.findUnique.mockResolvedValueOnce(null);
    userMock.create.mockImplementation(async ({ data }: any) => ({ id: 'u1', tier: 'free', tokenVersion: 0, ...data }));
    const res = await request(app).post('/api/auth/register').send({ ...body, acceptedTerms: true, healthConsent: true, marketingConsent: false });
    expect(res.status).toBe(200);
    const data = userMock.create.mock.calls[0][0].data;
    expect(data.acceptedTermsAt).toBeInstanceOf(Date);
    expect(data.termsVersion).toBe('2026-10');
    expect(data.healthConsentAt).toBeInstanceOf(Date);
    expect(data.marketingConsentAt).toBeNull();
    expect(decode(res.body.token).tv).toBe(0);
  });

  it('rejects names over 60 characters and reserved names', async () => {
    const long = await request(app).post('/api/auth/register').send({ ...body, name: 'x'.repeat(61) });
    expect(long.status).toBe(400);
    const reserved = await request(app).post('/api/auth/register').send({ ...body, name: 'Axiom' });
    expect(reserved.status).toBe(400);
    expect(userMock.create).not.toHaveBeenCalled();
  });

  it('moderates the display name', async () => {
    moderateText.mockResolvedValueOnce({ allowed: false, message: 'Pick another name.' });
    const res = await request(app).post('/api/auth/register').send(body);
    expect(res.status).toBe(400);
    expect(moderateText).toHaveBeenCalledWith('Sam', 'display_name');
    expect(userMock.create).not.toHaveBeenCalled();
  });
});

describe('Apple sign-in fullName', () => {
  it('caps the name at 60 characters before saving', async () => {
    appleVerify.mockResolvedValueOnce({ sub: 'apple-1', email: 'a@privaterelay.appleid.com', email_verified: 'true' });
    userMock.findUnique.mockResolvedValue(null);
    userMock.findFirst?.mockResolvedValue(null);
    userMock.create.mockImplementation(async ({ data }: any) => ({ id: 'ua', tier: 'free', tokenVersion: 0, dateOfBirth: null, ...data }));
    userMock.update.mockImplementation(async ({ data }: any) => ({ id: 'ua', tier: 'free', tokenVersion: 0, dateOfBirth: null, ...data }));
    await request(app).post('/api/auth/apple').send({ identityToken: 'x', fullName: { givenName: 'A'.repeat(50), familyName: 'B'.repeat(50) } });
    const saved = [...userMock.create.mock.calls, ...userMock.update.mock.calls].map((c) => c[0]?.data?.name).filter(Boolean);
    expect(saved.length).toBeGreaterThan(0);
    for (const n of saved) expect(n.length).toBeLessThanOrEqual(60);
  });
});

describe('POST /auth/logout-all', () => {
  it('bumps tokenVersion and clears the cookie', async () => {
    userMock.update.mockResolvedValueOnce({ tokenVersion: 4 });
    const res = await request(app).post('/api/auth/logout-all').set('x-test-user', 'u1');
    expect(res.status).toBe(200);
    expect(userMock.update.mock.calls[0][0]).toMatchObject({ where: { id: 'u1' }, data: { tokenVersion: { increment: 1 } } });
    expect(String(res.headers['set-cookie'])).toMatch(/liftoff_jwt=;/);
  });
});

describe('POST /auth/consent', () => {
  it('records accepted terms with the current version and lets marketing be withdrawn', async () => {
    userMock.update.mockImplementation(async ({ data }: any) => ({ acceptedTermsAt: null, termsVersion: null, healthConsentAt: null, marketingConsentAt: null, ...data }));
    const res = await request(app).post('/api/auth/consent').set('x-test-user', 'u1').send({ acceptedTerms: true, marketingConsent: false });
    expect(res.status).toBe(200);
    const data = userMock.update.mock.calls[0][0].data;
    expect(data.termsVersion).toBe('2026-10');
    expect(data.acceptedTermsAt).toBeInstanceOf(Date);
    expect(data.marketingConsentAt).toBeNull();
    expect('healthConsentAt' in data).toBe(false);
    expect(res.body.consent.termsVersion).toBe('2026-10');
  });

  it('400s an empty body and 401s without a session', async () => {
    expect((await request(app).post('/api/auth/consent').set('x-test-user', 'u1').send({})).status).toBe(400);
    expect((await request(app).post('/api/auth/consent').send({ acceptedTerms: true })).status).toBe(401);
  });
});

describe('GET /auth/me', () => {
  it('returns consent, needsDob, and a token carrying tv', async () => {
    const accepted = new Date('2026-10-01T00:00:00Z');
    userMock.findUnique.mockResolvedValueOnce({
      id: 'u1', email: 'u1@example.com', name: 'U', tier: 'pro', dateOfBirth: null, tokenVersion: 7,
      acceptedTermsAt: accepted, termsVersion: '2026-10', healthConsentAt: null, marketingConsentAt: null,
      institutionMemberships: [],
    });
    const res = await request(app).get('/api/auth/me').set('x-test-user', 'u1');
    expect(res.status).toBe(200);
    expect(res.body.needsDob).toBe(true);
    expect(res.body.user.needsDob).toBe(true);
    expect(res.body.consent).toMatchObject({ acceptedTermsAt: accepted.toISOString(), termsVersion: '2026-10', healthConsentAt: null, marketingConsentAt: null });
    expect(res.body.user.tokenVersion).toBeUndefined();
    const cookie = String(res.headers['set-cookie']).match(/liftoff_jwt=([^;]+)/)![1];
    expect(decode(cookie).tv).toBe(7);
  });
});

describe('POST /auth/set-dob', () => {
  it('deletes an under-13 account, clears the cookie and answers reason:underage', async () => {
    const dob = new Date(Date.now() - 10 * 365.25 * 86400000).toISOString().slice(0, 10);
    userMock.findUnique.mockResolvedValue({ id: 'kid', email: 'kid@example.com', stripeCustomerId: null, dateOfBirth: null });
    userMock.delete.mockResolvedValueOnce({});
    const res = await request(app).post('/api/auth/set-dob').set('x-test-user', 'kid').send({ dateOfBirth: dob });
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('underage');
    expect(userMock.delete).toHaveBeenCalledWith({ where: { id: 'kid' } });
    expect(String(res.headers['set-cookie'])).toMatch(/liftoff_jwt=;/);
  });

  it('saves an adult DOB', async () => {
    userMock.update.mockResolvedValueOnce({});
    const res = await request(app).post('/api/auth/set-dob').set('x-test-user', 'adult').send({ dateOfBirth: '1990-05-05' });
    expect(res.status).toBe(200);
    expect(userMock.delete).not.toHaveBeenCalled();
  });
});

describe('DELETE /auth/account', () => {
  beforeEach(() => {
    userMock.findUnique.mockResolvedValue({ id: 'u1', email: 'Del@Example.com', stripeCustomerId: 'cus_1' });
    userMock.delete.mockResolvedValue({});
  });

  it('cancels Stripe, removes reports/flags/blog rows, scrubs PostHog', async () => {
    const res = await request(app).delete('/api/auth/account').set('x-test-user', 'u1');
    expect(res.status).toBe(200);
    expect(res.body.warnings).toEqual([]);
    expect(cancelActiveSubscriptions).toHaveBeenCalledWith('cus_1');
    const hit = (model: string, where: any) => txCalls.some((c) => c.model === model && c.op === 'deleteMany' && JSON.stringify(c.args?.where) === JSON.stringify(where));
    expect(hit('contentReport', { reportedUserId: 'u1' })).toBe(true);
    expect(hit('contentReport', { reporterId: 'u1' })).toBe(true);
    expect(hit('contentFlag', { userId: 'u1' })).toBe(true);
    expect(hit('blogSubscriber', { email: 'del@example.com' })).toBe(true);
    expect(posthog.identify).toHaveBeenCalledWith({ distinctId: 'u1', properties: { $set: { email: null, name: null, deleted: true } } });
  });

  it('removes imported prospect data for practices the user was the last coach of', async () => {
    memberMock.findMany.mockResolvedValueOnce([{ institutionId: 'p1' }, { institutionId: 'p2' }]);
    memberMock.count.mockResolvedValueOnce(0).mockResolvedValueOnce(2); // p1 sole coach, p2 has others
    const res = await request(app).delete('/api/auth/account').set('x-test-user', 'u1');
    expect(res.status).toBe(200);
    const orphan = txCalls.filter((c) => c.op === 'deleteMany' && JSON.stringify(c.args?.where) === JSON.stringify({ practiceId: { in: ['p1'] } }));
    expect(orphan.map((c) => c.model).sort()).toEqual(['ptImport', 'ptImportedWeight', 'ptImportedWorkout', 'ptProspect']);
  });

  it('reports failed steps as warnings and still deletes the user', async () => {
    failModels.add('contentFlag');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app).delete('/api/auth/account').set('x-test-user', 'u1');
    expect(res.status).toBe(200);
    expect(res.body.warnings).toContain('contentFlag');
    expect(userMock.delete).toHaveBeenCalled();
    expect(err.mock.calls.some((c) => String(c[0]).includes('contentFlag'))).toBe(true);
    err.mockRestore();
  });

  it('deletes nothing when Stripe cancellation fails', async () => {
    cancelActiveSubscriptions.mockRejectedValueOnce(new Error('stripe down'));
    const res = await request(app).delete('/api/auth/account').set('x-test-user', 'u1');
    expect(res.status).toBe(502);
    expect(userMock.delete).not.toHaveBeenCalled();
  });
});
