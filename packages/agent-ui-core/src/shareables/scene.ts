// Shareable scenes: data → a list of draw ops in the spec's design space
// (300 × 533 pt). Renderers (React Native Skia on the phone, CanvasKit in
// Node for QA) scale by width / 300 and draw the ops in order. Text is laid
// out with the renderer's own measure() so positions are exact on both.
//
// Coordinates and rules follow "RN spec: Shareable progress cards" (19 Oct
// 2026). Where the spec contradicts its own overlay safe zones (3g "top 22",
// 20 pt sides), the safe zones win: ≥ 22 pt sides, ≥ 92 pt top, ≥ 22 pt bottom.

import type { ClimbData, CutData, DayData, LineData, SessionData, ShareableData, ShareableKind } from './types';

export const W = 300;
export const H = 533;

export const C = {
  ink: '#09090b', muted: '#71717a', faint: '#a1a1aa', hair: '#e4e4e7', surface: '#f4f4f5',
  accent: '#A51C30', protein: '#3b82f6', carbs: '#f59e0b', fat: '#ec4899', white: '#ffffff',
} as const;

export type Weight = 400 | 500 | 600 | 700 | 800;
export type Pt = [number, number];
export type Op =
  | { t: 'rect'; x: number; y: number; w: number; h: number; fill?: string; stroke?: string; sw?: number; r?: number; opacity?: number }
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; color: string; w: number; dash?: [number, number]; opacity?: number; shadow?: boolean }
  | { t: 'poly'; pts: Pt[]; color?: string; w?: number; fill?: string; closed?: boolean; shadow?: boolean; opacity?: number }
  | { t: 'circle'; x: number; y: number; r: number; fill?: string; stroke?: string; sw?: number; shadow?: boolean }
  /** (x, y) = top-left of the text box for align left; right edge / centre for right / center. */
  | { t: 'text'; x: number; y: number; s: string; size: number; weight: Weight; color: string; align?: 'left' | 'center' | 'right'; ls?: number; opacity?: number; shadow?: boolean; tnum?: boolean }
  /** A full-width vertical fade behind overlay text so it reads on any photo: [position 0..1 within y0→y1, alpha] stops. */
  | { t: 'scrim'; y0: number; y1: number; color: string; stops: [number, number][] }
  /** The Axiom mark (square) in the given ink, or the user's photo (cover, full frame). */
  | { t: 'image'; id: 'mark' | 'photo'; x: number; y: number; w: number; h: number; ink?: 'white' | 'dark' };

/** Width of `s` in pt at `size`, letter spacing `ls` in em. */
export type Measure = (s: string, size: number, weight: Weight, ls?: number) => number;

export interface SceneOpts {
  measure: Measure;
  /** Overlays: which ink. Default white. */
  ink?: 'white' | 'dark';
  /** Preview in the app (rounded border) vs export (square, no border). */
  preview?: boolean;
  /** Overlays: draw the photo layer (false for "Save overlay only"). */
  withPhoto?: boolean;
}

export interface Scene { kind: ShareableKind; ops: Op[]; background: string | null; label: string }

