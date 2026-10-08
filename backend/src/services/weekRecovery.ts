// Recovery in a program's week (founder feedback, Oct 2026: a 6-day program
// put six upper-body sessions back to back). Programs used to place their
// training days on consecutive days from the start date, so a 4-day week ran
// Mon–Thu with nothing between sessions. Here a phase's days are spread
// through the week (weekSlots) and ordered so the same muscles aren't trained
// on consecutive days. What ordering can't fix is reported, so the writer can
// change the split instead. Pure, so it's tested.

import { canonicalizeStrict } from './exerciseCanonical.js';

const LOWER = new Set(['quads', 'hamstrings', 'glutes', 'calves', 'adductors', 'abductors']);
const GUESS: [RegExp, string][] = [
  [/squat|leg press|lunge|leg extension|step[- ]?up|hack/i, 'quads'],
  [/deadlift|rdl|romanian|leg curl|hamstring|good morning|nordic/i, 'hamstrings'],
  [/hip thrust|glute|bridge|abduct/i, 'glutes'],
  [/calf/i, 'calves'],
  [/bench|chest|fly|flye|push[- ]?up|dip|pec/i, 'chest'],
  [/row|pull[- ]?up|chin[- ]?up|pulldown|lat\b|shrug/i, 'back'],
  [/overhead press|ohp|shoulder|lateral raise|rear delt|face pull|arnold/i, 'shoulders'],
  [/curl/i, 'biceps'],
  [/tricep|pushdown|skull|extension/i, 'triceps'],
  [/plank|crunch|ab\b|abs|core|carry|pallof|leg raise/i, 'abs'],
];

const muscleOf = (name: string) => canonicalizeStrict(name)?.primaryMuscle ?? GUESS.find(([re]) => re.test(name))?.[1] ?? 'other';
const setsOf = (e: any) => Math.max(1, Math.min(10, Number(e?.sets) || 3));

/** Hard sets per primary muscle for a day (core and unknowns don't drive recovery). */
export function muscleSets(day: any): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of day?.exercises ?? []) {
    const k = muscleOf(String(e?.name ?? e?.exercise ?? ''));
    if (k === 'abs' || k === 'other') continue;
    m.set(k, (m.get(k) ?? 0) + setsOf(e));
  }
  return m;
}

/** Share of the smaller day's work that hits the same muscles as the other (0–1). */
export function overlap(a: Map<string, number>, b: Map<string, number>): number {
  let shared = 0;
  for (const [k, v] of a) shared += Math.min(v, b.get(k) ?? 0);
  const ta = [...a.values()].reduce((x, y) => x + y, 0), tb = [...b.values()].reduce((x, y) => x + y, 0);
  return ta && tb ? shared / Math.min(ta, tb) : 0;
}

export type Region = 'upper' | 'lower' | 'full' | 'none';
export function regionOf(m: Map<string, number>): Region {
  let lo = 0, up = 0;
  for (const [k, v] of m) (LOWER.has(k) ? (lo += v) : (up += v));
  if (!lo && !up) return 'none';
  const share = lo / (lo + up);
  return share >= 0.65 ? 'lower' : share <= 0.35 ? 'upper' : 'full';
}

/** Which days of the week train, spread so sessions get rest between them. */
export function spreadSlots(n: number): number[] {
  const SPREAD: Record<number, number[]> = { 1: [0], 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 4, 5], 6: [0, 1, 2, 3, 4, 5], 7: [0, 1, 2, 3, 4, 5, 6] };
  return SPREAD[Math.max(1, Math.min(7, Math.round(n)))] ?? [0];
}

/** Pairs of slot positions that fall on consecutive days (including Sunday → next Monday). */
function adjacent(slots: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < slots.length; i++) for (let j = 0; j < slots.length; j++) {
    if (i !== j && (slots[j] - slots[i] === 1 || (slots[i] === 6 && slots[j] === 0))) out.push([i, j]);
  }
  return out;
}

export interface Conflict { kind: 'same_muscles' | 'region_streak' | 'no_rest'; days: string[]; detail: string }

