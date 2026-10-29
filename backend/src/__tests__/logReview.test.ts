// Log review (design "Log review 1a", Oct 2026): detection rules on cases
// taken from real logs, the digest card block, and the fix helpers.

import { describe, it, expect } from 'vitest';
import { detect, editRatio, type ReviewLog } from '../services/logReview/detect.js';
import { reviewBlock, periodLabel, introText, followUpText, countableExercises, type FlagRow } from '../services/logReview/index.js';
import { patchExercise } from '../agent/toolkits/logReview.js';

const key = (n: string) => n.toLowerCase().replace(/^(barbell|machine) /, '').replace(/s$/, '').trim();
const at = (iso: string) => new Date(iso);
let n = 0;
const log = (over: Partial<ReviewLog>): ReviewLog => ({ id: `w${++n}`, date: '2026-10-25', createdAt: at('2026-10-25T20:00:00Z'), title: 'Workout', duration: null, notes: null, exercises: [], ...over });
const ex = (name: string, kg: number | null, reps: number, sets = 3, extra: any = {}) => ({ name, sets, reps: String(reps), weightKg: kg, setEntries: Array.from({ length: sets }, () => ({ weightKg: kg, reps })), ...extra });
const run = (recent: ReviewLog[], history: ReviewLog[] = [], over: any = {}) => detect({ recent, history, key, unit: 'imperial', bodyweightKg: 80, suppressed: new Set(), ...over });

describe('duplicates and corrections (one flag per session)', () => {
  it('a climb saved four times while being corrected is one conflict: keep the latest', () => {
    const climb = (min: number, t: string) => log({ title: `Rock climbing · ${min} min`, duration: min, createdAt: at(t), exercises: [{ name: 'Rock climbing', sets: 1, reps: String(min) }] as any });
    const a = climb(150, '2026-10-26T01:19:57Z'), b = climb(150, '2026-10-26T01:20:19Z'), c = climb(150, '2026-10-26T01:20:46Z'), d = climb(120, '2026-10-26T01:22:48Z');
    const f = run([a, b, c, d]);
    expect(f).toHaveLength(1);
    expect(f[0].type).toBe('conflict');
    expect(f[0].title).toBe('Rock climbing: 4 versions');
    expect(f[0].suggestion).toEqual({ op: 'delete', payload: { logIds: [a.id, b.id, c.id] } });
  });

  it('identical copies are a duplicate — high confidence within 5 minutes, medium after', () => {
    const one = log({ createdAt: at('2026-10-15T10:25:22Z'), exercises: [ex('Hip Thrust', 40, 10)] });
    const two = log({ createdAt: at('2026-10-15T10:32:55Z'), exercises: [ex('Hip Thrust', 40, 10)] });
    const [f] = run([one, two]);
    expect(f.type).toBe('duplicate');
    expect(f.confidence).toBe('medium');
    expect(f.reason).toMatch(/8 min apart/);
    const quick = log({ createdAt: at('2026-10-15T10:26:00Z'), exercises: [ex('Hip Thrust', 40, 10)] });
    expect(run([one, quick])[0].confidence).toBe('high');
  });

  it('two sessions far apart in the day are left alone', () => {
    const am = log({ createdAt: at('2026-10-25T08:00:00Z'), exercises: [ex('Bench Press', 80, 5)] });
    const pm = log({ createdAt: at('2026-10-25T18:00:00Z'), exercises: [ex('Bench Press', 80, 5)] });
    expect(run([am, pm])).toEqual([]);
  });
});

describe('equipment: machine numbers logged as free weights', () => {
  it('a 135 lb lateral raise is flagged as a machine', () => {
    const [f] = run([log({ exercises: [ex('Lateral Raise', 61.2, 10, 2)] })]);
    expect(f.type).toBe('equipment');
    expect(f.suggestion.payload).toMatchObject({ patch: { name: 'Machine Lateral Raise', equipment: 'machine' } });
  });
  it('dumbbell-sized numbers, or a name that already says machine, are fine', () => {
    expect(run([log({ exercises: [ex('Lateral Raise', 12, 12)] })])).toEqual([]);
    expect(run([log({ exercises: [ex('Machine Lateral Raise', 61.2, 10)] })])).toEqual([]);
  });
});

