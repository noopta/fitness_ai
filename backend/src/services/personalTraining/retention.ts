// Engagement and churn (handoff A7, gap #11): who might be drifting away,
// why, and a gentle way to reach out — before they cancel, not after.
//
// Care language, never surveillance language: reasons describe what the
// trainer could help with ("hasn't logged a session in 12 days"), never a
// verdict on the client. Every score is rules over data; every suggestion is
// a draft the trainer sends or doesn't.

import { prisma } from './db.js';
import { createDraft, toDraft, writeDraftText } from './drafts.js';
import { loadPracticeData, type ClientData } from './data.js';
import { missStreak } from './checkins.js';
import type { Client, Draft, RetentionRow } from './types.js';

const DAY_MS = 86_400_000;

export interface Signals {
  daysSinceSession: number | null;
  daysSinceJoined: number;
  engagementNow: number;
  engagementBefore: number;
  missedCheckIns: number;
  daysSinceClientMessage: number | null;
  paymentFailing: boolean;
  planEndingSoon: boolean;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * Risk 0–100 from the signals, each with its reason. Pure; exported for tests.
 * Weights favour what predicts leaving in coaching: training stopping,
 * check-ins going unanswered, and a payment problem.
 */
export function scoreRisk(s: Signals): { risk: number; reasons: string[]; intervention: RetentionRow['intervention'] } {
  let risk = 0;
  const reasons: string[] = [];
  if (s.daysSinceSession !== null && s.daysSinceSession >= 7) {
    risk += Math.min(35, 15 + (s.daysSinceSession - 7) * 2);
    reasons.push(`Hasn't logged a session in ${s.daysSinceSession} days`);
  } else if (s.daysSinceSession === null && s.daysSinceJoined >= 7) {
    risk += 30;
    reasons.push(`Hasn't logged a session since joining ${s.daysSinceJoined} days ago`);
  }
  if (s.engagementBefore >= 3 && s.engagementNow <= s.engagementBefore * 0.6) {
    risk += Math.min(25, Math.round((s.engagementBefore - s.engagementNow) * 5));
    reasons.push(`Training has dropped from about ${Math.round(s.engagementBefore)} to ${Math.round(s.engagementNow)} out of 10 over the last few weeks`);
  }
  if (s.missedCheckIns >= 1) {
    risk += Math.min(20, s.missedCheckIns * 10);
    reasons.push(s.missedCheckIns === 1 ? 'Missed the last check-in' : `Missed the last ${s.missedCheckIns} check-ins`);
  }
  if (s.daysSinceClientMessage !== null && s.daysSinceClientMessage >= 21) {
    risk += 10;
    reasons.push(`Hasn't written to you in ${Math.floor(s.daysSinceClientMessage / 7)} weeks`);
  }
  if (s.paymentFailing) {
    risk += 20;
    reasons.push('A payment didn\'t go through');
  }
  if (s.planEndingSoon) {
    risk += 5;
    reasons.push('Their package is almost used up');
  }
  risk = Math.min(100, risk);
  const intervention: RetentionRow['intervention'] = s.paymentFailing
    ? { kind: 'billing', text: 'Check in kindly about the payment; the link to update their card is in their Billing tab.' }
    : s.missedCheckIns >= 2 || (s.daysSinceSession ?? 0) >= 14
      ? { kind: 'call', text: 'Offer a quick call to reset the plan around what life looks like right now.' }
      : s.engagementBefore >= 3 && s.engagementNow <= s.engagementBefore * 0.6
        ? { kind: 'lighten', text: 'Offer a lighter week or shorter sessions to make it easy to get going again.' }
        : { kind: 'check_in', text: 'Send a short, warm message asking how things are going.' };
  return { risk, reasons, intervention };
}

function signalsFor(c: Client, d: ClientData, extra: { paymentFailing: boolean; planEndingSoon: boolean }, now: Date): Signals {
  const lastSession = c.lastSessionAt ? new Date(c.lastSessionAt) : null;
  const lastClientMsg = [...d.messages].reverse().find((m) => m.fromClient);
  const e = c.engagement8w;
  return {
    daysSinceSession: lastSession ? Math.floor((now.getTime() - lastSession.getTime()) / DAY_MS) : null,
    daysSinceJoined: Math.floor((now.getTime() - new Date(c.joinedAt).getTime()) / DAY_MS),
    engagementNow: mean(e.slice(-2)),
    engagementBefore: mean(e.slice(-6, -2)),
    missedCheckIns: missStreak(d.checkIns),
    // Only meaningful once they have written at all.
    daysSinceClientMessage: lastClientMsg ? Math.floor((now.getTime() - lastClientMsg.createdAt.getTime()) / DAY_MS) : null,
    ...extra,
  };
}

/** Every active client with a risk above zero, highest first. */
export async function atRisk(practiceId: string, trainerId: string, now: Date = new Date()): Promise<RetentionRow[]> {
  const data = await loadPracticeData(practiceId, trainerId, { now, excludePaused: true });
  const ids = data.clients.map((c) => c.id);
  const [failing, plans] = await Promise.all([
    prisma.ptPayment.findMany({ where: { practiceId, clientId: { in: ids }, status: 'failed' }, select: { clientId: true } }),
    prisma.ptClientPlan.findMany({ where: { practiceId, clientId: { in: ids }, status: 'active', creditsTotal: { gt: 0 } }, select: { clientId: true, creditsTotal: true, creditsUsed: true } }),
  ]);
  const failingSet = new Set(failing.map((f) => f.clientId));
  const ending = new Set(plans.filter((p) => p.creditsTotal - p.creditsUsed <= 1).map((p) => p.clientId));
  const rows: RetentionRow[] = [];
  for (const c of data.clients) {
    const s = signalsFor(c, data.byClient.get(c.id)!, { paymentFailing: failingSet.has(c.id), planEndingSoon: ending.has(c.id) }, now);
    const r = scoreRisk(s);
    if (r.risk === 0) continue;
    rows.push({
      clientId: c.id, client: { id: c.id, name: c.name, initials: c.initials }, risk: r.risk,
      level: r.risk >= 50 ? 'high' : r.risk >= 25 ? 'medium' : 'low', reasons: r.reasons, intervention: r.intervention,
      engagement8w: c.engagement8w,
    });
  }
  return rows.sort((a, b) => b.risk - a.risk);
}

/** A warm draft for the suggested intervention. Never sent from here. */
export async function draftOutreach(practiceId: string, trainerId: string, clientId: string, now: Date = new Date()): Promise<Draft> {
  const row = (await atRisk(practiceId, trainerId, now)).find((r) => r.clientId === clientId);
  const client = row?.client ?? (await prisma.user.findUnique({ where: { id: clientId }, select: { name: true } }).then((u) => ({ name: u?.name ?? 'there' })));
  const first = client.name.split(' ')[0];
  const trainer = await prisma.user.findUnique({ where: { id: trainerId }, select: { name: true } });
  const fallback = row?.intervention.kind === 'billing'
    ? `Hi ${first}, a quick heads-up that your last payment didn't go through. No stress. You can update your card from your page whenever suits.`
    : row?.intervention.kind === 'call'
      ? `Hi ${first}, it has been a little while and I wanted to check in. Would a quick call this week help us shape the plan around what is going on for you?`
      : row?.intervention.kind === 'lighten'
        ? `Hi ${first}, how are things? If the plan feels like a lot right now, I can lighten this week so it is easier to fit in.`
        : `Hi ${first}, just checking in. How are things going this week?`;
  const text = await writeDraftText({
    clientFirstName: first,
    trainerFirstName: trainer?.name?.split(' ')[0] ?? '',
    purpose: `a caring check-in: ${row?.intervention.text ?? 'ask how things are going'} Never mention tracking, scores or data about them.`,
    facts: row?.intervention.kind === 'billing' ? ['Their last payment did not go through', 'They can update their card from their page'] : [],
    fallback,
  });
  return toDraft(await createDraft({ practiceId, trainerId, clientId, kind: 'retention', text }));
}
