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

const prisma = new PrismaClient();

export const PREVIEW_TTL_MS = 30 * 60_000;

export interface BackfillPreview {
  previewId: string;
  ready: WorkoutLogInput[];
  /** Sessions with no readable date — the agent asks the user for one. */
  undated: { title: string | null; exercises: string[] }[];
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
    if (!c.date) { undated.push({ title: c.title, exercises: c.exercises.map((e) => e.name) }); continue; }
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

// In-memory: a preview is a 30-minute bridge between "here's what I found" and
// "yes". The card's Log button carries the sessions in its own args, so it
// doesn't depend on this surviving a restart.
const previews = new Map<string, { userId: string; at: number; preview: BackfillPreview }>();

function savePreview(userId: string, preview: BackfillPreview): void {
  const now = Date.now();
  for (const [k, v] of previews) if (now - v.at > PREVIEW_TTL_MS) previews.delete(k);
  previews.set(preview.previewId, { userId, at: now, preview });
}

/** The stored preview, once: a second confirm finds nothing. */
export function takePreview(userId: string, previewId: string): BackfillPreview | null {
  const hit = previews.get(previewId);
  if (!hit || hit.userId !== userId || Date.now() - hit.at > PREVIEW_TTL_MS) return null;
  previews.delete(previewId);
  return hit.preview;
}