describe('outliers and typo hypotheses', () => {
  const history = [0, 1, 2].map((i) => log({ date: `2026-09-1${i}`, createdAt: at(`2026-09-1${i}T10:00:00Z`), exercises: [ex('Overhead Press', 60, 5)] }));
  it('1,350 lb overhead press reads as a typo of 135 → high confidence', () => {
    const [f] = run([log({ exercises: [ex('Overhead Press', 612, 5)] })], history);
    expect(f.type).toBe('outlier');
    expect(f.confidence).toBe('high');
    expect(f.suggestion.payload).toMatchObject({ patch: { weightKg: 61.2 } });
  });
  it('one bad old log does not poison the baseline (median of the last 3)', () => {
    const bad = log({ date: '2026-09-01', createdAt: at('2026-09-01T10:00:00Z'), exercises: [ex('Overhead Press', 600, 5)] });
    expect(run([log({ exercises: [ex('Overhead Press', 62, 5)] })], [...history, bad])).toEqual([]);
  });
});

describe('missing data and names', () => {
  it('a weighted lift saved without weight is filled from the median of recent sessions (low)', () => {
    const history = [100, 105, 110].map((kg, i) => log({ date: `2026-09-1${i}`, createdAt: at(`2026-09-1${i}T10:00:00Z`), exercises: [ex('Barbell Row', kg, 8)] }));
    const [f] = run([log({ exercises: [ex('Barbell Row', null, 8)] })], history);
    expect(f.type).toBe('missing');
    expect(f.confidence).toBe('low');
    expect(f.suggestion).toMatchObject({ op: 'fill', payload: { patch: { weightKg: 105 } } });
  });
  it('a typo is renamed toward the real word, never the other way', () => {
    const hist = [log({ date: '2026-09-01', exercises: [ex('Tricep Pushdown', 20, 10)] }), log({ date: '2026-09-08', exercises: [ex('Tricep Pushdown', 20, 10)] })];
    const [f] = run([log({ exercises: [ex('Trciep Pushdown', 20, 10)] })], hist);
    expect(f).toMatchObject({ type: 'fuzzy_duplicate', fix: 'Rename to Tricep Pushdown' });
    expect(run([log({ exercises: [ex('Tricep Pushdown', 20, 10)] })], [log({ date: '2026-09-01', exercises: [ex('Trciep Pushdown', 20, 10)] }), log({ date: '2026-09-02', exercises: [ex('Trciep Pushdown', 20, 10)] })])).toEqual([]);
  });
  it('different lifts with similar names are not merged', () => {
    expect(editRatio('Single arm tricep pushdown', 'Underarm tricep pushdown')).toBeGreaterThan(0.12);
  });
});

describe('dismissed memory', () => {
  it('a kept rule is never raised again', () => {
    const recent = [log({ exercises: [ex('Lateral Raise', 61.2, 10)] })];
    const [f] = run(recent);
    expect(run(recent, [], { suppressed: new Set([f.ruleKey]) })).toEqual([]);
  });
});

describe('digest card', () => {
  const row = (over: Partial<FlagRow>): FlagRow => ({ id: `f${++n}`, type: 'duplicate', status: 'pending', confidence: 'high', entryDate: '2026-10-20', title: 't', fix: 'x', before: 'b', after: 'a', reason: 'r', impact: null, doneLabel: 'Done', ...over });
  it('orders pending high → low confidence, then newest; caps at five with "Show N more"', () => {
    const flags = [row({ confidence: 'low', entryDate: '2026-10-24' }), row({ confidence: 'high', entryDate: '2026-10-20' }), row({ status: 'applied' }), row({ confidence: 'medium' }), row({ confidence: 'high', entryDate: '2026-10-22' }), row({ confidence: 'low' }), row({ status: 'invalidated' })];
    const b = reviewBlock(flags);
    expect(b.pending).toBe(5);
    expect(b.rows.map((r) => r.confidence)).toEqual(['high', 'high', 'medium', 'low', 'low']);
    expect(b.rows[0].date).toBe('Thu, Oct 22');
    expect(b.hiddenCount).toBe(1);
    expect(b.period).toBe('Oct 20–24');
  });
  it('labels', () => {
    expect(periodLabel('2026-10-28', '2026-11-02')).toBe('Oct 28–Nov 2');
    expect(introText(['duplicate', 'outlier', 'missing'])).toBe('3 entries don’t look right — duplicates, an odd weight and a gap. I haven’t changed anything. Review below before I recalculate your strength numbers.');
    expect(followUpText(4, 1, 'Your Bench Press estimated max is now 225 lb.')).toBe('All reviewed — 4 corrected, 1 kept as is. Your Bench Press estimated max is now 225 lb.');
  });
});

