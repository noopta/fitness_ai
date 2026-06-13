// Orchestration loop — the agent's "brain". A Claude tool-use loop: send the
// conversation + tool defs, if Claude asks for tools run them and feed the
// results back, repeat until Claude produces a final answer.
//
// Built on the raw @anthropic-ai/sdk (zod-3 compatible — the higher-level
// @anthropic-ai/claude-agent-sdk requires zod 4, which would force a
// breaking migration of the whole backend's validation layer). The manual
// loop is also a better fit for embedding in Express than the filesystem/
// bash-oriented agent SDK.

import Anthropic from '@anthropic-ai/sdk';
import { assembleContext, renderContext } from './context.js';
import { AGENT_TOOLS } from './tools.js';
import type { AgentTool, AgentTurnResult, AgentProposal } from './types.js';

// Sonnet is the right cost/quality point for a coaching agent — Opus is
// overkill for "read my macros and advise", and the latency is better. Pin
// the id so a model alias change doesn't silently shift behaviour.
const MODEL = process.env.AGENT_MODEL || 'claude-sonnet-4-6';
const MAX_TOKENS = 1024;
// Hard ceiling on tool round-trips so a misbehaving loop can't run up an
// unbounded API bill or hang a request. 8 is generous — most turns need 1-3.
const MAX_ITERATIONS = 8;

const SYSTEM_PROMPT = `You are Anakin, an elite strength & conditioning and nutrition coach inside the Axiom app. You are direct, evidence-based, and concise — you talk like a great coach texting a client, not like a chatbot.

You have tools to read the user's real data (profile, today's nutrition, body-weight trend, recent workouts, wellness check-ins) and to take actions (log a meal, save a durable memory). Use them:
- ALWAYS read the relevant data before giving specific numerical advice. Don't guess their macros or weight — look them up.
- When the user tells you to log something, use log_meal and confirm exactly what you logged.
- When you learn a durable fact (a goal, an injury, a strong preference), use remember so future sessions know it. Don't remember transient details.
- Chain tools when needed: e.g. read training load AND nutrition before advising on a recovery meal.

Applying changes to their plan (swap_exercise_in_program, adjust_macros, apply_program_update, propose_workout_swap):
- These MODIFY the user's real program/macros. First describe the proposed change in plain language. Then, when the user agrees in ANY form ("yes", "ok", "sure", "do it", "go with X", "let's do that", just naming the chosen option) — call the tool ON THAT SAME TURN. Not next turn. THIS turn.
- HARD RULE: if the user agrees to a swap and your reply does NOT include a tool_use call, you have failed. Text-only confirmation does not change the program. The user will think it worked, see no change, and lose trust.
- For exercise swaps in their program: use swap_exercise_in_program(fromExerciseName, toExerciseName, reason?). It's the simplest path — no need to construct a full program object. Backend does the surgery + persists.
- NEVER say "Program stays untouched" or "for today only" unless the user EXPLICITLY says they want a one-time mental note for this session only. By default, every swap is a real, persisted program edit.
- NEVER respond to "yes" with a follow-up question like "want to make this permanent?". The user already said yes — make it permanent now and confirm.
- For broader changes: apply_program_update or propose_program_update. Workout-day swaps: propose_workout_swap. Macros: adjust_macros.
- Preserve their GOAL — adjust around it, keep phase structure + progression intact.
- After the tool runs, confirm in one line what changed (use the tool's return value).

Keep replies tight. Lead with the answer. Use the user's real numbers. If you took an action, say so in one line.`;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set — agent cannot run.');
    client = new Anthropic({ apiKey });
  }
  return client;
}

/**
 * Run one agent turn. `history` is prior turns (optional) in Anthropic
 * message format; `userMessage` is the new input. Returns the reply plus
 * telemetry. `injectClient` lets tests pass a mock Anthropic client so no
 * live API calls (or spend) happen in CI.
 */
export interface AgentTurnOptions {
  history?: Anthropic.MessageParam[];
  injectClient?: Pick<Anthropic, 'messages'>;
  // Extra tools available only for this turn (e.g. propose_notification in
  // the proactive runner). Merged with the standard registry.
  extraTools?: AgentTool[];
  // Replace the default chat system prompt (the proactive runner supplies
  // its own "decide whether to notify" framing). UserContext is still
  // appended either way.
  systemOverride?: string;
  // Recursion depth for sub-agent delegation. 0 = top level. The delegate
  // tool is only offered while depth < MAX_SUBAGENT_DEPTH, so a sub-agent
  // can't spawn its own sub-agents — bounding cost + recursion.
  depth?: number;
}

