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
    const req = makeReq(undefined);
    const res = makeRes();
    await checkAnalysisRateLimit(req as Request, res as Response, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('passes through immediately for pro tier users', async () => {
    const req = makeReq({ id: 'u1', email: 'pro@example.com', tier: 'pro' });
    const res = makeRes();
    await checkAnalysisRateLimit(req as Request, res as Response, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('passes through immediately for enterprise tier users', async () => {
    const req = makeReq({ id: 'u1', email: 'ent@example.com', tier: 'enterprise' });
    const res = makeRes();
    await checkAnalysisRateLimit(req as Request, res as Response, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('allows a free user who has not used any analyses today', async () => {
    prismaUserMock.findUnique.mockResolvedValue({
      id: 'u2',
      tier: 'free',
      dailyAnalysisCount: 0,
      dailyAnalysisDate: null,
    });
    prismaUserMock.update.mockResolvedValue({});

    const req = makeReq({ id: 'u2', email: 'free@example.com', tier: 'free' });
    const res = makeRes();
    await checkAnalysisRateLimit(req as Request, res as Response, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('allows a free user who is under the daily limit', async () => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);

    prismaUserMock.findUnique.mockResolvedValue({
      id: 'u3',
      tier: 'free',
      dailyAnalysisCount: 1, // 1 out of 2
      dailyAnalysisDate: today,
    });
    prismaUserMock.update.mockResolvedValue({});

    const req = makeReq({ id: 'u3', email: 'free@example.com', tier: 'free' });
    const res = makeRes();
    await checkAnalysisRateLimit(req as Request, res as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it('returns 429 when the free user has hit the daily limit', async () => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);

    prismaUserMock.findUnique.mockResolvedValue({
      id: 'u4',
      tier: 'free',
      dailyAnalysisCount: 2, // at limit
      dailyAnalysisDate: today,
    });

    const req = makeReq({ id: 'u4', email: 'free@example.com', tier: 'free' });
    const res = makeRes();
    await checkAnalysisRateLimit(req as Request, res as Response, next);
    expect(res.status).toHaveBeenCalledWith(429);
    const jsonCall = res.json.mock.calls[0][0];
    expect(jsonCall).toHaveProperty('upgradeUrl');
    expect(next).not.toHaveBeenCalled();
  });

  it('resets counter when it is a new day', async () => {
    // dailyAnalysisDate is yesterday
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(12, 0, 0, 0);

    prismaUserMock.findUnique.mockResolvedValue({
      id: 'u5',
      tier: 'free',
      dailyAnalysisCount: 2, // would be over limit, but it's a new day
      dailyAnalysisDate: yesterday,
    });
    prismaUserMock.update.mockResolvedValue({});

    const req = makeReq({ id: 'u5', email: 'free@example.com', tier: 'free' });
    const res = makeRes();
    await checkAnalysisRateLimit(req as Request, res as Response, next);
    // Should pass because the old count is from yesterday
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 401 when user not found in database', async () => {
    prismaUserMock.findUnique.mockResolvedValue(null);

    const req = makeReq({ id: 'ghost', email: 'ghost@example.com', tier: 'free' });
    const res = makeRes();
    await checkAnalysisRateLimit(req as Request, res as Response, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('increments the daily counter after a successful check', async () => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);

    prismaUserMock.findUnique.mockResolvedValue({
      id: 'u6',
      tier: 'free',
      dailyAnalysisCount: 0,
      dailyAnalysisDate: today,
    });
    prismaUserMock.update.mockResolvedValue({});

    const req = makeReq({ id: 'u6', email: 'free@example.com', tier: 'free' });
    const res = makeRes();
    await checkAnalysisRateLimit(req as Request, res as Response, next);

    expect(prismaUserMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u6' },
        data: expect.objectContaining({ dailyAnalysisCount: 1 }),
      })
    );
  });
});
