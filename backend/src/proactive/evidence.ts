// Evidence the fixed rules verified — the receipt lines under a check-in
// ("CHECKED — 6 hard sessions in 6 days", "READ — 'Legs are cooked' · you,
// yesterday"). Every item is computed here from DB rows; the reasoner can
// only *cite* items by id, never write its own. That is the design's rule:
// "every line is a DB value the fixed rules verified, not model prose."
//
// Used: logged sets and sessions, meals, check-ins (sleep, energy), what the
// user said in chat, weigh-ins, open event threads. Not used: HRV, soreness
// scores — no user has them.

import { PrismaClient } from '@prisma/client';
import { loadStoredMessages, stripAppNotes } from '../agent/conversation.js';
import { historyFromRows } from '../services/trainingSummary.js';
import { addDays, shortDate, type ThreadRow } from './threads.js';

const prisma = new PrismaClient();

export interface EvidenceItem {
  id: string;
  verb: 'Checked' | 'Read';
  text: string;
  /** What the item speaks to — the reasoner picks items that match its topic. */
  topics: string[];
}

export interface WorkoutRow { date: string; title: string | null; exercises: string; duration?: number | null }
export interface CheckinRow { date: string; energy: number | null; sleepHours: number | null; stress?: number | null }
export interface MessageRow { role: 'user' | 'assistant'; text: string; at?: string; origin?: string }
export interface MealDayRow { date: string; proteinG: number; kcal: number }
export interface WeighInRow { date: string; weightKg: number }

export interface EvidenceInput {
  today: string;
  workouts: WorkoutRow[];
  checkins: CheckinRow[];
  messages: MessageRow[];
  mealDays: MealDayRow[];
  proteinTarget: number | null;
  weighIns: WeighInRow[];
  threads: Pick<ThreadRow, 'kind' | 'title' | 'eventDate' | 'status'>[];
  /** Exposures per canonical lift, newest first: [{ date, weightKg, reps }] — from trainingSummary. */
  lifts: { name: string; sessions: { date: string; weightKg: number; reps: number }[] }[];
}

const COMBAT = /\b(mma|sparring|boxing|muay thai|bjj|jiu[- ]?jitsu|wrestling|kickbox|grappling|rolling)\b/i;
const HARD_RPE = 8;

/** A session counts as hard when it's combat work, long, or any set was RPE ≥ 8. */
export function isHardSession(w: WorkoutRow): boolean {
  if (COMBAT.test(w.title ?? '')) return true;
  if ((w.duration ?? 0) >= 60) return true;
  try {
    const ex = JSON.parse(w.exercises);
    if (!Array.isArray(ex)) return false;
    if (ex.some((e: any) => COMBAT.test(String(e?.name ?? '')))) return true;
    return ex.some((e: any) => (e?.rpe ?? 0) >= HARD_RPE || (Array.isArray(e?.setEntries) && e.setEntries.some((s: any) => (s?.rpe ?? 0) >= HARD_RPE)));
  } catch { return false; }
}

export function sessionsEvidence(workouts: WorkoutRow[], today: string, days = 7): EvidenceItem | null {
  const since = addDays(today, -(days - 1));
  const dates = new Set(workouts.filter((w) => w.date >= since && w.date <= today).map((w) => w.date));
  if (dates.size < 3) return null;
  const hard = new Set(workouts.filter((w) => w.date >= since && w.date <= today && isHardSession(w)).map((w) => w.date)).size;
  const n = dates.size;
  const text = hard >= Math.ceil(n / 2) ? `${hard} hard sessions in ${days} days` : `${n} sessions in ${days} days`;
  return { id: 'sessions_week', verb: 'Checked', text, topics: ['recovery', 'training load', 'fatigue'] };
}

/** Streak of consecutive training days ending today or yesterday ("6 hard days in a row"). */
export function streakEvidence(workouts: WorkoutRow[], today: string): EvidenceItem | null {
  const dates = new Set(workouts.map((w) => w.date));
  let d = dates.has(today) ? today : addDays(today, -1);
  if (!dates.has(d)) return null;
  let n = 0;
  while (dates.has(d)) { n++; d = addDays(d, -1); }
  if (n < 4) return null;
  const hard = [...dates].filter((x) => x > d && workouts.some((w) => w.date === x && isHardSession(w))).length;
  return { id: 'streak_days', verb: 'Checked', text: `${n} ${hard >= Math.ceil(n / 2) ? 'hard ' : ''}days in a row`, topics: ['recovery', 'training load', 'fatigue'] };
}

