// Canonical exercise names — one lift, many spellings ("Bench Press",
// "barbell bench press", "BB bench").
//
// Everything that groups logs by lift — PRs, the strength profile, the agent's
// read tools, the training summary — keys through the SAME function the
// adaptation engine uses (adaptation/history.ts makeKeyFn): the
// ExerciseNormalization row if one exists, else the seed dictionary, else a
// lowercase collapse. Both sides of any comparison go through it, so history
// logged under an old spelling still lines up with today's.

import type { PrismaClient } from '@prisma/client';
import { canonicalizeSync, type ExerciseCategory } from './exerciseCanonical.js';
import { makeKeyFn, workingSets, type KeyFn } from '../adaptation/history.js';
import type { LoggedExercise as LedgerExercise } from './workoutStimulusService.js';

export type RawExercise = Parameters<typeof workingSets>[0];

export interface CanonicalMeta {
  canonicalName: string;
  category: ExerciseCategory | string;
  primaryMuscle: string;
  isCompound: boolean;
}

export interface CanonicalResolver {
  /** Stable lift key (collapsed canonical name). '' for a blank name. */
  key: KeyFn;
  /** Display name + classification, or null when neither the DB nor the seed knows it. */
  resolve: (name: string) => CanonicalMeta | null;
}

export interface NormRow { rawName: string; canonicalName: string; category?: string | null; primaryMuscle?: string | null; isCompound?: boolean | null }

/** Build a resolver from already-loaded ExerciseNormalization rows. Pure. */
export function makeCanonicalResolver(rows: NormRow[] = []): CanonicalResolver {
  const byRaw = new Map<string, NormRow>();
  for (const r of rows) if (r?.rawName) byRaw.set(r.rawName.trim(), r);
  const key = makeKeyFn(new Map([...byRaw].map(([raw, r]) => [raw, r.canonicalName])));
  const resolve = (name: string): CanonicalMeta | null => {
    const raw = (name ?? '').replace(/\s+/g, ' ').trim();
    if (!raw) return null;
    const row = byRaw.get(raw) ?? byRaw.get((name ?? '').trim());
    if (row) {
      // A DB row without classification still names the lift; borrow the
      // seed's classification for its canonical name when there is one.
      const seed = canonicalizeSync(row.canonicalName);
      return {
        canonicalName: row.canonicalName,
        category: row.category ?? seed?.category ?? 'push',
        primaryMuscle: row.primaryMuscle ?? seed?.primaryMuscle ?? 'unknown',
        isCompound: row.isCompound ?? seed?.isCompound ?? false,
      };
    }
    const seed = canonicalizeSync(raw);
    return seed ? { ...seed } : null;
  };
  return { key, resolve };
}

/** ExerciseNormalization rows for the given raw names. Tolerates a client
 *  without the model (test stubs) — callers then fall back to the seed. */
export async function loadNormRows(prisma: PrismaClient, names: Iterable<string>): Promise<NormRow[]> {
  const raw = [...new Set([...names].map((n) => String(n ?? '').trim()).filter(Boolean))];
  if (!raw.length) return [];
  try {
    const rows = await (prisma as any).exerciseNormalization?.findMany({
      where: { rawName: { in: raw } },
      select: { rawName: true, canonicalName: true, category: true, primaryMuscle: true, isCompound: true },
    });
    return Array.isArray(rows) ? rows : [];
  } catch { return []; }
}

/** Load the normalization rows for the given raw names and build a resolver. */
export async function loadCanonicalResolver(prisma: PrismaClient, names: Iterable<string>): Promise<CanonicalResolver> {
  return makeCanonicalResolver(await loadNormRows(prisma, names));
}

/**
 * Canonical lift lookup for one pass over a user's logs: DB normalization rows
 * first, then the seed dictionary, then the trimmed raw name. Every spelling
 * with the same key gets one display name (a known canonical wins over a raw
 * spelling seen first).
 */
export function liftResolver(rows: Parameters<typeof makeCanonicalResolver>[0]) {
  const resolver = makeCanonicalResolver(rows);
  const byKey = new Map<string, { canonical: string; known: boolean }>();
  return {
    key: resolver.key,
    of(name: string) {
      const raw = (name ?? '').trim();
      const key = resolver.key(raw) || raw.toLowerCase();
      const meta = resolver.resolve(raw);
      const seen = byKey.get(key);
      if (!seen || (!seen.known && meta)) byKey.set(key, { canonical: meta?.canonicalName ?? raw, known: !!meta });
      return { key, canonical: byKey.get(key)!.canonical, meta };
    },
  };
}

/**
 * One logged exercise → the ledger's uniform shape. Per-set logs become one
 * entry per run of identical sets, so tonnage, hard sets and e1RM see the
 * real loads instead of the top-level summary weight.
 */
export function toLedgerExercises(ex: RawExercise, canonical: string): LedgerExercise[] {
  const sets = workingSets(ex);
  if (sets.length === 0) {
    // Unparseable reps (e.g. "AMRAP") — keep the volume signal as before.
    return [{ name: canonical, sets: Number(ex.sets) || 1, reps: ex.reps ?? 0, weightKg: ex.bodyweight ? null : ex.weightKg ?? null, rpe: ex.rpe ?? null }];
  }
  const out: LedgerExercise[] = [];
  for (const s of sets) {
    const last = out[out.length - 1];
    if (last && last.weightKg === s.weightKg && last.reps === s.reps && (last.rpe ?? null) === s.rpe) last.sets += 1;
    else out.push({ name: canonical, sets: 1, reps: s.reps, weightKg: s.weightKg, rpe: s.rpe });
  }
  return out;
}
