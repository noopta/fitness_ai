// Follow-ups on the right screen (design flow D, and G3's screen line):
//   D1  Home brief — an open event thread takes an extra block (eyebrow + big countdown)
//   D2  Today — a thread that touches an exercise in this session puts a note
//       before you start, with two inline answers
//   D3  Fuel — the training × nutrition insight (insight.ts)
//   G3  the weight-cut flag as a line on Fuel/Today (free users never see it in chat)
//   G2  the sparse-data note, once
//
// One endpoint (GET /coach/agent/screens) serves all of it so Home, Today and
// Fuel make one call each and the client stays thin.

import { PrismaClient } from '@prisma/client';
import { todayForTz } from '../services/localDate.js';
import { resolveTargets } from '../services/nutritionTargets.js';
import { proactiveAvailableFor } from '../services/featureFlags.js';
import { countdown, exerciseTouches, isOpen, openThreads, parseList, shortDate, type ThreadRow } from './threads.js';
import { fuelInsight, carbDayOverride, type CarbsRepsInsight } from './insight.js';
import { currentWeightCutFlag } from './safety.js';
import { sparseDataNote, MIN_SESSIONS } from './gate.js';
import { isCutting } from './sweep.js';

const prisma = new PrismaClient();

export const EVENT_PHASES = ['Recover', 'Build', 'Peak', 'Cut'] as const;

export interface EventBlock { threadId: string; title: string; date: string; dateLabel: string; daysOut: number; note: string | null; phases: readonly string[]; phaseIndex: number; sub: string | null }
export interface TodayNote { threadId: string; exercise: string; text: string; sub: string | null; options: [string, string] }
export interface Screens {
  event: EventBlock | null;
  todayNote: TodayNote | null;
  fuelInsight: (CarbsRepsInsight & { appliedCarbsG: number | null }) | null;
  safety: { headline: string; help: string } | null;
  sparse: { text: string; progress: { done: number; of: number } } | null;
}

/** Pure: D1. The soonest open event that hasn't passed. */
export function eventBlock(threads: ThreadRow[], today: string): EventBlock | null {
  const ev = threads.filter((t) => isOpen(t) && t.kind === 'event' && t.eventDate && t.eventDate >= today).sort((a, b) => a.eventDate!.localeCompare(b.eventDate!))[0];
  if (!ev) return null;
  const daysOut = countdown(ev.eventDate!, today);
  const recovering = threads.some((t) => isOpen(t) && t.kind === 'experiment' && /recover|deload/i.test(t.title));
  const phaseIndex = recovering ? 0 : daysOut > 14 ? 1 : daysOut > 3 ? 2 : 3;
  const running = threads.find((t) => isOpen(t) && t.kind === 'experiment');
  return {
    threadId: ev.id, title: ev.title.replace(/\s*·.*$/, ''), date: ev.eventDate!, dateLabel: shortDate(ev.eventDate!), daysOut,
    note: ev.read ?? null, phases: EVENT_PHASES, phaseIndex,
    sub: running ? `${running.title}${running.read ? ` · ${running.read.toLowerCase()}` : ''}` : null,
  };
}


/** Pure: D2. Only when an open symptom/experiment thread touches an exercise in this session. */
export function todayNote(threads: ThreadRow[], sessionExercises: string[]): TodayNote | null {
  if (!sessionExercises.length) return null;
  for (const t of threads.filter((x) => isOpen(x) && (x.kind === 'symptom' || x.kind === 'experiment'))) {
    const affects = parseList(t.affectsJson);
    const hit = sessionExercises.find((e) => exerciseTouches(affects, e));
    if (!hit) continue;
    const quiet = t.kind === 'symptom' && t.lastRaisedAt == null && t.sourceAt ? Math.floor((Date.now() - t.sourceAt.getTime()) / (7 * 86_400_000)) : 0;
    const text = t.kind === 'symptom'
      ? `${t.title.replace(/^left |^right /i, (m) => m)} check: if it talks on set 2 of ${hit.toLowerCase()}, stop and flag it.`
      : `${t.title}: ${t.read ?? `${hit} is part of it — log it as written.`}`;
    const sub = t.kind === 'symptom' ? (quiet >= 2 ? `Quiet ${quiet} weeks — I'd like to close this out today.` : (t.read ?? null)) : null;
    return { threadId: t.id, exercise: hit, text, sub, options: ['Got it', 'It\'s fine now'] };
  }
  return null;
}

export async function loadScreens(userId: string, opts: { sessionExercises?: string[]; now?: Date } = {}): Promise<Screens> {
  const now = opts.now ?? new Date();
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, tier: true, timezone: true, savedProgram: true, coachProfile: true, dailyCalorieTarget: true } });
  const empty: Screens = { event: null, todayNote: null, fuelInsight: null, safety: null, sparse: null };
  if (!u || !proactiveAvailableFor(userId, u.email)) return empty;
  const today = todayForTz(u.timezone || 'UTC', now);
  const threads = await openThreads(userId);
  const event = eventBlock(threads, today);
  const note = todayNote(threads, opts.sessionExercises ?? []);
  const flag = await currentWeightCutFlag(userId, today, !!event).catch(() => null);
  const isPro = u.tier === 'pro' || u.tier === 'enterprise';
  let insight: Screens['fuelInsight'] = null;
  if (isPro) {
    const targets = resolveTargets({ savedProgram: u.savedProgram, coachProfile: u.coachProfile, dailyCalorieTarget: u.dailyCalorieTarget });
    const cutting = await isCutting(userId).catch(() => false);
    const r = await fuelInsight(userId, today, { cutting, carbTargetG: targets?.carbsG ?? null, sessionLifts: opts.sessionExercises }).catch(() => null);
    if (r) insight = { ...r, appliedCarbsG: carbDayOverride(u.coachProfile, today) };
  }
  let sparse: Screens['sparse'] = null;
  if (isPro) {
    const sessions = await prisma.workoutLog.count({ where: { userId } });
    const blob = (() => { try { return JSON.parse(u.coachProfile ?? '{}'); } catch { return {}; } })();
    if (sessions < MIN_SESSIONS && !blob.sparseNoteShown) sparse = sparseDataNote(sessions);
  }
  return { event, todayNote: note, fuelInsight: insight, safety: flag ? { headline: flag.headline, help: flag.help } : null, sparse };
}