export function energyEvidence(checkins: CheckinRow[], n = 3): EvidenceItem | null {
  const recent = checkins.filter((c) => c.energy != null).slice(0, n);
  if (recent.length < n) return null;
  const vals = recent.map((c) => c.energy as number);
  const max = Math.max(...vals);
  if (max > 2) return null;
  return { id: 'energy_low', verb: 'Checked', text: `Energy ${max} of 5 at your last ${n} check-ins`, topics: ['recovery', 'fatigue', 'sleep'] };
}

export function sleepEvidence(checkins: CheckinRow[], nights = 4): EvidenceItem | null {
  const recent = checkins.filter((c) => c.sleepHours != null).slice(0, nights);
  if (recent.length < 3) return null;
  const short = recent.filter((c) => (c.sleepHours as number) < 6).length;
  if (short < 3) return null;
  return { id: 'sleep_short', verb: 'Checked', text: `Under 6 h sleep on ${short} of the last ${recent.length} nights`, topics: ['recovery', 'sleep', 'fatigue'] };
}

const QUOTE_WORDS = /\b(cooked|wrecked|dead|exhausted|tired|sore|sorest|beat up|rough|brutal|cranky|tight|tweak|twinge|tingl(?:e|ing)|pinch|hurts?|pain|ache|aching|niggle|clicking|stuck|stalled|plateau|fight|meet|competition|race|comp|cut(?:ting)?|weigh-?in|wedding|trip|travel(?:ling)?|holiday|vacation|deadline|stress(?:ed)?)\b/i;

/** The user's own words, recent, that speak to how they're doing. Up to `max` of them, newest first. */
export function quoteEvidence(messages: MessageRow[], today: string, max = 2, days = 14): EvidenceItem[] {
  const since = addDays(today, -days);
  const out: EvidenceItem[] = [];
  const seen = new Set<string>();
  for (const m of [...messages].sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))) {
    if (m.role !== 'user' || !m.at || m.at.slice(0, 10) < since) continue;
    const text = stripAppNotes(m.text).replace(/\s+/g, ' ').trim();
    if (!QUOTE_WORDS.test(text) || text.length > 240) continue;
    // The most quotable sentence: one naming the body or the event first ("Legs are cooked"), a general one ("rough") only when that's all there is.
    const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
    const strong = /\b(cooked|wrecked|dead|exhausted|sore|sorest|beat up|cranky|tweak|twinge|tingl(?:e|ing)|pinch|hurts?|pain|ache|aching|niggle|clicking|stuck|stalled|plateau|fight|meet|competition|race|comp|cut(?:ting)?|weigh-?in|wedding|trip|travel(?:ling)?|holiday|vacation|deadline)\b/i;
    const sentence = (sentences.find((s) => strong.test(s)) ?? sentences.find((s) => QUOTE_WORDS.test(s)) ?? text).trim();
    const key = sentence.toLowerCase();
    if (seen.has(key) || sentence.length < 6) continue;
    seen.add(key);
    const day = m.at.slice(0, 10);
    const when = day === today ? 'today' : day === addDays(today, -1) ? 'yesterday' : shortDate(day);
    out.push({ id: `quote_${m.at}`, verb: 'Read', text: `“${sentence.replace(/^"|"$/g, '').slice(0, 90)}” · you, ${when}`, topics: ['the user said'] });
    if (out.length >= max) break;
  }
  return out;
}

/** A lift whose top set hasn't moved for ≥ 4 sessions ("Bench has sat at 135 × 5 for four sessions"). */
export function stalledLiftEvidence(lifts: EvidenceInput['lifts'], unit: 'lb' | 'kg' = 'lb'): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  for (const l of lifts) {
    const s = l.sessions.filter((x) => x.weightKg > 0 && x.reps > 0);
    if (s.length < 4) continue;
    const [a, ...rest] = s.slice(0, 6);
    let n = 1;
    for (const x of rest) { if (Math.abs(x.weightKg - a.weightKg) < 0.5 && x.reps === a.reps) n++; else break; }
    if (n < 4) continue;
    const w = unit === 'kg' ? Math.round(a.weightKg) : Math.round(a.weightKg * 2.20462);
    out.push({ id: `stalled_${l.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`, verb: 'Checked', text: `${l.name} · ${w} × ${a.reps} for the last ${n} sessions`, topics: ['plateau', l.name.toLowerCase(), 'progression'] });
  }
  return out;
}

