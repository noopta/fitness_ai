// Exercise swaps keep the job (Oct 2026). The rules are checked across the
// whole catalog, not one example: a swap never changes the movement of a
// main/secondary lift, never replaces a main lift with a low-load one, never
// drops the session's only hinge/squat/press/pull, respects equipment and
// injuries, spares the sore joint on a pain swap, and ranks the same way twice.
import { describe, it, expect } from 'vitest';
import { CATALOG, ALL_REGIONS, ALL_PATTERNS, ALL_JOINTS, ALL_EQUIPMENT, type ExerciseProfile } from '../services/swap/catalog.js';
import { resolveProfile, normalizeName, slotJob, rankSwaps, emptyContext, patternSim, primaryGroup, equipmentFrom, jointsFrom, weightsFor, WEIGHTS, type SwapContext } from '../services/swap/match.js';
import { toProfile } from '../services/swap/classify.js';
import { makeKeyFn } from '../adaptation/history.js';

const byName = new Map(CATALOG.map((c) => [c.name, c]));
const get = (n: string) => byName.get(n)!;
const ctx = (patch: Partial<SwapContext> = {}): SwapContext => ({ ...emptyContext(), ...patch });

describe('catalog', () => {
  it('every entry is well-formed', () => {
    const names = new Set<string>();
    for (const c of CATALOG) {
      expect(names.has(c.name), c.name).toBe(false);
      names.add(c.name);
      const sum = Object.values(c.m).reduce((a, b) => a + (b ?? 0), 0);
      expect(Math.abs(sum - 1), `${c.name} muscle weights sum to ${sum}`).toBeLessThan(0.011);
      for (const r of Object.keys(c.m)) expect(ALL_REGIONS, `${c.name}: ${r}`).toContain(r);
      for (const j of Object.keys(c.joints)) expect(ALL_JOINTS, `${c.name}: ${j}`).toContain(j);
      expect(ALL_PATTERNS).toContain(c.pattern);
      expect(ALL_EQUIPMENT).toContain(c.eq);
      for (const v of [c.load, c.demand, c.skill]) expect(v >= 1 && v <= 5, c.name).toBe(true);
    }
  });

  it('every name and alias resolves to its own entry (no alias is shared)', () => {
    for (const c of CATALOG) for (const n of [c.name, ...(c.aka ?? [])]) expect(resolveProfile(n)?.name, n).toBe(c.name);
  });

  it('role weights sum to 1, also after the reason adjusts them', () => {
    for (const role of Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]) for (const reason of ['default', 'pain', 'equipment'] as const) {
      const sum = Object.values(weightsFor(role, reason)).reduce((a, b) => a + (b ?? 0), 0);
      expect(Math.abs(sum - 1), `${role}/${reason}`).toBeLessThan(1e-9);
    }
  });
});

describe('names', () => {
  it('spellings collapse: hyphens, plurals, tricep(s), press/pushdown', () => {
    expect(normalizeName('Single-arm Tricep Pushdowns')).toBe(normalizeName('single arm triceps pushdown'));
    expect(resolveProfile('Single-arm tricep pushdowns')?.name).toBe('Single Arm Tricep Pushdown');
    expect(resolveProfile('single arm cable tricep pushdown')?.name).toBe('Single Arm Tricep Pushdown');
    expect(resolveProfile('Tricep Pushdown')?.name).toBe('Triceps Pressdown');
  });

  it('a machine name never resolves to the free-weight lift', () => {
    expect(resolveProfile('Machine Lateral Raise')?.name).toBe('Machine Lateral Raise');
    expect(resolveProfile('machine chest fly')?.eq).toBe('machine');
    expect(resolveProfile('cable lateral raise')?.name).toBe('Cable Lateral Raise');
  });

  it('history keys: one lift per spelling, machine versions of free-weight lifts are their own lift', () => {
    const k = makeKeyFn();
    expect(k('Single-arm tricep pushdowns')).toBe(k('Single Arm Triceps Pushdown'));
    expect(k('Single Arm Tricep Pushdown')).not.toBe(k('Tricep Pushdown'));
    expect(k('Machine Lateral Raise')).not.toBe(k('Lateral Raise'));
    expect(k('Dumbbell Lateral Raise')).toBe(k('Lateral Raise'));
    expect(k('Smith machine squat')).not.toBe(k('Squat'));
    expect(k('Back Squat')).toBe(k('Squat'));
    expect(k('Machine Leg Press')).toBe(k('Leg Press'));
    expect(k('Pull-Up')).toBe(k('pull ups'));
  });
});

