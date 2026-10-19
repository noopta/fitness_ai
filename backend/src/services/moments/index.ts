// Progress moments — the DB half. Called after a workout, a meal or a
// weigh-in is saved; builds the moment (./build.ts), keeps one per category
// per day, and serves it to the app and Anakin.
//
// Never throws into the caller: a moment is a celebration, and a failure here
// must not fail the log that earned it.

import { PrismaClient } from '@prisma/client';
import { buildWorkoutMoment, buildNutritionMoment, buildCutMoment, mondayOf, type BuiltMoment, type HistoryLog, type LoggedExercise } from './build.js';
import type { ProgressMoment, ShareUnit } from './types.js';
import { loadCanonicalResolver } from '../liftCanonical.js';
import { bestE1RMByLift } from '../progressService.js';
import { bodyWeightKg } from '../weightUnits.js';
import { resolveTargets } from '../nutritionTargets.js';
import { todayForTz } from '../localDate.js';
import { parseUserPrefs } from '../userPrefs.js';

const prisma = new PrismaClient();
const DAY = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const parse = <T>(s: string | null | undefined, fb: T): T => { try { return s ? JSON.parse(s) : fb; } catch { return fb; } };
const unitOf = (pref: string | null | undefined): ShareUnit => (pref === 'metric' ? 'kg' : 'lb');

type Row = Awaited<ReturnType<typeof prisma.progressMoment.findUnique>>;

/** The API shape (packages/agent-ui-core ProgressMoment). */
export function toMoment(r: NonNullable<Row>, canShare: boolean): ProgressMoment {
  return {
    id: r.id, type: r.type as ProgressMoment['type'], label: r.label, title: r.title, praise: r.praise,
    why: parse<string[]>(r.whyJson, []), shareables: parse(r.shareablesJson, []),
    sharedAt: r.sharedAt?.toISOString() ?? null, canShare,
  };
}

async function canShare(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { prefsJson: true } });
  return parseUserPrefs(u?.prefsJson).shareCards !== false;
}

/**
 * Keep one moment per category per day. A workout replaces that day's moment
 * unless the day already has a PR and this one isn't (the PR is the better
 * story); a replaced moment starts fresh (not shared, not dismissed).
 */
async function save(userId: string, category: 'workout' | 'nutrition' | 'cut', date: string, m: BuiltMoment, workoutLogId: string | null): Promise<{ row: NonNullable<Row>; fresh: boolean }> {
  const existing = await prisma.progressMoment.findUnique({ where: { userId_category_date: { userId, category, date } } });
  if (existing && category === 'workout' && existing.type === 'pr' && m.type !== 'pr' && existing.workoutLogId !== workoutLogId) return { row: existing, fresh: false };
  if (existing && category === 'nutrition') return { row: existing, fresh: false };
  const data = {
    type: m.type, label: m.label, title: m.title, praise: m.praise, whyJson: JSON.stringify(m.why), shareablesJson: JSON.stringify(m.shareables),
    score: m.score, workoutLogId, sharedAt: null, dismissedAt: null,
  };
  const row = existing
    ? await prisma.progressMoment.update({ where: { id: existing.id }, data })
    : await prisma.progressMoment.create({ data: { userId, category, date, ...data } });
  return { row, fresh: true };
}

// ── Workouts ────────────────────────────────────────────────────────────────

export interface WorkoutMomentOpts {
  prs?: { key: string; displayName: string; e1RMLbs: number; prevLbs: number; deltaLbs: number }[];
  /** A backfill batch of this many sessions; this log is its most recent. */
  batch?: number;
}

/** The moment a just-saved workout earned (PR or session), saved and returned. Null only on failure. */
export async function momentForWorkout(userId: string, logId: string, opts: WorkoutMomentOpts = {}): Promise<ProgressMoment | null> {
  try {
    const log = await prisma.workoutLog.findUnique({ where: { id: logId } });
    if (!log || log.userId !== userId) return null;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { unitPreference: true, timezone: true, weightKg: true, prefsJson: true } });
    const exercises = parse<LoggedExercise[]>(log.exercises, []);
    const from = addDays(log.date, -16 * 7);
    const rows = await prisma.workoutLog.findMany({ where: { userId, date: { gte: from, lte: log.date } }, orderBy: { date: 'desc' }, take: 400, select: { id: true, date: true, exercises: true } });
    const history: HistoryLog[] = rows.map((r) => ({ id: r.id, date: r.date, exercises: parse<LoggedExercise[]>(r.exercises, []) }));
    const resolver = await loadCanonicalResolver(prisma, [...exercises, ...history.flatMap((h) => h.exercises)].map((e) => e?.name).filter(Boolean));
    const keyFn = (n: string) => resolver.key(n) || n.trim().toLowerCase();
    const bw = await prisma.bodyWeightLog.findFirst({ where: { userId, date: { lte: log.date } }, orderBy: { date: 'desc' }, select: { weightKg: true, weightLbs: true } });
    const built = buildWorkoutMoment({
      log: { id: log.id, date: log.date, title: log.title, duration: log.duration, exercises },
      history, keyFn, unit: unitOf(user?.unitPreference), bodyweightKg: bodyWeightKg(bw) ?? user?.weightKg ?? null,
      prs: opts.prs ?? [], today: todayForTz(user?.timezone), batch: opts.batch,
    });
    const { row } = await save(userId, 'workout', log.date, built, log.id);
    return toMoment(row, parseUserPrefs(user?.prefsJson).shareCards !== false);
  } catch (err: any) {
    console.error('[moments] workout moment failed:', err?.message ?? err);
    return null;
  }
}

