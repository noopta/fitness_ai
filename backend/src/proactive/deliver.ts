// Delivery (design A1–A3): a verified, gated candidate becomes a turn Anakin
// starts — receipts (the evidence), the question as an Ask with three exits
// (act · defer · mute), and, only when a session is within hours, a push
// whose copy says why now and never what was noticed.
//
// The ops at the bottom are what the three exits run; the mute sheet (A3)
// is itself a card whose answer is an Adjusted change with an inverse, so
// Undo works and F1 can reverse it later.

import { PrismaClient } from '@prisma/client';
import { defineOp } from '../agent/ops.js';
import { postInitiatedTurn } from '../agent/initiated.js';
import { sendPushNotification } from '../services/notificationService.js';
import type { CardDraft } from '../agent/cards/types.js';
import type { Candidate } from './reasoner.js';
import type { EvidenceItem } from './evidence.js';
import { getProactivePrefs, inQuietHours, muteTopic, setProactivePrefs, unmuteTopic, type ProactivePrefs } from './prefs.js';
import { addDays, appendHistory, getThread, noteIgnored, noteRaised, updateThread } from './threads.js';

const prisma = new PrismaClient();

export const NOT_NOW = 'Not now';
export const STOP_ASKING = 'Stop asking about this';
/** A push is only worth it when the session it concerns starts within this many hours. */
export const PUSH_WINDOW_H = 6;
/** "Not now" moves the check-back out this far; a second one closes the thread via back-off. */
export const NOT_NOW_DAYS = 3;

// ── Pure ────────────────────────────────────────────────────────────────────

/** The receipt list under the turn: evidence items in the order the candidate cited them. */
export function receiptsFor(c: Candidate, evidence: EvidenceItem[]): { verb: string; text: string }[] {
  return c.evidence.map((id) => evidence.find((e) => e.id === id)).filter((e): e is EvidenceItem => !!e).map((e) => ({ verb: e.verb, text: e.text }));
}

/** A1: the Ask card. Three exits, always. The mute row renders muted — available, never the default. */
export function checkinCard(c: Candidate, eventId: string): CardDraft {
  return {
    fn: 'PRO-01', pattern: 'ask', rule: 'show',
    meta: { label: c.kind === 'followup' ? 'Follow-up' : 'Check-in' },
    ask: { q: c.question, options: [c.primary, NOT_NOW, STOP_ASKING], typeInstead: true },
    pending: { answer: { op: 'proactive.answer', args: { eventId, threadId: c.threadId, topic: c.topic, primary: c.primary }, valueKey: 'value' } },
    entity: c.threadId ? `proactive:thread:${c.threadId}` : `proactive:topic:${c.topic}`,
  };
}

/** The one-line summary above the receipts ("Checked 3 things"). */
export function checkedLine(n: number): string { return n === 1 ? 'Checked 1 thing' : `Checked ${n} things`; }

// Lock-screen rule: no symptoms, weights, check-in values or injury words. Times ("at 9") are fine.
const PUSH_BANNED = /\b(sore(ness)?|pain|hurt(s|ing)?|injur(y|ed|ies)|elbow|knee|shoulder|hip|wrist|ankle|back pain|tendon|strain|tweak|dizzy|faint|weight|weigh|kg|lbs?|calorie|kcal|deficit|cut(ting)?|hrv|energy|sleep|protein|carbs?|fat)\b|\d+\s*(?:\/|of)\s*\d+|\d+\s*(?:%|×|x)\s*\d*/i;
export const PUSH_BODY_MAX = 140;
export const PUSH_TAIL = 'One quick question about this week before you go.';

/** Pure: may this text go on a lock screen? */
export function pushSafe(text: string): boolean {
  return text.length > 0 && text.length <= PUSH_BODY_MAX && !PUSH_BANNED.test(text);
}

export interface PushContext { prefs: ProactivePrefs; localHour: number; localMinute: number; hasToken: boolean }

/** Pure: minutes until the usual session, or null when unknown / already passed today. */
export function minutesToSession(sessionTime: string | null, localHour: number, localMinute: number): number | null {
  if (!sessionTime) return null;
  const [h, m] = sessionTime.split(':').map(Number);
  const delta = h * 60 + m - (localHour * 60 + localMinute);
  return delta >= 0 ? delta : null;
}

