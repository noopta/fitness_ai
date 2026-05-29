// Agent task framework — each high-value agent application is a thin task
// definition (a system-prompt framing + an opening instruction), not a
// bespoke implementation. They all run through the same tool-use loop, so
// adding a new agent-powered surface is ~10 lines here.
//
// All tasks are read-first: they pull the user's real data with tools before
// advising. Write actions (log_meal, remember, etc.) are available but the
// framings tell the agent to propose + confirm rather than silently mutate.

import { runAgentTurn } from './loop.js';
import type { AgentTurnResult } from './types.js';
import type Anthropic from '@anthropic-ai/sdk';

export type AgentTaskId =
  | 'program_adjustment'
  | 'life_happened'
  | 'plateau'
  | 'meal_suggestions'
  | 'daily_tips'
  | 'weekly_review'
  | 'injury_intake'
  | 'research_apply'
  | 'apply_suggestion';

interface AgentTaskDef {
  id: AgentTaskId;
  // Replaces the default chat persona for this task. UserContext is still
  // appended automatically by the loop.
  framing: string;
  // The opening instruction sent as the "user" turn. `{input}` is replaced
  // with the caller-supplied input (e.g. the user's "I was sick all week").
  opening: string;
  // Whether this task expects free-form caller input (Life Happened, injury,
  // research) vs. running purely off context (daily tips, weekly review).
  needsInput: boolean;
}

const BASE = `You are Anakin, an elite strength & nutrition coach inside Axiom. Direct, evidence-based, concise. You have tools to read the user's real data (profile, program, nutrition, weight, workouts, wellness, diagnostic) and the research feed. ALWAYS read the relevant data before advising — never guess their numbers. The deterministic diagnostic engine is authoritative; call read_latest_diagnostic, don't re-derive it.`;

