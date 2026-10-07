// Backfilling history: many past workouts at once, from whatever the user
// kept (notes, a spreadsheet, a description) or from sessions the agent has
// already structured. Two steps so nothing lands unseen:
//
//   preview  — read + check: what will be logged, what has no date, what is
//              already in the log. Stored under a previewId for 30 minutes.
//   confirm  — log the preview's sessions in one batch (createWorkoutLogsBulk).
//
// A session already in the log (same day, same exercises) is never logged
// twice — not by a second confirm, not by a tap on the card after a "yes" in
// chat, not after a restart that lost the preview store.

import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { WorkoutLogInput } from './workoutLogService.js';
import type { BatchBlock, BatchSession } from '../agent/cards/types.js';

const prisma = new PrismaClient();

// Long enough for "not now" → "ok, log them" later the same day, or "skip the
// week of 27 Jul" → a re-preview, without re-reading the notes.
export const PREVIEW_TTL_MS = 24 * 60 * 60_000;
/** Up to this many sessions the card lists them; more and it groups by week. */
export const LIST_MAX = 12;

export interface BackfillPreview {
  previewId: string;
  ready: WorkoutLogInput[];
  /** Sessions with no readable date: a row the user can date on the card, or the agent asks. */
  undated: { title: string | null; exercises: WorkoutLogInput['exercises'] }[];
  /** Sessions already in the log; left out. */
  duplicates: { date: string; title: string | null }[];
  /** Dated after today; left out. */
  future: { date: string; title: string | null }[];
  unparsed: string[];
}

/** A session's identity for duplicate checks: its day and its exercise names. */
export function sessionSignature(date: string, exerciseNames: string[]): string {
  const names = exerciseNames.map((n) => n.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()).filter(Boolean).sort();
  return `${date}|${names.join(',')}`;
}

/** Signatures of what is already logged between two days. */
export async function loggedSignatures(userId: string, from: string, to: string): Promise<Set<string>> {
  const rows = await prisma.workoutLog.findMany({ where: { userId, date: { gte: from, lte: to } }, select: { date: true, exercises: true } });
  const out = new Set<string>();
  for (const r of rows) {
    let exs: any[] = [];
    try { exs = JSON.parse(r.exercises); } catch { /* skip */ }
    if (Array.isArray(exs)) out.add(sessionSignature(r.date, exs.map((e) => String(e?.name ?? ''))));
  }
  return out;
}

/** Drop sessions that are already logged, and repeats within the batch itself. */
export async function withoutLogged(userId: string, inputs: WorkoutLogInput[]): Promise<{ fresh: WorkoutLogInput[]; dupes: WorkoutLogInput[] }> {
  if (!inputs.length) return { fresh: [], dupes: [] };
  const dates = inputs.map((i) => i.date).sort();
  const seen = await loggedSignatures(userId, dates[0], dates[dates.length - 1]);
  const fresh: WorkoutLogInput[] = [];
  const dupes: WorkoutLogInput[] = [];
  for (const i of inputs) {
    const sig = sessionSignature(i.date, i.exercises.map((e) => e.name));
    if (seen.has(sig)) dupes.push(i);
    else { seen.add(sig); fresh.push(i); }
  }
  return { fresh, dupes };
}

/**
 * Split candidate sessions into what will be logged and what won't, and store
 * the result. `candidates` carry a date (or null) and service-shaped
 * exercises.
 */
export async function buildPreview(
  userId: string,
  candidates: { date: string | null; title: string | null; exercises: WorkoutLogInput['exercises'] }[],
  today: string,
  unparsed: string[] = [],
): Promise<BackfillPreview> {
  const undated: BackfillPreview['undated'] = [];
  const future: BackfillPreview['future'] = [];
  const dated: WorkoutLogInput[] = [];
  for (const c of candidates) {
    if (!c.exercises.length) continue;
    if (!c.date) { undated.push({ title: c.title, exercises: c.exercises }); continue; }
    if (c.date > today) { future.push({ date: c.date, title: c.title }); continue; }
    dated.push({ date: c.date, title: c.title, exercises: c.exercises, notes: null, duration: null, programDayRef: null });
  }
  const { fresh, dupes } = await withoutLogged(userId, dated);
  fresh.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const preview: BackfillPreview = {
    previewId: randomUUID(),
    ready: fresh,
    undated,
    duplicates: dupes.map((d) => ({ date: d.date, title: d.title ?? null })),
    future,
    unparsed,
  };
  savePreview(userId, preview);
  return preview;
}

