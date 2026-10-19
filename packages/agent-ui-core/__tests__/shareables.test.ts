import { describe, it, expect } from 'vitest';
import { sceneFor, approxMeasure, fit, W, H, type Op } from '../src/shareables/scene';
import type { ClimbData, DayData, CutData, SessionData, LineData, ShareableData } from '../src/shareables/types';

const m = approxMeasure;
const series = (vals: number[], start = '2026-07-27') => vals.map((e1rm, i) => ({ date: new Date(Date.parse(`${start}T12:00:00Z`) + i * 7 * 864e5).toISOString().slice(0, 10), e1rm }));

const climb: ClimbData = {
  lift: 'Bench press', unit: 'lb', repMax: '225×3', delta: 10,
  series: series([218, 220, 224, 223, 229, 231, 228, 234, 238, 237, 241, 244, 248]),
  goal: { value: 255, label: '255' }, events: [{ date: '2026-09-07', label: 'Deload', sub: 'wk 7' }],
  stats: { gained: 30, bw: 1.3, weeksToGoal: 4, weeks: 12 },
};
const day: DayData = {
  date: '2026-10-19', protein: { total: 182, target: 180, meals: [{ name: 'Breakfast', g: 42 }, { name: 'Lunch', g: 55 }, { name: 'Shake', g: 25 }, { name: 'Dinner', g: 60 }] },
  calories: { n: 2480, target: 2600 }, carbs: { n: 260, target: 290 }, fat: { n: 78, target: 80 }, fiber: { n: 31, target: 35 },
  week: [true, true, false, true, true, false, false], todayIndex: 0,
};
const cut: CutData = {
  unit: 'lb', weeks: 10, change: -8.4, since: 'Aug 10',
  series: [0, -1.2, -1.9, -2.8, -3.6, -4.1, -5.3, -6.2, -7.5, -8.4].map((delta, i) => ({ week: i + 1, delta })),
  safe: { min: 0.5, max: 1.5 }, lifts: [{ name: 'Squat', start: 285, now: 295 }, { name: 'Bench press', start: 225, now: 225 }, { name: 'Deadlift', start: 365, now: 375 }],
};
const session: SessionData = {
  name: 'Legs / glutes', minutes: 64, unit: 'lb', volume: 18450,
  lifts: [{ name: 'Back squat', top: '275×5', share: 0.42, isPR: true }, { name: 'Romanian deadlift', top: '225×8', share: 0.28, isPR: false }, { name: 'Hip thrust', top: '315×10', share: 0.2, isPR: false }, { name: 'Leg extension', top: '140×12', share: 0.1, isPR: false }],
};
const line: LineData = { lift: 'Bench press', unit: 'lb', now: 248, start: { label: 'Jul 27', value: 218 }, weeks: 12, series: series([218, 224, 229, 228, 238, 241, 248]) };

const all: ShareableData[] = [
  { kind: '3a', data: climb }, { kind: '3e', data: climb }, { kind: '3b', data: day }, { kind: '3f', data: day },
  { kind: '3d', data: cut }, { kind: '3g', data: session }, { kind: '2f', data: line },
];

/** Bounding box of an op (text via the measure). */
function box(o: Op): { l: number; r: number; t: number; b: number } | null {
  switch (o.t) {
    case 'rect': return { l: o.x, r: o.x + o.w, t: o.y, b: o.y + o.h };
    case 'line': return { l: Math.min(o.x1, o.x2), r: Math.max(o.x1, o.x2), t: Math.min(o.y1, o.y2), b: Math.max(o.y1, o.y2) };
    case 'poly': { const xs = o.pts.map((p) => p[0]), ys = o.pts.map((p) => p[1]); return { l: Math.min(...xs), r: Math.max(...xs), t: Math.min(...ys), b: Math.max(...ys) }; }
    case 'circle': return { l: o.x - o.r, r: o.x + o.r, t: o.y - o.r, b: o.y + o.r };
    case 'text': {
      const w = m(o.s, o.size, o.weight, o.ls);
      const l = o.align === 'right' ? o.x - w : o.align === 'center' ? o.x - w / 2 : o.x;
      return { l, r: l + w, t: o.y, b: o.y + o.size * 1.2 };
    }
    case 'image': return o.id === 'photo' ? null : { l: o.x, r: o.x + o.w, t: o.y, b: o.y + o.h };
    case 'scrim': return null; // full-bleed by design
  }
}

