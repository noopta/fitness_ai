// The fixed-rule gate: the LLM decides what is worth raising, this decides
// whether it goes out. Pure, so every rule in the design has a test:
//
//   F1  daily / weekly cap by frequency; quiet hours (local); muted topics;
//       "I only reply when you write first"
//   B5  back-off — a thread ignored twice closes
//   G2  sparse data — Anakin raises nothing of his own until 6 sessions
//       (or 3 days of meals for Fuel); follow-ups on threads the user opened
//       in chat are exempt
//   G3  safety skips the cap and mutes, but not quiet hours unless acute
//   G4  free users get nothing in chat — safety reaches them as a screen line

import { FREQUENCY_CAP, inQuietHours, topicMuted, type ProactivePrefs } from './prefs.js';

export type CandidateKind = 'checkin' | 'followup' | 'prepared' | 'outcome' | 'insight' | 'safety';

export interface RecentEvent { kind: string; topic: string; threadId?: string | null; channel: string; createdAt: string; outcome?: string | null }

export interface GateInput {
  kind: CandidateKind;
  topic: string;
  /** Set when the candidate is about a thread the user opened (G2 exemption, back-off). */
  threadId?: string | null;
  thread?: { ignoredCount: number; mutedUntil: string | null; status: string } | null;
  prefs: ProactivePrefs;
  tier: string;
  localHour: number;
  /** YYYY-MM-DD in the user's zone. */
  localDate: string;
  /** Reach-outs in the last 14 days (ProactiveEvent rows), any channel. */
  recent: RecentEvent[];
  /** Logged sessions and days with meals, all time. */
  sessions: number;
  mealDays: number;
  /** Fuel-side observation (uses the meals threshold instead of sessions). */
  area?: 'training' | 'fuel';
  /** A safety reading that suggests acute risk: quiet hours don't hold it. */
  acute?: boolean;
}

export interface GateResult { allow: boolean; reason: string; closeThread?: boolean }

export const MIN_SESSIONS = 6;
export const MIN_MEAL_DAYS = 3;
export const BACKOFF_IGNORES = 2;
/** The same topic, ignored, isn't raised again inside this many days. */
export const TOPIC_COOLDOWN_DAYS = 14;

const DAY = 86_400_000;
const isPro = (tier: string) => tier === 'pro' || tier === 'enterprise';
const delivered = (e: RecentEvent) => e.channel === 'chat' || e.channel === 'push';

export function gateCandidate(i: GateInput, now = new Date()): GateResult {
  const t = now.getTime();
  // G4 — free accounts: nothing in chat (there is nothing to reply in). Safety is shown on a screen instead.
  if (!isPro(i.tier)) return i.kind === 'safety' ? { allow: true, reason: 'safety: screen line for a free user' } : { allow: false, reason: 'free_tier' };

  if (i.kind === 'safety') {
    // Skips the cap and mutes. Quiet hours still hold unless the reading suggests acute risk.
    if (inQuietHours(i.prefs, i.localHour) && !i.acute) return { allow: false, reason: 'quiet_hours' };
    return { allow: true, reason: 'safety' };
  }

  if (!i.prefs.allCheckins) return { allow: false, reason: 'only_replies' };
  if (i.kind === 'outcome' && !i.prefs.outcomeReports) return { allow: false, reason: 'outcome_reports_off' };
  if (inQuietHours(i.prefs, i.localHour)) return { allow: false, reason: 'quiet_hours' };
  if (topicMuted(i.prefs, i.topic, now)) return { allow: false, reason: 'topic_muted' };

  if (i.thread) {
    if (i.thread.mutedUntil && Date.parse(i.thread.mutedUntil) > t) return { allow: false, reason: 'thread_muted' };
    if (!['open', 'watching', 'running'].includes(i.thread.status)) return { allow: false, reason: 'thread_closed' };
    // B5 — a second ignore counts toward back-off and closes the thread.
    if (i.thread.ignoredCount >= BACKOFF_IGNORES) return { allow: false, reason: 'backoff', closeThread: true };
  }

  // Topic cooldown: raised and ignored inside the window → not again.
  const ignoredRecently = i.recent.some((e) => delivered(e) && e.topic.toLowerCase() === i.topic.toLowerCase()
    && e.outcome === 'ignored' && t - Date.parse(e.createdAt) < TOPIC_COOLDOWN_DAYS * DAY);
  if (ignoredRecently) return { allow: false, reason: 'topic_cooldown' };

  // F1 — the cap. Safety never counts toward it.
  const cap = FREQUENCY_CAP[i.prefs.frequency];
  const sent = i.recent.filter((e) => delivered(e) && e.kind !== 'safety');
  const today = sent.filter((e) => e.createdAt.slice(0, 10) === i.localDate).length;
  if (today >= cap.perDay) return { allow: false, reason: 'daily_cap' };
  const week = sent.filter((e) => t - Date.parse(e.createdAt) < 7 * DAY).length;
  if (week >= cap.perWeek) return { allow: false, reason: 'weekly_cap' };

  // G2 — Anakin's own observations wait for evidence; a thread the user opened doesn't.
  const own = !i.threadId && (i.kind === 'checkin' || i.kind === 'insight' || i.kind === 'prepared');
  if (own) {
    if (i.area === 'fuel' ? i.mealDays < MIN_MEAL_DAYS : i.sessions < MIN_SESSIONS) return { allow: false, reason: 'sparse_data' };
  }
  return { allow: true, reason: 'ok' };
}

/** G2 copy — said once, with the Dots primitive on the client. */
export function sparseDataNote(sessions: number): { text: string; progress: { done: number; of: number } } {
  return {
    text: `Once I've seen ${MIN_SESSIONS} of your sessions I'll start raising things about your training. Anything you ask me to watch, I'll follow up on from today.`,
    progress: { done: Math.min(sessions, MIN_SESSIONS), of: MIN_SESSIONS },
  };
}