// In-memory: a preview is a bridge between "here's what I found" and "yes"
// (or "skip that week"). The card's Log button carries the sessions in its own
// args, so it doesn't depend on this surviving a restart.
const previews = new Map<string, { userId: string; at: number; preview: BackfillPreview }>();

function savePreview(userId: string, preview: BackfillPreview): void {
  const now = Date.now();
  for (const [k, v] of previews) if (now - v.at > PREVIEW_TTL_MS) previews.delete(k);
  previews.set(preview.previewId, { userId, at: now, preview });
}

/** The stored preview without using it up (a re-preview that drops a week). */
export function peekPreview(userId: string, previewId: string): BackfillPreview | null {
  const hit = previews.get(previewId);
  if (!hit || hit.userId !== userId || Date.now() - hit.at > PREVIEW_TTL_MS) return null;
  return hit.preview;
}

/** The stored preview, once: a second confirm finds nothing. */
export function takePreview(userId: string, previewId: string): BackfillPreview | null {
  const hit = previews.get(previewId);
  if (!hit || hit.userId !== userId || Date.now() - hit.at > PREVIEW_TTL_MS) return null;
  previews.delete(previewId);
  return hit.preview;
}

// ── The card ────────────────────────────────────────────────────────────────

const KG_PER_LB = 0.45359237;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
type Unit = 'metric' | 'imperial';
type Ex = WorkoutLogInput['exercises'][number];