describe('the job', () => {
  it('main / secondary / accessory / cardio / mobility', () => {
    expect(slotJob(get('Squat'), { reps: 5, index: 0 }).role).toBe('main');
    expect(slotJob(get('Cable Row'), { reps: 10, index: 3 }).role).toBe('secondary');
    expect(slotJob(get('Triceps Pressdown'), { reps: '10-12', index: 4 }).role).toBe('accessory');
    expect(slotJob(get('Running'), { notes: '30 min zone 2' })).toMatchObject({ role: 'cardio', energy: 'aerobic' });
    expect(slotJob(get('Running'), { notes: '8 x 200 m sprint intervals' }).energy).toBe('anaerobic');
    expect(slotJob(get('Pigeon Stretch')).role).toBe('mobility');
  });

  it('the only hinge in the session must stay a hinge', () => {
    expect(slotJob(get('Romanian Deadlift'), { session: ['Squat', 'Leg Press', 'Leg Extension', 'Romanian Deadlift'] }).keepPattern).toBe(true);
    expect(slotJob(get('Romanian Deadlift'), { session: ['Squat', 'Hip Thrust', 'Romanian Deadlift'] }).keepPattern).toBe(false);
  });
});

describe('ranking invariants, every exercise in the catalog', () => {
  const strength = CATALOG.filter((c) => c.mod !== 'cardio' && c.mod !== 'mobility');

  it('main and secondary swaps keep the movement; main swaps keep the load capacity', () => {
    for (const o of strength) for (const slot of [{ reps: 5, index: 0 }, { reps: 10, index: 3 }]) {
      const job = slotJob(o, slot);
      if (job.role === 'accessory') continue;
      for (const opt of rankSwaps(o, job, ctx()).options) {
        const c = get(opt.name);
        expect(patternSim(o.pattern, c.pattern), `${o.name} → ${c.name}`).toBeGreaterThanOrEqual(0.6);
        if (job.role === 'main') expect(c.load, `${o.name} → ${c.name}`).toBeGreaterThanOrEqual(o.load - 1);
      }
    }
  });

  it('accessory swaps keep the movement or the primary target', () => {
    for (const o of strength) {
      const job = slotJob(o, { reps: 12, index: 5 });
      if (job.role !== 'accessory') continue;
      for (const opt of rankSwaps(o, job, ctx()).options) {
        const c = get(opt.name);
        expect(patternSim(o.pattern, c.pattern) >= 0.6 || primaryGroup(c) === primaryGroup(o), `${o.name} → ${c.name}`).toBe(true);
      }
    }
  });

  it('never crosses modality (a lift is never swapped for cardio or a stretch)', () => {
    for (const o of CATALOG) for (const opt of rankSwaps(o, slotJob(o), ctx()).options) {
      const c = get(opt.name);
      const cls = (p: ExerciseProfile) => (p.mod === 'power' ? 'strength' : p.mod);
      expect(cls(c), `${o.name} → ${c.name}`).toBe(cls(o));
    }
  });

  it('the best option is never much easier than the original unless they asked', () => {
    for (const o of strength) {
      const top = rankSwaps(o, slotJob(o, { reps: 8, index: 1 }), ctx()).top[0];
      if (top) expect(get(top.name).demand, `${o.name} → ${top.name}`).toBeGreaterThanOrEqual(o.demand - 1);
    }
  });

  it('respects injuries and equipment', () => {
    const home = equipmentFrom('home_gym')!;
    for (const o of CATALOG) {
      const r = rankSwaps(o, slotJob(o), ctx({ injured: new Set(['shoulder']), equipment: home }));
      for (const opt of r.options) {
        const c = get(opt.name);
        expect(c.joints.shoulder ?? 0, `${o.name} → ${c.name}`).toBeLessThan(2);
        expect(home.has(c.eq), `${o.name} → ${c.name} (${c.eq})`).toBe(true);
      }
    }
  });

  it('a pain swap always eases the sore joint', () => {
    for (const o of CATALOG) {
      const r = rankSwaps(o, slotJob(o), ctx(), 'pain');
      const worst = Object.entries(o.joints).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0) || a[0].localeCompare(b[0]))[0];
      if (!worst) continue;
      for (const opt of r.options) expect(get(opt.name).joints[worst[0] as keyof ExerciseProfile['joints']] ?? 0, `${o.name} → ${opt.name}`).toBeLessThan(worst[1]!);
    }
  });

  it('is deterministic', () => {
    for (const o of CATALOG) {
      const a = rankSwaps(o, slotJob(o, { reps: 8 }), ctx());
      const b = rankSwaps(o, slotJob(o, { reps: 8 }), ctx());
      expect(a.options.map((x) => [x.name, x.score])).toEqual(b.options.map((x) => [x.name, x.score]));
      expect(a.top.map((x) => x.name)).toEqual(b.top.map((x) => x.name));
    }
  });

  it('every option explains itself in one line', () => {
    for (const o of CATALOG) for (const opt of rankSwaps(o, slotJob(o), ctx()).options) expect(opt.why, `${o.name} → ${opt.name}`).toMatch(/^[A-Z].+\.$/);
  });
});