const PAD = 22;
const SAFE = { side: 22, top: 92, bottom: 22 };
const LH = 1.2; // text box height = size × LH

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ts = (d: string) => Date.parse(`${d}T12:00:00Z`);
const month = (d: string) => MONTHS[new Date(`${d}T12:00:00Z`).getUTCMonth()];
const fmt = (n: number, dp = 0) => {
  const v = Number(n.toFixed(dp));
  return (Number.isInteger(v) ? String(v) : v.toFixed(dp)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};
const signed = (n: number, dp = 0) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n), dp)}`;
const upper = (s: string) => s.toUpperCase();

/**
 * Fit user text (lift names, session titles, meal names) into `max` pt,
 * cutting at a word where it can and ending with "…". Names are typed by
 * people — "Triceps Rope Pressdown" ran into the next column (19 Oct 2026).
 */
export function fit(m: Measure, s: string, max: number, size: number, weight: Weight, ls = 0): string {
  if (max <= 0) return '';
  if (m(s, size, weight, ls) <= max) return s;
  let cut = s;
  while (cut.length > 1 && m(`${cut}…`, size, weight, ls) > max) cut = cut.slice(0, -1);
  const word = cut.lastIndexOf(' ');
  if (word >= Math.max(3, cut.length * 0.6)) cut = cut.slice(0, word);
  return `${cut.trimEnd().replace(/[\s·,–-]+$/, '')}…`;
}
/** Uppercase eyebrow text fitted to `max`. */
const fitEyebrow = (m: Measure, s: string, max: number) => fit(m, upper(s), max, 10, 700, 0.14);

/** Eyebrow: 10 pt / 700 / +0.14em, uppercase. */
const eyebrow = (x: number, y: number, s: string, color: string, align: 'left' | 'right' | 'center' = 'left', extra: Partial<Op & { t: 'text' }> = {}): Op =>
  ({ t: 'text', x, y, s: upper(s), size: 10, weight: 700, color, align, ls: 0.14, ...extra } as Op);

// ── Shared card frame ───────────────────────────────────────────────────────

function cardFrame(ops: Op[], o: SceneOpts, moment: string) {
  if (o.preview) ops.push({ t: 'rect', x: 0.5, y: 0.5, w: W - 1, h: H - 1, fill: C.white, stroke: C.hair, sw: 1, r: 20 });
  ops.push({ t: 'image', id: 'mark', x: PAD, y: PAD, w: 18, h: 18, ink: 'dark' });
  ops.push({ t: 'text', x: PAD + 24, y: PAD + 1, s: 'Axiom', size: 13, weight: 600, color: C.ink });
  ops.push(eyebrow(W - PAD, PAD + 3, moment, C.accent, 'right'));
}

/** Footer: ink top rule, 3 equal columns (value 20/700, label 10 muted), rules between. */
function footerStats(ops: Op[], cols: { v: string; l: string }[]) {
  const top = H - PAD - 46;
  const cw = (W - 2 * PAD) / 3;
  ops.push({ t: 'line', x1: PAD, y1: top, x2: W - PAD, y2: top, color: C.ink, w: 1 });
  cols.slice(0, 3).forEach((c, i) => {
    const x = PAD + i * cw + (i ? 10 : 0);
    if (i) ops.push({ t: 'line', x1: PAD + i * cw, y1: top + 12, x2: PAD + i * cw, y2: H - PAD, color: C.hair, w: 1 });
    ops.push({ t: 'text', x, y: top + 12, s: c.v, size: 20, weight: 700, color: C.ink, ls: -0.02, tnum: true });
    ops.push({ t: 'text', x, y: top + 12 + 26, s: c.l, size: 10, weight: 400, color: C.muted });
  });
}

/** Hero number with a smaller suffix set on the same baseline. */
function hero(ops: Op[], m: Measure, x: number, y: number, s: string, size: number, suffix?: { s: string; color: string; weight: Weight; size: number }) {
  ops.push({ t: 'text', x, y, s, size, weight: 700, color: C.ink, ls: -0.045, tnum: true });
  if (suffix) {
    const w = m(s, size, 700, -0.045);
    // Align baselines: the suffix box sits so its bottom meets the hero's baseline region.
    ops.push({ t: 'text', x: x + w + 6, y: y + size * 0.98 - suffix.size * 1.05, s: suffix.s, size: suffix.size, weight: suffix.weight, color: suffix.color, tnum: true });
  }
}

const xLabels = (dates: string[]) => {
  const a = month(dates[0]), b = month(dates[dates.length - 1]);
  const mid = [...new Set(dates.slice(1, -1).map(month))].filter((m) => m !== a && m !== b);
  return [a, mid.slice(0, 2).join(' · ') || '', b];
};

// ── 3a · PR: the climb ──────────────────────────────────────────────────────

export function scene3a(d: ClimbData, o: SceneOpts): Scene {
  const ops: Op[] = [];
  const m = o.measure;
  const isPR = (d.badge ?? 'New PR') === 'New PR';
  cardFrame(ops, o, d.badge ?? 'New PR');
  const top = PAD + 18 + 22;
  ops.push(eyebrow(PAD, top, fitEyebrow(m, isPR ? `${d.lift} · best ${repWord(d.repMax)}` : `${d.lift} · today`, W - 2 * PAD), C.muted));
  const heroY = top + 12 + 6;
  hero(ops, m, PAD, heroY, d.repMax, 52, d.delta != null && d.delta !== 0 ? { s: signed(d.delta), color: C.accent, weight: 700, size: 15 } : undefined);

  const labY = heroY + 52 * LH + 22;
  ops.push({ t: 'text', x: PAD, y: labY, s: `${upper(d.chartLabel ?? 'Estimated max')} · ${upper(d.unit)}`, size: 9, weight: 700, color: C.muted, ls: 0.1 });
  ops.push({ t: 'text', x: W - PAD, y: labY, s: `${d.stats.weeks} WEEKS`, size: 9, weight: 700, color: C.muted, ls: 0.1, align: 'right' });

  const ct = labY + 20; // chart box top
  const ph = Math.max(140, H - PAD - 46 - 40 - ct); // plot height: fill down to the footer
  const gutter = 24;
  const x0 = PAD + gutter, x1 = W - PAD;
  const vals = d.series.map((p) => p.e1rm);
  const goal = d.goal?.value ?? Math.max(...vals);
  const y0 = Math.floor(Math.min(...vals) / 10) * 10 - 8;
  const top_ = Math.max(goal, Math.max(...vals));
  const yOf = (v: number) => ct + ph - ((v - y0) / (top_ - y0)) * (ph - 20);
  const t0 = ts(d.series[0].date), t1 = ts(d.series[d.series.length - 1].date);
  const xOf = (date: string) => (t1 === t0 ? (x0 + x1) / 2 : x0 + ((ts(date) - t0) / (t1 - t0)) * (x1 - x0));

  // Axis: baseline, mid gridline, goal line.
  ops.push({ t: 'line', x1: x0, y1: ct + 20 + (ph - 20) / 2, x2: x1, y2: ct + 20 + (ph - 20) / 2, color: C.surface, w: 1 });
  if (d.goal) {
    ops.push({ t: 'line', x1: x0, y1: ct + 20, x2: x1, y2: ct + 20, color: C.hair, w: 1, dash: [3, 3] });
    ops.push({ t: 'text', x: x0 + 2, y: ct + 20 - 13, s: d.goal.label, size: 9, weight: 600, color: C.muted });
  }
  ops.push({ t: 'line', x1: x0, y1: ct + ph, x2: x1, y2: ct + ph, color: C.ink, w: 1 });
  // Y labels in the gutter: the floor and the goal.
  ops.push({ t: 'text', x: x0 - 6, y: ct + ph - 6, s: fmt(y0), size: 9, weight: 400, color: C.faint, align: 'right', tnum: true });
  ops.push({ t: 'text', x: x0 - 6, y: yOf(top_) - 6, s: fmt(top_), size: 9, weight: 400, color: C.faint, align: 'right', tnum: true });

  const pts: Pt[] = d.series.map((p) => [xOf(p.date), yOf(p.e1rm)]);

  // Event marker (≤ 1): dashed line, label on a white backing, left of the line unless near the start.
  const ev = d.events.find((e) => ts(e.date) > t0 && ts(e.date) < t1);
  if (ev) {
    const ex = xOf(ev.date);
    ops.push({ t: 'line', x1: ex, y1: ct + 26, x2: ex, y2: ct + ph, color: C.ink, w: 1, dash: [2, 3] });
    const nameW = m(ev.label, 9, 700), subW = ev.sub ? m(ev.sub, 9, 400) : 0;
    const bw = Math.max(nameW, subW) + 6;
    const right = (ex - x0) / (x1 - x0) < 0.3;
    // Lift the label clear of the series near the marker.
    const seriesY = interpY(pts, ex);
    let ly = Math.min(ct + ph - 40, seriesY + 14);
    if (ly + 26 > ct + ph - 4) ly = Math.max(ct + 28, seriesY - 34);
    const lx = right ? ex + 5 : ex - 5 - bw;
    ops.push({ t: 'rect', x: lx, y: ly - 1, w: bw, h: ev.sub ? 25 : 13, fill: C.white });
    ops.push({ t: 'text', x: lx + 3, y: ly, s: ev.label, size: 9, weight: 700, color: C.ink });
    if (ev.sub) ops.push({ t: 'text', x: lx + 3, y: ly + 12, s: ev.sub, size: 9, weight: 400, color: C.muted });
  }

  // Series, start dot + label, crimson end dot + value.
  ops.push({ t: 'poly', pts, color: C.ink, w: 2.2 });
  ops.push({ t: 'circle', x: pts[0][0], y: pts[0][1], r: 1.5, fill: C.ink });
  ops.push({ t: 'text', x: pts[0][0], y: pts[0][1] + 6, s: fmt(vals[0]), size: 9, weight: 600, color: C.muted, align: 'left', tnum: true });
  const end = pts[pts.length - 1];
  ops.push({ t: 'circle', x: end[0], y: end[1], r: 2.5, fill: C.accent });
  const endS = fmt(vals[vals.length - 1]), endW = o.measure(endS, 11, 700);
  ops.push({ t: 'rect', x: end[0] - 6 - endW, y: end[1] - 18, w: endW + 4, h: 14, fill: C.white });
  ops.push({ t: 'text', x: end[0] - 4, y: end[1] - 18, s: endS, size: 11, weight: 700, color: C.accent, align: 'right', tnum: true });

  // X labels: start, middle, end.
  const [xa, xm, xb] = xLabels(d.series.map((p) => p.date));
  ops.push({ t: 'text', x: x0, y: ct + ph + 6, s: xa, size: 9, weight: 400, color: C.faint });
  if (xm) ops.push({ t: 'text', x: (x0 + x1) / 2, y: ct + ph + 6, s: xm, size: 9, weight: 400, color: C.faint, align: 'center' });
  ops.push({ t: 'text', x: x1, y: ct + ph + 6, s: xb, size: 9, weight: 400, color: C.faint, align: 'right' });

  const goalHit = d.goal ? Math.max(...vals) >= d.goal.value : false;
  footerStats(ops, [
    d.stats.gained > 0 || !d.chartLabel ? { v: signed(d.stats.gained), l: `${d.unit} on est. max` } : { v: fmt(Math.max(...vals)), l: (d.chartLabel ?? '').toLowerCase() },
    { v: d.stats.bw != null ? `${fmt(d.stats.bw, 1)}×` : '—', l: 'bodyweight' },
    !d.goal ? { v: `${d.series.length}`, l: 'sessions' } : goalHit ? { v: 'Goal hit', l: `goal ${fmt(d.goal.value)}` } : d.stats.weeksToGoal == null ? { v: fmt(d.goal.value), l: 'next milestone' } : { v: `${d.stats.weeksToGoal} wk`, l: `to ${fmt(d.goal.value)}` },
  ]);
  return { kind: '3a', ops, background: C.white, label: `${d.lift}, ${isPR ? `new best ${repWord(d.repMax)}` : 'top set'}, ${d.repMax.replace('×', ' by ')}, estimated max ${signed(d.stats.gained)} ${d.unit === 'lb' ? 'pounds' : 'kilograms'} over ${d.stats.weeks} weeks.` };
}

const repWord = (repMax: string) => {
  const r = Number(repMax.split('×')[1]);
  return r === 1 ? 'single' : r === 2 ? 'double' : r === 3 ? 'triple' : `${r}-rep set`;
};

/** y of a polyline at x (linear between neighbours). */
export function interpY(pts: Pt[], x: number): number {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) { const [ax, ay] = pts[i - 1], [bx, by] = pts[i]; return ay + ((x - ax) / (bx - ax || 1)) * (by - ay); }
  }
  return pts[pts.length - 1][1];
}

// ── 3b · Daily goal ─────────────────────────────────────────────────────────

const longDay = (date: string) => { const t = new Date(`${date}T12:00:00Z`); return `${WD[t.getUTCDay()]} ${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}`; };

export function scene3b(d: DayData, o: SceneOpts): Scene {
  const ops: Op[] = [];
  const m = o.measure;
  cardFrame(ops, o, 'Goal hit');
  const top = PAD + 18 + 22;
  ops.push(eyebrow(PAD, top, fitEyebrow(o.measure, `Protein · ${longDay(d.date)}`, W - 2 * PAD), C.muted));
  const heroY = top + 18;
  hero(ops, m, PAD, heroY, `${fmt(d.protein.total)} g`, 52, { s: `of ${fmt(d.protein.target)}`, color: C.muted, weight: 600, size: 15 });

  // Meal-by-meal bar.
  const bw = W - 2 * PAD;
  const fy = H - PAD - 34;
  const restY = fy - 28 - (22 + 3 * 24);
  const barY = Math.max(heroY + 52 * LH + 44, (heroY + 52 * LH + restY) / 2 - 12);
  const dom = Math.max(d.protein.total, d.protein.target) * 1.05;
  let x = PAD;
  const meals = d.protein.meals.filter((x) => x.g > 0);
  meals.forEach((meal, i) => {
    const w = (meal.g / dom) * bw;
    const last = i === meals.length - 1;
    ops.push({ t: 'rect', x, y: barY, w: Math.max(1, w - (last ? 0 : 1)), h: 22, fill: C.protein, opacity: last ? 1 : i % 2 ? 0.7 : 0.45 });
    const cx = x + w / 2;
    if (w >= 34) {
      ops.push({ t: 'text', x: cx, y: barY + 27, s: fit(m, meal.name, w - 4, 9, last ? 700 : 400), size: 9, weight: last ? 700 : 400, color: last ? C.ink : C.muted, align: 'center' });
      ops.push({ t: 'text', x: cx, y: barY + 38, s: `${fmt(meal.g)} g`, size: 9, weight: last ? 700 : 400, color: last ? C.ink : C.muted, align: 'center', tnum: true });
    } else {
      ops.push({ t: 'text', x: cx, y: barY + 27, s: `${fmt(meal.g)}`, size: 9, weight: last ? 700 : 400, color: last ? C.ink : C.muted, align: 'center', tnum: true });
    }
    x += w;
  });
  const tx = PAD + (d.protein.target / dom) * bw;
  ops.push({ t: 'line', x1: tx, y1: barY - 8, x2: tx, y2: barY + 30, color: C.ink, w: 1.5 });
  const tl = `${fmt(d.protein.target)} target`, tw = m(tl, 9, 700);
  ops.push({ t: 'text', x: Math.min(W - PAD - tw / 2, Math.max(PAD + tw / 2, tx)), y: barY - 8 - 13, s: tl, size: 9, weight: 700, color: C.ink, align: 'center', tnum: true });

  // The rest of the day, set just above the footer.
  let ry = restY;
  ops.push(eyebrow(PAD, ry, 'The rest of the day', C.muted));
  ry += 22;
  const rows: { l: string; v: { n: number; target: number }; color: string; tick?: boolean; unit: string }[] = [
    { l: 'Calories', v: d.calories, color: C.ink, tick: true, unit: '' },
    { l: 'Carbs', v: d.carbs, color: C.carbs, unit: ' g' },
    { l: 'Fat', v: d.fat, color: C.fat, unit: ' g' },
  ];
  for (const r of rows) {
    const bx = PAD + 62, bwid = W - PAD - 72 - bx - 8;
    ops.push({ t: 'text', x: PAD, y: ry, s: r.l, size: 11, weight: 600, color: C.ink });
    ops.push({ t: 'rect', x: bx, y: ry + 4, w: bwid, h: 6, fill: C.surface, r: 3 });
    const frac = r.v.target > 0 ? Math.min(1.15, r.v.n / r.v.target) / 1.15 : 0;
    ops.push({ t: 'rect', x: bx, y: ry + 4, w: Math.max(2, frac * bwid), h: 6, fill: r.color, r: 3 });
    if (r.tick) { const tk = bx + (1 / 1.15) * bwid; ops.push({ t: 'line', x1: tk, y1: ry + 1, x2: tk, y2: ry + 13, color: C.ink, w: 1.5 }); }
    ops.push({ t: 'text', x: W - PAD, y: ry, s: `${fmt(r.v.n)} / ${fmt(r.v.target)}${r.unit}`, size: 11, weight: 600, color: C.ink, align: 'right', tnum: true });
    ry += 24;
  }

  // Footer: week squares + "4 of 5 days this week".
  ops.push({ t: 'line', x1: PAD, y1: fy, x2: W - PAD, y2: fy, color: C.ink, w: 1 });
  d.week.forEach((hit, i) => {
    const sx = PAD + i * 20, sy = fy + 14;
    const today = i === d.todayIndex;
    if (today) ops.push({ t: 'rect', x: sx - 3.5, y: sy - 3.5, w: 23, h: 23, stroke: C.accent, sw: 1.5, r: 6.5 });
    ops.push({ t: 'rect', x: sx, y: sy, w: 16, h: 16, fill: hit ? C.protein : C.hair, r: 4 });
  });
  const hits = d.week.filter(Boolean).length, sofar = Math.min(d.week.length, d.todayIndex + 1);
  ops.push({ t: 'text', x: W - PAD, y: fy + 16, s: `${hits} of ${sofar} ${sofar === 1 ? 'day' : 'days'} this week`, size: 11, weight: 600, color: C.ink, align: 'right' });
  return { kind: '3b', ops, background: C.white, label: `Protein goal hit, ${fmt(d.protein.total)} grams of ${fmt(d.protein.target)} on ${longDay(d.date)}, ${hits} of ${sofar} ${sofar === 1 ? 'day' : 'days'} this week.` };
}

// ── 3d · Cut: fat down, strength kept ───────────────────────────────────────

export function scene3d(d: CutData, o: SceneOpts): Scene {
  const ops: Op[] = [];
  cardFrame(ops, o, `${d.weeks} weeks in`);
  const top = PAD + 18 + 22;
  ops.push(eyebrow(PAD, top, fitEyebrow(o.measure, `Change since ${d.since} · 7-day average`, W - 2 * PAD), C.muted));
  const heroY = top + 18;
  hero(ops, o.measure, PAD, heroY, `${signed(d.change, 1)} ${d.unit}`, 52);

  const ct = heroY + 52 * LH + 26;
  const gutter = 26;
  const nLifts = Math.min(3, d.lifts.length);
  const x0 = PAD + gutter, x1 = W - PAD, ph = Math.max(110, H - PAD - 30 - 18 - (nLifts ? 52 + nLifts * 24 : 10) - 20 - ct);
  const minDelta = Math.min(0, ...d.series.map((p) => p.delta));
  const bottom = Math.min(Math.floor(-(d.weeks - 1) * d.safe.max), Math.floor(minDelta) - 1);
  const yOf = (v: number) => ct + (v / bottom) * ph;
  const xOf = (week: number) => x0 + ((week - 1) / Math.max(1, d.weeks - 1)) * (x1 - x0);

  // Safe band between −min·t and −max·t, clipped to the plot.
  const band: Pt[] = [];
  for (let w = 1; w <= d.weeks; w++) band.push([xOf(w), yOf(Math.max(bottom, -d.safe.min * (w - 1)))]);
  for (let w = d.weeks; w >= 1; w--) band.push([xOf(w), yOf(Math.max(bottom, -d.safe.max * (w - 1)))]);
  ops.push({ t: 'poly', pts: band, fill: C.surface, closed: true });
  ops.push({ t: 'line', x1: x0, y1: ct, x2: x1, y2: ct, color: C.hair, w: 1 });
  ops.push({ t: 'line', x1: x0, y1: ct + ph, x2: x1, y2: ct + ph, color: C.hair, w: 1 });
  const mid = Math.round(bottom / 2);
  for (const v of [0, mid, bottom]) ops.push({ t: 'text', x: x0 - 6, y: yOf(v) - 6, s: v === 0 ? '0' : signed(v), size: 9, weight: 400, color: C.faint, align: 'right', tnum: true });

  const pts: Pt[] = d.series.map((p) => [xOf(p.week), yOf(p.delta)]);
  // Safe-range label: inside the band's widest part (bottom right), clear of the series.
  const label = `safe range · ${fmt(d.safe.min, 1)}–${fmt(d.safe.max, 1)} ${d.unit}/wk`;
  const lw = o.measure(label, 9, 400) + 8;
  // Right-aligned, just under the series where the band is widest; above it if there's no room below.
  const lx = x1 - lw - 4;
  let lowest = -Infinity, highest = Infinity;
  for (let x = lx - 4; x <= lx + lw + 4; x += 2) { const sy = interpY(pts, x); lowest = Math.max(lowest, sy); highest = Math.min(highest, sy); }
  const lp = { x: lx, y: lowest + 8 + 13 <= ct + ph - 2 ? lowest + 8 : highest - 8 - 13 };
  ops.push({ t: 'rect', x: lp.x, y: lp.y, w: lw, h: 13, fill: C.surface });
  ops.push({ t: 'text', x: lp.x + 4, y: lp.y + 1, s: label, size: 9, weight: 400, color: C.muted });

  ops.push({ t: 'poly', pts, color: C.ink, w: 2.2 });
  const end = pts[pts.length - 1];
  ops.push({ t: 'circle', x: end[0], y: end[1], r: 2.5, fill: C.accent });
  ops.push({ t: 'text', x: x0, y: ct + ph + 6, s: 'wk 1', size: 9, weight: 400, color: C.faint });
  ops.push({ t: 'text', x: x1, y: ct + ph + 6, s: `wk ${d.weeks}`, size: 9, weight: 400, color: C.faint, align: 'right' });

  // Strength over the same weeks (only when there are lifts to show).
  let ry = ct + ph + 32;
  if (nLifts) ops.push(eyebrow(PAD, ry, `Strength over the same ${d.weeks} weeks`, C.muted));
  ry += 20;
  d.lifts.slice(0, 3).forEach((l, i) => {
    if (i) ops.push({ t: 'line', x1: PAD, y1: ry - 5, x2: W - PAD, y2: ry - 5, color: C.surface, w: 1 });
    const nowX = W - PAD, arrowX = nowX - 46 - 4, startX = arrowX - 14;
    ops.push({ t: 'text', x: PAD, y: ry, s: fit(o.measure, l.name, startX - o.measure(fmt(l.start), 12, 400) - 10 - PAD, 12, 600), size: 12, weight: 600, color: C.ink });
    ops.push({ t: 'text', x: startX, y: ry, s: fmt(l.start), size: 12, weight: 400, color: C.muted, align: 'right', tnum: true });
    ops.push({ t: 'text', x: arrowX - 2, y: ry, s: '→', size: 12, weight: 400, color: C.faint, align: 'right' });
    ops.push({ t: 'text', x: nowX, y: ry, s: fmt(l.now), size: 12, weight: 700, color: C.ink, align: 'right', tnum: true });
    ry += 24;
  });

  const fy = H - PAD - 20;
  ops.push({ t: 'line', x1: PAD, y1: fy - 10, x2: W - PAD, y2: fy - 10, color: C.ink, w: 1 });
  const held = d.lifts.length > 0 && d.lifts.every((l) => l.now >= l.start * 0.97);
  const rate = -d.change / Math.max(1, d.weeks - 1);
  const steady = rate >= d.safe.min * 0.9 && rate <= d.safe.max * 1.1 ? 'Steady, inside the safe range.' : 'Steady and patient.';
  const foot = held ? 'The loss is fat, not muscle.' : nLifts ? 'Strength mostly held.' : steady;
  ops.push({ t: 'text', x: PAD, y: fy, s: foot, size: 11, weight: 600, color: C.ink });
  ops.push({ t: 'text', x: W - PAD, y: fy, s: 'Weight hidden', size: 11, weight: 400, color: C.muted, align: 'right' });
  return { kind: '3d', ops, background: C.white, label: `${d.weeks} weeks in, 7-day average ${signed(d.change, 1)} ${d.unit === 'lb' ? 'pounds' : 'kilograms'}, ${held ? 'strength kept' : nLifts ? 'strength mostly held' : 'steady'}.` };
}

// ── Overlays ────────────────────────────────────────────────────────────────

function overlayBase(ops: Op[], o: SceneOpts) {
  const photo = o.withPhoto !== false;
  if (photo) ops.push({ t: 'image', id: 'photo', x: 0, y: 0, w: W, h: H });
  const white = (o.ink ?? 'white') === 'white';
  const ink = white ? C.white : C.ink;
  /** Soft fade behind a text block — only over a photo (an overlay saved alone stays clean). */
  // Reaches full strength 45% of the way in and holds there (or holds, then fades, for a top scrim).
  const scrim = (y0: number, y1: number, a0: number, a1: number) => {
    if (!photo) return;
    const k = white ? 1 : 0.9;
    const stops: [number, number][] = a1 >= a0 ? [[0, a0 * k], [0.45, a1 * k], [1, a1 * k]] : [[0, a0 * k], [0.55, a0 * k], [1, a1 * k]];
    ops.push({ t: 'scrim', y0, y1, color: white ? '#000000' : '#ffffff', stops });
  };
  return { ink, sh: white, hair: white ? 'rgba(255,255,255,0.35)' : 'rgba(9,9,11,0.35)', mark: (white ? 'white' : 'dark') as 'white' | 'dark', scrim };
}

/** 3e · PR lower third. */
export function scene3e(d: ClimbData, o: SceneOpts): Scene {
  const ops: Op[] = [];
  const { ink, sh, hair, mark, scrim } = overlayBase(ops, o);
  scrim(H * 0.45, H, 0, 0.55);
  const L = SAFE.side, R = W - SAFE.side;
  // Built bottom-up from the safe bottom edge.
  const footY = H - SAFE.bottom - 14;
  ops.push({ t: 'line', x1: L, y1: footY - 8, x2: R, y2: footY - 8, color: hair, w: 1 });
  ops.push({ t: 'image', id: 'mark', x: L, y: footY, w: 14, h: 14, ink: mark });
  ops.push({ t: 'text', x: L + 19, y: footY + 1, s: 'Axiom', size: 11, weight: 600, color: ink, shadow: sh });
  if (d.goal && d.stats.weeksToGoal != null) ops.push({ t: 'text', x: R, y: footY + 1, s: `${d.stats.weeksToGoal} weeks to ${fmt(d.goal.value)}`, size: 11, weight: 400, color: ink, opacity: 0.75, align: 'right', shadow: sh });

  const xl = footY - 8 - 18;
  const dates = d.series.map((p) => p.date);
  ops.push({ t: 'text', x: L, y: xl, s: month(dates[0]), size: 9, weight: 600, color: ink, opacity: 0.8, shadow: sh });
  ops.push({ t: 'text', x: (L + R) / 2, y: xl, s: `${d.stats.weeks} weeks`, size: 9, weight: 600, color: ink, opacity: 0.8, align: 'center', shadow: sh });
  ops.push({ t: 'text', x: R, y: xl, s: month(dates[dates.length - 1]), size: 9, weight: 600, color: ink, opacity: 0.8, align: 'right', shadow: sh });

  // Mini chart 260 × 44 (clamped to the safe width).
  const cb = xl - 6, ch = 44, ct = cb - ch;
  const vals = d.series.map((p) => p.e1rm);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const t0 = ts(dates[0]), t1 = ts(dates[dates.length - 1]);
  const pts: Pt[] = d.series.map((p) => [L + ((ts(p.date) - t0) / Math.max(1, t1 - t0)) * (R - L), ct + 12 + (1 - (p.e1rm - lo) / Math.max(1, hi - lo)) * (ch - 14)]);
  ops.push({ t: 'line', x1: L, y1: cb, x2: R, y2: cb, color: ink, w: 1, opacity: 0.6, shadow: sh });
  ops.push({ t: 'poly', pts, color: ink, w: 2, shadow: sh });
  const end = pts[pts.length - 1];
  ops.push({ t: 'circle', x: end[0], y: end[1], r: 2.25, fill: C.accent, shadow: sh });
  ops.push({ t: 'text', x: pts[0][0], y: pts[0][1] - 13, s: fmt(vals[0]), size: 9, weight: 700, color: ink, shadow: sh, tnum: true });
  ops.push({ t: 'text', x: R, y: Math.min(end[1], ct + 12) - 15, s: `${fmt(vals[vals.length - 1])} ${(d.chartLabel ?? 'est. max').toLowerCase()}`, size: 10, weight: 700, color: ink, align: 'right', shadow: sh, tnum: true });

  // Hero row and eyebrow above the chart.
  const heroY = ct - 20 - 56 * LH + 10;
  ops.push({ t: 'text', x: L, y: heroY, s: d.repMax, size: 56, weight: 700, color: ink, ls: -0.045, shadow: sh, tnum: true });
  if (d.delta) ops.push({ t: 'text', x: L + o.measure(d.repMax, 56, 700, -0.045) + 8, y: heroY + 56 * 0.98 - 15 * 1.05, s: `${signed(d.delta)} ${d.unit}`, size: 15, weight: 700, color: ink, shadow: sh, tnum: true });
  const eyY = heroY - 18;
  ops.push({ t: 'circle', x: L + 3, y: eyY + 6, r: 3, fill: C.accent, shadow: sh });
  ops.push(eyebrow(L + 11, eyY, fitEyebrow(o.measure, `${d.lift} · ${d.badge ?? 'New PR'}`, R - L - 11), ink, 'left', { shadow: sh } as any));
  return { kind: '3e', ops, background: null, label: `${d.lift}, ${(d.badge ?? 'New PR') === 'New PR' ? 'new best' : 'top set'}, ${d.repMax.replace('×', ' by ')}.` };
}

/** 3f · Today's label (nutrition-facts style). */
export function scene3f(d: DayData, o: SceneOpts): Scene {
  const ops: Op[] = [];
  const { ink, sh, mark, scrim } = overlayBase(ops, o);
  scrim(H * 0.38, H, 0, 0.55);
  const bw = 176, R = W - SAFE.side, L = R - bw;
  const rows: { l: string; n: number; t: number; dot?: boolean }[] = [
    { l: 'Protein', n: d.protein.total, t: d.protein.target, dot: true },
    { l: 'Carbs', n: d.carbs.n, t: d.carbs.target },
    { l: 'Fat', n: d.fat.n, t: d.fat.target },
    ...(d.fiber ? [{ l: 'Fiber', n: d.fiber.n, t: d.fiber.target }] : []),
  ];
  const height = 26 + 14 + 10 + 30 + rows.length * 20 + 8 + 28 + 18;
  let y = H - SAFE.bottom - height;
  let ts_ = 20;
  while (ts_ > 14 && o.measure("Today's numbers", ts_, 800) > bw) ts_ -= 0.5;
  ops.push({ t: 'text', x: L, y: y + (20 - ts_), s: "Today's numbers", size: ts_, weight: 800, color: ink, shadow: sh });
  y += 26;
  ops.push({ t: 'text', x: L, y, s: longDay(d.date), size: 9, weight: 600, color: ink, opacity: 0.8, shadow: sh });
  y += 14;
  ops.push({ t: 'rect', x: L, y, w: bw, h: 7, fill: ink });
  y += 10;
  ops.push({ t: 'text', x: L, y: y + 5, s: 'Calories', size: 14, weight: 800, color: ink, shadow: sh });
  ops.push({ t: 'text', x: R, y, s: fmt(d.calories.n), size: 20, weight: 800, color: ink, align: 'right', shadow: sh, tnum: true });
  y += 27;
  ops.push({ t: 'rect', x: L, y, w: bw, h: 3, fill: ink });
  y += 6;
  rows.forEach((r, i) => {
    const pctS = r.t > 0 ? `${Math.round((r.n / r.t) * 100)}%` : '—';
    let x = L;
    if (r.dot) { ops.push({ t: 'circle', x: L + 3, y: y + 7, r: 3, fill: C.accent, shadow: sh }); x += 10; }
    ops.push({ t: 'text', x, y, s: `${r.l} ${fmt(r.n)} g`, size: 11, weight: r.dot ? 700 : 400, color: ink, shadow: sh, tnum: true });
    ops.push({ t: 'text', x: R, y, s: pctS, size: 11, weight: r.dot ? 700 : 400, color: ink, align: 'right', shadow: sh, tnum: true });
    y += 16;
    ops.push({ t: 'rect', x: L, y, w: bw, h: i === rows.length - 1 ? 3 : 1, fill: ink });
    y += 4;
  });
  y += 6;
  const hits = d.week.filter(Boolean).length, sofar = Math.min(d.week.length, d.todayIndex + 1);
  const long = `Protein goal hit · ${hits} of ${sofar} ${sofar === 1 ? 'day' : 'days'} this week.`;
  ops.push({ t: 'text', x: L, y, s: o.measure(long, 9, 400) <= bw ? long : `Goal hit ${hits} of ${sofar} days.`, size: 9, weight: 400, color: ink, opacity: 0.85, shadow: sh });
  y += 22;
  ops.push({ t: 'image', id: 'mark', x: L, y, w: 12, h: 12, ink: mark });
  ops.push({ t: 'text', x: L + 16, y: y, s: 'Axiom', size: 10, weight: 600, color: ink, shadow: sh });
  return { kind: '3f', ops, background: null, label: `Today's numbers, ${fmt(d.calories.n)} calories, protein ${fmt(d.protein.total)} grams, goal hit.` };
}

