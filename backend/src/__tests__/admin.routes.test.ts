/**
 * Admin dashboard routes.
 *
 * The important guarantees here are (a) the data is gated to ADMIN_EMAILS and
 * (b) the funnel is a strictly nested cohort. (b) matters because the first
 * version counted each stage independently and produced "intake done 27" above
 * "has program 29" — with stages out of order the "lost" figure between rows is
 * nonsense, which is exactly the kind of quiet wrongness a dashboard should
 * never have.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

process.env.JWT_SECRET = 'test_secret_key_at_least_32_chars_long!!';
process.env.ADMIN_EMAILS = 'boss@example.com';

// Raw-SQL routes: stub $queryRawUnsafe and key off a marker in each query.
const queryRawUnsafe = vi.fn();

vi.mock('@prisma/client', () => {
  const PrismaClient = vi.fn(function (this: any) {
    this.$queryRawUnsafe = queryRawUnsafe;
    this.user = { count: vi.fn().mockResolvedValue(0) };
    this.agentConversation = { count: vi.fn().mockResolvedValue(0) };
  });
  return { PrismaClient };
});

let currentUser: any = { id: 'u1', email: 'boss@example.com', tier: 'pro' };
vi.mock('../middleware/requireAuth.js', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!currentUser) return res.status(401).json({ error: 'Authentication required' });
    req.user = currentUser;
    next();
  },
  optionalAuth: (_req: any, _res: any, next: any) => next(),
}));

async function buildApp() {
  const { default: adminRoutes } = await import('../routes/admin.js');
  const app = express();
  app.use('/api', adminRoutes);
  app.use('/', adminRoutes);
  return app;
}

let app: express.Express;
beforeAll(async () => { app = await buildApp(); });

/** Funnel counts in the order the route requests them. */
function stubFunnel(counts: number[]) {
  let i = 0;
  queryRawUnsafe.mockImplementation(async () => [{ n: counts[i++] ?? 0 }]);
}

describe('admin auth gating', () => {
  it('401s with no authenticated user', async () => {
    currentUser = null;
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(401);
    currentUser = { id: 'u1', email: 'boss@example.com', tier: 'pro' };
  });

  it('403s for an authenticated non-admin', async () => {
    currentUser = { id: 'u2', email: 'someone@example.com', tier: 'pro' };
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(403);
    currentUser = { id: 'u1', email: 'boss@example.com', tier: 'pro' };
  });

  it('matches admin emails case-insensitively', async () => {
    currentUser = { id: 'u1', email: 'BOSS@Example.COM', tier: 'pro' };
    stubFunnel([10, 5, 4, 3, 2, 1, 0, 0, 0, 0]);
    const res = await request(app).get('/api/admin/funnel');
    expect(res.status).toBe(200);
    currentUser = { id: 'u1', email: 'boss@example.com', tier: 'pro' };
  });

  it('serves the page shell unauthenticated — it holds no data', async () => {
    currentUser = null;
    const res = await request(app).get('/admin');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('/api/admin/funnel');
    currentUser = { id: 'u1', email: 'boss@example.com', tier: 'pro' };
  });
});

describe('GET /api/admin/funnel', () => {
  it('returns stages in strictly non-increasing order', async () => {
    stubFunnel([162, 29, 16, 12, 5, 4, 3, 2, 4, 1]);
    const res = await request(app).get('/api/admin/funnel');

    expect(res.status).toBe(200);
    const counts = res.body.stages.map((s: any) => s.count);
    expect(counts).toEqual([162, 29, 16, 12, 5, 4]);
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]);
    }
  });

  it('identifies the biggest absolute drop', async () => {
    stubFunnel([162, 29, 16, 12, 5, 4, 3, 2, 4, 1]);
    const res = await request(app).get('/api/admin/funnel');
    expect(res.body.biggestDropOff).toMatchObject({ lost: 133 });
    expect(res.body.biggestDropOff.from).toBe('Signed up');
  });

  it('surfaces off-path users rather than hiding them', async () => {
    stubFunnel([162, 29, 16, 12, 5, 4, 3, 2, 4, 1]);
    const res = await request(app).get('/api/admin/funnel');
    // Nesting on "has a program" excludes anyone who logged without one; that
    // count has to stay visible or real usage is understated.
    expect(res.body.offPath.loggedWithoutProgram).toBe(3);
    expect(res.body.offPath.programWithoutIntakeFlag).toBe(2);
  });

  it('reports no drop when nothing is lost', async () => {
    stubFunnel([5, 5, 5, 5, 5, 5, 0, 0, 0, 0]);
    const res = await request(app).get('/api/admin/funnel');
    expect(res.body.biggestDropOff).toBeNull();
  });
});

describe('GET /api/admin/users', () => {
  const row = (over: any = {}) => ({
    id: 'u1', email: 'a@b.c', username: 'ann', name: 'Ann', tier: 'free',
    intakeDone: 1, hasProgram: 1, signedUp: '2026-01-01',
    meals: 3, workouts: 1, wellness: 0, activeDays: 2,
    lastActivityDay: null, lastActionType: null, usedChat: 0, ...over,
  });

  it('computes daysQuiet from the last activity day', async () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    queryRawUnsafe.mockResolvedValueOnce([row({ lastActivityDay: yesterday, lastActionType: 'nutrition' })]);
    const res = await request(app).get('/api/admin/users');

    expect(res.status).toBe(200);
    expect(res.body.users[0].daysQuiet).toBe(1);
    expect(res.body.users[0].lastActionType).toBe('nutrition');
  });

  it('keeps never-active users as null, not zero or infinity', async () => {
    queryRawUnsafe.mockResolvedValueOnce([row()]);
    const res = await request(app).get('/api/admin/users');
    // null is a distinct state from "quiet for N days" and the UI sorts on it.
    expect(res.body.users[0].daysQuiet).toBeNull();
    expect(res.body.neverActive).toBe(1);
  });

  it('coerces SQLite integer flags to booleans', async () => {
    queryRawUnsafe.mockResolvedValueOnce([row({ hasProgram: 0, usedChat: 1, intakeDone: 1 })]);
    const res = await request(app).get('/api/admin/users');
    const u = res.body.users[0];
    expect(u.hasProgram).toBe(false);
    expect(u.usedChat).toBe(true);
    expect(u.intakeDone).toBe(true);
  });

  it('returns an accurate total', async () => {
    queryRawUnsafe.mockResolvedValueOnce([row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })]);
    const res = await request(app).get('/api/admin/users');
    expect(res.body.total).toBe(3);
  });
});
