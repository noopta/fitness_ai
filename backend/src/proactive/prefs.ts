// Proactive coach preferences (design F1 "How often Anakin reaches out" and
// B9 "Who runs your program?"). Stored under prefsJson.proactive on User so
// no column is needed; defaults are the design's: Normal (up to 1 a day),
// push only when time-sensitive, quiet 22:00–07:00, outcome reports on.
//
// Everything here is pure except the two DB accessors at the bottom, so the
// gate (gate.ts) can be tested without Prisma.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export type Frequency = 'rarely' | 'normal' | 'often';
/** me = Anakin applies after confirm · coach_offline = suggestions go out through the share sheet · coach_axiom = to their inbox. */
export type ProgramOwner = 'me' | 'coach_offline' | 'coach_axiom';

export interface MutedTopic { topic: string; until: string | null; mutedAt: string }

export interface ProactivePrefs {
  frequency: Frequency;
  pushTimeSensitive: boolean;
  /** Local hours, 0–23. quietStart > quietEnd wraps midnight (22 → 7). */
  quietStart: number;
  quietEnd: number;
  outcomeReports: boolean;
  mutedTopics: MutedTopic[];
  /** false = "All check-ins · I only reply when you write first" (A3). Safety still comes through. */
  allCheckins: boolean;
  programOwner: ProgramOwner;
  photoRetentionDays: number;
  /** Usual session start, "HH:mm" local. Null until asked or inferred (A2 needs it). */
  sessionTime: string | null;
}

export const DEFAULT_PROACTIVE_PREFS: ProactivePrefs = {
  frequency: 'normal', pushTimeSensitive: true, quietStart: 22, quietEnd: 7, outcomeReports: true,
  mutedTopics: [], allCheckins: true, programOwner: 'me', photoRetentionDays: 90, sessionTime: null,
};

/** Frequency → the cap (F1 caption: Rarely 2/wk · Normal 1/day · Often 2/day). */
export const FREQUENCY_CAP: Record<Frequency, { perDay: number; perWeek: number }> = {
  rarely: { perDay: 1, perWeek: 2 },
  normal: { perDay: 1, perWeek: 7 },
  often: { perDay: 2, perWeek: 14 },
};
export const FREQUENCY_LABEL: Record<Frequency, string> = { rarely: 'Up to 2 a week', normal: 'Up to 1 a day', often: 'Up to 2 a day' };

const clampHour = (h: unknown, d: number) => { const n = Number(h); return Number.isInteger(n) && n >= 0 && n <= 23 ? n : d; };

/** Pure: prefsJson → prefs, defaults filled, bad values dropped. */
export function parseProactivePrefs(prefsJson: string | null | undefined): ProactivePrefs {
  let raw: any = {};
  try { raw = prefsJson ? JSON.parse(prefsJson)?.proactive ?? {} : {}; } catch { raw = {}; }
  const d = DEFAULT_PROACTIVE_PREFS;
  return {
    frequency: raw.frequency in FREQUENCY_CAP ? raw.frequency : d.frequency,
    pushTimeSensitive: typeof raw.pushTimeSensitive === 'boolean' ? raw.pushTimeSensitive : d.pushTimeSensitive,
    quietStart: clampHour(raw.quietStart, d.quietStart),
    quietEnd: clampHour(raw.quietEnd, d.quietEnd),
    outcomeReports: typeof raw.outcomeReports === 'boolean' ? raw.outcomeReports : d.outcomeReports,
    mutedTopics: Array.isArray(raw.mutedTopics)
      ? raw.mutedTopics.filter((m: any) => m && typeof m.topic === 'string').map((m: any) => ({ topic: String(m.topic), until: m.until ? String(m.until) : null, mutedAt: String(m.mutedAt ?? '') }))
      : [],
    allCheckins: typeof raw.allCheckins === 'boolean' ? raw.allCheckins : d.allCheckins,
    programOwner: ['me', 'coach_offline', 'coach_axiom'].includes(raw.programOwner) ? raw.programOwner : d.programOwner,
    photoRetentionDays: Number.isInteger(raw.photoRetentionDays) && raw.photoRetentionDays >= 1 && raw.photoRetentionDays <= 365 ? raw.photoRetentionDays : d.photoRetentionDays,
    sessionTime: typeof raw.sessionTime === 'string' && /^\d{2}:\d{2}$/.test(raw.sessionTime) ? raw.sessionTime : null,
  };
}