/** A2: push only when timing matters — within the window, outside quiet hours, pref on, token present, copy safe. */
export function pushDecision(c: Candidate, ctx: PushContext): { push: boolean; body: string | null; reason: string } {
  if (!c.pushWhyNow) return { push: false, body: null, reason: 'not time-sensitive' };
  if (!ctx.prefs.pushTimeSensitive) return { push: false, body: null, reason: 'push pref off' };
  if (!ctx.hasToken) return { push: false, body: null, reason: 'no push token' };
  if (inQuietHours(ctx.prefs, ctx.localHour)) return { push: false, body: null, reason: 'quiet hours' };
  const mins = minutesToSession(ctx.prefs.sessionTime, ctx.localHour, ctx.localMinute);
  if (mins == null || mins > PUSH_WINDOW_H * 60) return { push: false, body: null, reason: 'no session within the window' };
  // The copy says why now, never what was noticed: the question itself waits in the thread (A2).
  const body = `${c.pushWhyNow.replace(/[.!?]*$/, '')}. ${PUSH_TAIL}`.slice(0, PUSH_BODY_MAX);
  if (!pushSafe(body)) return { push: false, body: null, reason: 'copy failed the lock-screen rule' };
  return { push: true, body, reason: 'session soon' };
}

/** A3 sheet: thread · topic · everything — the narrowest first. */
export function muteSheetCard(threadTitle: string | null, topic: string, eventId: string, threadId: string | null): CardDraft {
  const options = [
    ...(threadTitle ? [`${threadTitle} — this thread only`] : []),
    `${topic.charAt(0).toUpperCase()}${topic.slice(1)} — the whole topic, 30 days`,
    'All check-ins — I only reply when you write first',
  ];
  return {
    fn: 'PRO-04', pattern: 'ask', rule: 'show', meta: { label: 'Stop asking about what?' },
    ask: { q: 'Stop asking about what?', options },
    why: 'Safety checks still come through — a weight cut over 5% in a week, a symptom getting worse.',
    pending: { answer: { op: 'proactive.mute', args: { eventId, threadId, topic, threadTitle }, valueKey: 'value' } },
  };
}

// ── Delivery ────────────────────────────────────────────────────────────────

export interface DeliverOpts { dryRun?: boolean; now?: Date; localHour?: number; localMinute?: number }

/** Record, post the turn, maybe push. In dry-run only the record is written (channel 'dryrun'). */
export async function deliverCandidate(userId: string, c: Candidate, evidence: EvidenceItem[], opts: DeliverOpts = {}): Promise<{ eventId: string; posted: boolean; pushed: boolean; channel: string }> {
  const now = opts.now ?? new Date();
  const receipts = receiptsFor(c, evidence);
  const channel = opts.dryRun ? 'dryrun' : 'chat';
  const ev = await prisma.proactiveEvent.create({ data: {
    userId, kind: c.kind, topic: c.topic, threadId: c.threadId, channel, text: c.question,
    evidenceJson: JSON.stringify(receipts),
  } });
  if (opts.dryRun) {
    console.log(`[proactive] DRY RUN user=${userId.slice(0, 8)} ${c.kind} "${c.topic}": ${c.question} | ${receipts.map((r) => r.text).join(' · ')}`);
    return { eventId: ev.id, posted: false, pushed: false, channel };
  }
  const posted = await postInitiatedTurn(userId, { text: c.question, cards: [checkinCard(c, ev.id)], receipts });
  if (!posted) { await prisma.proactiveEvent.update({ where: { id: ev.id }, data: { outcome: 'not_posted', outcomeAt: now } }); return { eventId: ev.id, posted, pushed: false, channel }; }
  // The card id lands on the event so the answer op can find it.
  const card = await prisma.agentCard.findFirst({ where: { userId, fn: 'PRO-01' }, orderBy: { createdAt: 'desc' }, select: { id: true } });
  if (card) await prisma.proactiveEvent.update({ where: { id: ev.id }, data: { cardId: card.id } });
  if (c.threadId) { await noteRaised(c.threadId, now); await appendHistory(c.threadId, `Raised in chat: ${c.question}`, now); }

  let pushed = false;
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { expoPushToken: true } });
  const prefs = await getProactivePrefs(userId);
  const d = pushDecision(c, { prefs, localHour: opts.localHour ?? now.getUTCHours(), localMinute: opts.localMinute ?? now.getUTCMinutes(), hasToken: !!u?.expoPushToken });
  if (d.push && u?.expoPushToken && d.body) {
    const { moderateText } = await import('../services/moderationService.js');
    const verdict = await moderateText(d.body, 'push_body', userId).catch(() => null);
    if (verdict?.allowed) {
      await sendPushNotification({ to: u.expoPushToken, title: 'Anakin', body: d.body });
      await prisma.proactiveEvent.create({ data: { userId, kind: c.kind, topic: c.topic, threadId: c.threadId, cardId: card?.id ?? null, channel: 'push', text: d.body } });
      pushed = true;
    }
  }
  return { eventId: ev.id, posted, pushed, channel };
}