describe('fixes and exclusion', () => {
  it('patches weight, reps, name and equipment across set entries', () => {
    const e = ex('Lateral Raise', 61.2, 10, 2);
    expect(patchExercise(e, { name: 'Machine Lateral Raise', equipment: 'machine' })).toMatchObject({ name: 'Machine Lateral Raise', equipment: 'machine', weightKg: 61.2 });
    expect(patchExercise(e, { weightKg: 20 }).setEntries.every((s: any) => s.weightKg === 20)).toBe(true);
    expect(patchExercise(ex('Squat', 100, 85), { repsFrom: 85, repsTo: 8 }).setEntries[0].reps).toBe(8);
    expect(e.setEntries[0].weightKg).toBe(61.2); // the original is untouched (Undo restores from it)
  });
  it('flagged entries and estimates sit out of e1RM / PRs', () => {
    const exs = [ex('Bench', 100, 5), ex('Row', 80, 8, 3, { estimated: true }), ex('Curl', 20, 10)];
    expect(countableExercises('w1', exs, new Set(['w1#2'])).map((e) => e.name)).toEqual(['Bench']);
    expect(countableExercises('w1', exs, new Set(['w1']))).toEqual([]);
  });
});

describe('equipment rule: machine-by-nature lifts are never flagged (Oct 29 2026)', () => {
  const lb = (x: number) => x / 2.20462;
  const mk = (name: string, w: number) => ({ id: `l-${name}`, date: '2026-10-28', createdAt: new Date('2026-10-28T10:00:00Z'), title: 'Session', duration: 60, notes: null, exercises: [{ name, sets: 3, reps: '10', weightKg: lb(w) }] });
  const run = (name: string, w: number) => detect({ recent: [mk(name, w)], history: [], key: (n: string) => n.toLowerCase(), unit: 'imperial', bodyweightKg: 80, suppressed: new Set() } as any).filter((f) => f.type === 'equipment');
  it('heavy seated leg curl, pushdown, face pull, pec deck: no flag', () => {
    for (const [n, w] of [['Seated leg curl', 180], ['Tricep Pushdown', 150], ['Face Pull', 90], ['Pec Deck', 200], ['Lat Pulldown', 200]] as const) expect(run(n, w), n).toHaveLength(0);
  });
  it('a 135 lb lateral raise and a 156 lb chest fly are still flagged', () => {
    expect(run('Lateral Raise', 135)).toHaveLength(1);
    expect(run('Chest Fly', 156)).toHaveLength(1);
    expect(run('Dumbbell Curl', 150)).toHaveLength(1);
  });
});

describe('equipment rule never flags a machine or cable lift, across the whole exercise catalog', () => {
  it('every catalog exercise that is machine, cable or Smith: no equipment flag at any load', async () => {
    const { CATALOG } = await import('../services/swap/catalog.js');
    const mk = (name: string, kg: number) => ({ id: `l-${name}`, date: '2026-10-28', createdAt: new Date('2026-10-28T10:00:00Z'), title: 'S', duration: 60, notes: null, exercises: [{ name, sets: 3, reps: '10', weightKg: kg }] });
    for (const c of CATALOG.filter((x) => ['machine', 'cable', 'smith'].includes(x.eq))) {
      for (const n of [c.name, ...(c.aka ?? [])]) {
        const f = detect({ recent: [mk(n, 250)], history: [], key: (x: string) => x.toLowerCase(), unit: 'metric', bodyweightKg: 80, suppressed: new Set() } as any).filter((x) => x.type === 'equipment');
        expect(f, n).toHaveLength(0);
      }
    }
  });
});