describe('shareable scenes', () => {
  it.each(all.map((s) => [s.kind, s] as const))('%s builds, has a label and stays on the canvas', (_k, s) => {
    const scene = sceneFor(s, { measure: m, preview: true });
    expect(scene.ops.length).toBeGreaterThan(8);
    expect(scene.label.length).toBeGreaterThan(10);
    for (const o of scene.ops) {
      const b = box(o);
      if (!b) continue;
      expect(b.l).toBeGreaterThanOrEqual(0);
      expect(b.r).toBeLessThanOrEqual(W + 0.5);
      expect(b.t).toBeGreaterThanOrEqual(0);
      expect(b.b).toBeLessThanOrEqual(H + 0.5);
    }
  });

  it.each(['3e', '3f', '3g', '2f'] as const)('overlay %s keeps everything inside the story safe zones', (k) => {
    const s = all.find((x) => x.kind === k)!;
    for (const ink of ['white', 'dark'] as const) {
      const scene = sceneFor(s, { measure: m, ink });
      expect(scene.background).toBeNull();
      for (const o of scene.ops) {
        const b = box(o);
        if (!b) continue;
        expect(b.l, JSON.stringify(o)).toBeGreaterThanOrEqual(22 - 3.5); // dots may overhang by their radius
        expect(b.r, JSON.stringify(o)).toBeLessThanOrEqual(W - 22 + 3.5);
        expect(b.t, JSON.stringify(o)).toBeGreaterThanOrEqual(92 - 3.5);
        expect(b.b, JSON.stringify(o)).toBeLessThanOrEqual(H - 22 + 0.5);
      }
    }
  });

  it('overlays put a scrim behind their text over a photo, and none on a bare overlay', () => {
    for (const k of ['3e', '3f', '3g', '2f'] as const) {
      const s = all.find((x) => x.kind === k)!;
      expect(sceneFor(s, { measure: m }).ops.some((o) => o.t === 'scrim')).toBe(true);
      expect(sceneFor(s, { measure: m, withPhoto: false }).ops.some((o) => o.t === 'scrim')).toBe(false);
    }
  });

  it('overlays drop the photo layer for "Save overlay only"', () => {
    const withPhoto = sceneFor({ kind: '3g', data: session }, { measure: m });
    const without = sceneFor({ kind: '3g', data: session }, { measure: m, withPhoto: false });
    expect(withPhoto.ops.some((o) => o.t === 'image' && o.id === 'photo')).toBe(true);
    expect(without.ops.some((o) => o.t === 'image' && o.id === 'photo')).toBe(false);
  });

  it('long typed names never run into the next column (3g "Triceps Rope Pressdown", 19 Oct)', () => {
    const long = 'Triceps Rope Pressdown With Single Arm Supination Hold';
    const texts = (k: '3a' | '3d' | '3e' | '3g' | '2f') => {
      const data: any = k === '3g' ? { ...session, name: 'Upper Body Hypertrophy Push Pull Superset Day', lifts: [{ name: long, top: '90×6', share: 0.6, isPR: true }, { name: long, top: '1,245×10', share: 0.4, isPR: false }] }
        : k === '3d' ? { ...cut, lifts: [{ name: long, start: 1225, now: 1245 }] }
        : k === '2f' ? { ...line, lift: long } : { ...climb, lift: long };
      return sceneFor({ kind: k, data } as any, { measure: m }).ops.filter((o): o is Extract<Op, { t: 'text' }> => o.t === 'text');
    };
    const overlaps = (a: Extract<Op, { t: 'text' }>, b: Extract<Op, { t: 'text' }>) => {
      const A = box(a)!, B = box(b)!;
      return A.l < B.r - 0.5 && B.l < A.r - 0.5 && A.t < B.b - 0.5 && B.t < A.b - 0.5;
    };
    for (const k of ['3a', '3d', '3e', '3g', '2f'] as const) {
      const t = texts(k);
      for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) {
        if (overlaps(t[i], t[j])) throw new Error(`${k}: "${t[i].s}" overlaps "${t[j].s}"`);
      }
      for (const o of t) { const b = box(o)!; expect(b.r, `${k} ${o.s}`).toBeLessThanOrEqual(W - 22 + 0.5); }
    }
    const row = texts('3g').find((o) => o.s.startsWith('Triceps'))!;
    expect(row.s.endsWith('…')).toBe(true);
  });

  it('fit() keeps short names and cuts long ones at a word', () => {
    expect(fit(m, 'Bench press', 200, 12, 500)).toBe('Bench press');
    const f = fit(m, 'Triceps Rope Pressdown', 80, 12, 500);
    expect(f.endsWith('…')).toBe(true);
    expect(m(f, 12, 500)).toBeLessThanOrEqual(80);
  });

  it('3a: the event label sits to one side of its marker, never across it', () => {
    const scene = sceneFor({ kind: '3a', data: climb }, { measure: m });
    const marker = scene.ops.find((o): o is Extract<Op, { t: 'line' }> => o.t === 'line' && !!o.dash && o.x1 === o.x2)!;
    const label = scene.ops.find((o) => o.t === 'text' && o.s === 'Deload')!;
    const b = box(label)!;
    expect(b.r <= marker.x1 || b.l >= marker.x1).toBe(true);
  });

  it('a "Top set" climb never claims a PR', () => {
    for (const k of ['3a', '3e'] as const) {
      const sc = sceneFor({ kind: k, data: { ...climb, badge: 'Top set', delta: null } }, { measure: m });
      const t = sc.ops.filter((o): o is Extract<Op, { t: 'text' }> => o.t === 'text').map((o) => o.s.toUpperCase()).join(' ');
      expect(t).not.toMatch(/NEW PR|BEST TRIPLE/);
      expect(t).toMatch(/TOP SET/);
      if (k === '3a') expect(t).toMatch(/· TODAY/);
      expect(sc.label).not.toMatch(/new best/);
    }
  });

  it('3a: a series that has already passed the goal says so', () => {
    const scene = sceneFor({ kind: '3a', data: { ...climb, goal: { value: 240, label: '240' } } }, { measure: m });
    expect(scene.ops.some((o) => o.t === 'text' && o.s === 'Goal hit')).toBe(true);
  });

  it('3d never shows an absolute body weight, and only claims "fat, not muscle" when every lift held ≥ 97%', () => {
    const texts = (d: CutData) => sceneFor({ kind: '3d', data: d }, { measure: m }).ops.filter((o): o is Extract<Op, { t: 'text' }> => o.t === 'text').map((o) => o.s);
    const t = texts(cut);
    expect(t).toContain('The loss is fat, not muscle.');
    expect(t).toContain('Weight hidden');
    // Only deltas, lift numbers and axis labels: nothing in a body-weight range with a unit.
    expect(t.filter((s) => /\b(1[2-9]\d|2\d\d)\s?lb\b/.test(s))).toEqual([]);
    const dropped = texts({ ...cut, lifts: [{ name: 'Squat', start: 300, now: 285 }] });
    expect(dropped).not.toContain('The loss is fat, not muscle.');
    expect(dropped).toContain('Strength mostly held.');
  });

  it('3d with no lifts makes no strength claim and drops the strength section', () => {
    const t = sceneFor({ kind: '3d', data: { ...cut, lifts: [] } }, { measure: m }).ops.filter((o): o is Extract<Op, { t: 'text' }> => o.t === 'text').map((o) => o.s);
    expect(t.some((s) => /strength|muscle/i.test(s))).toBe(false);
    expect(t).toContain('Steady, inside the safe range.');
  });

  it('3d: the safe-range label does not sit on the series', () => {
    const scene = sceneFor({ kind: '3d', data: cut }, { measure: m });
    const series = scene.ops.find((o): o is Extract<Op, { t: 'poly' }> => o.t === 'poly' && !o.closed && !!o.color)!;
    const label = box(scene.ops.find((o) => o.t === 'text' && o.s.startsWith('safe range'))!)!;
    for (let i = 1; i < series.pts.length; i++) {
      const [ax, ay] = series.pts[i - 1], [bx, by] = series.pts[i];
      for (let f = 0; f <= 1; f += 0.05) {
        const x = ax + (bx - ax) * f, y = ay + (by - ay) * f;
        expect(x >= label.l && x <= label.r && y >= label.t && y <= label.b).toBe(false);
      }
    }
  });

  it('2f: the start label stays clear of the crimson end dot', () => {
    const scene = sceneFor({ kind: '2f', data: line }, { measure: m });
    const dot = scene.ops.find((o): o is Extract<Op, { t: 'circle' }> => o.t === 'circle' && o.fill === '#A51C30')!;
    const label = box(scene.ops.find((o) => o.t === 'text' && o.s.startsWith('JUL'))!)!;
    expect(dot.x + dot.r < label.l || dot.x - dot.r > label.r || dot.y + dot.r < label.t || dot.y - dot.r > label.b).toBe(true);
  });

  it('3b: the target label never runs off the card, even when the target is the whole bar', () => {
    const scene = sceneFor({ kind: '3b', data: { ...day, protein: { ...day.protein, total: 150 } } }, { measure: m });
    const b = box(scene.ops.find((o) => o.t === 'text' && o.s.endsWith('target'))!)!;
    expect(b.r).toBeLessThanOrEqual(W - 22 + 0.5);
  });

  it('handles a single-point series and a kg user', () => {
    const one = { ...climb, unit: 'kg' as const, series: series([100]), events: [], goal: null, stats: { ...climb.stats, weeksToGoal: null, bw: null } };
    expect(() => sceneFor({ kind: '3a', data: one }, { measure: m })).not.toThrow();
    expect(() => sceneFor({ kind: '3e', data: one }, { measure: m })).not.toThrow();
    expect(() => sceneFor({ kind: '2f', data: { ...line, series: series([100]) } }, { measure: m })).not.toThrow();
  });
});