const utc = (d: string) => new Date(`${d}T12:00:00Z`);
/** "15 Jul". */
export const shortDay = (d: string) => `${utc(d).getUTCDate()} ${MONTHS[utc(d).getUTCMonth()]}`;
/** "Wed 15 Jul". */
export const longDay = (d: string) => `${WD[utc(d).getUTCDay()]} ${shortDay(d)}`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
function addDaysIso(d: string, n: number): string { const t = utc(d); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
const mondayOf = (d: string) => addDaysIso(d, -((utc(d).getUTCDay() + 6) % 7));

function w(kg: number | null | undefined, unit: Unit): string | null {
  if (kg == null || !(kg > 0)) return null;
  const v = unit === 'metric' ? kg : kg / KG_PER_LB;
  const r = unit === 'metric' ? Math.round(v * 10) / 10 : Math.round(v);
  return String(r);
}
const u = (unit: Unit) => (unit === 'metric' ? 'kg' : 'lb');

/**
 * One exercise as the card shows it: "3 × 5 · 225 lb", "3 sets · 135–165 lb"
 * (sets at different weights), "3 sets · 12, 10, 8" (bodyweight, reps vary),
 * "3 × 15", or a time/distance as written ("5k", "60s").
 */
export function exerciseValue(e: Ex, unit: Unit): string {
  const entries = Array.isArray(e.setEntries) ? e.setEntries : [];
  if (entries.length >= 2) {
    const ws = entries.map((x) => w(x.weightKg, unit)).filter((x): x is string => !!x).map(Number);
    const reps = entries.map((x) => x.reps);
    const sameReps = reps.every((r) => r === reps[0]);
    if (ws.length) {
      const lo = Math.min(...ws), hi = Math.max(...ws);
      if (lo === hi) return sameReps ? `${entries.length} × ${reps[0]} · ${hi} ${u(unit)}` : `${entries.length} sets · ${reps.join(', ')} · ${hi} ${u(unit)}`;
      return `${entries.length} sets · ${lo}–${hi} ${u(unit)}`;
    }
    return sameReps ? `${entries.length} × ${reps[0]}` : `${entries.length} sets · ${reps.join(', ')}`;
  }
  const reps = String(e.reps ?? '').trim();
  const numeric = /^\d+(-\d+)?$/.test(reps);
  const load = w(e.weightKg, unit);
  const core = numeric ? `${e.sets} × ${reps}` : e.sets > 1 ? `${e.sets} × ${reps || '?'}` : reps || `${e.sets} set${e.sets === 1 ? '' : 's'}`;
  return load && !e.bodyweight ? `${core} · ${load} ${u(unit)}` : core;
}

function session(i: number, date: string | null, title: string | null, exs: Ex[], unit: Unit): BatchSession {
  return {
    i, date, day: date ? longDay(date) : null, title,
    names: exs.map((e) => e.name).join(', '),
    count: plural(exs.length, 'lift'),
    detail: exs.map((e) => ({ name: e.name, value: exerciseValue(e, unit) })),
  };
}

const setsOf = (exs: Ex[]) => exs.reduce((n, e) => n + (e.setEntries?.length || e.sets || 0), 0);

/** The pending inputs a preview card logs from: dated sessions, then undated ones (date null) the user can date. */
export function previewInputs(p: BackfillPreview): (Omit<WorkoutLogInput, 'date'> & { date: string | null })[] {
  return [
    ...p.ready,
    ...p.undated.map((x) => ({ date: null, title: x.title, exercises: x.exercises, notes: null, duration: null, programDayRef: null })),
  ];
}

/** "Left out: 1 already logged (Wed 15 Jul · Push) · 2 lines that weren't training." */
export function leftOutLine(p: BackfillPreview, opts: { undatedToo?: boolean } = {}): string | undefined {
  const named = (xs: { date: string; title: string | null }[]) => xs.length <= 2 ? ` (${xs.map((x) => `${longDay(x.date)}${x.title ? ` · ${x.title}` : ''}`).join(', ')})` : '';
  const parts = [
    p.duplicates.length ? `${p.duplicates.length} already logged${named(p.duplicates)}` : '',
    p.future.length ? `${p.future.length} dated in the future${named(p.future)}` : '',
    opts.undatedToo && p.undated.length ? `${plural(p.undated.length, 'session')} with no date (tell me when)` : '',
    p.unparsed.length ? `${plural(p.unparsed.length, 'line')} that weren’t training` : '',
  ].filter(Boolean);
  return parts.length ? `Left out: ${parts.join(' · ')}.` : undefined;
}

/** "Past workouts · 15 Jul – 5 Aug". */
export function rangeLabel(dates: string[]): string {
  const ds = [...dates].sort();
  if (!ds.length) return 'Past workouts';
  return ds[0] === ds[ds.length - 1] ? `Past workouts · ${shortDay(ds[0])}` : `Past workouts · ${shortDay(ds[0])} – ${shortDay(ds[ds.length - 1])}`;
}

/**
 * The card's batch block for a preview. Up to LIST_MAX sessions (undated
 * included): a tickable list, undated rows last. More: a count hero, sessions
 * per week as bars, and a row per week that opens to its days; undated
 * sessions go in the footer, since big batches are adjusted by asking Anakin.
 */
export function previewBatch(p: BackfillPreview, unit: Unit): BatchBlock {
  const inputs = previewInputs(p);
  const all = inputs.map((x, i) => session(i, x.date, x.title ?? null, x.exercises, unit));
  if (all.length <= LIST_MAX) {
    return { kind: 'list', sessions: all, selectable: true, leftOut: leftOutLine(p) };
  }
  const dated = all.filter((x) => x.date);
  const byWeek = new Map<string, BatchSession[]>();
  for (const x of dated) { const k = mondayOf(x.date!); byWeek.set(k, [...(byWeek.get(k) ?? []), x]); }
  const dupesByWeek = new Map<string, number>();
  for (const d of p.duplicates) { const k = mondayOf(d.date); dupesByWeek.set(k, (dupesByWeek.get(k) ?? 0) + 1); }
  const mondays = [...byWeek.keys()].sort();
  const weeks = mondays.map((mon) => {
    const xs = byWeek.get(mon)!;
    const titles = [...new Set(xs.map((x) => x.title).filter((t): t is string => !!t))];
    const sub = (titles.length ? titles : [...new Set(xs.flatMap((x) => x.detail.map((d) => d.name)))].slice(0, 4)).join(', ');
    const dupes = dupesByWeek.get(mon) ?? 0;
    return { label: `Week of ${shortDay(mon)}`, sub: dupes ? `${sub} · ${dupes} already logged` : sub, count: plural(xs.length, 'session'), ids: xs.map((x) => x.i) };
  });
  // Bars run over every calendar week from the first to the last, gaps included.
  const v: number[] = [];
  for (let mon = mondays[0]; mon <= mondays[mondays.length - 1]; mon = addDaysIso(mon, 7)) v.push(byWeek.get(mon)?.length ?? 0);
  const datedInputs = inputs.filter((x) => x.date);
  const exercises = datedInputs.reduce((n, x) => n + x.exercises.length, 0);
  return {
    kind: 'weeks',
    sessions: dated,
    weeks,
    hero: { value: String(dated.length), unit: dated.length === 1 ? 'workout' : 'workouts', sub: `${plural(v.length, 'week')} · ${plural(exercises, 'exercise')} · ${plural(datedInputs.reduce((n, x) => n + setsOf(x.exercises), 0), 'set')}` },
    bars: { v, from: shortDay(dated[0].date!), to: shortDay(dated[dated.length - 1].date!) },
    selectable: false,
    leftOut: leftOutLine(p, { undatedToo: true }),
  };
}

export interface BatchSelection { skip?: number[]; dates?: Record<string, string> }

/**
 * Ticks and dates from the card, over the preview's inputs. Skipped indices go;
 * an undated session takes its date from `dates` (a real day, not in the future,
 * within a year) and is otherwise left out, as is anything still undated.
 */
export function applyBatchSelection(inputs: any[], selection: BatchSelection | undefined, today: string): WorkoutLogInput[] {
  const skip = new Set((selection?.skip ?? []).map(Number));
  const oldest = addDaysIso(today, -366);
  const out: WorkoutLogInput[] = [];
  inputs.forEach((x, i) => {
    if (skip.has(i)) return;
    let date: string | null = x.date ?? null;
    if (!date) {
      const d = selection?.dates?.[String(i)];
      if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(utc(d).getTime()) && d <= today && d >= oldest) date = d;
    }
    if (date) out.push({ ...x, date });
  });
  return out;
}