/** A deleted workout takes its moment with it. */
export async function dropMomentsForWorkout(logId: string) {
  await prisma.progressMoment.deleteMany({ where: { workoutLogId: logId } }).catch(() => {});
}

// ── Nutrition ───────────────────────────────────────────────────────────────

/**
 * After a meal is logged for `date`: a moment the first time that day's
 * protein reaches the target. `fresh` is false when the day already had one
 * (the app shows the prompt once per day).
 */
export async function momentForNutrition(userId: string, date: string): Promise<{ moment: ProgressMoment; fresh: boolean } | null> {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { savedProgram: true, coachProfile: true, dailyCalorieTarget: true, prefsJson: true } });
    if (!user) return null;
    const targets = resolveTargets(user);
    if (!targets?.proteinG) return null;
    const meals = await prisma.mealEntry.findMany({ where: { userId, date }, orderBy: { createdAt: 'asc' }, select: { name: true, mealType: true, proteinG: true, carbsG: true, fatG: true, calories: true } });
    const mon = mondayOf(date);
    const week = await prisma.mealEntry.groupBy({ by: ['date'], where: { userId, date: { gte: mon, lte: addDays(mon, 6) } }, _sum: { proteinG: true } });
    const built = buildNutritionMoment({
      date, meals, targets: { calories: targets.calories, proteinG: targets.proteinG, carbsG: targets.carbsG, fatG: targets.fatG },
      weekProtein: Object.fromEntries(week.map((w) => [w.date, w._sum.proteinG ?? 0])),
    });
    if (!built) return null;
    const { row, fresh } = await save(userId, 'nutrition', date, built, null);
    return { moment: toMoment(row, parseUserPrefs(user.prefsJson).shareCards !== false), fresh };
  } catch (err: any) {
    console.error('[moments] nutrition moment failed:', err?.message ?? err);
    return null;
  }
}

// ── Weigh-ins: the cut ──────────────────────────────────────────────────────

/** Whether the user is cutting: a goal weight below where they are, or a fat-loss goal. */
function cutting(user: { goalWeightKg: number | null; coachProfile: string | null }, nowKg: number): boolean {
  if (user.goalWeightKg != null && user.goalWeightKg < nowKg - 0.5) return true;
  const cp = parse<any>(user.coachProfile, {});
  // Same test as llmService.extractBodyCompositionGoal's fat_loss branch (not imported: that module pulls in the LLM clients).
  return /lose weight|fat loss|fat-loss|\bcut\b|cutting|leaner|lean out|deficit|drop.*lb|drop.*weight|lose.*lb|lose.*fat|shred|slim/i.test(String(cp?.primaryGoal ?? cp?.goal ?? cp?.goals ?? ''));
}

/** After a weigh-in: at most one cut moment a week, once the cut is ≥ 4 weeks old and the 7-day average is down. */
export async function momentForWeighIn(userId: string): Promise<{ moment: ProgressMoment; fresh: boolean } | null> {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { unitPreference: true, timezone: true, goalWeightKg: true, coachProfile: true, prefsJson: true } });
    if (!user) return null;
    const today = todayForTz(user.timezone);
    const raw = await prisma.bodyWeightLog.findMany({ where: { userId, date: { gte: addDays(today, -16 * 7), lte: today } }, orderBy: { date: 'asc' }, select: { date: true, weightKg: true, weightLbs: true } });
    const weighIns = raw.map((r) => ({ date: r.date, kg: bodyWeightKg(r) })).filter((r): r is { date: string; kg: number } => r.kg != null);
    if (weighIns.length < 6 || !cutting(user, weighIns[weighIns.length - 1].kg)) return null;
    const recent = await prisma.progressMoment.findFirst({ where: { userId, category: 'cut', date: { gt: addDays(today, -7) } } });
    if (recent) return null;

    // Strength over the same weeks: the three most-trained lifts, best estimated max in the first and last fortnight.
    const unit = unitOf(user.unitPreference);
    const start = weighIns[0].date;
    const logs = await prisma.workoutLog.findMany({ where: { userId, date: { gte: start, lte: today } }, select: { date: true, exercises: true } });
    const parsed = logs.map((l) => ({ date: l.date, exercises: parse<LoggedExercise[]>(l.exercises, []) }));
    const resolver = await loadCanonicalResolver(prisma, parsed.flatMap((l) => l.exercises.map((e) => e?.name)).filter(Boolean));
    const keyFn = (n: string) => resolver.key(n) || n.trim().toLowerCase();
    const freq = new Map<string, { name: string; n: number; start: number; now: number }>();
    for (const l of parsed) {
      const early = l.date <= addDays(start, 13), late = l.date > addDays(today, -14);
      for (const [k, b] of bestE1RMByLift(l.exercises as any, keyFn)) {
        const f = freq.get(k) ?? { name: b.displayName, n: 0, start: 0, now: 0 };
        f.n++;
        const v = unit === 'lb' ? Math.round(b.e1RMLbs) : Math.round(b.e1RMLbs / 2.20462);
        if (early) f.start = Math.max(f.start, v);
        if (late) f.now = Math.max(f.now, v);
        freq.set(k, f);
      }
    }
    const lifts = [...freq.values()].filter((f) => f.start > 0 && f.now > 0).sort((a, b) => b.n - a.n).slice(0, 3).map(({ name, start, now }) => ({ name, start, now }));
    const built = buildCutMoment({ unit, weighIns, lifts, today });
    if (!built) return null;
    const { row, fresh } = await save(userId, 'cut', today, built, null);
    return { moment: toMoment(row, parseUserPrefs(user.prefsJson).shareCards !== false), fresh };
  } catch (err: any) {
    console.error('[moments] cut moment failed:', err?.message ?? err);
    return null;
  }
}