/** 3g · Session breakdown. */
export function scene3g(d: SessionData, o: SceneOpts): Scene {
  const ops: Op[] = [];
  const { ink, sh, hair, mark, scrim } = overlayBase(ops, o);
  scrim(0, SAFE.top + 120, 0.5, 0);
  scrim(H - SAFE.bottom - Math.min(4, d.lifts.length) * 26 - 90, H, 0, 0.55);
  const L = SAFE.side, R = W - SAFE.side;
  const top = SAFE.top;
  ops.push(eyebrow(L, top, fitEyebrow(o.measure, `${d.name}${d.minutes ? ` · ${d.minutes} min` : ''}`, R - 12 - o.measure('Axiom', 10, 600) - 4 - 10 - L), ink, 'left', { shadow: sh } as any));
  ops.push({ t: 'image', id: 'mark', x: R - 12 - o.measure('Axiom', 10, 600) - 4, y: top - 1, w: 12, h: 12, ink: mark });
  ops.push({ t: 'text', x: R, y: top - 1, s: 'Axiom', size: 10, weight: 600, color: ink, align: 'right', shadow: sh });
  const vol = fmt(d.volume);
  ops.push({ t: 'text', x: L, y: top + 18, s: vol, size: 34, weight: 700, color: ink, ls: -0.02, shadow: sh, tnum: true });
  ops.push({ t: 'text', x: L + o.measure(vol, 34, 700, -0.02) + 6, y: top + 18 + 34 * 0.98 - 11 * 1.1, s: d.volumeUnit ?? `${d.unit} moved`, size: 11, weight: 600, color: ink, opacity: 0.85, shadow: sh });

  const lifts = d.lifts.slice(0, 4);
  const maxShare = Math.max(0.0001, ...lifts.map((l) => l.share));
  const rowH = 26;
  let y = H - SAFE.bottom - (lifts.length * rowH + 18);
  ops.push({ t: 'text', x: R - 92 - 8, y, s: 'Top set', size: 9, weight: 600, color: ink, opacity: 0.8, align: 'right', shadow: sh });
  ops.push({ t: 'text', x: R, y, s: 'Volume share', size: 9, weight: 600, color: ink, opacity: 0.8, align: 'right', shadow: sh });
  y += 16;
  ops.push({ t: 'line', x1: L, y1: y, x2: R, y2: y, color: hair, w: 1 });
  for (const l of lifts) {
    const ty = y + 7;
    let nx = L;
    if (l.isPR) { ops.push({ t: 'circle', x: L + 3, y: ty + 7, r: 3, fill: C.accent, shadow: sh }); nx += 10; }
    // The name gets what the top-set column leaves, less a gap — never runs into it.
    const w = l.isPR ? 700 : 500;
    const topLeft = R - 92 - 8 - o.measure(l.top, 12, w);
    ops.push({ t: 'text', x: nx, y: ty, s: fit(o.measure, l.name, topLeft - 10 - nx, 12, w), size: 12, weight: w, color: ink, shadow: sh });
    ops.push({ t: 'text', x: R - 92 - 8, y: ty, s: l.top, size: 12, weight: l.isPR ? 700 : 500, color: ink, align: 'right', shadow: sh, tnum: true });
    const bx = R - 92;
    ops.push({ t: 'rect', x: bx, y: ty + 5, w: 92, h: 5, fill: hair, r: 2.5 });
    ops.push({ t: 'rect', x: bx, y: ty + 5, w: Math.max(3, (l.share / maxShare) * 92), h: 5, fill: ink, r: 2.5 });
    y += rowH;
    ops.push({ t: 'line', x1: L, y1: y, x2: R, y2: y, color: hair, w: 1 });
  }
  return { kind: '3g', ops, background: null, label: `${d.name}${d.minutes ? `, ${d.minutes} minutes` : ''}, ${vol} ${d.volumeUnit ?? `${d.unit === 'lb' ? 'pounds' : 'kilograms'} moved`}.` };
}

