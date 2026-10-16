// The structured parts of a client's dossier (handoff §4 phase 0): goals with
// a number and a date on them, body measurements, and progress photos.
//
// Storage is canonical — kg for weights, cm for lengths — and converted to the
// viewer's unit at the edge, like every other weight in the app. A goal's
// current value is always read from data (logs, measurements), never typed.

import { blobStoreEnabled, objectUrl, putImageBase64 } from '../blobStore.js';
import { bodyWeightKg, kgToLb, lbToKg, type UnitPreference } from '../weightUnits.js';
import { audit } from './drafts.js';
import { prisma } from './db.js';
import { isLiftKey, liftHistory, LIFT_LABEL } from './lifts.js';
import type { ClientGoal, GoalMetric, Measurement, MeasurementKind, ProgressPhoto } from './types.js';

const DAY_MS = 86_400_000;
const CM_PER_IN = 2.54;

export class RecordError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'RecordError';
    this.status = status;
  }
}

export const MEASUREMENT_KINDS: MeasurementKind[] = ['bodyweight', 'waist', 'hips', 'chest', 'arm', 'thigh', 'calf', 'neck', 'body_fat', 'resting_hr', 'custom'];
const LENGTH_KINDS = new Set<MeasurementKind>(['waist', 'hips', 'chest', 'arm', 'thigh', 'calf', 'neck']);
const KIND_LABEL: Record<MeasurementKind, string> = {
  bodyweight: 'Bodyweight', waist: 'Waist', hips: 'Hips', chest: 'Chest', arm: 'Arm', thigh: 'Thigh', calf: 'Calf', neck: 'Neck',
  body_fat: 'Body fat', resting_hr: 'Resting heart rate', custom: 'Measurement',
};

/** Unit a kind is shown in for this viewer. */
export function displayUnit(kind: MeasurementKind, pref: UnitPreference): string {
  if (kind === 'bodyweight') return pref === 'metric' ? 'kg' : 'lb';
  if (LENGTH_KINDS.has(kind)) return pref === 'metric' ? 'cm' : 'in';
  if (kind === 'body_fat') return '%';
  if (kind === 'resting_hr') return 'bpm';
  return '';
}

/** Canonical (kg / cm) from what the person typed, in the unit they typed it in. */
export function toCanonical(kind: MeasurementKind, value: number, unit: string): number {
  if (kind === 'bodyweight') return unit === 'lb' || unit === 'lbs' ? lbToKg(value) : value;
  if (LENGTH_KINDS.has(kind)) return unit === 'in' ? value * CM_PER_IN : value;
  return value;
}

export function fromCanonical(kind: MeasurementKind, value: number, pref: UnitPreference): number {
  const v = kind === 'bodyweight' ? (pref === 'metric' ? value : kgToLb(value))
    : LENGTH_KINDS.has(kind) ? (pref === 'metric' ? value : value / CM_PER_IN)
    : value;
  return Math.round(v * 10) / 10;
}

const canonicalUnit = (kind: MeasurementKind) => (kind === 'bodyweight' ? 'kg' : LENGTH_KINDS.has(kind) ? 'cm' : kind === 'body_fat' ? '%' : kind === 'resting_hr' ? 'bpm' : 'custom');

const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

// ── Measurements ─────────────────────────────────────────────────────────────

