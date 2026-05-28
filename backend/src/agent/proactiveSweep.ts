// Phase 5 — operational proactive layer. Turns the per-user
// evaluateProactiveTrigger() into a sweep the existing cron infrastructure
// can call: find candidate users for a trigger, ask the agent to decide,
// and (only if delivery is enabled) send the proposed push.
//
// SAFETY (two independent gates):
//   1. The sweep only does anything meaningful when AGENT_ENABLED is on
//      (otherwise the agent has no API path).
//   2. It only SENDS when AGENT_PROACTIVE_ENABLED is on. With it off, it
//      evaluates + logs the decisions but sends nothing — so you can watch
//      what it *would* send in the logs before trusting it with delivery.

import { PrismaClient } from '@prisma/client';
import type Anthropic from '@anthropic-ai/sdk';
import { sendPushNotification } from '../services/notificationService.js';
import { evaluateProactiveTrigger, proactiveDeliveryEnabled, type ProactiveTrigger } from './proactive.js';

const prisma = new PrismaClient();

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
  const result: SweepResult = { trigger, evaluated: 0, wouldNotify: 0, sent: 0, decisions: [] };

  for (const userId of targets) {
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
