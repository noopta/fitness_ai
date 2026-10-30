// Safety flag — weight cut (design G3). Fixed thresholds, not the LLM. Skips
// the daily cap and topic mutes but not quiet hours (unless acute). No "Not
// now", no "Stop asking". "My coach is managing it" is only offered when a
// coach runs the program (B9); it pauses the alert for 7 days, and the alert
// returns only if the weekly rate is worse than the one acknowledged, or
// total loss passes 7%.
//
// THRESHOLDS AND WORDING NEED CLINICIAN REVIEW BEFORE LAUNCH. They are
// constants here so that review changes numbers, not logic.

import { PrismaClient } from '@prisma/client';
import type { CardDraft } from '../agent/cards/types.js';
import { defineOp } from '../agent/ops.js';
import { parseBlob, mergeBlobKeys } from '../agent/profile/coachProfile.js';
import { addDays, shortDate } from './threads.js';

const prisma = new PrismaClient();

/** % of body weight lost inside 7 days that flags. */
export const CUT_RATE_PCT = 5;
/** % lost since the acknowledged reading that brings the alert back regardless. */
export const CUT_TOTAL_PCT = 7;
/** % inside 7 days that counts as acute — quiet hours don't hold it. */
export const CUT_ACUTE_PCT = 8;
export const MIN_WEIGHINS = 4;
export const ACK_DAYS = 7;

export interface WeighIn { date: string; weightKg: number }
export interface SafetyAck { at: string; ratePct: number; startKg: number }

export interface WeightCutFlag {
  lossKg: number;
  pct: number;
  days: number;
  weighIns: number;
  acute: boolean;
  /** Set when the alert returns past an acknowledgement. */
  returned: 'rate_worse' | 'total' | null;
  headline: string;
  help: string;
}

export const HELP_LINE = "I can't mute this one. If you feel dizzy, confused or faint, stop cutting and get medical help.";

/** Pure. `today` YYYY-MM-DD. Null when nothing flags (or the ack still holds). */
export function weightCutCheck(weighIns: WeighIn[], today: string, ack: SafetyAck | null = null, opts: { hasEvent?: boolean } = {}): WeightCutFlag | null {
  const since = addDays(today, -6);
  const week = weighIns.filter((w) => w.date >= since && w.date <= today && w.weightKg > 0).sort((a, b) => a.date.localeCompare(b.date));
  if (week.length < MIN_WEIGHINS) return null;
  const first = week[0], last = week[week.length - 1];
  const lossKg = first.weightKg - last.weightKg;
  const pct = (lossKg / first.weightKg) * 100;
  if (pct < CUT_RATE_PCT) return null;
  const days = Math.max(1, Math.round((Date.parse(last.date) - Date.parse(first.date)) / 86_400_000));
  const acute = pct >= CUT_ACUTE_PCT;
  let returned: WeightCutFlag['returned'] = null;
  if (ack && Date.parse(ack.at) > Date.parse(`${today}T00:00:00Z`) - ACK_DAYS * 86_400_000) {
    const totalPct = ack.startKg > 0 ? ((ack.startKg - last.weightKg) / ack.startKg) * 100 : 0;
    if (totalPct >= CUT_TOTAL_PCT) returned = 'total';
    else if (pct > ack.ratePct + 0.5) returned = 'rate_worse';
    else return null;
  }
  const kg = Math.round(lossKg * 10) / 10;
  const headline = `You're down ${kg} kg in ${days} days — ${pct.toFixed(1)}% of your weight. That's faster than I'd call safe${opts.hasEvent ? ', even for a fight' : ''}.`;
  return { lossKg: kg, pct: Math.round(pct * 10) / 10, days, weighIns: week.length, acute, returned, headline, help: HELP_LINE };
}

