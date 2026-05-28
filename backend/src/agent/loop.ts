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
import type { AgentTool, AgentTurnResult } from './types.js';

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
}

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

  // Per-call tool set = standard registry + any extras.
  const tools = [...AGENT_TOOLS, ...(opts.extraTools ?? [])];
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
      return { reply: reply || '(no reply)', toolsUsed, iterations };
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
  };
}
