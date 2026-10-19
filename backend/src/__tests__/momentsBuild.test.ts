import { describe, it, expect } from 'vitest';
import { buildWorkoutMoment, buildNutritionMoment, buildCutMoment, topSet, inUnit, mondayOf, type HistoryLog, type WorkoutInput } from '../services/moments/build.js';

const keyFn = (n: string) => n.trim().toLowerCase().replace(/^barbell /, '');
const lbKg = (lb: number) => lb / 2.20462;
const bench = (lb: number, reps: number, sets = 3) => ({ name: 'Bench press', sets, reps: String(reps), weightKg: lbKg(lb) });
const day = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

/** Weekly bench history climbing 4 lb a week from 160×5 (best 196×5, e1RM ≈ 229 — below the PR). */
function history(weeks: number, until = '2026-10-12'): HistoryLog[] {
  return Array.from({ length: weeks }, (_, i) => ({ id: `h${i}`, date: day(until, -7 * (weeks - 1 - i)), exercises: [bench(160 + 4 * i, 5)] }));
}

const base = (over: Partial<WorkoutInput> = {}): WorkoutInput => ({
  log: { id: 'L', date: '2026-10-19', title: 'Push', duration: 55, exercises: [bench(225, 3), { name: 'Overhead press', sets: 3, reps: '8', weightKg: lbKg(115) }, { name: 'Dips', sets: 3, reps: '12', bodyweight: true }] },
  history: history(10), keyFn, unit: 'lb', bodyweightKg: lbKg(180), prs: [], today: '2026-10-19', ...over,
});