/** "2 were bests at the time — squat 230 × 5, deadlift 320 × 4." */
export function bestsLine(created: { date: string; prs: string[] }[], inputs: WorkoutLogInput[], unit: Unit): string | undefined {
  const tops: string[] = [];
  for (const c of created) {
    const input = inputs.find((x) => x.date === c.date && c.prs.some((p) => x.exercises.some((e) => e.name.toLowerCase().includes(p.toLowerCase()) || p.toLowerCase().includes(e.name.toLowerCase()))));
    for (const pr of c.prs) {
      const e = input?.exercises.find((x) => x.name.toLowerCase().includes(pr.toLowerCase()) || pr.toLowerCase().includes(x.name.toLowerCase()));
      const sets = e ? (e.setEntries?.length ? e.setEntries.map((s) => ({ kg: s.weightKg ?? 0, reps: s.reps })) : [{ kg: e.weightKg ?? 0, reps: Number(e.reps) || 0 }]) : [];
      const top = sets.reduce((a, b) => (b.kg > a.kg ? b : a), { kg: 0, reps: 0 });
      const load = w(top.kg, unit);
      tops.push(load && top.reps ? `${pr.toLowerCase()} ${load} × ${top.reps}` : pr.toLowerCase());
    }
  }
  if (!tops.length) return undefined;
  return `${tops.length} ${tops.length === 1 ? 'was a best' : 'were bests'} at the time — ${tops.slice(0, 3).join(', ')}${tops.length > 3 ? ` and ${tops.length - 3} more` : ''}.`;
}