/** Pure: is this local hour inside quiet hours? Wraps midnight when start > end. */
export function inQuietHours(p: Pick<ProactivePrefs, 'quietStart' | 'quietEnd'>, localHour: number): boolean {
  if (p.quietStart === p.quietEnd) return false;
  return p.quietStart < p.quietEnd
    ? localHour >= p.quietStart && localHour < p.quietEnd
    : localHour >= p.quietStart || localHour < p.quietEnd;
}

export const normTopic = (t: string) => t.trim().toLowerCase().replace(/\s+/g, ' ');

/** Pure: a topic is muted when a mute names it and hasn't lapsed. */
export function topicMuted(p: Pick<ProactivePrefs, 'mutedTopics'>, topic: string, now = new Date()): boolean {
  const t = normTopic(topic);
  return p.mutedTopics.some((m) => normTopic(m.topic) === t && (!m.until || Date.parse(m.until) > now.getTime()));
}

/** Pure: mute a topic for `days` (null = forever). Re-muting replaces the earlier entry. */
export function muteTopic(p: ProactivePrefs, topic: string, days: number | null, now = new Date()): ProactivePrefs {
  const until = days == null ? null : new Date(now.getTime() + days * 86_400_000).toISOString();
  const rest = p.mutedTopics.filter((m) => normTopic(m.topic) !== normTopic(topic));
  return { ...p, mutedTopics: [...rest, { topic: topic.trim(), until, mutedAt: now.toISOString() }] };
}

export function unmuteTopic(p: ProactivePrefs, topic: string): ProactivePrefs {
  return { ...p, mutedTopics: p.mutedTopics.filter((m) => normTopic(m.topic) !== normTopic(topic)) };
}

/** "Muted Oct 3 · forever" / "Until Nov 14" — the F1 muted-topics sub line. */
export function muteLabel(m: MutedTopic): string {
  const d = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return m.until ? `Until ${d(m.until)}` : `Muted ${m.mutedAt ? d(m.mutedAt) : ''} · forever`.replace('  ', ' ');
}

export async function getProactivePrefs(userId: string): Promise<ProactivePrefs> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { prefsJson: true } });
  return parseProactivePrefs(u?.prefsJson);
}

/** Merge a patch into prefsJson.proactive, leaving the other prefs keys alone. */
export async function setProactivePrefs(userId: string, patch: Partial<ProactivePrefs>): Promise<ProactivePrefs> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { prefsJson: true } });
  let all: Record<string, unknown> = {};
  try { all = u?.prefsJson ? JSON.parse(u.prefsJson) : {}; } catch { all = {}; }
  const next = parseProactivePrefs(JSON.stringify({ proactive: { ...parseProactivePrefs(u?.prefsJson), ...patch } }));
  await prisma.user.update({ where: { id: userId }, data: { prefsJson: JSON.stringify({ ...all, proactive: next }) } });
  return next;
}

/**
 * Pure: the usual session start from the local hours sessions were logged
 * (median, less an hour — people log after they lift). Null under 4 logs.
 */
export function inferSessionTime(localHours: number[]): string | null {
  const hs = localHours.filter((h) => Number.isInteger(h) && h >= 0 && h <= 23).sort((a, b) => a - b);
  if (hs.length < 4) return null;
  const med = hs[Math.floor(hs.length / 2)];
  return `${String((med + 23) % 24).padStart(2, '0')}:00`;
}
