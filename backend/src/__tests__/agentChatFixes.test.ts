// Fixes from the founder's chat, 12–14 Oct 2026: Anakin got the day wrong
// ("yesterday, Oct 11" on Oct 13), said "Camera's open" without opening it,
// and answered "what micronutrients did it hit?" with names but no amounts.

import { describe, it, expect, vi } from 'vitest';

const meals = [
  { id: 'm1', name: 'Eggs, OJ and half a burrito', mealType: 'breakfast', calories: 600, proteinG: 41, carbsG: 46, fatG: 28, createdAt: new Date(), servings: 1, nutrientsJson: JSON.stringify({ vitaminCMg: 125, zincMg: 3.1, fiberG: 4 }) },
  { id: 'm2', name: 'Pork chop dinner', mealType: 'dinner', calories: 509, proteinG: 35, carbsG: 32, fatG: 27, createdAt: new Date(), servings: 1, nutrientsJson: JSON.stringify({ vitaminCMg: 20.4, zincMg: 4 }) },
];
vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(function (this: any) {
    this.user = { findUnique: async () => ({ timezone: 'America/Toronto', savedProgram: null, subtractWorkoutBurnFromCalories: false, unitPreference: 'imperial' }) };
    this.mealEntry = { findMany: async () => meals };
    this.workoutLog = { findMany: async () => [] };
  }),
}));
vi.mock('../services/nutritionPlanService.js', () => ({ latestNutritionPlan: vi.fn(async () => null) }));
vi.mock('../services/cacheService.js', () => ({ cacheDelete: vi.fn(), cacheClearByPrefix: vi.fn(), cacheGet: vi.fn(), cacheSet: vi.fn(), cacheMarkStale: vi.fn() }));

const { claimsCaptureWithoutTool } = await import('../agent/actionClaims.js');
const { localNow, renderContext } = await import('../agent/context.js');
const { absoluteInjuryDates, readInjuries } = await import('../agent/profile/coachProfile.js');

describe('claims of an action no tool did', () => {
  it('catches "camera\'s open" with no capture tool', () => {
    expect(claimsCaptureWithoutTool('Camera’s open — snap the pic and I’ll log it from there.', [])).toBe(true);
    expect(claimsCaptureWithoutTool('The scanner is ready.', ['read_nutrition_today'])).toBe(true);
    expect(claimsCaptureWithoutTool('Take a photo of the plate and send it through.', [])).toBe(true);
  });
  it('is satisfied when the camera was actually opened', () => {
    expect(claimsCaptureWithoutTool('Camera’s open — snap your plate.', ['open_food_capture'])).toBe(false);
  });
  it('leaves ordinary food talk alone', () => {
    expect(claimsCaptureWithoutTool('Logged — 4 eggs, OJ and half the burrito, about 600 cal.', ['log_meal'])).toBe(false);
    expect(claimsCaptureWithoutTool('Open your plate up with more vegetables tomorrow.', [])).toBe(false);
  });
});

describe('the user\'s own date', () => {
  it('is their local day, with yesterday, even when UTC has rolled over', () => {
    // 02:57 UTC on 14 Oct = 22:57 on 13 Oct in Toronto.
    const n = localNow('America/Toronto', new Date('2026-10-14T02:57:00Z'));
    expect(n.date).toBe('2026-10-13');
    expect(n.yesterday).toBe('2026-10-12');
    expect(n.label).toMatch(/Tuesday, October 13, 2026.*10:57/);
  });
  it('falls back to a valid zone for junk', () => {
    expect(localNow('Not/AZone', new Date('2026-10-13T12:00:00Z')).tz).toBe('America/New_York');
  });
  it('is stated to the model', () => {
    const out = renderContext({ userId: 'u1', now: { date: '2026-10-13', yesterday: '2026-10-12', label: 'Tuesday, October 13, 2026 at 5:34 AM', tz: 'America/Toronto' }, profile: { name: 'A', tier: 'pro', unitPreference: 'imperial' }, todayNutrition: null, bodyWeight: null, lastWellness: null, memory: [] } as any);
    expect(out).toContain('Today = 2026-10-13; yesterday = 2026-10-12');
  });
});

describe('read_nutrition_today carries micronutrients', () => {
  it('per meal and for the day, against the targets', async () => {
    await import('../agent/toolkits/index.js');
    const { AGENT_TOOLS } = await import('../agent/registry.js');
    const t = AGENT_TOOLS.find((x) => x.name === 'read_nutrition_today')!;
    const r: any = await t.execute({ date: '2026-10-13' }, 'u1');
    expect(r.meals[0].micros.vitaminCMg).toBe(125);
    const c = r.micros.find((m: any) => /vitamin c/i.test(m.nutrient));
    expect(c.amount).toBeCloseTo(145.4, 1);
    expect(c.pctOfTarget).toBeGreaterThan(100);
    expect(r.microsNote).toMatch(/about/);
  });
  it('the camera tool is always loaded', async () => {
    const { AGENT_TOOLS } = await import('../agent/registry.js');
    expect(AGENT_TOOLS.find((x) => x.name === 'open_food_capture')?.core).toBe(true);
  });
});

describe('injury notes keep their dates', () => {
  it('turns "today" into the day it was written, and drops a "No" answer', () => {
    const out = absoluteInjuryDates([
      { area: 'No' },
      { area: 'Achilles tendon', note: 'Underwent surgical repair today. Swelling since yesterday.', since: 'today', severity: 'severe' },
      { area: 'Left shoulder', since: '2 weeks' },
    ], '2026-10-11');
    expect(out).toHaveLength(2);
    expect(out[0].note).toBe('Underwent surgical repair on Sun 11 Oct. Swelling since on Sat 10 Oct.');
    expect(out[0].since).toBe('2026-10-11');
    expect(out[1].since).toBe('2 weeks');
  });
  it('reading the old free-text field skips "No"', () => {
    expect(readInjuries({ injuries: 'No; Achilles tendon (rupture)' }, null).map((i) => i.area)).toEqual(['Achilles tendon (rupture)']);
  });
});
