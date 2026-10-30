// The day a chat log goes on, and the trace saved with it (Oct 2026).
// dayWords.ts holds the rule; this gathers what it needs for the turn in
// flight — their words, when they sent them, the message before, the day of
// their last log — and builds the `logTrace` the row keeps, so "why is this
// on Monday?" has an answer in the database.

import { PrismaClient } from '@prisma/client';
import { chooseLogDate, type DayChoice } from './dayWords.js';
import { turnFacts } from './turnMessage.js';
import { recordLogTruth } from '../services/opsWatch.js';

const prisma = new PrismaClient();

/** A split message ("…and then I did BJJ" a minute later) carries the day across. */
export const SPLIT_MS = 10 * 60_000;
/** Anakin's question about a day ("What did you do Monday?") carries for an hour. */
export const ASKED_MS = 60 * 60_000;
/** "That day" means the day of their last log, if it was this recent. */
export const REF_MS = 6 * 60 * 60_000;

export interface LogTrace {
  via: 'chat' | 'app' | 'import';
  /** When the user sent the message the log came from (ISO). */
  sentAt?: string;
  /** Their local clock then: "Tue 27 Oct, 2:43 pm · America/Regina". */
  local?: string;
  basis?: DayChoice['basis'] | 'client';
  /** Their words that named the day. */
  said?: string;
  /** The date the model asked for, when it was set aside. */
  modelDate?: string;
  tool?: string;
}

function localParts(tz: string, at: Date) {
  let zone = tz;
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); } catch { zone = 'America/New_York'; }
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', hourCycle: 'h23' }).format(at)) % 24;
  const label = `${at.toLocaleDateString('en-GB', { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short' })}, ${at.toLocaleTimeString('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' }).toLowerCase()} · ${zone}`;
  return { today, hour, label };
}

async function lastLogDate(userId: string, now: Date): Promise<string | null> {
  const since = new Date(now.getTime() - REF_MS);
  const [w, m] = await Promise.all([
    prisma.workoutLog.findFirst({ where: { userId, createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, select: { date: true, createdAt: true } }).catch(() => null),
    prisma.mealEntry.findFirst({ where: { userId, createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, select: { date: true, createdAt: true } }).catch(() => null),
  ]);
  const latest = [w, m].filter(Boolean).sort((a, b) => +b!.createdAt - +a!.createdAt)[0];
  return latest?.date ?? null;
}

export type LogDate = { date: string; trace: LogTrace; choice: DayChoice } | { ask: string };

/** The day for a log a tool is about to save this turn, from the user's words. */
export async function logDateFor(userId: string, tz: string, modelDate: unknown, tool: string, now = new Date()): Promise<LogDate> {
  const f = turnFacts(userId);
  const sent = new Date(Date.parse(f.sentAt) || now.getTime());
  const { today, hour, label } = localParts(tz, sent);
  const recent = f.prevUser && sent.getTime() - Date.parse(f.prevUser.at) <= SPLIT_MS ? f.prevUser.text : null;
  const askedQ = f.prevAssistant && sent.getTime() - Date.parse(f.prevAssistant.at) <= ASKED_MS
    ? f.prevAssistant.text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().endsWith('?')).join(' ')
    : null;
  const choice = chooseLogDate({
    modelDate: typeof modelDate === 'string' ? modelDate : null,
    today, localHour: hour, text: f.text,
    recentUserText: recent, askedText: askedQ || null,
    lastLogDate: await lastLogDate(userId, now),
  });
  if ('ask' in choice) return choice;
  if (choice.basis === 'overruled') {
    recordLogTruth('date_overruled');
    console.warn(`[logtruth] date overruled user=${userId.slice(0, 8)} tool=${tool} model=${choice.modelDate} → ${choice.date}${choice.said ? ` said="${choice.said}"` : ''}`);
  }
  return {
    date: choice.date, choice,
    trace: { via: 'chat', sentAt: sent.toISOString(), local: label, basis: choice.basis, ...(choice.said ? { said: choice.said } : {}), ...(choice.modelDate ? { modelDate: choice.modelDate } : {}), tool },
  };
}

/** The activity nudge (activityReport.ts) with the day's real sessions, read from the database. */
export async function activityNudgeFor(userId: string, tz: string, now = new Date()): Promise<string> {
  const { activityLogNudge } = await import('./activityReport.js');
  const { shortDayLabel } = await import('./dayWords.js');
  const d = await logDateFor(userId, tz, null, 'nudge', now).catch(() => null);
  const date = d && 'date' in d ? d.date : localParts(tz, now).today;
  const rows = await prisma.workoutLog.findMany({ where: { userId, date }, orderBy: { createdAt: 'asc' }, select: { title: true, date: true, createdAt: true } }).catch(() => []);
  const sessions = rows.map((r) => ({ title: r.title, date: r.date, loggedAt: localParts(tz, r.createdAt).label.replace(/ · .*$/, '') }));
  return activityLogNudge(shortDayLabel(date), sessions);
}
