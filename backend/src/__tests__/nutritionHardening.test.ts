// Oct 2026 audit — nutrition input/abuse rails: strict calendar dates, the
// ?days clamp, bounded nutrient maps, the atomic free meal-logging quota, the
// community barcode overwrite rule and meal-macro sanitising on model output.
import { describe, it, expect, vi } from 'vitest';

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(function (this: any) {}),
}));
vi.mock('../services/llmService.js', () => ({
  parseMealMacros: vi.fn(), analyzeMealPhoto: vi.fn(), suggestMeals: vi.fn(),
  transcribeAudio: vi.fn(), parseNutritionLabel: vi.fn(),
}));
vi.mock('../services/ragService.js', () => ({ buildRAGContext: vi.fn() }));
vi.mock('../services/chatClient.js', () => ({ chatComplete: vi.fn() }));

const shared = await import('../services/nutritionShared.js');
const { canOverwriteBarcode, safeMealMacros, mealEntrySchema } = await import('../routes/nutrition.js');

describe('isValidIsoDate', () => {
  it('accepts real dates', () => {
    expect(shared.isValidIsoDate('2026-10-16')).toBe(true);
    expect(shared.isValidIsoDate('2024-02-29')).toBe(true);
  });
  it('rejects impossible or malformed dates', () => {
    for (const d of ['2026-02-29', '2026-02-31', '2026-13-01', '2026-00-10', '26-10-16', '2026-1-1', '', null, 20261016, '0001-01-01']) {
      expect(shared.isValidIsoDate(d as any)).toBe(false);
    }
  });
  it('is enforced by the meal entry schema', () => {
    expect(mealEntrySchema.safeParse({ date: '2026-02-31', name: 'x' }).success).toBe(false);
    expect(mealEntrySchema.safeParse({ date: '2026-02-28', name: 'x' }).success).toBe(true);
  });
});

describe('clampDays', () => {
  it('clamps to 1..365 with a fallback for garbage', () => {
    expect(shared.clampDays('0')).toBe(1);
    expect(shared.clampDays('-5')).toBe(1);
    expect(shared.clampDays('9999')).toBe(365);
    expect(shared.clampDays('abc', 30)).toBe(30);
    expect(shared.clampDays(undefined, 7)).toBe(7);
    expect(shared.clampDays('14')).toBe(14);
  });
});

describe('boundNutrientMap', () => {
  it('keeps at most 60 finite, non-negative numeric entries with sane keys', () => {
    const big: Record<string, unknown> = {};
    for (let i = 0; i < 500; i++) big[`n${i}`] = i;
    big['bad key!'] = 3;
    big.neg = -1;
    big.inf = Infinity;
    const out = shared.boundNutrientMap(big)!;
    expect(Object.keys(out)).toHaveLength(shared.MAX_NUTRIENT_KEYS);
    expect(out['bad key!']).toBeUndefined();
  });
  it('trims (never rejects) an oversized nutrientMap on a meal', () => {
    const nutrientMap: Record<string, number> = {};
    for (let i = 0; i < 200; i++) nutrientMap[`k${i}`] = 1;
    const r = mealEntrySchema.safeParse({ date: '2026-10-01', name: 'x', nutrientMap });
    expect(r.success).toBe(true);
    expect(Object.keys((r as any).data.nutrientMap)).toHaveLength(60);
  });
});