export const AGENT_TASKS: Record<AgentTaskId, AgentTaskDef> = {
  program_adjustment: {
    id: 'program_adjustment',
    framing: `${BASE}\n\nYou are adjusting the user's training program. Read their current program, recent training load, wellness, and diagnostic first. Propose a concrete, minimal adjustment that fits the plan they're on and their goal. Explain the why in one or two lines. Do NOT overwrite their program silently — present the change for them to accept.`,
    opening: 'The user wants to adjust their program. Their request: "{input}". Read what you need and propose the adjustment.',
    needsInput: true,
  },
  life_happened: {
    id: 'life_happened',
    framing: `${BASE}\n\nLife disrupted the user's routine (travel, illness, missed sessions, a rough week). Your job is damage control + a clean restart, NOT guilt. Read their program + recent training to see what was actually missed, then give a specific, encouraging plan to get back on track without trying to "make up" everything at once. Keep it short and actionable. If it'd help, delegate the re-draft of the upcoming week to a sub-agent.`,
    opening: 'The user reports: "{input}". Figure out what was missed and give them a get-back-on-track plan.',
    needsInput: true,
  },
  plateau: {
    id: 'plateau',
    framing: `${BASE}\n\nThe user feels stuck. Diagnose WHY across domains: read their training history (volume/progression), nutrition adherence vs. target, body-weight trend, wellness (sleep/stress), and latest diagnostic. Identify the most likely single limiter and one concrete change to test for 2-3 weeks. Avoid laundry lists — pick the highest-leverage factor.`,
    opening: 'The user says: "{input}". Investigate across their data and tell them the most likely reason they\'re stalled + one change to test.',
    needsInput: true,
  },
  meal_suggestions: {
    id: 'meal_suggestions',
    framing: `${BASE}\n\nSuggest meals that fit what's LEFT in the user's day. Read today's nutrition + their plan target + goal + any remembered dietary preferences. Give 2-3 specific options with macros, sized to their remaining budget. Offer to log whichever they pick.`,
    // Has a real default so the task works with no caller input; if input IS
    // given (e.g. "something high-protein and quick") it replaces this.
    opening: 'Suggest meals that fit what\'s left in my day based on my targets, goal, and preferences. {input}',
    needsInput: false,
  },
  daily_tips: {
    id: 'daily_tips',
    framing: `${BASE}\n\nGive the user ONE high-leverage coaching cue for today. Read their recent training, today's nutrition so far, body-weight trend, and last wellness check-in. Pick the single most useful thing — not a list. 2-3 sentences max, specific to their real data.`,
    opening: "Give me today's single most useful coaching cue based on my current data.",
    needsInput: false,
  },
  weekly_review: {
    id: 'weekly_review',
    framing: `${BASE}\n\nProduce a short weekly progress review. Read the body-weight trend, recent workouts, nutrition adherence, and wellness. Cover: what's trending well, what's off-plan, and the single most important thing to change next week. Be honest and specific with their numbers. 4-6 sentences.`,
    opening: 'Give me my weekly progress review based on the last week of data.',
    needsInput: false,
  },
  injury_intake: {
    id: 'injury_intake',
    framing: `${BASE}\n\nThe user reported pain or an injury. Read their current program to see which sessions/lifts are affected. Recommend specific substitutions or volume reductions for the affected movements (you are a coach, not a doctor — flag if they should see a professional). Use the remember tool to save the constraint so future advice respects it.`,
    opening: 'The user reports: "{input}". Save the constraint and adjust their affected training.',
    needsInput: true,
  },
  research_apply: {
    id: 'research_apply',
    framing: `${BASE}\n\nAnswer an evidence question and apply it to THIS user. Use query_research to ground the answer in the feed's sources, then translate it to their specific situation (read their profile/goal/program as needed). Cite the source(s). Distinguish what's well-supported from what's speculative.`,
    opening: 'The user asks: "{input}". Answer with evidence and apply it to their situation.',
    needsInput: true,
  },
  // The user tapped "Apply to my plan" on a specific suggestion — the tap IS
  // their consent, so apply directly (don't re-ask), but intelligently: read
  // the relevant data, make the change FIT their goal + sound progression, and
  // actually persist it via adjust_macros / apply_program_update. Then report
  // exactly what changed in 1-2 lines so they can see (and reverse if wanted).
  apply_suggestion: {
    id: 'apply_suggestion',
    framing: `${BASE}\n\nThe user tapped "Apply to my plan" on a suggestion from their Strength/Nutrition analysis. Their tap is explicit consent — DO NOT ask them to confirm again. Read the relevant data (read_program / read_latest_diagnostic / read_nutrition_today as needed), translate the suggestion into a concrete, GOAL-PRESERVING change, and APPLY it: use apply_program_update for training changes (read_program first, change only what's needed, keep goal + phase structure + progression) or adjust_macros for nutrition changes. The user's goal is the priority — fit the change around it, backed by training/nutrition science. If the suggestion can't be safely applied (ambiguous, or would compromise the goal), DON'T apply — explain why in one line instead. After applying, state exactly what you changed in 1-2 lines.`,
    opening: 'Apply this suggestion to my plan: "{input}"',
    needsInput: true,
  },
};

/**
 * Run an agent task for a user. `input` is required for tasks where
 * needsInput is true (the caller-supplied message). `injectClient` is a test
 * seam. History is optional (most tasks are one-shot, but coach-chat-adjacent
 * ones can pass prior turns).
 */
export async function runAgentTask(
  userId: string,
  taskId: AgentTaskId,
  input?: string,
  injectClient?: Pick<Anthropic, 'messages'>,
): Promise<AgentTurnResult> {
  const task = AGENT_TASKS[taskId];
  if (!task) throw new Error(`Unknown task: ${taskId}`);
  if (task.needsInput && !input?.trim()) {
    throw new Error(`Task "${taskId}" requires input.`);
  }
  // Guard against an empty user message (Anthropic 400s on empty content) —
  // can happen if a no-input task's opening were ever just "{input}".
  const opening = task.opening.replace('{input}', (input ?? '').trim()).trim()
    || 'Help me with my training and nutrition based on my current data.';
  return runAgentTurn(userId, opening, {
    systemOverride: task.framing,
    injectClient,
  });
}