export function proteinEvidence(mealDays: MealDayRow[], target: number | null, today: string, days = 7): EvidenceItem | null {
  if (!target) return null;
  const since = addDays(today, -(days - 1));
  const logged = mealDays.filter((d) => d.date >= since && d.date <= today && d.kcal > 0);
  if (logged.length < 3) return null;
  const short = logged.filter((d) => d.proteinG < target * 0.8).length;
  if (short < 3) return null;
  return { id: 'protein_short', verb: 'Checked', text: `Protein short on ${short} of the last ${logged.length} logged days`, topics: ['nutrition', 'protein', 'recovery'] };
}

export function weighInEvidence(weighIns: WeighInRow[], today: string): EvidenceItem | null {
  const since = addDays(today, -6);
  const w = weighIns.filter((x) => x.date >= since && x.date <= today);
  if (w.length < 2) return null;
  return { id: 'weigh_ins', verb: 'Checked', text: `Weight · ${w.length} weigh-ins this week`, topics: ['weight', 'cut'] };
}

export function eventEvidence(threads: EvidenceInput['threads'], today: string): EvidenceItem[] {
  return threads.filter((t) => t.kind === 'event' && t.eventDate && ['open', 'watching', 'running'].includes(t.status) && t.eventDate >= today)
    .map((t) => ({ id: `event_${t.eventDate}`, verb: 'Checked' as const, text: `${t.title.replace(/\s*·.*$/, '')} · ${shortDate(t.eventDate!)}`, topics: ['event', 'the fight', 'peaking', 'cut'] }));
}

/** Pure: the whole catalog for one user. */
export function buildEvidence(i: EvidenceInput, unit: 'lb' | 'kg' = 'lb'): EvidenceItem[] {
  return [
    streakEvidence(i.workouts, i.today) ?? sessionsEvidence(i.workouts, i.today),
    energyEvidence(i.checkins), sleepEvidence(i.checkins),
    ...quoteEvidence(i.messages, i.today),
    ...stalledLiftEvidence(i.lifts, unit),
    proteinEvidence(i.mealDays, i.proteinTarget, i.today),
    weighInEvidence(i.weighIns, i.today),
    ...eventEvidence(i.threads, i.today),
  ].filter((x): x is EvidenceItem => !!x);
}

/** Load the rows the catalog needs. Sessions and meal-day counts come back too — the gate's G2 numbers. */
export async function loadEvidenceInput(userId: string, today: string, threads: ThreadRow[], proteinTarget: number | null): Promise<EvidenceInput & { sessionCount: number; mealDayCount: number }> {
  const since30 = addDays(today, -30);
  const [workouts, checkins, meals, weighs, messages, sessionCount, mealDayRows] = await Promise.all([
    prisma.workoutLog.findMany({ where: { userId, date: { gte: addDays(today, -120) } }, orderBy: { date: 'asc' }, select: { id: true, date: true, title: true, exercises: true, duration: true } }),
    prisma.wellnessCheckin.findMany({ where: { userId }, orderBy: { date: 'desc' }, take: 8, select: { date: true, energy: true, sleepHours: true, stress: true } }),
    prisma.mealEntry.findMany({ where: { userId, date: { gte: since30 } }, select: { date: true, proteinG: true, calories: true } }),
    prisma.bodyWeightLog.findMany({ where: { userId, date: { gte: since30 } }, orderBy: { date: 'asc' }, select: { date: true, weightKg: true, weightLbs: true } }),
    loadStoredMessages(userId),
    prisma.workoutLog.count({ where: { userId } }),
    prisma.mealEntry.findMany({ where: { userId }, select: { date: true }, distinct: ['date'] }),
  ]);
  const byDay = new Map<string, MealDayRow>();
  for (const m of meals) { const d = byDay.get(m.date) ?? { date: m.date, proteinG: 0, kcal: 0 }; d.proteinG += m.proteinG ?? 0; d.kcal += m.calories ?? 0; byDay.set(m.date, d); }
  const history = historyFromRows(workouts.map((w) => ({ id: w.id, date: w.date, title: w.title, exercises: w.exercises })));
  const lifts: EvidenceInput['lifts'] = [];
  for (const [key, exps] of history.exposures) {
    if (exps.length < 4) continue;
    lifts.push({ name: history.displayName(key), sessions: exps.map((e) => ({ date: e.date, weightKg: e.top?.weightKg ?? 0, reps: e.top?.reps ?? 0 })) });
  }
  return {
    today, workouts, checkins, messages: messages as MessageRow[], mealDays: [...byDay.values()], proteinTarget,
    weighIns: weighs.map((w) => ({ date: w.date, weightKg: w.weightKg ?? (w.weightLbs ? w.weightLbs / 2.20462 : 0) })).filter((w) => w.weightKg > 0),
    threads, lifts, sessionCount, mealDayCount: mealDayRows.length,
  };
}