/** Problems with a week in a given order. */
export function weekConflicts(days: any[], slots: number[]): Conflict[] {
  const m = days.map(muscleSets);
  const name = (i: number) => String(days[i]?.day ?? `Day ${i + 1}`);
  const out: Conflict[] = [];
  for (const [i, j] of adjacent(slots)) {
    const o = overlap(m[i], m[j]);
    if (o > 0.5) out.push({ kind: 'same_muscles', days: [name(i), name(j)], detail: `${name(i)} and ${name(j)} train the same muscles on consecutive days` });
  }
  // Three consecutive training days on the same region (full body counts for both).
  const reg = m.map(regionOf);
  for (const R of ['upper', 'lower'] as const) {
    const on = slots.map((_, i) => reg[i] === R || reg[i] === 'full');
    const bySlot = new Map(slots.map((s, i) => [s, i]));
    for (const s of slots) {
      const a = bySlot.get(s)!, b = bySlot.get((s + 1) % 7), c = bySlot.get((s + 2) % 7);
      if (b != null && c != null && on[a] && on[b] && on[c]) { out.push({ kind: 'region_streak', days: [name(a), name(b), name(c)], detail: `${R} body three days running (${name(a)}, ${name(b)}, ${name(c)})` }); break; }
    }
  }
  if (slots.length >= 7) out.push({ kind: 'no_rest', days: [], detail: 'no rest day in the week' });
  return out;
}

function permutations(n: number): number[][] {
  if (n <= 1) return [[0].slice(0, n)];
  const out: number[][] = [];
  const rec = (cur: number[], left: number[]) => { if (!left.length) { out.push(cur); return; } for (const x of left) rec([...cur, x], left.filter((y) => y !== x)); };
  rec([], [...Array(n).keys()]);
  return out;
}

/** Every way to place n training days in a week, starting on day 0, the default spread first. */
export function slotLayouts(n: number): number[][] {
  const k = Math.max(1, Math.min(7, Math.round(n)));
  const out: number[][] = [spreadSlots(k)];
  const rec = (start: number, cur: number[]) => {
    if (cur.length === k) { if (cur.join() !== out[0].join()) out.push(cur); return; }
    for (let d = start; d < 7; d++) rec(d + 1, [...cur, d]);
  };
  rec(1, [0]);
  return out;
}

/**
 * The placement and order of a phase's days that recovers best: which days of
 * the week train (four upper-body-only days go every other day; upper/lower
 * pairs can sit back to back) and in what order. Ties keep the default spread
 * and the written order.
 */
export function bestOrder(days: any[]): { order: number[]; slots: number[]; conflicts: Conflict[] } {
  const m = days.map(muscleSets);
  const perms = permutations(days.length);
  let best: { order: number[]; slots: number[]; score: number } | null = null;
  for (const slots of slotLayouts(days.length)) {
    const pairs = adjacent(slots);
    for (const order of perms) {
      let score = 0;
      for (const [i, j] of pairs) score += overlap(m[order[i]], m[order[j]]);
      score += weekConflicts(order.map((k) => days[k]), slots).length * 2;
      if (!best || score < best.score - 1e-9) best = { order, slots, score };
    }
  }
  const order = best?.order ?? days.map((_, i) => i);
  const slots = best?.slots ?? spreadSlots(days.length);
  return { order, slots, conflicts: weekConflicts(order.map((k) => days[k]), slots) };
}

/**
 * Spread and order every phase's week (sets phase.weekSlots and reorders its
 * trainingDays). Phases that already have weekSlots are left alone. Returns
 * what still breaks recovery, by phase, for the writer to fix.
 */
export function applyWeekRecovery(program: any): { program: any; problems: string[] } {
  const problems: string[] = [];
  for (const ph of program?.phases ?? []) {
    const days: any[] = ph?.trainingDays ?? [];
    if (!days.length || Array.isArray(ph.weekSlots) || days.some((d) => Array.isArray(d?.exercises) && d.exercises.length === 0)) continue;
    const { order, slots, conflicts } = bestOrder(days);
    ph.trainingDays = order.map((k) => days[k]);
    ph.weekSlots = slots;
    for (const c of conflicts) problems.push(`${ph.phaseName ?? 'A phase'}: ${c.detail}`);
  }
  return { program, problems: [...new Set(problems)] };
}

/** After a day is added or removed: keep the week spread (the order is the user's). */
export function respreadSlots(phase: any) {
  const n = (phase?.trainingDays ?? []).length;
  if (Array.isArray(phase?.weekSlots) && phase.weekSlots.length !== n) phase.weekSlots = spreadSlots(n);
}
