// Phase 5 — operational proactive layer. Turns the per-user
// evaluateProactiveTrigger() into a sweep the existing cron infrastructure
// can call: find candidate users for a trigger, ask the agent to decide,
// and (only if delivery is enabled) send the proposed push.
//
// SAFETY: nothing runs unless AGENT_PROACTIVE_ENABLED=true. The evaluation is
// a paid agent turn (up to 8 Claude calls); it used to run on every workout
// log even with delivery off (Oct 2026 audit HIGH-2). With the flag on, each
// user gets at most AGENT_PROACTIVE_DAILY_CAP evaluations a day (default 3).

import { PrismaClient } from '@prisma/client';
import type Anthropic from '@anthropic-ai/sdk';
import { sendPushNotification } from '../services/notificationService.js';
import { evaluateProactiveTrigger, proactiveDeliveryEnabled, type ProactiveTrigger } from './proactive.js';

const prisma = new PrismaClient();

// Per-user daily cap on evaluations (in memory: a restart resets it, which
// only ever allows a few more, and keeps this off the DB schema).
const evalsToday = new Map<string, { day: string; n: number }>();
function proactiveCap(): number {
  const n = parseInt(process.env.AGENT_PROACTIVE_DAILY_CAP || '', 10);
  return Number.isFinite(n) && n >= 0 ? n : 3;
}
export function takeProactiveSlot(userId: string, now = new Date()): boolean {
  const day = now.toISOString().slice(0, 10);
  const cur = evalsToday.get(userId);
  const n = cur && cur.day === day ? cur.n : 0;
  if (n >= proactiveCap()) return false;
  evalsToday.set(userId, { day, n: n + 1 });
  if (evalsToday.size > 50_000) for (const [k, v] of evalsToday) if (v.day !== day) evalsToday.delete(k);
  return true;
}
export function resetProactiveSlotsForTests() { evalsToday.clear(); }

export interface SweepResult {
  trigger: ProactiveTrigger;
  evaluated: number;
  wouldNotify: number;
  sent: number;
  decisions: Array<{ userId: string; shouldNotify: boolean; title: string | null; reasoning: string }>;
}

/**
 * Run a proactive trigger across candidate users. `userIds` lets a caller
 * pre-select (e.g. the streak-at-risk cron already computes who's at risk);
 * if omitted we fall back to all users with a push token, capped.
 */
export async function runProactiveSweep(
  trigger: ProactiveTrigger,
  userIds?: string[],
  opts: { max?: number; injectClient?: Pick<Anthropic, 'messages'> } = {},
): Promise<SweepResult> {
  const max = opts.max ?? 100;
  const empty: SweepResult = { trigger, evaluated: 0, wouldNotify: 0, sent: 0, decisions: [] };
  // Off unless explicitly enabled: evaluation itself costs an agent turn.
  if (!proactiveDeliveryEnabled()) return empty;

  let targets: string[];
  if (userIds && userIds.length) {
    targets = userIds.slice(0, max);
  } else {
    const users = await prisma.user.findMany({
      where: { expoPushToken: { not: null }, reengagementOptOut: false },
      select: { id: true },
      take: max,
    });
    targets = users.map((u) => u.id);
  }

  const deliver = proactiveDeliveryEnabled();
  const result: SweepResult = empty;

  for (const userId of targets) {
    if (!takeProactiveSlot(userId)) continue;
    let decision;
    try {
      decision = await evaluateProactiveTrigger(userId, trigger, opts.injectClient);
    } catch (err: any) {
      console.error(`[proactive] eval failed for ${userId}:`, err?.message ?? err);
      continue;
    }
    result.evaluated++;
    result.decisions.push({
      userId, shouldNotify: decision.shouldNotify, title: decision.title, reasoning: decision.reasoning,
    });
    if (!decision.shouldNotify) continue;
    result.wouldNotify++;

    // Decision-only unless delivery is explicitly enabled. The log line is
    // the audit trail of what the agent decided either way.
    console.log(`[proactive] ${trigger} user=${userId} WOULD_SEND title="${decision.title}" (deliver=${deliver})`);
    if (!deliver) continue;

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { expoPushToken: true } });
    if (!user?.expoPushToken || !decision.title || !decision.body) continue;
    await sendPushNotification({ to: user.expoPushToken, title: decision.title, body: decision.body });
    result.sent++;
  }

  console.log(`[proactive] sweep ${trigger}: evaluated=${result.evaluated} wouldNotify=${result.wouldNotify} sent=${result.sent}`);
  return result;
}