describe('consumeMealLoggingQuota (atomic)', () => {
  const res = () => {
    const r: any = { statusCode: 200, body: null };
    r.status = (c: number) => { r.statusCode = c; return r; };
    r.json = (b: any) => { r.body = b; return r; };
    return r;
  };

  it('pro is unmetered and never touches the DB', async () => {
    const prisma: any = { user: { updateMany: vi.fn(), findUnique: vi.fn() } };
    expect(await shared.consumeMealLoggingQuota(prisma, 'u', 'pro', res())).toBe(true);
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('first call of the day resets to 1 in one conditional update', async () => {
    const prisma: any = { user: { updateMany: vi.fn().mockResolvedValueOnce({ count: 1 }), findUnique: vi.fn() } };
    expect(await shared.consumeMealLoggingQuota(prisma, 'u', 'free', res())).toBe(true);
    expect(prisma.user.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.user.updateMany.mock.calls[0][0].data.dailyPhotoScanCount).toBe(1);
  });

  it('same day increments only while under the cap (the DB picks the winner)', async () => {
    const prisma: any = { user: { updateMany: vi.fn().mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 }), findUnique: vi.fn() } };
    expect(await shared.consumeMealLoggingQuota(prisma, 'u', 'free', res())).toBe(true);
    const second = prisma.user.updateMany.mock.calls[1][0];
    expect(second.where.dailyPhotoScanCount).toEqual({ lt: shared.FREE_DAILY_PHOTO_LIMIT });
    expect(second.data.dailyPhotoScanCount).toEqual({ increment: 1 });
  });

  it('429s at the cap', async () => {
    const prisma: any = { user: { updateMany: vi.fn().mockResolvedValue({ count: 0 }), findUnique: vi.fn().mockResolvedValue({ id: 'u' }) } };
    const r = res();
    expect(await shared.consumeMealLoggingQuota(prisma, 'u', 'free', r)).toBe(false);
    expect(r.statusCode).toBe(429);
  });

  it('concurrent callers at count 6 → exactly one gets the last slot', async () => {
    let count = 6;
    const today = new Date().toISOString().slice(0, 10);
    const prisma: any = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: 'u' }),
        updateMany: vi.fn(async ({ where, data }: any) => {
          if (where.OR) return { count: 0 }; // already today's row
          if (where.dailyPhotoScanDate === today && count < where.dailyPhotoScanCount.lt) {
            count += data.dailyPhotoScanCount.increment;
            return { count: 1 };
          }
          return { count: 0 };
        }),
      },
    };
    const results = await Promise.all(Array.from({ length: 5 }, () => shared.consumeMealLoggingQuota(prisma, 'u', 'free', res())));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(count).toBe(7);
  });
});

describe('canOverwriteBarcode', () => {
  it('a verified row is never overwritten', () => {
    expect(canOverwriteBarcode({ verified: true, contributedByUserId: 'u1', source: 'user_label_scan' }, 'u1')).toBe(false);
  });
  it('only the contributor may replace an unverified label row', () => {
    const row = { verified: false, contributedByUserId: 'u1', source: 'user_label_scan' };
    expect(canOverwriteBarcode(row, 'u1')).toBe(true);
    expect(canOverwriteBarcode(row, 'u2')).toBe(false);
    expect(canOverwriteBarcode({ ...row, contributedByUserId: null }, 'u2')).toBe(false);
  });
  it('an unconfirmed web-search guess may be replaced by a real label read', () => {
    expect(canOverwriteBarcode({ verified: false, contributedByUserId: 'u1', source: 'web_search' }, 'u2')).toBe(true);
  });
  it('a new code is always writable', () => {
    expect(canOverwriteBarcode(null, 'u2')).toBe(true);
  });
});

describe('safeMealMacros', () => {
  it('clamps model numbers to 5000 and reconciles calories with 4/4/9', () => {
    const out: any = safeMealMacros({ name: 'x', calories: 90000, proteinG: 30, carbsG: 50, fatG: 10 });
    expect(out.calories).toBeLessThanOrEqual(5000);
    expect(out.calories).toBe(410); // 4×30 + 4×50 + 9×10
    expect(out.macrosAdjusted).toBe(true);
    expect(out.name).toBe('x');
  });
  it('leaves a consistent meal alone and passes no-food results through', () => {
    const ok: any = safeMealMacros({ calories: 410, proteinG: 30, carbsG: 50, fatG: 10 });
    expect(ok.macrosAdjusted).toBeUndefined();
    const none = { noFoodDetected: true, calories: 0 };
    expect(safeMealMacros(none)).toBe(none);
  });
});
