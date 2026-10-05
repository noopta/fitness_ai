// Exercise picker (contract 2): the user's own canonicalized history first,
// most recent first, then the seed library. Works regardless of flags.
//
// Pure core (buildExerciseNameList) + a thin loader. Names go through the
// same canonicalization the adaptation engine uses — ExerciseNormalization
// row if one exists, else the seed dictionary — so "bench", "Bench press" and
// "Barbell Bench Press" collapse into one row the user picks once.

import { PrismaClient } from '@prisma/client';
import { SEED, canonicalizeSync } from '../services/exerciseCanonical.js';

const prisma = new PrismaClient();

export interface ExerciseNameRow {
  name: string;
  canonical: string;
  source: 'history' | 'library';
  lastDate: string | null;
  count: number;
}

export interface NameWorkout { date: string; exercises: string }

function matches(q: string, ...fields: string[]): boolean {
  if (!q) return true;
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = fields.join(' ').toLowerCase();
  return tokens.every(t => hay.includes(t));
}

/** Library canonical names, deduped, alphabetical. */
export function libraryNames(): string[] {
  return [...new Set(Object.values(SEED).map(v => v.canonicalName))].sort((a, b) => a.localeCompare(b));
}

export function buildExerciseNameList(
  workouts: NameWorkout[],
  dbCanonical: Map<string, string>,
  q: string,
  limit: number,
): ExerciseNameRow[] {
  const query = (q ?? '').trim();
  const byCanon = new Map<string, ExerciseNameRow & { latestRawDate: string }>();
  for (const w of workouts) {
    let list: any[];
    try { list = JSON.parse(w.exercises); } catch { continue; }
    if (!Array.isArray(list)) continue;
    const seenThisWorkout = new Set<string>();
    for (const ex of list) {
      const raw = String(ex?.name ?? '').replace(/\s+/g, ' ').trim();
      if (!raw) continue;
      const canonical = dbCanonical.get(raw) ?? canonicalizeSync(raw)?.canonicalName ?? raw;
      const k = canonical.toLowerCase();
      const row = byCanon.get(k);
      if (!row) {
        byCanon.set(k, { name: raw, canonical, source: 'history', lastDate: w.date, count: 1, latestRawDate: w.date });
        seenThisWorkout.add(k);
        continue;
      }
      if (!seenThisWorkout.has(k)) { row.count += 1; seenThisWorkout.add(k); }
      if (w.date > (row.lastDate ?? '')) row.lastDate = w.date;
      // Show the user's most recent spelling.
      if (w.date >= row.latestRawDate) { row.name = raw; row.latestRawDate = w.date; }
    }
  }
  const history = [...byCanon.values()]
    .filter(r => matches(query, r.name, r.canonical))
    .sort((a, b) => (b.lastDate ?? '').localeCompare(a.lastDate ?? '') || b.count - a.count)
    .map(({ latestRawDate: _l, ...r }) => r);
  const out: ExerciseNameRow[] = history.slice(0, limit);
  if (out.length < limit) {
    const have = new Set(out.map(r => r.canonical.toLowerCase()));
    for (const name of libraryNames()) {
      if (out.length >= limit) break;
      if (have.has(name.toLowerCase()) || !matches(query, name)) continue;
      out.push({ name, canonical: name, source: 'library', lastDate: null, count: 0 });
    }
  }
  return out;
}

export async function listExerciseNames(userId: string, q: string, limit: number): Promise<ExerciseNameRow[]> {
  const workouts = await prisma.workoutLog.findMany({
    where: { userId },
    orderBy: { date: 'desc' },
    take: 500,
    select: { date: true, exercises: true },
  });
  const raw = new Set<string>();
  for (const w of workouts) {
    try { for (const ex of JSON.parse(w.exercises) ?? []) if (ex?.name) raw.add(String(ex.name).replace(/\s+/g, ' ').trim()); } catch { /* skip */ }
  }
  const dbCanonical = new Map<string, string>();
  if (raw.size) {
    const rows = await prisma.exerciseNormalization.findMany({ where: { rawName: { in: [...raw] } }, select: { rawName: true, canonicalName: true } });
    for (const r of rows) dbCanonical.set(r.rawName, r.canonicalName);
  }
  return buildExerciseNameList(workouts, dbCanonical, q, limit);
}