/** Candidates that got no answer by the next morning count as ignored (back-off, cooldown). */
export async function markUnansweredIgnored(userId: string, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 20 * 3_600_000);
  const open = await prisma.proactiveEvent.findMany({ where: { userId, channel: 'chat', outcome: null, createdAt: { lt: cutoff }, kind: { in: ['checkin', 'followup', 'outcome', 'prepared'] } } });
  for (const e of open) {
    await prisma.proactiveEvent.update({ where: { id: e.id }, data: { outcome: 'ignored', outcomeAt: now } });
    if (e.threadId) await noteIgnored(e.threadId);
  }
  return open.length;
}

// ── Ops: the three exits ────────────────────────────────────────────────────

const outcome = async (eventId: unknown, outcome: string) => {
  if (typeof eventId !== 'string') return;
  await prisma.proactiveEvent.update({ where: { id: eventId }, data: { outcome, outcomeAt: new Date() } }).catch(() => {});
};

defineOp({
  name: 'proactive.answer',
  run: async (userId, args) => {
    const value = String(args.value ?? '');
    const threadId = typeof args.threadId === 'string' ? args.threadId : null;
    const topic = String(args.topic ?? '');
    if (value === NOT_NOW) {
      await outcome(args.eventId, 'not_now');
      if (threadId) {
        const t = await getThread(userId, threadId);
        if (t) {
          // Counts toward back-off: the second "Not now" closes the thread (B5).
          await noteIgnored(threadId);
          const close = t.ignoredCount + 1 >= 2;
          await updateThread(userId, threadId, close ? { status: 'closed' } : { checkBackAt: addDays(new Date().toISOString().slice(0, 10), NOT_NOW_DAYS) });
          await appendHistory(threadId, close ? 'Not now, twice — closed' : `Not now — back in ${NOT_NOW_DAYS} days`);
        }
      }
      return { inverse: null, summary: `Not now · ${topic}`, result: { line: 'Not now — I’ll leave it', sendAsMessage: null } };
    }
    if (value === STOP_ASKING) {
      const t = threadId ? await getThread(userId, threadId) : null;
      await outcome(args.eventId, 'muted');
      return { inverse: null, summary: `Stop asking · ${topic}`, result: { line: 'Stop asking about this', sendAsMessage: null, nextCard: muteSheetCard(t?.title ?? null, topic, String(args.eventId ?? ''), threadId) } };
    }
    // The yes option (or typed words): the answer becomes their message and Anakin takes it from there.
    await outcome(args.eventId, 'answered');
    if (threadId) await appendHistory(threadId, `Answered: ${value}`);
    return { inverse: null, summary: `Answered · ${topic}`, result: { line: value, sendAsMessage: value } };
  },
});

defineOp({
  name: 'proactive.mute',
  run: async (userId, args) => {
    const value = String(args.value ?? '');
    const topic = String(args.topic ?? 'this');
    const threadId = typeof args.threadId === 'string' ? args.threadId : null;
    const prefs = await getProactivePrefs(userId);
    if (/this thread only$/.test(value) && threadId) {
      const until = new Date(Date.now() + 3650 * 86_400_000);
      await updateThread(userId, threadId, { mutedUntil: until });
      await appendHistory(threadId, 'Muted — won’t raise it again');
      return { inverse: { op: 'proactive.unmute', args: { threadId } }, summary: `Won’t raise ${String(args.threadTitle ?? topic).toLowerCase()} again`, result: { line: `Adjusted — Won’t raise ${String(args.threadTitle ?? topic).toLowerCase()} again`, sendAsMessage: null } };
    }
    if (/the whole topic/.test(value)) {
      await setProactivePrefs(userId, muteTopic(prefs, topic, 30));
      return { inverse: { op: 'proactive.unmute', args: { topic } }, summary: `Muted ${topic} for 30 days`, result: { line: `Adjusted — ${topic} muted for 30 days`, sendAsMessage: null } };
    }
    await setProactivePrefs(userId, { allCheckins: false });
    return { inverse: { op: 'proactive.unmute', args: { allCheckins: true } }, summary: 'Check-ins off', result: { line: 'Adjusted — I only reply when you write first', sendAsMessage: null } };
  },
});

defineOp({
  name: 'proactive.unmute',
  run: async (userId, args) => {
    if (typeof args.threadId === 'string') { await updateThread(userId, args.threadId, { mutedUntil: null }); return { inverse: null, summary: 'Thread unmuted' }; }
    if (typeof args.topic === 'string') { await setProactivePrefs(userId, unmuteTopic(await getProactivePrefs(userId), args.topic)); return { inverse: null, summary: `${args.topic} unmuted` }; }
    await setProactivePrefs(userId, { allCheckins: true });
    return { inverse: null, summary: 'Check-ins back on' };
  },
});