/** G3 card for Pro users in chat. The coach option appears only when a coach runs the program. */
export function safetyCard(f: WeightCutFlag, opts: { coachRuns: boolean; eventLabel: string | null; eventId: string }): CardDraft {
  const actions: NonNullable<CardDraft['actions']> = [
    { id: 'help', label: 'Help me slow it down', kind: 'primary', client: { action: 'send_message', args: { text: 'Help me slow the cut down without losing the plan.' } } },
    ...(opts.coachRuns ? [{ id: 'coach', label: 'My coach is managing it', kind: 'secondary' as const }] : []),
    { id: 'wrong', label: 'That weigh-in was wrong', kind: 'secondary', client: { action: 'open_page', args: { page: 'body' } } },
  ];
  return {
    fn: 'PRO-07', pattern: 'proposal', rule: 'show',
    meta: { label: 'Safety check · weight' },
    rows: [{ key: 'Weight', value: `${f.weighIns} weigh-ins this week` }, ...(opts.eventLabel ? [{ key: 'Event', value: opts.eventLabel }] : [])],
    note: f.help,
    actions,
    pending: { actions: { ...(opts.coachRuns ? { coach: { op: 'proactive.safety_ack', args: { eventId: opts.eventId, ratePct: f.pct }, status: 'kept' as const, line: 'Noted — your coach has it. I’ll check again in a week.' } } : {}) } },
    entity: 'safety:weight-cut',
  };
}

export function safetyReceipts(f: WeightCutFlag, eventLabel: string | null): { verb: string; text: string }[] {
  return [{ verb: 'Checked', text: `Weight · ${f.weighIns} weigh-ins this week` }, ...(eventLabel ? [{ verb: 'Checked', text: eventLabel }] : [])];
}

export async function readSafetyAck(userId: string): Promise<SafetyAck | null> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { coachProfile: true } });
  const a = parseBlob(u?.coachProfile).weightCutAck;
  return a && typeof a.at === 'string' && typeof a.ratePct === 'number' ? { at: a.at, ratePct: a.ratePct, startKg: Number(a.startKg) || 0 } : null;
}

export async function loadWeighIns(userId: string, today: string): Promise<WeighIn[]> {
  const rows = await prisma.bodyWeightLog.findMany({ where: { userId, date: { gte: addDays(today, -35) } }, orderBy: { date: 'asc' }, select: { date: true, weightKg: true, weightLbs: true } });
  return rows.map((r) => ({ date: r.date, weightKg: r.weightKg ?? (r.weightLbs ? r.weightLbs / 2.20462 : 0) })).filter((r) => r.weightKg > 0);
}

/** For the screen line (free users, and any screen): the current flag or null. */
export async function currentWeightCutFlag(userId: string, today: string, hasEvent: boolean): Promise<WeightCutFlag | null> {
  const [w, ack] = await Promise.all([loadWeighIns(userId, today), readSafetyAck(userId)]);
  return weightCutCheck(w, today, ack, { hasEvent });
}

defineOp({
  name: 'proactive.safety_ack',
  run: async (userId, args) => {
    const w = await loadWeighIns(userId, new Date().toISOString().slice(0, 10));
    const startKg = w.length ? w[w.length - 1].weightKg : 0;
    await mergeBlobKeys(userId, { weightCutAck: { at: new Date().toISOString(), ratePct: Number(args.ratePct ?? 0), startKg } });
    if (typeof args.eventId === 'string') await prisma.proactiveEvent.update({ where: { id: args.eventId }, data: { outcome: 'answered', outcomeAt: new Date() } }).catch(() => {});
    return { inverse: { op: 'proactive.safety_unack', args: {} }, summary: `Weight check paused ${ACK_DAYS} days — coach managing` };
  },
});
defineOp({
  name: 'proactive.safety_unack',
  run: async (userId) => { await mergeBlobKeys(userId, { weightCutAck: null }); return { inverse: null, summary: 'Weight check back on' }; },
});

export const safetyDateLabel = (d: string) => shortDate(d);