// ── Reads and marks ─────────────────────────────────────────────────────────

export async function getMoment(userId: string, id: string): Promise<ProgressMoment | null> {
  const row = await prisma.progressMoment.findUnique({ where: { id } });
  if (!row || row.userId !== userId) return null;
  return toMoment(row, await canShare(userId));
}

export async function recentMoments(userId: string, limit = 10): Promise<ProgressMoment[]> {
  const rows = await prisma.progressMoment.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' }, take: Math.min(30, Math.max(1, limit)) });
  const share = await canShare(userId);
  return rows.map((r) => toMoment(r, share));
}

export async function markMoment(userId: string, id: string, what: 'shared' | 'dismissed'): Promise<boolean> {
  const r = await prisma.progressMoment.updateMany({ where: { id, userId }, data: what === 'shared' ? { sharedAt: new Date() } : { dismissedAt: new Date() } });
  return r.count > 0;
}

// ── On request: "can I share my workout?" ───────────────────────────────────

export type ShareWhat = 'workout' | 'nutrition' | 'cut' | 'latest';

/**
 * The moment to share when the user asks for one after the fact (Anakin's
 * share_progress): a workout's (built now if it never got one — logs from
 * before moments existed, or from the classic app), the day's protein goal,
 * the cut, or simply the latest. `none` says why there's nothing.
 */
export async function momentToShare(userId: string, what: ShareWhat, date?: string | null): Promise<{ moment: ProgressMoment } | { none: string }> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { timezone: true, prefsJson: true } });
  const share = parseUserPrefs(user?.prefsJson).shareCards !== false;
  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  if (what === 'latest') {
    const row = await prisma.progressMoment.findFirst({ where: { userId, ...(day ? { date: day } : {}) }, orderBy: { updatedAt: 'desc' } });
    if (row) return { moment: toMoment(row, share) };
    what = 'workout';
  }
  if (what === 'workout') {
    const log = await prisma.workoutLog.findFirst({ where: { userId, ...(day ? { date: day } : {}) }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] });
    if (!log) return { none: day ? `No workout logged on ${day}.` : 'No workouts logged yet.' };
    // The day already has its moment (the best of its sessions): share that one.
    const existing = await prisma.progressMoment.findUnique({ where: { userId_category_date: { userId, category: 'workout', date: log.date } } });
    if (existing) return { moment: toMoment(existing, share) };
    const { detectStrengthPRs } = await import('../progressService.js');
    const prs = await detectStrengthPRs(prisma, userId, log.id, parse<LoggedExercise[]>(log.exercises, []) as any, log.date).catch(() => []);
    const m = await momentForWorkout(userId, log.id, { prs });
    return m ? { moment: m } : { none: 'I couldn’t build a card for that workout.' };
  }
  if (what === 'nutrition') {
    const d = day ?? todayForTz(user?.timezone);
    const r = await momentForNutrition(userId, d);
    return r ? { moment: r.moment } : { none: `Protein isn’t at target for ${d} yet — the goal card unlocks when it is.` };
  }
  const row = await prisma.progressMoment.findFirst({ where: { userId, category: 'cut' }, orderBy: { updatedAt: 'desc' } });
  if (row) return { moment: toMoment(row, share) };
  const r = await momentForWeighIn(userId);
  return r ? { moment: r.moment } : { none: 'The cut card needs about four weeks of weigh-ins trending down toward a goal weight below where you are.' };
}
