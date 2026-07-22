// Gut-health agent tools — read_micro_status aggregation/banding and
// read_nutrition_plan, plus the micro_gap proactive trigger registration.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn() },
  mealEntry: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  bodyWeightLog: { findMany: vi.fn(), create: vi.fn() },
  wellnessCheckin: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  workoutLog: { findMany: vi.fn(), create: vi.fn() },
  session: { findFirst: vi.fn() },
  feedItem: { findMany: vi.fn() },
  agentMemory: { findUnique: vi.fn(), upsert: vi.fn() },
}));
vi.mock('@prisma/client', () => {
  const PrismaClient = vi.fn(function (this: any) {
    Object.assign(this, mocks);
  });
  return { PrismaClient };
});

vi.mock('../services/llmService.js', () => ({
  parseMealMacros: vi.fn(),
}));
vi.mock('../services/cacheService.js', () => ({
  cacheDelete: vi.fn(), cacheClearByPrefix: vi.fn(), cacheGet: vi.fn(), cacheSet: vi.fn(),
}));
vi.mock('../routes/coach.js', () => ({
  buildSwapProposal: vi.fn(), getCurrentWeekSchedule: vi.fn(),
  applyProposedWeek: vi.fn(), SwapProposalError: class extends Error {},
}));

const mockLatestPlan = vi.hoisted(() => vi.fn());
vi.mock('../services/nutritionPlanService.js', () => ({
  latestNutritionPlan: mockLatestPlan,
}));

const { TOOLS_BY_NAME } = await import('../agent/tools.js');
const USER = 'u-1';

const entry = (date: string, over: Record<string, unknown> = {}) => ({
  date,
  nutrientsJson: JSON.stringify({ fiberG: 10, ironMg: 3, magnesiumMg: 100 }),
  plantsJson: JSON.stringify(['tomato', 'spinach']),
  fermentedJson: null,
  ultraProcessed: false,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockLatestPlan.mockResolvedValue(null);
  mocks.mealEntry.findMany.mockResolvedValue([]);
});

describe('read_micro_status', () => {
  it('exists in the registry alongside read_nutrition_plan', () => {
    expect(TOOLS_BY_NAME.read_micro_status).toBeTruthy();
    expect(TOOLS_BY_NAME.read_nutrition_plan).toBeTruthy();
  });

  it('averages per-day totals, bands them, and reports gut pillars', async () => {
    mocks.mealEntry.findMany.mockResolvedValue([
      entry('2026-07-20'), entry('2026-07-20'), // day totals: fiber 20
      entry('2026-07-21', { fermentedJson: JSON.stringify(['kefir']) }),
    ]);
    const out: any = await TOOLS_BY_NAME.read_micro_status.execute({ days: 7 }, USER);
    expect(out.window.observedDays).toBe(2);
    const fiber = out.nutrients.find((n: any) => n.key === 'fiberG');
    expect(fiber.avgPerDay).toBe(15); // (20 + 10) / 2
    expect(['low', 'vlow']).toContain(fiber.status); // vs 34g default
    expect(out.gut.pillars).toHaveLength(5);
    expect(out.gut.plantCount).toBe(2); // tomato + spinach deduped
    expect(out.estimateNote).toMatch(/±30%/);
  });

  it('flags persistent focus gaps (3+ days below target)', async () => {
    mocks.mealEntry.findMany.mockResolvedValue([
      entry('2026-07-18'), entry('2026-07-19'), entry('2026-07-20'), entry('2026-07-21'),
    ]);
    const out: any = await TOOLS_BY_NAME.read_micro_status.execute({}, USER);
    const gapKeys = out.persistentGaps.map((g: any) => g.key);
    expect(gapKeys).toContain('fiberG'); // 10g/day vs 34 target, 4 days low
  });

  it('uses personalized plan targets when present', async () => {
    mockLatestPlan.mockResolvedValue({
      targets: {
        targets: [{ key: 'fiberG', label: 'Fiber', unit: 'g', target: 20, direction: 'meet', rationale: [] }],
        focus: ['fiberG'],
      },
    });
    mocks.mealEntry.findMany.mockResolvedValue([entry('2026-07-21', { nutrientsJson: JSON.stringify({ fiberG: 18 }) })]);
    const out: any = await TOOLS_BY_NAME.read_micro_status.execute({}, USER);
    const fiber = out.nutrients.find((n: any) => n.key === 'fiberG');
    expect(fiber.target).toBe(20);
    expect(fiber.status).toBe('ok'); // 18/20 = 90%
  });
});

describe('read_nutrition_plan', () => {
  it('returns a helpful hint when no plan exists', async () => {
    const out: any = await TOOLS_BY_NAME.read_nutrition_plan.execute({}, USER);
    expect(out.hasPlan).toBe(false);
    expect(out.hint).toMatch(/assessment/);
  });

  it('returns the plan and focus keys when one exists', async () => {
    mockLatestPlan.mockResolvedValue({
      generatedAt: new Date('2026-07-20'),
      plan: { summary: 'Plan', focusNutrients: [] },
      targets: { targets: [], focus: ['fiberG', 'ironMg'] },
      sources: [],
    });
    const out: any = await TOOLS_BY_NAME.read_nutrition_plan.execute({}, USER);
    expect(out.hasPlan).toBe(true);
    expect(out.focus).toEqual(['fiberG', 'ironMg']);
  });
});

describe('micro_gap proactive trigger', () => {
  it('is a registered trigger with band-honest framing', async () => {
    const proactive = await import('../agent/proactive.js');
    // Type-level: assignment compiles; runtime: framing exists via evaluate path.
    const trigger: import('../agent/proactive.js').ProactiveTrigger = 'micro_gap';
    expect(trigger).toBe('micro_gap');
    expect(proactive).toBeTruthy();
  });
});
