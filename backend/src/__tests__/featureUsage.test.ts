/**
 * Unit tests for the generic per-day feature-quota service.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

// Pin limits so the assertions don't depend on ambient env.
process.env.FREE_FORM_VIDEO_DAILY_LIMIT = '1';
process.env.FREE_MEAL_DAILY_LIMIT = '1';

const featureUsageMock = {
  findUnique: vi.fn(),
  upsert: vi.fn(),
};

vi.mock('@prisma/client', () => {
  const PrismaClient = vi.fn(function (this: any) {
    this.featureUsage = featureUsageMock;
  });
  return { PrismaClient };
});

const { consumeDailyQuota, peekDailyQuota, dailyLimitFor, todayKey, FEATURE } =
  await import('../services/featureUsageService.js');

afterEach(() => vi.clearAllMocks());

describe('dailyLimitFor', () => {
  it('reads env overrides and defaults to 1', () => {
    expect(dailyLimitFor(FEATURE.FORM_VIDEO)).toBe(1);
    expect(dailyLimitFor(FEATURE.MEAL_PHOTO)).toBe(1);
  });
});

describe('todayKey', () => {
  it('formats a fixed date as the UTC calendar day', () => {
    expect(todayKey(new Date('2026-06-03T23:30:00Z'))).toBe('2026-06-03');
  });
});

describe('consumeDailyQuota', () => {
  it('is unlimited for pro users without touching the table', async () => {
    const q = await consumeDailyQuota('u1', 'pro', FEATURE.FORM_VIDEO);
    expect(q.allowed).toBe(true);
    expect(q.limit).toBeNull();
    expect(q.remaining).toBeNull();
    expect(featureUsageMock.upsert).not.toHaveBeenCalled();
  });

  it('is unlimited for enterprise users', async () => {
    const q = await consumeDailyQuota('u1', 'enterprise', FEATURE.FORM_VIDEO);
    expect(q.allowed).toBe(true);
    expect(featureUsageMock.upsert).not.toHaveBeenCalled();
  });

  it("allows a free user's first call of the day and increments", async () => {
    featureUsageMock.upsert.mockResolvedValue({ count: 1 });
    const q = await consumeDailyQuota('u2', 'free', FEATURE.FORM_VIDEO);
    expect(q.allowed).toBe(true);
    expect(q.used).toBe(1);
    expect(q.remaining).toBe(0);
    expect(featureUsageMock.upsert).toHaveBeenCalledOnce();
  });

  it('rejects the call that pushes a free user over the limit', async () => {
    // Post-increment count of 2 against a limit of 1 → over.
    featureUsageMock.upsert.mockResolvedValue({ count: 2 });
    const q = await consumeDailyQuota('u3', 'free', FEATURE.FORM_VIDEO);
    expect(q.allowed).toBe(false);
    expect(q.used).toBe(1); // clamped to the limit
    expect(q.remaining).toBe(0);
  });
});

describe('peekDailyQuota', () => {
  it('does not mutate and reports remaining for a free user', async () => {
    featureUsageMock.findUnique.mockResolvedValue({ count: 0 });
    const q = await peekDailyQuota('u4', 'free', FEATURE.MEAL_PHOTO);
    expect(q.allowed).toBe(true);
    expect(q.used).toBe(0);
    expect(q.remaining).toBe(1);
    expect(featureUsageMock.upsert).not.toHaveBeenCalled();
  });

  it('treats a missing row as zero usage', async () => {
    featureUsageMock.findUnique.mockResolvedValue(null);
    const q = await peekDailyQuota('u5', 'free', FEATURE.FORM_VIDEO);
    expect(q.used).toBe(0);
    expect(q.allowed).toBe(true);
  });

  it('reports unlimited for pro', async () => {
    const q = await peekDailyQuota('u6', 'pro', FEATURE.FORM_VIDEO);
    expect(q.limit).toBeNull();
    expect(q.remaining).toBeNull();
  });
});
