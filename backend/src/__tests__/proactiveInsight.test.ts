// D3 · training × nutrition: the approved pair, its gate, and its limits.
import { describe, it, expect, vi } from 'vitest';

vi.mock('@prisma/client', async () => ({ PrismaClient: (await import('./helpers/memPrisma.js')).PrismaClient }));
vi.mock('../services/cacheService.js', () => ({ cacheDelete: vi.fn(), cacheClearByPrefix: vi.fn(), cacheGet: vi.fn(), cacheSet: vi.fn(), cacheMarkStale: vi.fn() }));

const I = await import('../proactive/insight.js');

const day = (d: number, reps: number, carbs: number | null) => ({ date: `2026-10-${String(d).padStart(2, '0')}`, reps, carbsPrevDay: carbs });
const eight = [day(2, 25, 280), day(5, 23, 120), day(8, 25, 300), day(11, 24, 260), day(14, 22, 100), day(17, 25, 290), day(20, 23, 140), day(23, 25, 310)];

describe('carbsRepsInsight', () => {
  it('fires on ≥ 8 days with ≥ 3 low and ≥ 3 other days and a gap bigger than the normal spread', () => {
    const r = I.carbsRepsInsight('Back Squat', eight, { carbTargetG: 250 })!;
    expect(r).toMatchObject({ lowDays: 3, otherDays: 5, lowAvgReps: 22.7, otherAvgReps: 24.8, gap: -2.1 });
    expect(r.headline).toBe('Your back squat reps dropped after each of the 3 days you ate under 150 g of carbs.');
    expect(r.caption).toBe('8 back squat days is a small sample — this fits, it doesn\'t prove it.');
    expect(r.bars.filter((b) => b.low)).toHaveLength(3);
    expect(r.proposal.carbsG).toBe(300);
  });
  it('is silent with too few days, too few of either kind, or a gap inside the spread', () => {
    expect(I.carbsRepsInsight('Back Squat', eight.slice(0, 7))).toBeNull();
    expect(I.carbsRepsInsight('Back Squat', [...eight.slice(0, 6), day(26, 25, 300), day(29, 25, 300)])).toBeNull(); // only 2 low days
    expect(I.carbsRepsInsight('Back Squat', eight.map((d) => ({ ...d, reps: d.carbsPrevDay! < 150 ? 24 : 25 })))).toBeNull(); // 1-rep gap, spread floor 1
  });
  it('is silent during an active weight cut', () => {
    expect(I.carbsRepsInsight('Back Squat', eight, { cutting: true })).toBeNull();
  });
  it('days without a logged day before don\'t count', () => {
    expect(I.carbsRepsInsight('Back Squat', [...eight.slice(0, 7), day(23, 25, null)])).toBeNull();
  });
});

describe('liftDays and the approved list', () => {
  const workouts = [
    { date: '2026-10-02', exercises: [{ name: 'Back Squat', sets: 5, reps: '5', setEntries: [{ reps: 5 }, { reps: 5 }, { reps: 5 }, { reps: 5 }, { reps: 5 }] }, { name: 'Curl', sets: 3, reps: '12' }] },
    { date: '2026-10-05', exercises: [{ name: 'Back Squat', sets: 5, reps: '5', setEntries: [{ reps: 5 }, { reps: 5 }, { reps: 5 }, { reps: 4 }, { reps: 4 }] }] },
  ];
  const carbs = new Map([['2026-10-01', 280], ['2026-10-04', 120]]);
  it('sums the lift\'s working reps per day and reads the carbs from the day before', () => {
    expect(I.liftDays(I.APPROVED_PAIRS[0].lifts, workouts, carbs)).toEqual({ lift: 'Back Squat', days: [{ date: '2026-10-02', reps: 25, carbsPrevDay: 280 }, { date: '2026-10-05', reps: 23, carbsPrevDay: 120 }] });
  });
  it('only approved lifts are tested — a curl is never scanned', () => {
    expect(I.liftDays(/curl/i, workouts, carbs)?.lift).toBe('Curl');
    expect(I.APPROVED_PAIRS).toHaveLength(1);
    expect(I.APPROVED_PAIRS[0].lifts.test('Curl')).toBe(false);
  });
  it('the one-day carb override reads only for its date', () => {
    const blob = JSON.stringify({ carbDay: { date: '2026-10-30', carbsG: 300 } });
    expect(I.carbDayOverride(blob, '2026-10-30')).toBe(300);
    expect(I.carbDayOverride(blob, '2026-10-31')).toBeNull();
    expect(I.carbDayOverride(null, '2026-10-30')).toBeNull();
  });
});
