/**
 * Unit tests for the analysis rate-limit middleware.
 * We test the logic by creating mock req/res/next objects.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// ─── Setup env + mock Prisma before import ────────────────────────────────────
process.env.FREE_TIER_DAILY_LIMIT = '2';

const prismaUserMock = {
  findUnique: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
};

vi.mock('@prisma/client', () => {
  const PrismaClient = vi.fn(function (this: any) {
    this.user = prismaUserMock;
  });
  return { PrismaClient };
});

// Lazy import after mocks are set up
const { checkAnalysisRateLimit } = await import('../middleware/rateLimit.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(user?: { id: string; email: string; tier: string }): Partial<Request> {
  return { user } as any;
}

function makeRes(): { status: any; json: any; _status?: number; _body?: unknown } {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

const next: NextFunction = vi.fn();

afterEach(() => vi.clearAllMocks());

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('checkAnalysisRateLimit', () => {
  it('returns 401 when no user is attached', async () => {
    const res = makeRes();
    await checkAnalysisRateLimit(makeReq(undefined) as Request, res as Response, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('passes pro and enterprise through with no daily counter', async () => {
    for (const tier of ['pro', 'enterprise']) {
      const res = makeRes();
      await checkAnalysisRateLimit(makeReq({ id: 'u1', email: 'p@example.com', tier }) as Request, res as Response, next);
      expect(res.status).not.toHaveBeenCalled();
    }
    expect(next).toHaveBeenCalledTimes(2);
    expect(prismaUserMock.updateMany).not.toHaveBeenCalled();
  });

  it('allows a free user under the limit with one conditional increment (atomic)', async () => {
    prismaUserMock.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    const res = makeRes();
    await checkAnalysisRateLimit(makeReq({ id: 'u3', email: 'f@example.com', tier: 'free' }) as Request, res as Response, next);
    expect(next).toHaveBeenCalled();
    const [reset, inc] = prismaUserMock.updateMany.mock.calls.map((c: any[]) => c[0]);
    expect(reset.data).toMatchObject({ dailyAnalysisCount: 0 });
    expect(inc).toEqual({ where: { id: 'u3', dailyAnalysisCount: { lt: 2 } }, data: { dailyAnalysisCount: { increment: 1 } } });
  });

  it('returns 429 with an upgrade url when the conditional increment matches nothing', async () => {
    prismaUserMock.updateMany.mockResolvedValue({ count: 0 });
    prismaUserMock.findUnique.mockResolvedValue({ id: 'u4' });
    const res = makeRes();
    await checkAnalysisRateLimit(makeReq({ id: 'u4', email: 'f@example.com', tier: 'free' }) as Request, res as Response, next);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json.mock.calls[0][0]).toHaveProperty('upgradeUrl');
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when the user no longer exists', async () => {
    prismaUserMock.updateMany.mockResolvedValue({ count: 0 });
    prismaUserMock.findUnique.mockResolvedValue(null);
    const res = makeRes();
    await checkAnalysisRateLimit(makeReq({ id: 'ghost', email: 'g@example.com', tier: 'free' }) as Request, res as Response, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('fails CLOSED (503) when the counter cannot be written', async () => {
    prismaUserMock.updateMany.mockRejectedValue(new Error('db locked'));
    const res = makeRes();
    await checkAnalysisRateLimit(makeReq({ id: 'u6', email: 'f@example.com', tier: 'free' }) as Request, res as Response, next);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });

  it('applies the per-minute burst limit even to pro when limiting is on', async () => {
    const prev = process.env.RATE_LIMIT_DISABLED;
    process.env.RATE_LIMIT_DISABLED = 'false';
    try {
      const user = { id: 'burst-pro', email: 'p@example.com', tier: 'pro' };
      let passed = 0;
      let limited = 0;
      for (let i = 0; i < 14; i++) {
        const res: any = makeRes();
        res.setHeader = vi.fn();
        const n = vi.fn();
        await checkAnalysisRateLimit(makeReq(user) as Request, res as Response, n);
        if (n.mock.calls.length) passed++;
        if (res.status.mock.calls.some((c: any[]) => c[0] === 429)) limited++;
      }
      expect(passed).toBe(12);
      expect(limited).toBe(2);
    } finally {
      process.env.RATE_LIMIT_DISABLED = prev;
    }
  });
});
