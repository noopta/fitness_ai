// The exercise library (handoff B2): Axiom's built-in exercises plus each
// practice's own. Every exercise carries the movement patterns the rules
// engine reads, so the library, the builder and AI generation all refuse the
// same things for the same client.

import { exercises as STATIC_EXERCISES } from '../../data/exercises.js';
import { SEED } from '../exerciseCanonical.js';
import { audit } from './drafts.js';
import { prisma } from './db.js';
import { PATTERNS, exercisePatterns, type Pattern } from './contraindicationRules.js';
import type { LibraryExercise } from './types.js';

export class LibraryError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'LibraryError';
    this.status = status;
  }
}

export const EQUIPMENT = ['barbell', 'dumbbell', 'kettlebell', 'cable', 'machine', 'band', 'bench', 'rack', 'pullup_bar', 'bodyweight', 'other'] as const;
export type Equipment = (typeof EQUIPMENT)[number];

/** Equipment a name implies, when nothing better is known. */
export function inferEquipment(name: string): Equipment[] {
  const n = name.toLowerCase();
  const out = new Set<Equipment>();
  if (/barbell|\bbb\b|back squat|front squat|deadlift|bench press|overhead press|\bohp\b|good morning|rack pull|pendlay|clean|snatch|thruster/.test(n) && !/dumbbell|\bdb\b|kettlebell|\bkb\b|machine|smith/.test(n)) out.add('barbell');
  if (/dumbbell|\bdb\b/.test(n)) out.add('dumbbell');
  if (/kettlebell|\bkb\b|swing|goblet/.test(n)) out.add('kettlebell');
  if (/cable|pulldown|pull-down|face pull|pushdown|crossover|pallof/.test(n)) out.add('cable');
  if (/machine|leg press|leg extension|leg curl|pec deck|smith|hack squat|pendulum/.test(n)) out.add('machine');
  if (/band/.test(n)) out.add('band');
  if (/pull[- ]?up|chin[- ]?up|hanging/.test(n)) out.add('pullup_bar');
  if (/bench|incline|decline|seated/.test(n)) out.add('bench');
  if (/squat|bench press|rack pull/.test(n) && out.has('barbell')) out.add('rack');
  if (out.size === 0 && /push[- ]?up|plank|lunge|bodyweight|air squat|burpee|jump|crunch|sit[- ]?up|bridge|dead bug|bird dog|mountain climber|run|sprint|dip/.test(n)) out.add('bodyweight');
  return [...out];
}

