// Proactive layer (Stage 5) — lets the agent act *for* the user on triggers
// instead of only responding to messages. A trigger (from the existing cron/
// notification infra: nightly check, streak-at-risk, post-workout, etc.)
// invokes the agent with context and a "decide whether to reach out" framing.
// The agent reads the user's data, decides if a nudge is warranted, and if so
// drafts the push copy via the propose_notification tool.
//
// SAFETY: this module NEVER sends a notification on its own. It returns a
// ProactiveDecision. Actual delivery is the caller's job and is gated behind
// AGENT_PROACTIVE_ENABLED (default off). So wiring this into a cron is inert
// until that flag is deliberately turned on — nothing reaches a user's phone
// during development.

import type Anthropic from '@anthropic-ai/sdk';
import { runAgentTurn } from './loop.js';
import type { AgentTool } from './types.js';

export type ProactiveTrigger =
  | 'nightly_review'
  | 'streak_at_risk'
  | 'post_workout'
  | 'wellness_flag'
  | 'nutrition_gap';

export interface ProactiveDecision {
  trigger: ProactiveTrigger;
  shouldNotify: boolean;
  title: string | null;
  body: string | null;
  reasoning: string;
  toolsUsed: string[];
}

const TRIGGER_FRAMING: Record<ProactiveTrigger, string> = {
  nightly_review:
    "It's the end of the day. Review how the user's day went (nutrition vs. target, whether they trained) and decide if a brief, encouraging or corrective nudge is worth sending.",
  streak_at_risk:
    "The user's logging streak is at risk (they haven't logged today). Decide if a gentle reminder is warranted, considering their recent consistency — don't nag someone who's clearly just busy one day.",
  post_workout:
    "The user just logged a workout. Decide if a useful follow-up is warranted — e.g. a recovery-meal suggestion that fits their remaining macros.",
  wellness_flag:
    "The user's recent wellness check-in shows low energy/sleep or high stress. Decide if you should proactively adjust expectations or suggest a lighter session.",
  nutrition_gap:
    "The user is well behind on a macro target with little of the day left. Decide if a specific, actionable suggestion is worth sending.",
};

const PROACTIVE_SYSTEM = `You are Anakin, deciding whether to PROACTIVELY message the user. You are not in a conversation — you were woken by a trigger to evaluate their current state.

Be conservative. A proactive push is an interruption; only send one when it's genuinely useful and timely. Most triggers should result in NO notification. Read the relevant data with your tools before deciding.

If — and only if — a notification is clearly worth it, call propose_notification with a SHORT title (≤5 words) and a body (≤140 chars) that is specific to their real data (use their actual numbers). Otherwise, do not call it.

After deciding, reply with one sentence explaining your decision.`;

/**
 * Evaluate a trigger for a user. Returns the agent's decision WITHOUT sending
 * anything. The caller decides whether/how to deliver (and only if the
 * AGENT_PROACTIVE_ENABLED flag is on).
 */
export async function evaluateProactiveTrigger(
  userId: string,
  trigger: ProactiveTrigger,
  injectClient?: Pick<Anthropic, 'messages'>,
): Promise<ProactiveDecision> {
  // Closure-captured proposal — the propose_notification tool writes here.
  let proposal: { title: string; body: string } | null = null;

  const proposeNotification: AgentTool = {
    name: 'propose_notification',
    description:
      'Propose a push notification to send to the user. Only call this if a notification is genuinely warranted. Title ≤5 words, body ≤140 chars, specific to their real data.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['title', 'body'],
    },
    execute: async (input) => {
      proposal = {
        title: String(input.title ?? '').slice(0, 60),
        body: String(input.body ?? '').slice(0, 140),
      };
      return { accepted: true };
    },
  };

  const result = await runAgentTurn(userId, TRIGGER_FRAMING[trigger], {
    systemOverride: PROACTIVE_SYSTEM,
    extraTools: [proposeNotification],
    injectClient,
  });

  return {
    trigger,
    shouldNotify: proposal !== null,
    title: proposal?.title ?? null,
    body: proposal?.body ?? null,
    reasoning: result.reply,
    toolsUsed: result.toolsUsed,
  };
}

/**
 * Whether proactive delivery is allowed. The evaluate step always runs
 * (it's read-only + decision-only); this gate controls whether a caller may
 * actually send the proposed notification. Default OFF.
 */
export function proactiveDeliveryEnabled(): boolean {
  return process.env.AGENT_PROACTIVE_ENABLED === 'true';
}
