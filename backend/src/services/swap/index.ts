// Swap options for one user (Oct 2026): the pure ranking in match.ts, with
// who they are — equipment, injuries (constraintsText AND coachProfile, both
// hold them), what they've logged — and the classified profile for any name
// the catalog doesn't know.

import { PrismaClient } from '@prisma/client';
import { CATALOG, type Equipment } from './catalog.js';
import { resolveProfile, slotJob, rankSwaps, variantsOf, emptyContext, equipmentFrom, jointsFrom, normalizeName, primaryGroup, type SwapReason, type SwapContext, type SwapOption, type SlotJob } from './match.js';
import { profileFor, loadClassified } from './classify.js';
import { parseExercisesColumn } from '../workoutExercises.js';
import type { Joint } from './catalog.js';

const prisma = new PrismaClient();
const HISTORY_DAYS = 120;

export interface SwapRequest { name: string; sets?: number | string | null; reps?: number | string | null; notes?: string | null; index?: number | null; session?: string[]; reason?: SwapReason; painJoint?: Joint | null }

export interface SwapRow { name: string; why: string; score: number; equipment: Equipment; lastDone?: string | null }
export interface SwapOptions {
  original: { name: string; known: boolean };
  job: SlotJob | null;
  /** Top 3, spread out. */
  best: SwapRow[];
  /** Lifts they've logged that do the same job, most recent first. */
  yours: SwapRow[];
  /** Same movement, same target. */
  variants: SwapRow[];
  lowConfidence: boolean;
}

const row = (o: SwapOption, lastDone?: string | null): SwapRow => ({ name: o.name, why: o.why, score: o.score, equipment: o.eq, ...(lastDone !== undefined ? { lastDone } : {}) });

/** Injury text from both places it lives. */
function injuryText(u: { constraintsText: string | null; coachProfile: string | null }): string {
  let fromProfile = '';
  try {
    const inj = u.coachProfile ? JSON.parse(u.coachProfile)?.injuries : null;
    fromProfile = Array.isArray(inj) ? inj.filter((i: any) => !i?.resolvedAt).map((i: any) => [i?.area, i?.note].filter(Boolean).join(' ')).join('; ') : typeof inj === 'string' ? inj : '';
  } catch { /* not JSON */ }
  return [u.constraintsText ?? '', fromProfile].join('; ').replace(/\b(none|n\/a|no injuries)\b/gi, '');
}

export async function swapOptions(userId: string, req: SwapRequest): Promise<SwapOptions> {
  const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);
  const [user, logs] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { equipment: true, constraintsText: true, coachProfile: true } }),
    prisma.workoutLog.findMany({ where: { userId, date: { gte: since } }, orderBy: { date: 'desc' }, take: 300, select: { date: true, exercises: true } }),
  ]);
  // Their lifts, newest first, one per name.
  const lastDone = new Map<string, { name: string; date: string }>();
  for (const l of logs) for (const e of parseExercisesColumn(l.exercises)) {
    const k = normalizeName(e?.name ?? '');
    if (k && !lastDone.has(k)) lastDone.set(k, { name: String(e.name).trim(), date: l.date });
  }
  const original = await profileFor(req.name);
  const ctx: SwapContext = {
    ...emptyContext(),
    equipment: equipmentFrom(user?.equipment),
    injured: jointsFrom(user ? injuryText(user) : ''),
    history: new Set(lastDone.keys()),
    painJoint: req.painJoint ?? null,
  };
  if (!original) return { original: { name: req.name, known: false }, job: null, best: [], yours: [], variants: [], lowConfidence: true };

  // Their own lifts the catalog doesn't know join the pool when they've been classified.
  const classified = await loadClassified([...lastDone.values()].map((v) => v.name));
  const catalogNames = new Set(CATALOG.map((c) => c.name));
  const pool = [...classified.values()].filter((p) => !catalogNames.has(p.name));
  const extra = new Map([...classified]);
  const job = slotJob(original, { reps: req.reps, notes: req.notes, index: req.index, session: req.session }, extra);
  const ranked = rankSwaps(original, job, ctx, req.reason ?? 'default', pool);
  const byName = new Map(ranked.options.map((o) => [o.name, o]));

  const yours: SwapRow[] = [];
  const seen = new Set<string>();
  for (const { name, date } of lastDone.values()) {
    const p = resolveProfile(name, extra);
    if (!p || p.name === original.name || seen.has(p.name)) continue;
    const opt = byName.get(p.name);
    if (!opt) continue;
    seen.add(p.name);
    // Shown under the name they logged it as.
    yours.push({ ...row(opt, date), name });
    if (yours.length === 5) break;
  }
  return {
    original: { name: original.name, known: true },
    job,
    best: ranked.top.map((o) => row(o)),
    yours,
    variants: variantsOf(original, ranked.options, pool).filter((o) => !ranked.top.some((t) => t.name === o.name)).slice(0, 6).map((o) => row(o)),
    lowConfidence: ranked.lowConfidence,
  };
}

/** Every exercise name the swap search can offer (catalog names + aliases), grouped by target. */
export function catalogIndex(): { name: string; aka: string[]; group: string; modality: string }[] {
  return CATALOG.map((c) => ({ name: c.name, aka: c.aka ?? [], group: primaryGroup(c), modality: c.mod }));
}

/** A name they typed: classify it in the background so it ranks next time. */
export function learnExercise(name: string): void {
  if (resolveProfile(name)) return;
  void profileFor(name).catch(() => {});
}