function builtIns(): LibraryExercise[] {
  const byName = new Map<string, LibraryExercise>();
  for (const e of STATIC_EXERCISES) {
    byName.set(e.name.toLowerCase(), {
      id: `builtin:${e.id}`, name: e.name, builtIn: true,
      patterns: exercisePatterns(e.name),
      equipment: (e.equipment.filter((x) => (EQUIPMENT as readonly string[]).includes(x)) as Equipment[]).concat(e.equipment.length ? [] : inferEquipment(e.name)),
      primaryMuscle: e.targetMuscle[0] ?? null, videoUrl: null, cues: e.description ?? null,
    });
  }
  for (const v of Object.values(SEED)) {
    const key = v.canonicalName.toLowerCase();
    if (byName.has(key)) continue;
    byName.set(key, {
      id: `builtin:${key.replace(/[^a-z0-9]+/g, '_')}`, name: v.canonicalName, builtIn: true,
      patterns: exercisePatterns(v.canonicalName), equipment: inferEquipment(v.canonicalName),
      primaryMuscle: v.primaryMuscle, videoUrl: null, cues: null,
    });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

let BUILT_INS: LibraryExercise[] | null = null;
export const builtInExercises = () => (BUILT_INS ??= builtIns());

type Row = Awaited<ReturnType<typeof prisma.ptExercise.findMany>>[number];
const list = (raw: string) => { try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; } };

function rowToExercise(r: Row): LibraryExercise {
  const patterns = list(r.patternsJson) as Pattern[];
  const equipment = list(r.equipmentJson) as Equipment[];
  return {
    id: r.id, name: r.name, builtIn: false,
    patterns: patterns.length ? patterns : exercisePatterns(r.name),
    equipment: equipment.length ? equipment : inferEquipment(r.name),
    primaryMuscle: r.primaryMuscle, videoUrl: r.videoUrl, cues: r.cues,
  };
}

/** The library a practice sees: its own exercises first (they replace a built-in of the same name), then Axiom's. */
export async function libraryFor(practiceId: string): Promise<LibraryExercise[]> {
  const own = (await prisma.ptExercise.findMany({ where: { practiceId, archivedAt: null }, orderBy: { name: 'asc' } })).map(rowToExercise);
  const ownNames = new Set(own.map((e) => e.name.toLowerCase()));
  return [...own, ...builtInExercises().filter((e) => !ownNames.has(e.name.toLowerCase()))];
}

export function searchLibrary(all: LibraryExercise[], q: { text?: string; pattern?: string; equipment?: string }): LibraryExercise[] {
  const text = q.text?.trim().toLowerCase();
  return all.filter((e) =>
    (!text || e.name.toLowerCase().includes(text) || (e.primaryMuscle ?? '').toLowerCase().includes(text)) &&
    (!q.pattern || e.patterns.includes(q.pattern as Pattern)) &&
    (!q.equipment || e.equipment.includes(q.equipment as Equipment)));
}

const URL_RE = /^https:\/\/[^\s]{4,500}$/;

function fields(body: Record<string, unknown>, creating: boolean) {
  const name = body.name === undefined ? undefined : typeof body.name === 'string' && body.name.trim().length >= 2 ? body.name.trim().slice(0, 80) : (() => { throw new LibraryError('Name the exercise', 400); })();
  if (creating && !name) throw new LibraryError('Name the exercise', 400);
  const patterns = body.patterns === undefined ? undefined : Array.isArray(body.patterns) && body.patterns.every((p) => (PATTERNS as readonly string[]).includes(p as string)) ? JSON.stringify([...new Set(body.patterns)]) : (() => { throw new LibraryError('patterns must be movement patterns', 400); })();
  const equipment = body.equipment === undefined ? undefined : Array.isArray(body.equipment) && body.equipment.every((p) => (EQUIPMENT as readonly string[]).includes(p as string)) ? JSON.stringify([...new Set(body.equipment)]) : (() => { throw new LibraryError(`equipment must be from ${EQUIPMENT.join(', ')}`, 400); })();
  const videoUrl = body.videoUrl === undefined ? undefined : body.videoUrl === null || body.videoUrl === '' ? null : typeof body.videoUrl === 'string' && URL_RE.test(body.videoUrl) ? body.videoUrl : (() => { throw new LibraryError('videoUrl must be an https link', 400); })();
  const cues = body.cues === undefined ? undefined : typeof body.cues === 'string' ? body.cues.trim().slice(0, 1000) || null : null;
  const primaryMuscle = body.primaryMuscle === undefined ? undefined : typeof body.primaryMuscle === 'string' ? body.primaryMuscle.trim().slice(0, 40) || null : null;
  return { name, patternsJson: patterns, equipmentJson: equipment, videoUrl, cues, primaryMuscle };
}

export async function createExercise(practiceId: string, trainerId: string, body: Record<string, unknown>) {
  const f = fields(body, true);
  const row = await prisma.ptExercise.create({ data: { practiceId, createdById: trainerId, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)) } as any });
  // A trainer's tagging decides what the rules engine refuses for this exercise, so it is on the record.
  await audit({ practiceId, trainerId, action: 'exercise_created', itemType: 'exercise', itemId: row.id, meta: { name: row.name, patterns: list(row.patternsJson) } });
  return rowToExercise(row);
}

export async function updateExercise(practiceId: string, trainerId: string, id: string, body: Record<string, unknown>) {
  const row = await prisma.ptExercise.findUnique({ where: { id } });
  if (!row || row.practiceId !== practiceId || row.archivedAt) throw new LibraryError('Exercise not found', 404);
  const f = fields(body, false);
  const updated = await prisma.ptExercise.update({ where: { id }, data: Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)) });
  await audit({ practiceId, trainerId, action: 'exercise_updated', itemType: 'exercise', itemId: id, meta: { patterns: list(updated.patternsJson) } });
  return rowToExercise(updated);
}

export async function archiveExercise(practiceId: string, trainerId: string, id: string) {
  const row = await prisma.ptExercise.findUnique({ where: { id } });
  if (!row || row.practiceId !== practiceId || row.archivedAt) throw new LibraryError('Exercise not found', 404);
  await prisma.ptExercise.update({ where: { id }, data: { archivedAt: new Date() } });
  await audit({ practiceId, trainerId, action: 'exercise_archived', itemType: 'exercise', itemId: id });
}

/** Patterns the practice tagged on its own exercises, by lower-cased name — they override inference in validation. */
export async function practicePatternOverrides(practiceId: string): Promise<Map<string, Pattern[]>> {
  const rows = await prisma.ptExercise.findMany({ where: { practiceId, archivedAt: null }, select: { name: true, patternsJson: true } });
  const out = new Map<string, Pattern[]>();
  for (const r of rows) {
    const p = list(r.patternsJson) as Pattern[];
    if (p.length) out.set(r.name.toLowerCase(), p);
  }
  return out;
}
