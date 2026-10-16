// Weekly wins: one engine for "celebrate progress" in chat and the Sunday email.
// Every win is a number from the logs, and needs enough data to be true.

import { describe, it, expect, vi } from 'vitest';

vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) { this.user = {}; this.workoutLog = {}; this.mealEntry = {}; this.bodyWeightLog = {}; }) }));
vi.mock('../services/cacheService.js', () => ({ cacheDelete: vi.fn(), cacheClearByPrefix: vi.fn(), cacheGet: vi.fn(), cacheSet: vi.fn(), cacheMarkStale: vi.fn() }));

const { buildWeekReport } = await import('../services/weeklyWins.js');
const { weeklyWinsEmail } = await import('../services/emailTemplates.js');
const { isSendHour, recapText } = await import('../services/weeklyWinsJob.js');
const { winsNotice } = await import('../agent/notices.js');

const bench = (kg: number, reps = 5) => ({ name: 'Bench Press', sets: 3, reps: String(reps), weightKg: kg, setEntries: [{ weightKg: kg, reps, rpe: 8 }] });
const days = (start: string, n: number) => Array.from({ length: n }, (_, i) => { const d = new Date(`${start}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10); });

const base = {
  name: 'Tarek Assaf', unit: 'imperial' as const, goal: 'lose' as const, start: '2026-10-12', end: '2026-10-18',
  workouts: [{ date: '2026-10-01', exercises: [bench(80)] }, ...days('2026-10-12', 4).map((d) => ({ date: d, exercises: [bench(d === '2026-10-14' ? 85 : 80)] }))],
  meals: days('2026-10-12', 7).flatMap((d) => [{ date: d, calories: 950, proteinG: 100, nutrientsJson: JSON.stringify({ vitaminCMg: 60, zincMg: 6 }) }, { date: d, calories: 900, proteinG: 95, nutrientsJson: JSON.stringify({ vitaminCMg: 40, zincMg: 6 }) }]),
  weights: [...days('2026-10-05', 7).filter((_, i) => i % 2 === 0).map((d) => ({ date: d, kg: 98.5 })), ...days('2026-10-12', 7).filter((_, i) => i % 2 === 0).map((d) => ({ date: d, kg: 97.6 }))],
  firstWeight: { date: '2026-10-04', kg: 99.2 },
  targets: { calories: 1900, proteinG: 190, carbsG: null, fatG: null, fiberG: 27, source: 'quick' as const },
  proteinTargetG: 214,
  microTargets: [{ key: 'vitaminCMg', label: 'Vitamin C', unit: 'mg' as const, target: 90, direction: 'meet' as const, rationale: [] }, { key: 'zincMg', label: 'Zinc', unit: 'mg' as const, target: 11, direction: 'meet' as const, rationale: [] }],
  streak: 12,
};

describe('wins', () => {
  const r = buildWeekReport(base);
  it('celebrates weight moving toward the goal, by 7-day average and since day one', () => {
    expect(r.wins.find((w) => w.key.startsWith('weight-week'))?.title).toBe('Down 2 lbs this week');
    expect(r.wins.find((w) => w.key.startsWith('weight-total'))?.title).toBe('Down 3.5 lbs since you started');
  });
  it('celebrates a lift beating every earlier session', () => {
    const s = r.wins.find((w) => w.kind === 'strength')!;
    expect(s.title).toBe('New best on Bench Press');
    expect(s.detail).toMatch(/Estimated max 206 → 219 lbs \(\+6%\)/);
  });
  it('celebrates consistency in logging, calories, protein and micronutrients', () => {
    const titles = r.wins.map((w) => w.title);
    expect(titles).toEqual(expect.arrayContaining(['Logged food 7 of 7 days', 'On your calorie target 7 of 7 days', 'Hit protein 7 of 7 days', 'Met 2 micronutrient targets most days', '4 workouts this week']));
  });
  it('never calls weight gain a win on a fat-loss goal, and needs weigh-ins in both weeks', () => {
    const up = buildWeekReport({ ...base, weights: base.weights.map((w) => ({ ...w, kg: w.date >= '2026-10-12' ? 99.5 : 98.5 })) });
    expect(up.wins.some((w) => w.kind === 'weight')).toBe(false);
    const sparse = buildWeekReport({ ...base, weights: [{ date: '2026-10-13', kg: 97 }] });
    expect(sparse.body.changeKg).toBeNull();
  });
  it('points next week at what is missing', () => {
    const quiet = buildWeekReport({ ...base, weights: [{ date: '2026-10-11', kg: 97.2 }], meals: base.meals.map((m) => ({ ...m, proteinG: 70 })) });
    expect(quiet.focus[0]).toMatch(/Weigh in 3 mornings .* it's been 7 days/);
    expect(quiet.focus[1]).toMatch(/Protein: aim for 190 g on 5 days — you averaged 140 g, so you're on your way\. It’s what protects your muscle/);
  });
});

describe('the Sunday email', () => {
  it('leads with the best win, shows the numbers, focus and a weekly-only unsubscribe', () => {
    const msg = weeklyWinsEmail(buildWeekReport(base), { name: 'Tarek Assaf', unsubscribeUrl: 'https://api.example/email/unsubscribe?u=1&t=x&c=weekly', toKgDisplay: (kg) => kg * 2.20462 });
    expect(msg.subject).toBe('Tarek, down 2 lbs this week');
    expect(msg.html).toContain('Your wins this week');
    expect(msg.text).toMatch(/look at you go! You're down 2 lbs this week .* new best on Bench Press\. Be proud of this one\./);
    expect(msg.text).toContain('WHAT YOUR FOOD DID FOR YOU');
    expect(msg.text).toMatch(/Zinc \(Repair & immunity\) — 12 mg a day \(109% of your target\)/);
    expect(msg.html).toContain('not medical advice');
    expect(msg.html).toContain('Your next level-ups');
    expect(msg.html).toContain('c=weekly');
    expect(msg.text).toMatch(/Calories a day: 1850 of 1900/);
  });
  it('suggests the top-ups that matter most for the goal, with what they do', () => {
    const low = buildWeekReport({ ...base, microTargets: [...base.microTargets, { key: 'magnesiumMg', label: 'Magnesium', unit: 'mg' as const, target: 420, direction: 'meet' as const, rationale: [] }, { key: 'vitaminEMg', label: 'Vitamin E', unit: 'mg' as const, target: 15, direction: 'meet' as const, rationale: [] }],
      meals: base.meals.map((m) => ({ ...m, nutrientsJson: JSON.stringify({ ...JSON.parse(m.nutrientsJson), magnesiumMg: 70, vitaminEMg: 0.5 }) })) });
    const msg = weeklyWinsEmail(low, { name: 'Tarek', unsubscribeUrl: 'u', toKgDisplay: (kg) => kg * 2.2 });
    // Magnesium (sleep) outranks the even-lower vitamin E for a fat-loss goal.
    expect(msg.text).toMatch(/EASY TOP-UPS FOR NEXT WEEK\nMagnesium \(Sleep & recovery, about 33% of target\) — Magnesium helps muscles relax after training and supports deeper, more restful sleep\. Try pumpkin seeds/);
  });
  it('opens the Sunday chat recap warmly with the best win', () => {
    expect(recapText(buildWeekReport(base), 'Tarek')).toMatch(/^What a week, Tarek! Down 2 lbs this week — your 7-day average went from .* Plus \d+ more wins below\. .* Proud of you\.$/);
  });
  it('goes out at 6 pm on Sunday in the user’s own zone', () => {
    expect(isSendHour('America/Regina', new Date('2026-10-19T00:30:00Z'))).toBe(true); // Sun 18:30 in Regina
    expect(isSendHour('America/Toronto', new Date('2026-10-19T00:30:00Z'))).toBe(false); // 20:30 there
  });
});

describe('celebrating in chat', () => {
  it('notes only noticeable progress, warmly, and each win once', () => {
    const r = buildWeekReport(base);
    const n = winsNotice(r.wins, new Set())!;
    const keys = n.cards[0].rows?.map((row) => row.key) ?? [];
    expect(keys.some((k) => /Bench|workouts|Logged food/.test(k))).toBe(false); // PRs post at log time; routine counts wait for Sunday
    expect(keys[0]).toBe('Down 2 lbs this week');
    expect(n.text).toMatch(/^Look at this: down 2 lbs this week, and down 3\.5 lbs since you started.* You're doing the work and it's showing/);
    const one = winsNotice(r.wins.filter((w) => w.key.startsWith('weight-total')), new Set())!;
    expect(one.text).toMatch(/^Down 3\.5 lbs since you started! .* Proud of you\.$/);
    const all = new Set(r.wins.map((w) => w.key));
    expect(winsNotice(r.wins, all)).toBeNull();
  });
});