export async function addMeasurement(input: {
  practiceId: string; clientId: string; actorId: string; source: 'trainer' | 'client';
  kind: unknown; value: unknown; unit: unknown; date?: unknown; label?: unknown; now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  if (typeof input.kind !== 'string' || !MEASUREMENT_KINDS.includes(input.kind as MeasurementKind)) throw new RecordError(`kind must be one of ${MEASUREMENT_KINDS.join(', ')}`, 400);
  const kind = input.kind as MeasurementKind;
  const value = Number(input.value);
  if (!Number.isFinite(value) || value <= 0 || value > 1000) throw new RecordError('value must be a positive number', 400);
  const unit = typeof input.unit === 'string' ? input.unit : canonicalUnit(kind);
  const date = input.date === undefined ? now.toISOString().slice(0, 10) : isDate(input.date) ? input.date : (() => { throw new RecordError('date must be YYYY-MM-DD', 400); })();
  const canonical = toCanonical(kind, value, unit);
  if (kind === 'bodyweight' && (canonical < 20 || canonical > 400)) throw new RecordError('That bodyweight looks wrong', 400);
  if (kind === 'body_fat' && canonical > 70) throw new RecordError('Body fat must be a percentage', 400);
  const at = date === now.toISOString().slice(0, 10) ? now : new Date(`${date}T12:00:00Z`);

  // A client's own weigh-in is a weigh-in like any other: it goes where the app's do, so streaks,
  // the briefing and reports read it. A trainer's entry for an app client is the trainer's record,
  // kept apart so it never rewrites what the client logged.
  if (kind === 'bodyweight' && input.source === 'client') {
    await prisma.bodyWeightLog.create({ data: { userId: input.clientId, date, weightKg: canonical, createdAt: at } });
    return;
  }
  const label = kind === 'custom' && typeof input.label === 'string' ? input.label.trim().slice(0, 60) || null : null;
  if (kind === 'custom' && !label) throw new RecordError('Name the measurement', 400);
  const row = await prisma.ptMeasurement.create({
    data: { practiceId: input.practiceId, clientId: input.clientId, kind, label, value: canonical, unit: canonicalUnit(kind), date, at, source: input.source },
  });
  if (input.source === 'trainer') {
    await audit({ practiceId: input.practiceId, trainerId: input.actorId, clientId: input.clientId, action: 'measurement_added', itemType: 'measurement', itemId: row.id, meta: { kind } });
  }
}

export async function listMeasurements(practiceId: string, clientId: string, pref: UnitPreference): Promise<Measurement[]> {
  const isUser = !clientId.startsWith('prospect:');
  const [rows, weights] = await Promise.all([
    prisma.ptMeasurement.findMany({ where: { practiceId, clientId }, orderBy: { at: 'desc' }, take: 500 }),
    isUser ? prisma.bodyWeightLog.findMany({ where: { userId: clientId }, orderBy: { createdAt: 'desc' }, take: 200 }) : [],
  ]);
  const out: Measurement[] = [
    ...rows.map((r) => ({
      id: r.id, kind: r.kind as MeasurementKind, label: r.label ?? KIND_LABEL[r.kind as MeasurementKind] ?? r.kind,
      value: fromCanonical(r.kind as MeasurementKind, r.value, pref), unit: r.kind === 'custom' ? '' : displayUnit(r.kind as MeasurementKind, pref),
      date: r.date, source: r.source as Measurement['source'], deletable: true,
    })),
    ...weights.flatMap((w) => {
      const kg = bodyWeightKg(w);
      return kg ? [{
        id: `bw:${w.id}`, kind: 'bodyweight' as const, label: 'Bodyweight', value: fromCanonical('bodyweight', kg, pref),
        unit: displayUnit('bodyweight', pref), date: w.date, source: 'client' as const, deletable: false,
      }] : [];
    }),
  ];
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

export async function deleteMeasurement(practiceId: string, trainerId: string, clientId: string, id: string) {
  const row = await prisma.ptMeasurement.findUnique({ where: { id } });
  if (!row || row.practiceId !== practiceId || row.clientId !== clientId) throw new RecordError('Not found', 404);
  // A client's own entry is theirs; the trainer can only remove what the trainer recorded.
  if (row.source !== 'trainer') throw new RecordError("This was entered by the client and can't be removed here", 409);
  await prisma.ptMeasurement.delete({ where: { id } });
  await audit({ practiceId, trainerId, clientId, action: 'measurement_deleted', itemType: 'measurement', itemId: id, meta: { kind: row.kind } });
}

// ── Goals ────────────────────────────────────────────────────────────────────

/** The metric's latest value from data, canonical. Null when nothing has been logged. */
export async function currentValue(practiceId: string, clientId: string, metric: GoalMetric, now: Date = new Date()): Promise<number | null> {
  const isUser = !clientId.startsWith('prospect:');
  if (metric === 'bodyweight') {
    const [log, trainerRow] = await Promise.all([
      isUser ? prisma.bodyWeightLog.findFirst({ where: { userId: clientId }, orderBy: { createdAt: 'desc' } }) : null,
      prisma.ptMeasurement.findFirst({ where: { practiceId, clientId, kind: 'bodyweight' }, orderBy: { at: 'desc' } }),
    ]);
    const fromLog = log ? { at: log.createdAt, kg: bodyWeightKg(log) } : null;
    const fromTrainer = trainerRow ? { at: trainerRow.at, kg: trainerRow.value } : null;
    const latest = [fromLog, fromTrainer].filter((x): x is { at: Date; kg: number | null } => !!x?.kg).sort((a, b) => b.at.getTime() - a.at.getTime())[0];
    return latest?.kg ?? null;
  }
  if (metric.startsWith('e1rm:')) {
    const lift = metric.slice(5);
    if (!isLiftKey(lift) || !isUser) return null;
    const logs = await prisma.workoutLog.findMany({ where: { userId: clientId }, orderBy: { createdAt: 'asc' }, select: { id: true, createdAt: true, exercises: true } });
    const h = liftHistory(logs, lift);
    return h.length ? Math.round(h[h.length - 1].e1rm * 10) / 10 : null;
  }
  if (metric.startsWith('measurement:')) {
    const row = await prisma.ptMeasurement.findFirst({ where: { practiceId, clientId, kind: metric.slice(12) }, orderBy: { at: 'desc' } });
    return row?.value ?? null;
  }
  if (metric === 'sessions_per_week') {
    if (!isUser) return null;
    return prisma.workoutLog.count({ where: { userId: clientId, createdAt: { gte: new Date(now.getTime() - 7 * DAY_MS) } } });
  }
  return null;
}

function metricKind(metric: GoalMetric): MeasurementKind | null {
  if (metric === 'bodyweight' || metric.startsWith('e1rm:')) return 'bodyweight'; // weight units
  if (metric.startsWith('measurement:')) return metric.slice(12) as MeasurementKind;
  return null;
}

export function validMetric(v: unknown): v is GoalMetric {
  if (typeof v !== 'string') return false;
  if (v === 'bodyweight' || v === 'sessions_per_week' || v === 'custom') return true;
  if (v.startsWith('e1rm:')) return isLiftKey(v.slice(5));
  if (v.startsWith('measurement:')) return MEASUREMENT_KINDS.includes(v.slice(12) as MeasurementKind) && v.slice(12) !== 'bodyweight';
  return false;
}

export function defaultGoalLabel(metric: GoalMetric): string {
  if (metric === 'bodyweight') return 'Bodyweight';
  if (metric === 'sessions_per_week') return 'Sessions a week';
  if (metric.startsWith('e1rm:')) return `${LIFT_LABEL[metric.slice(5) as keyof typeof LIFT_LABEL]} (estimated 1RM)`;
  if (metric.startsWith('measurement:')) return KIND_LABEL[metric.slice(12) as MeasurementKind] ?? 'Measurement';
  return 'Goal';
}

/**
 * Progress from baseline to target, 0–100. Works in either direction; a
 * "hold" goal is 100 while the value is within 2% of the target.
 */
export function goalProgress(baseline: number | null, target: number | null, current: number | null, direction: 'up' | 'down' | 'hold'): number | null {
  if (target == null || current == null) return null;
  if (direction === 'hold') return Math.abs(current - target) <= Math.abs(target) * 0.02 ? 100 : Math.max(0, Math.round(100 - (Math.abs(current - target) / Math.max(1e-9, Math.abs(target))) * 100));
  if (baseline == null || baseline === target) return current === target ? 100 : null;
  const p = ((current - baseline) / (target - baseline)) * 100;
  return Math.max(0, Math.min(100, Math.round(p)));
}

type GoalRow = Awaited<ReturnType<typeof prisma.ptGoal.findMany>>[number];

async function toGoal(r: GoalRow, pref: UnitPreference, now: Date): Promise<ClientGoal> {
  const metric = r.metric as GoalMetric;
  const kind = metricKind(metric);
  const current = await currentValue(r.practiceId, r.clientId, metric, now);
  const show = (v: number | null) => (v == null ? null : kind ? fromCanonical(kind, v, pref) : Math.round(v * 10) / 10);
  const daysLeft = r.deadline ? Math.ceil((Date.parse(`${r.deadline}T23:59:59Z`) - now.getTime()) / DAY_MS) : null;
  return {
    id: r.id, metric, label: r.label, direction: r.direction as ClientGoal['direction'], status: r.status as ClientGoal['status'],
    baseline: show(r.baseline), target: show(r.target), current: show(current),
    unit: kind ? displayUnit(kind, pref) : r.unit ?? '',
    ...(r.deadline ? { deadline: r.deadline, daysLeft } : {}),
    progress: goalProgress(r.baseline, r.target, current, r.direction as ClientGoal['direction']),
  };
}

export async function listGoals(practiceId: string, clientId: string, pref: UnitPreference, now: Date = new Date()): Promise<ClientGoal[]> {
  const rows = await prisma.ptGoal.findMany({ where: { practiceId, clientId, status: { not: 'dropped' } }, orderBy: { createdAt: 'asc' } });
  return Promise.all(rows.map((r) => toGoal(r, pref, now)));
}

export interface GoalInput { metric?: unknown; label?: unknown; baseline?: unknown; target?: unknown; unit?: unknown; direction?: unknown; deadline?: unknown; status?: unknown }

function goalFields(input: GoalInput, metric: GoalMetric, pref: UnitPreference) {
  const kind = metricKind(metric);
  const num = (v: unknown, field: string) => {
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new RecordError(`${field} must be a number`, 400);
    // Typed in the trainer's display unit.
    return kind ? toCanonical(kind, n, displayUnit(kind, pref)) : n;
  };
  const direction = input.direction === undefined ? undefined : ['up', 'down', 'hold'].includes(input.direction as string) ? (input.direction as string) : (() => { throw new RecordError('direction must be up, down or hold', 400); })();
  const status = input.status === undefined ? undefined : ['active', 'achieved', 'dropped'].includes(input.status as string) ? (input.status as string) : (() => { throw new RecordError('status must be active, achieved or dropped', 400); })();
  const deadline = input.deadline === undefined ? undefined : input.deadline === null || input.deadline === '' ? null : isDate(input.deadline) ? input.deadline : (() => { throw new RecordError('deadline must be YYYY-MM-DD', 400); })();
  const label = input.label === undefined ? undefined : typeof input.label === 'string' && input.label.trim() ? input.label.trim().slice(0, 80) : (() => { throw new RecordError('label must be text', 400); })();
  const unit = input.unit === undefined ? undefined : typeof input.unit === 'string' ? input.unit.trim().slice(0, 20) || null : null;
  return { baseline: num(input.baseline, 'baseline'), target: num(input.target, 'target'), direction, status, deadline, label, unit };
}

export async function createGoal(practiceId: string, trainerId: string, clientId: string, input: GoalInput, pref: UnitPreference, now: Date = new Date()) {
  if (!validMetric(input.metric)) throw new RecordError('metric must be bodyweight, sessions_per_week, custom, e1rm:<lift> or measurement:<kind>', 400);
  const metric = input.metric;
  const f = goalFields(input, metric, pref);
  if (metric === 'custom' && !f.label) throw new RecordError('Describe the goal', 400);
  if (f.target == null && metric !== 'custom') throw new RecordError('Set a target', 400);
  // No baseline given: today's value is where the goal starts.
  const baseline = f.baseline !== undefined ? f.baseline : await currentValue(practiceId, clientId, metric, now);
  const target = f.target ?? null;
  const direction = f.direction ?? (baseline != null && target != null ? (target < baseline ? 'down' : target > baseline ? 'up' : 'hold') : 'up');
  const row = await prisma.ptGoal.create({
    data: {
      practiceId, clientId, metric, label: f.label ?? defaultGoalLabel(metric), baseline, target, unit: f.unit ?? null,
      direction, deadline: f.deadline ?? null, createdById: trainerId,
    },
  });
  await audit({ practiceId, trainerId, clientId, action: 'goal_created', itemType: 'goal', itemId: row.id, meta: { metric } });
  return toGoal(row, pref, now);
}

export async function updateGoal(practiceId: string, trainerId: string, clientId: string, id: string, input: GoalInput, pref: UnitPreference, now: Date = new Date()) {
  const row = await prisma.ptGoal.findUnique({ where: { id } });
  if (!row || row.practiceId !== practiceId || row.clientId !== clientId) throw new RecordError('Not found', 404);
  const f = goalFields(input, row.metric as GoalMetric, pref);
  const data = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined));
  const updated = await prisma.ptGoal.update({ where: { id }, data });
  await audit({ practiceId, trainerId, clientId, action: 'goal_updated', itemType: 'goal', itemId: id, meta: data });
  return toGoal(updated, pref, now);
}