describe('buildWorkoutMoment', () => {
  it('a PR builds the climb (3a, 3e), the session (3g) and the line (2f), in their numbers', () => {
    const m = buildWorkoutMoment(base({ prs: [{ key: 'bench press', displayName: 'Bench press', e1RMLbs: 247, prevLbs: 240, deltaLbs: 7 }] }));
    expect(m.type).toBe('pr');
    expect(m.label).toBe('New PR · Bench press');
    expect(m.title).toBe('225 × 3. A new best.');
    expect(m.shareables.map((s) => s.kind)).toEqual(['3a', '3e', '3g', '2f']);
    const climb = m.shareables[0].data as any;
    expect(climb.repMax).toBe('225×3');
    expect(climb.series[climb.series.length - 1]).toEqual({ date: '2026-10-19', e1rm: 248 });
    expect(climb.stats.bw).toBeCloseTo(1.4, 1);
    expect(climb.goal.value).toBe(250); // next 25 lb milestone
    expect(climb.stats.weeks).toBeGreaterThanOrEqual(9);
    expect(m.praise).toMatch(/strongest you've ever been on bench press/);
    expect(m.praise).toMatch(/248 lb/);
    expect(m.praise).not.toMatch(/!/);
    expect(m.why.join(' ')).toMatch(/Best set: 225 × 3/);
  });

  it('delta compares to the heaviest weight already done for at least those reps', () => {
    const hist = [...history(3), { id: 'x', date: '2026-10-14', exercises: [bench(215, 3)] }];
    const m = buildWorkoutMoment(base({ history: hist, prs: [{ key: 'bench press', displayName: 'Bench press', e1RMLbs: 247, prevLbs: 240, deltaLbs: 7 }] }));
    expect((m.shareables[0].data as any).delta).toBe(10);
  });

  it('a plain session gets 3g with volume shares, the week count and warm copy', () => {
    const m = buildWorkoutMoment(base({ history: [...history(10), { id: 'y', date: '2026-10-17', exercises: [bench(200, 5)] }] }));
    expect(m.type).toBe('session');
    expect(m.title).toBe('Push, logged.');
    expect(m.label).toBe('Session · Today');
    const s = m.shareables[0];
    expect(s.kind).toBe('3g');
    const data = s.data as any;
    expect(data.volume).toBe(225 * 9 + 115 * 24);
    expect(data.lifts[0].name).toBe('Overhead press'); // biggest share first
    expect(data.lifts.find((l: any) => l.name === 'Dips').top).toBe('12 reps');
    expect(m.praise).toMatch(/Second training day this week|training days out of the last seven/);
    expect(m.praise).toMatch(/in 55 minutes/);
  });

  it('a climbing main lift adds the 2f line to a plain session', () => {
    const m = buildWorkoutMoment(base({ log: { id: 'L', date: '2026-10-19', title: null, duration: null, exercises: [bench(230, 5)] } }));
    expect(m.shareables.map((s) => s.kind)).toEqual(['3g', '3a', '3e', '2f']);
    const climb = m.shareables[1].data as any;
    expect(climb.badge).toBe('Top set');
    expect(climb.repMax).toBe('230×5');
    expect(climb.series[climb.series.length - 1].date).toBe('2026-10-19');
    expect(m.title).toBe('Workout, logged.');
  });

  it('a backdated log is still a moment, and says which day it was for', () => {
    const m = buildWorkoutMoment(base({ log: { ...base().log, date: '2026-10-13' }, history: [] }));
    expect(m.label).toBe('Session · Tue 13 Oct');
    expect(m.praise).toMatch(/^Logged for Tue 13 Oct/);
  });

  it('a backfill batch mentions the other sessions', () => {
    const m = buildWorkoutMoment(base({ batch: 6 }));
    expect(m.praise).toMatch(/5 more sessions filled in alongside it/);
  });

  it('a bodyweight-only session counts reps, not pounds', () => {
    const m = buildWorkoutMoment(base({ log: { id: 'L', date: '2026-10-19', title: 'Calisthenics', duration: null, exercises: [{ name: 'Pull-ups', sets: 4, reps: '8', bodyweight: true }, { name: 'Push-ups', sets: 3, reps: '20', bodyweight: true }] }, history: [] }));
    const d = m.shareables[0].data as any;
    expect(d.volume).toBe(92);
    expect(d.volumeUnit).toBe('reps');
    expect(m.praise).toMatch(/92 reps across 2 lifts/);
    expect(m.praise).toMatch(/first one logged/);
  });

  it('kg users get kilos', () => {
    const m = buildWorkoutMoment(base({ unit: 'kg', prs: [{ key: 'bench press', displayName: 'Bench press', e1RMLbs: 247, prevLbs: 240, deltaLbs: 7 }] }));
    expect(m.title).toBe('102 × 3. A new best.');
    expect(m.praise).toMatch(/112.5 kg/);
    expect((m.shareables[0].data as any).goal.value).toBe(120);
  });

  it('PR outranks a session for the day', () => {
    const pr = buildWorkoutMoment(base({ prs: [{ key: 'bench press', displayName: 'Bench press', e1RMLbs: 247, prevLbs: 240, deltaLbs: 7 }] }));
    const plain = buildWorkoutMoment(base());
    expect(pr.score).toBeGreaterThan(plain.score);
  });
});

describe('the climb is best-to-date', () => {
  it('a light day never dips the PR line', async () => {
    const hist = [...history(4), { id: 'light', date: '2026-10-15', exercises: [bench(135, 10)] }];
    const m = buildWorkoutMoment(base({ history: hist, prs: [{ key: 'bench press', displayName: 'Bench press', e1RMLbs: 247, prevLbs: 240, deltaLbs: 7 }] }));
    const s = (m.shareables[0].data as any).series.map((p: any) => p.e1rm);
    expect(s).toEqual([...s].sort((a: number, b: number) => a - b));
  });
});

describe('a session that is not a PR still offers every workout card', () => {
  it("today's number closes the line even when it's below the old best", () => {
    const hist = [...history(6), { id: 'big', date: '2026-08-02', exercises: [bench(260, 2)] }];
    const m = buildWorkoutMoment(base({ history: hist, log: { id: 'L', date: '2026-10-19', title: 'Back day', duration: null, exercises: [{ name: 'T-bar row', sets: 3, reps: 'varies', weightKg: lbKg(135) }, bench(225, 5)] } }));
    expect(m.type).toBe('session');
    expect(m.shareables.map((s) => s.kind)).toEqual(['3g', '3a', '3e', '2f']);
    const c = m.shareables[1].data as any;
    expect(c.series[c.series.length - 1].e1rm).toBe(263); // 225×5 today, not the 260×2 best
    expect(c.series[0].e1rm).toBeLessThan(263); // the line starts at the low point: a climb
    expect(c.stats.gained).toBeGreaterThan(0);
    const row = (m.shareables[0].data as any).lifts.find((l: any) => l.name === 'T-bar row');
    expect(row.top).toBe('135 · 3 sets');
  });
});

describe('no lift climbed today', () => {
  it('still offers every card, as the best-ever line — never a decline', () => {
    const m = buildWorkoutMoment(base({ log: { id: 'L', date: '2026-10-19', title: 'Light', duration: null, exercises: [bench(135, 5)] } }));
    expect(m.shareables.map((s) => s.kind)).toEqual(['3g', '3a', '3e', '2f']);
    const c = m.shareables[1].data as any;
    expect(c.chartLabel).toBe('Best est. max');
    const v = c.series.map((p: any) => p.e1rm);
    expect(v).toEqual([...v].sort((a: number, b: number) => a - b));
    expect((m.shareables[3].data as any).label).toBe('Best est. max');
  });
  it('tries the next lift when the heaviest one dipped', () => {
    const hist = [...history(6), { id: 'r1', date: '2026-09-01', exercises: [{ name: 'Curl', sets: 3, reps: '8', weightKg: lbKg(50) }] }];
    const m = buildWorkoutMoment(base({ history: hist, log: { id: 'L', date: '2026-10-19', title: 'Arms', duration: null, exercises: [bench(135, 5), { name: 'Curl', sets: 3, reps: '8', weightKg: lbKg(60) }] } }));
    const c = m.shareables[1].data as any;
    expect(c.lift).toBe('Curl');
    expect(c.chartLabel).toBeUndefined();
  });
  it('a first-ever lift with no history: the session card alone', () => {
    const m = buildWorkoutMoment(base({ history: [], log: { id: 'L', date: '2026-10-19', title: 'New', duration: null, exercises: [{ name: 'Curl', sets: 3, reps: '8', weightKg: lbKg(60) }] } }));
    expect(m.shareables.map((s) => s.kind)).toEqual(['3g']);
  });
});

describe('helpers', () => {
  it('topSet picks the best estimated max and rounds units', () => {
    expect(topSet({ name: 'x', setEntries: [{ weightKg: 100, reps: 3 }, { weightKg: 90, reps: 8 }] })).toEqual({ kg: 90, reps: 8 });
    expect(inUnit(102.06, 'lb')).toBe(225);
    expect(inUnit(102.3, 'kg')).toBe(102.5);
    expect(mondayOf('2026-10-19')).toBe('2026-10-19');
    expect(mondayOf('2026-10-25')).toBe('2026-10-19');
  });
});

describe('buildNutritionMoment', () => {
  const meals = [
    { name: 'Eggs', mealType: 'breakfast', proteinG: 40, carbsG: 30, fatG: 20, calories: 500 },
    { name: 'Chicken bowl', mealType: 'lunch', proteinG: 60, carbsG: 80, fatG: 15, calories: 700 },
    { name: 'Shake', mealType: 'snack', proteinG: 30, carbsG: 10, fatG: 3, calories: 180 },
    { name: 'Salmon', mealType: 'dinner', proteinG: 52, carbsG: 60, fatG: 25, calories: 750 },
  ];
  const targets = { calories: 2400, proteinG: 180, carbsG: 250, fatG: 80 };

  it('only when protein reaches the target', () => {
    expect(buildNutritionMoment({ date: '2026-10-21', meals: meals.slice(0, 3), targets, weekProtein: {} })).toBeNull();
    expect(buildNutritionMoment({ date: '2026-10-21', meals, targets: { ...targets, proteinG: 0 }, weekProtein: {} })).toBeNull();
  });

  it('builds 3b + 3f with meals by slot and the week', () => {
    const m = buildNutritionMoment({ date: '2026-10-21', meals, targets, weekProtein: { '2026-10-19': 190, '2026-10-20': 120 } })!;
    expect(m.title).toBe('182 g of protein. Goal hit.');
    expect(m.shareables.map((s) => s.kind)).toEqual(['3b', '3f']);
    const d = m.shareables[0].data as any;
    expect(d.protein.meals.map((x: any) => x.name)).toEqual(['Breakfast', 'Lunch', 'Snack', 'Dinner']);
    expect(d.week).toEqual([true, false, true, false, false, false, false]);
    expect(d.todayIndex).toBe(2);
    expect(m.praise).toMatch(/second day on target this week/);
    expect(m.why).toContain('2 of 3 days on target so far this week.');
    expect(m.why).toContain('Biggest contributor: Lunch (60 g).');
  });
});

describe('buildCutMoment', () => {
  const weighIns = (weeks: number, startKg = 90, perWeekKg = 0.5) =>
    Array.from({ length: weeks * 7 }, (_, i) => ({ date: day('2026-08-10', i), kg: startKg - (perWeekKg * i) / 7 + (i % 3 === 0 ? 0.2 : 0) }));

  it('needs four weeks and a real drop', () => {
    expect(buildCutMoment({ unit: 'lb', weighIns: weighIns(3), lifts: [], today: '2026-10-19' })).toBeNull();
    expect(buildCutMoment({ unit: 'lb', weighIns: weighIns(8, 90, 0), lifts: [], today: '2026-10-19' })).toBeNull();
  });

  it('builds 3d from deltas only — never an absolute weight', () => {
    const m = buildCutMoment({ unit: 'lb', weighIns: weighIns(10), lifts: [{ name: 'Squat', start: 285, now: 295 }, { name: 'Bench press', start: 225, now: 225 }], today: '2026-10-19' })!;
    expect(m.type).toBe('cut');
    const d = m.shareables[0].data as any;
    expect(d.weeks).toBe(10);
    expect(d.series[0]).toEqual({ week: 1, delta: 0 });
    expect(d.change).toBeLessThan(-7);
    expect(d.safe.min).toBeGreaterThan(0.8);
    const text = [m.title, m.praise, ...m.why, JSON.stringify(d)].join(' ');
    expect(text).not.toMatch(/\b19\d(\.\d)?\b/); // ~198 lb start never appears
    expect(m.praise).toMatch(/fat, not muscle/);
  });

  it("doesn't claim fat-not-muscle when a lift dropped", () => {
    const m = buildCutMoment({ unit: 'kg', weighIns: weighIns(6), lifts: [{ name: 'Squat', start: 140, now: 130 }], today: '2026-10-19' })!;
    expect(m.praise).not.toMatch(/fat, not muscle/);
  });
});