// Phase 6 — sub-agent delegation. One level deep: the top-level agent can
// delegate a bounded task to a focused sub-agent, but that sub-agent gets no
// delegate tool of its own.
const MAX_SUBAGENT_DEPTH = 1;

const SUBAGENT_SYSTEM = `You are a focused sub-agent spun up by Anakin to handle ONE bounded task. Do exactly the task you were given using your tools, then return a concise result. Don't chat, don't ask follow-ups — produce the deliverable.`;

export async function runAgentTurn(
  userId: string,
  userMessage: string,
  historyOrOpts: Anthropic.MessageParam[] | AgentTurnOptions = [],
  injectClientLegacy?: Pick<Anthropic, 'messages'>,
): Promise<AgentTurnResult> {
  // Back-compat: callers may pass (history, injectClient) positionally, or a
  // single options object. Normalise.
  const opts: AgentTurnOptions = Array.isArray(historyOrOpts)
    ? { history: historyOrOpts, injectClient: injectClientLegacy }
    : historyOrOpts;
  const history = opts.history ?? [];
  const anthropic = opts.injectClient ?? getClient();
  const depth = opts.depth ?? 0;

  // Offer the delegate tool only above the depth ceiling so sub-agents can't
  // recurse. Built here (not in the static registry) so it can capture the
  // current depth + the injected client for nested calls.
  const delegateTools: AgentTool[] = depth < MAX_SUBAGENT_DEPTH ? [{
    name: 'delegate_task',
    description:
      'Hand a single, well-defined sub-task to a focused sub-agent (e.g. "draft a 4-day upper/lower split for my equipment" or "compute my remaining macros and propose a dinner"). The sub-agent has the same data tools and returns a concise result you can use. Use for complex multi-step work you want isolated from the main conversation.',
    input_schema: {
      type: 'object',
      properties: { task: { type: 'string', description: 'The self-contained instruction for the sub-agent.' } },
      required: ['task'],
    },
    execute: async (input, uid) => {
      const sub = await runAgentTurn(uid, String(input.task ?? ''), {
        depth: depth + 1,
        injectClient: opts.injectClient,
        systemOverride: SUBAGENT_SYSTEM,
      });
      return { result: sub.reply, toolsUsed: sub.toolsUsed };
    },
  }] : [];

  // Per-call tool set = standard registry + delegate (if allowed) + any extras.
  const tools = [...AGENT_TOOLS, ...delegateTools, ...(opts.extraTools ?? [])];
  const toolDefs = tools.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
  const byName: Record<string, AgentTool> = Object.fromEntries(tools.map((t) => [t.name, t]));

  const ctx = await assembleContext(userId);
  const baseSystem = opts.systemOverride ?? SYSTEM_PROMPT;
  const system = `${baseSystem}\n\n${renderContext(ctx)}`;

  const messages: Anthropic.MessageParam[] = [
    ...history,
    { role: 'user', content: userMessage },
  ];

  const toolsUsed: string[] = [];
  let iterations = 0;
  // Captured the last time the agent called a propose_* tool — surfaced on
  // the turn result so the client can render a confirm-before-apply UI.
  let proposal: AgentProposal | undefined;

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      tools: toolDefs as Anthropic.Tool[],
      messages,
    });

    // Record the assistant turn verbatim so tool_use ids line up with the
    // tool_result blocks we send next.
    messages.push({ role: 'assistant', content: res.content });

    if (res.stop_reason !== 'tool_use') {
      // Final answer — concatenate any text blocks.
      const reply = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();
      return { reply: reply || '(no reply)', toolsUsed, iterations, proposal };
    }

    // Execute every requested tool, collecting results for the next turn.
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of res.content) {
      if (block.type !== 'tool_use') continue;
      toolsUsed.push(block.name);
      const tool = byName[block.name];
      if (!tool) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: `Unknown tool: ${block.name}`,
          is_error: true,
        });
        continue;
      }
      try {
        const result = await tool.execute(block.input as Record<string, unknown>, userId);
        // Hoist a propose_* result onto the turn so the API caller gets the
        // structured proposal alongside the agent's text reply.
        if (result && typeof result === 'object' && (result as any)._proposal) {
          const r = result as any;
          if (r.kind === 'workout_swap') {
            proposal = {
              kind: 'workout_swap',
              proposedWeek: r.proposedWeek ?? [],
              rationale: r.rationale ?? '',
              summary: r.summary ?? 'Proposed workout swap',
              sourceDate: r.sourceDate ?? '',
              chosenSessionName: r.chosenSessionName ?? '',
            };
          } else {
            proposal = { kind: r.kind ?? 'program_update', updatedProgram: r.updatedProgram, summary: r.summary, changedDays: r.changedDays ?? [] };
          }
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      } catch (err: any) {
        // Feed the error back to the model rather than throwing — it can
        // recover (try a different tool, or explain to the user).
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: `Error: ${err?.message ?? String(err)}`,
          is_error: true,
        });
      }
    }
    messages.push({ role: 'user', content: toolResults });
  }

  // Hit the iteration ceiling without a final answer — return a graceful
  // fallback rather than looping forever.
  return {
    reply: "I ran out of steps working through that. Could you narrow the question a bit?",
    toolsUsed,
    iterations,
    proposal,
  };
}