/** 2f · The line, across the photo. */
export function scene2f(d: LineData, o: SceneOpts): Scene {
  const ops: Op[] = [];
  const { ink, sh, mark, scrim } = overlayBase(ops, o);
  scrim(0, SAFE.top + 110, 0.45, 0);
  scrim(H * 0.55, H, 0, 0.5);
  const L = SAFE.side, R = W - SAFE.side;
  const vals = d.series.map((p) => p.e1rm);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const t0 = ts(d.series[0].date), t1 = ts(d.series[d.series.length - 1].date);
  const pts: Pt[] = d.series.map((p) => [L + ((ts(p.date) - t0) / Math.max(1, t1 - t0)) * (R - L), 400 - ((p.e1rm - lo) / Math.max(1, hi - lo)) * 170]);
  ops.push({ t: 'poly', pts, color: ink, w: 2, shadow: sh });
  pts.slice(0, -1).forEach(([x, y]) => ops.push({ t: 'circle', x, y, r: 1.25, fill: ink, shadow: sh }));
  const end = pts[pts.length - 1];
  ops.push({ t: 'circle', x: end[0], y: end[1], r: 3, fill: C.accent, stroke: C.ink, sw: 1.5, shadow: sh });
  ops.push({ t: 'text', x: R, y: SAFE.top, s: fmt(d.now), size: 34, weight: 700, color: ink, ls: -0.03, align: 'right', shadow: sh, tnum: true });
  ops.push({ t: 'text', x: R, y: SAFE.top + 42, s: `${upper(d.label ?? 'Est. max')} · ${upper(d.unit)}`, size: 10, weight: 700, color: ink, ls: 0.16, align: 'right', shadow: sh });
  ops.push({ t: 'text', x: L, y: pts[0][1] + 16, s: `${upper(d.start.label)} · ${fmt(d.start.value)}`, size: 10, weight: 700, color: ink, ls: 0.16, shadow: sh, tnum: true });
  const fy = H - SAFE.bottom - 16;
  ops.push({ t: 'image', id: 'mark', x: L, y: fy, w: 16, h: 16, ink: mark });
  ops.push({ t: 'text', x: L + 21, y: fy + 1, s: fit(o.measure, `${d.lift} · ${d.weeks} weeks`, R - L - 21, 12, 600), size: 12, weight: 600, color: ink, shadow: sh });
  return { kind: '2f', ops, background: null, label: `${d.lift}, estimated max ${fmt(d.now)} ${d.unit === 'lb' ? 'pounds' : 'kilograms'}, up from ${fmt(d.start.value)} over ${d.weeks} weeks.` };
}

export function sceneFor(s: ShareableData, o: SceneOpts): Scene {
  switch (s.kind) {
    case '3a': return scene3a(s.data, o);
    case '3e': return scene3e(s.data, o);
    case '3b': return scene3b(s.data, o);
    case '3f': return scene3f(s.data, o);
    case '3d': return scene3d(s.data, o);
    case '3g': return scene3g(s.data, o);
    case '2f': return scene2f(s.data, o);
  }
}

/** A rough measure for tests and layout checks without a font engine (Inter averages ~0.56 em). */
export const approxMeasure: Measure = (s, size, weight, ls = 0) => s.length * size * (weight >= 700 ? 0.6 : 0.56) + Math.max(0, s.length - 1) * ls * size;