// ── Progress photos ──────────────────────────────────────────────────────────

const POSES = ['front', 'side', 'back', 'other'] as const;
const MAX_PHOTO_BASE64 = 8 * 1024 * 1024;

export async function addPhoto(input: {
  practiceId: string; clientId: string; actorId: string; source: 'trainer' | 'client';
  imageBase64: unknown; pose?: unknown; date?: unknown; note?: unknown; now?: Date;
}) {
  if (!blobStoreEnabled()) throw new RecordError('Photo storage is not set up on this server', 503);
  if (typeof input.imageBase64 !== 'string' || input.imageBase64.length < 100) throw new RecordError('imageBase64 is required', 400);
  if (input.imageBase64.length > MAX_PHOTO_BASE64) throw new RecordError('That photo is too large (6 MB max)', 413);
  const pose = input.pose === undefined ? 'front' : POSES.includes(input.pose as any) ? (input.pose as string) : (() => { throw new RecordError('pose must be front, side, back or other', 400); })();
  const now = input.now ?? new Date();
  const date = input.date === undefined ? now.toISOString().slice(0, 10) : isDate(input.date) ? input.date : (() => { throw new RecordError('date must be YYYY-MM-DD', 400); })();
  const stored = await putImageBase64(input.imageBase64);
  if (!stored) throw new RecordError('That photo could not be saved. Use a JPEG, PNG or WebP image.', 400);
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, 300) || null : null;
  const row = await prisma.ptProgressPhoto.create({
    data: { practiceId: input.practiceId, clientId: input.clientId, blobKey: stored.key, pose, date, note, source: input.source },
  });
  if (input.source === 'trainer') await audit({ practiceId: input.practiceId, trainerId: input.actorId, clientId: input.clientId, action: 'photo_added', itemType: 'photo', itemId: row.id });
  return row.id;
}

export async function listPhotos(practiceId: string, clientId: string): Promise<ProgressPhoto[]> {
  const rows = await prisma.ptProgressPhoto.findMany({ where: { practiceId, clientId }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 200 });
  const out: ProgressPhoto[] = [];
  for (const r of rows) {
    const url = await objectUrl(r.blobKey);
    if (url) out.push({ id: r.id, url, pose: r.pose as ProgressPhoto['pose'], date: r.date, ...(r.note ? { note: r.note } : {}), source: r.source as ProgressPhoto['source'] });
  }
  return out;
}

export async function deletePhoto(practiceId: string, actorId: string, clientId: string, id: string, by: 'trainer' | 'client') {
  const row = await prisma.ptProgressPhoto.findUnique({ where: { id } });
  if (!row || row.practiceId !== practiceId || row.clientId !== clientId) throw new RecordError('Not found', 404);
  // Either side may take a photo down. The stored object is content-addressed and may be shared, so only the row goes.
  await prisma.ptProgressPhoto.delete({ where: { id } });
  if (by === 'trainer') await audit({ practiceId, trainerId: actorId, clientId, action: 'photo_deleted', itemType: 'photo', itemId: id });
}