describe('examples', () => {
  it('back squat, main lift: same squat pattern loaded as heavy; leg extension never qualifies', () => {
    const o = get('Squat');
    const r = rankSwaps(o, slotJob(o, { reps: 5, index: 0 }), ctx());
    expect(r.top[0].name).toBe('Safety Bar Squat');
    expect(r.rejected['Leg Extension']).toBe('movement');
    expect(r.options.map((x) => x.name)).not.toContain('Goblet Squat');
  });

  it('RDL as the only hinge: a leg curl is not a substitute', () => {
    const o = get('Romanian Deadlift');
    const r = rankSwaps(o, slotJob(o, { reps: 8, index: 2, session: ['Squat', 'Leg Press', 'Leg Extension', 'Romanian Deadlift'] }), ctx());
    expect(r.options.map((x) => x.name)).not.toContain('Leg Curl');
    expect(r.top.every((t) => get(t.name).pattern === 'hinge')).toBe(true);
  });

  it('pushdown: other elbow extensions, the single-arm version among the variants', () => {
    const o = get('Triceps Pressdown');
    const r = rankSwaps(o, slotJob(o, { reps: 12, index: 4 }), ctx());
    expect(r.top.every((t) => get(t.name).pattern === 'elbow_ext')).toBe(true);
    expect(r.options.slice(0, 5).map((x) => x.name)).toContain('Single Arm Tricep Pushdown');
  });

  it('zone 2 run with sore knees: same energy system, lower impact', () => {
    const o = get('Running');
    const r = rankSwaps(o, slotJob(o, { notes: 'zone 2' }), ctx({ injured: jointsFrom('sore knees') }), 'pain');
    const names = r.options.map((x) => x.name);
    expect(names).not.toContain('Sprints');
    expect(names).toEqual(expect.arrayContaining(['Elliptical', 'Swimming']));
    expect(r.top[0].why).toMatch(/knee/);
  });

  it('lifts they already do get a nudge', () => {
    const o = get('Triceps Pressdown');
    const job = slotJob(o, { reps: 12, index: 4 });
    const without = rankSwaps(o, job, ctx()).options.find((x) => x.name === 'Single Arm Tricep Pushdown')!;
    const withHistory = rankSwaps(o, job, ctx({ history: new Set([normalizeName('Single Arm Tricep Pushdown')]) })).options.find((x) => x.name === 'Single Arm Tricep Pushdown')!;
    expect(withHistory.score).toBeGreaterThan(without.score);
    expect(withHistory.why).toMatch(/done it before/);
  });
});

describe('context parsing', () => {
  it('equipment text', () => {
    expect(equipmentFrom('full_gym')).toBeNull();
    expect(equipmentFrom('commercial')).toBeNull();
    expect(equipmentFrom(null)).toBeNull();
    expect([...equipmentFrom('Bodyweight only')!]).not.toContain('dumbbell');
    expect(equipmentFrom('home_gym')!.has('machine')).toBe(false);
    expect(equipmentFrom('barbell,dumbbells,rack')!.has('barbell')).toBe(true);
  });
  it('injury text', () => {
    expect([...jointsFrom('Recovering from shoulder surgery')]).toEqual(['shoulder']);
    expect([...jointsFrom('Achilles tendon rupture')]).toEqual(['ankle']);
    expect(jointsFrom('none').size).toBe(0);
  });
});

describe('classified profiles', () => {
  it('validates, clamps and normalizes a model answer', () => {
    const p = toProfile('Landmine Meadows Row', { mod: 'strength', pattern: 'h_pull', m: { lats: 2, upper_back: 1, biceps: 1, wings: 3 }, prof: 2, load: 9, demand: 3, skill: 0, joints: { lower_back: 1, toes: 2 }, energy: ['hypertrophy', 'vibes'], eq: 'landmine', uni: true })!;
    expect(p.m).toEqual({ lats: 0.5, upper_back: 0.25, biceps: 0.25 });
    expect(p.load).toBe(5);
    expect(p.skill).toBe(1);
    expect(p.joints).toEqual({ lower_back: 1 });
    expect(p.energy).toEqual(['hypertrophy']);
  });
  it('rejects answers outside the fixed lists', () => {
    expect(toProfile('x', { mod: 'yoga', pattern: 'h_pull', m: { lats: 1 }, prof: 1, load: 1, demand: 1, skill: 1, joints: {}, energy: ['hypertrophy'], eq: 'barbell' })).toBeNull();
    expect(toProfile('x', { mod: 'strength', pattern: 'h_pull', m: { wings: 1 }, prof: 1, load: 1, demand: 1, skill: 1, joints: {}, energy: ['hypertrophy'], eq: 'barbell' })).toBeNull();
  });
  it('a classified exercise ranks like a catalog one', () => {
    const p = toProfile('Landmine Meadows Row Variation', { mod: 'strength', pattern: 'h_pull', m: { lats: 0.5, upper_back: 0.3, biceps: 0.2 }, prof: 2, load: 3, demand: 3, skill: 3, joints: { lower_back: 1 }, energy: ['hypertrophy'], eq: 'landmine', uni: true })!;
    const r = rankSwaps(p, slotJob(p, { reps: 10, index: 2 }), ctx());
    expect(r.top.length).toBe(3);
    expect(r.top.every((t) => get(t.name).pattern === 'h_pull')).toBe(true);
  });
});