// ─── Streaming variant ────────────────────────────────────────────────────────

export type AgentStreamEvent =
  | { type: 'status'; phase: 'thinking' | 'tool'; tool?: string }
  | { type: 'delta'; text: string }
  | { type: 'done'; reply: string; toolsUsed: string[]; iterations: number }
  | { type: 'error'; error: string };

/**
 * Streaming version of a coach turn. Emits events as the loop runs:
 *  - status (thinking / calling a tool)
 *  - delta  (text tokens of the assistant's reply, as they generate)
 *  - done   (final reply + telemetry)
 *  - error
 * The route turns these into Server-Sent Events. Built for the chat surface
 * where 5-20s of silence would feel broken — the web client already expects
 * a token stream (it uses /coach/chat/stream today).
 */
export async function streamAgentTurn(
  userId: string,
  userMessage: string,
  onEvent: (e: AgentStreamEvent) => void,
  history: Anthropic.MessageParam[] = [],
  injectClient?: Pick<Anthropic, 'messages'>,
): Promise<AgentTurnResult> {
  const anthropic = injectClient ?? getClient();
  const ctx = await assembleContext(userId);
  const system = `${SYSTEM_PROMPT}\n\n${renderContext(ctx)}`;
  const tools = [...AGENT_TOOLS];
  const toolDefs = tools.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
  const byName: Record<string, AgentTool> = Object.fromEntries(tools.map((t) => [t.name, t]));

  const messages: Anthropic.MessageParam[] = [...history, { role: 'user', content: userMessage }];
  const toolsUsed: string[] = [];
  let iterations = 0;
  let finalText = '';
  let proposal: AgentProposal | undefined;

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    onEvent({ type: 'status', phase: 'thinking' });

    // Stream this model call; forward text deltas live.
    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      tools: toolDefs as Anthropic.Tool[],
      messages,
    });
    stream.on('text', (delta: string) => {
      finalText += delta;
      onEvent({ type: 'delta', text: delta });
    });
    const res = await stream.finalMessage();
    messages.push({ role: 'assistant', content: res.content });

    if (res.stop_reason !== 'tool_use') {
      const reply = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text).join('').trim() || finalText.trim() || '(no reply)';
      onEvent({ type: 'done', reply, toolsUsed, iterations });
      return { reply, toolsUsed, iterations, proposal };
    }

    // Reset accumulated text — intermediate "thinking" text before a tool
    // call isn't the final answer.
    finalText = '';
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of res.content) {
      if (block.type !== 'tool_use') continue;
      toolsUsed.push(block.name);
      onEvent({ type: 'status', phase: 'tool', tool: block.name });
      const tool = byName[block.name];
      if (!tool) {
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: `Unknown tool: ${block.name}`, is_error: true });
        continue;
      }
      try {
        const result = await tool.execute(block.input as Record<string, unknown>, userId);
        if (result && typeof result === 'object' && (result as any)._proposal) {
          const r = result as any;
          if (r.kind === 'workout_swap') {
            proposal = {
              kind: 'workout_swap',
              proposedWeek: r.proposedWeek ?? [],
              rationale: r.rationale ?? '',
              summary: r.summary ?? 'Proposed workout swap',
              sourceDate: r.sourceDate ?? '',
              chosenSessionName: r.chosenSessionName ?? '',
            };
          } else {
            proposal = { kind: r.kind ?? 'program_update', updatedProgram: r.updatedProgram, summary: r.summary, changedDays: r.changedDays ?? [] };
          }
        }
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
      } catch (err: any) {
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: `Error: ${err?.message ?? String(err)}`, is_error: true });
      }
    }
    messages.push({ role: 'user', content: toolResults });
  }

  const reply = "I ran out of steps working through that. Could you narrow the question a bit?";
  onEvent({ type: 'done', reply, toolsUsed, iterations });
  return { reply, toolsUsed, iterations, proposal };
}
