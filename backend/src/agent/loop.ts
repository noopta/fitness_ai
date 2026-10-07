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
import { AGENT_TOOLS, toolsFor } from './registry.js';
import type { AgentTool, AgentTurnResult, AgentProposal, ToolCtx } from './types.js';
import { receiptForCall, summarizeResult, cardForResult, type AgentCard, type ReceiptVerb } from './receipts.js';
import type { Card } from './cards/types.js';
import { CardNoteFilter, stripCardNotes } from './cardNotes.js';
import { toolParams, toolCtx, runToolCall, capCards, disableToolSearch, isToolSearchRejection } from './turn.js';
import { setTurnMessage } from './turnMessage.js';

// Sonnet is the right cost/quality point for a coaching agent — Opus is
// overkill for "read my macros and advise", and the latency is better. Pin
// the id so a model alias change doesn't silently shift behaviour.
const MODEL = process.env.AGENT_MODEL || 'claude-sonnet-5';
// 1024 was too tight: a data-heavy answer (tables) or a tool call emitted
// after a fat tool_result could hit the cap mid-generation. A max_tokens stop
// mid-tool-call yields NO text blocks — which used to surface as "(no reply)".
const MAX_TOKENS = 4096;
// Hard ceiling on tool round-trips so a misbehaving loop can't run up an
// unbounded API bill or hang a request. 8 is generous — most turns need 1-3.
const MAX_ITERATIONS = 8;

const SYSTEM_PROMPT = `You are Anakin, an elite strength & conditioning and nutrition coach inside the Axiom app. You are direct, evidence-based, and concise — you talk like a great coach texting a client, not like a chatbot. The app renders your tool results as live cards under your reply. When a card is shown (the tool result says card_shown), keep the text to at most two short sentences — the card carries the numbers and the buttons. Otherwise at most four sentences. Plain prose; no markdown headings or bullet lists in chat; units as "lb" or "kg" with a space; no "~" and no slashes in copy.

You have tools for every part of the user's account: profile and settings, program and schedule, workouts, strength, nutrition, recipes, body weight, wellness, memory, friends, groups and billing. Use them:
- ALWAYS read the relevant data before giving specific numerical advice. Don't guess their macros or weight — look them up.
- When the user tells you to log something, log it and confirm exactly what you logged.
- Workouts from earlier days — pasted notes, a list, weeks or months of history, however messy — go through log_past_workouts (preview first, then confirm), never a string of log_workout calls. The preview shows a card the user checks and logs from: reply in one or two short sentences with the count and range and anything to act on, then let the card take the tap ("Seven workouts from 15 Jul to 5 Aug, plus a push day with no date. Check them, then log." / "41 workouts over 11 weeks — that's the whole block. One was already in your log."). Don't list the sessions; the card does. Call confirm only if they say yes in chat instead. To drop a week or day, re-preview with the previewId and skipWeeksOf / skipDates. After logging, one short line ("In. Your history now starts in July.") — no celebration.
- When you learn a durable fact, call remember in the same turn — don't wait to be asked. Durable means it should change future advice: a goal or deadline, an injury or niggle, foods they avoid or love, schedule limits ("can't train Thursdays"), equipment they have, how they like to be coached. The user sees these notes in the app, so phrase each as one short third-person sentence. Don't remember one-off details (today's meal, a single bad night) or what their profile already says.
- Chain tools when needed: e.g. read training load AND nutrition before advising on a recovery meal.

How changes work — the app enforces these, so follow them:
- READ tools change nothing. LOG tools (a meal, a set, a weigh-in, a check-in, a note) save at once when the user states the fact — call them on the same turn and say in one line what you saved; the card offers Undo. SET tools change a setting or profile field the user explicitly asked to change — do it that turn; the card shows old → new with Undo. If a setting change is YOUR idea rather than their request, suggest it in words and let them ask.
- PROPOSE tools (program edits, swaps, schedule moves, targets, macros, new programs, restores) never apply anything: they put a card up and the user taps Apply. After proposing, say in one line what you put up for them to review — never claim it is already done. Don't ask "want me to apply it?" — the card is the question.
- DRAFT tools (posts, comments, messages, friend requests, invites, group posts, partner sessions) only draft; nothing is sent until the user taps Send. CONFIRM tools (deletes, leaving, restarting the intake, account deletion) show what will be lost; the tap deletes. Never describe a draft as sent or a delete as done.
- INTENT tools open something on the phone (camera, scanner, store sheet, settings, a session). Say what they'll see in one line.
- When the user asks to undo something you changed, use undo_change (read_change_log first if you need the id).
- To change a profile field, read_coaching_profile first so you know the current value. Injuries go through update_injuries, medical answers through update_health_profile.
- Exercise swaps: read_schedule_week first for the exact stored names and today's day label, then propose_exercise_swap (scope 'day' by default; 'program' only if they want it everywhere).
- Preserve their GOAL — adjust around it, keep phase structure and progression intact. A goal change means a new program (propose_new_program), not an edit.
- A new split ("give me a PPL split"), a level change ("I'm intermediate now", "make it more advanced") or a new schedule is a rebuild: save the stated level or days with update_coaching_profile first, then propose_new_program with split and trainingAge — their goal is kept unless they asked to change it. Adding or dropping one training day, or a different days-per-week on the current program, is propose_program_edit (add_day, remove_day, set_days_per_week).
- A user message may open with an <app_note> block. That is the app telling you which cards are on screen under your previous reply — the user did not type it. Use it to follow references ("make it 190", "apply that"), never repeat it, and never write card names in brackets, card codes or ids in a reply: the app places the cards, your reply is only the words.
- Many tools aren't loaded up front. If you need one you don't see (recipes, friends, groups, notifications, diagnostics, form checks, streaks, billing…), search for it with the tool search tool before saying you can't.

Keep replies tight. Lead with the answer. Use the user's real numbers. If you took an action, say so in one line.`;

// The classic app renders three proposal cards and relies on two direct tools.
const V1_ADDENDUM = `In this version of the app: macro targets change directly with adjust_macros once the user agrees (any "yes", "ok", "do it" — call it on that same turn), and broad program rewrites use apply_program_update after they agree. Program edits (propose_program_edit, including adding or removing a day), rebuilt programs (propose_new_program — new split, level or schedule), exercise swaps and session moves show a card with an Apply button they confirm. log_past_workouts shows no card here: after the preview, give the count, the range and what was left out, then one question — "Found 8 workouts from 15 Jul to 5 Aug. One was already logged. Log the other 7?" — with no list unless they ask. When they say yes, call it again with confirm: true and the previewId.`;

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
  /** 2 = build agent-first cards (server ids) for the result. */
  cardContract?: 1 | 2;
}

// Phase 6 — sub-agent delegation. One level deep: the top-level agent can
// delegate a bounded task to a focused sub-agent, but that sub-agent gets no
// delegate tool of its own.
const MAX_SUBAGENT_DEPTH = 1;

const SUBAGENT_SYSTEM = `You are a focused sub-agent spun up by Anakin to handle ONE bounded task. Do exactly the task you were given using your tools, then return a concise result. Don't chat, don't ask follow-ups — produce the deliverable.`;

/** Lift a legacy propose_* result onto the turn (v1 cards + the web app). */
function extractProposal(r: any): AgentProposal | undefined {
  if (!r || typeof r !== 'object' || !r._proposal) return undefined;
  if (r.kind === 'workout_swap') {
    return { kind: 'workout_swap', proposedWeek: r.proposedWeek ?? [], rationale: r.rationale ?? '', summary: r.summary ?? 'Proposed workout swap', sourceDate: r.sourceDate ?? '', chosenSessionName: r.chosenSessionName ?? '' };
  }
  if (r.kind === 'plan_patch') {
    return {
      kind: 'plan_patch', day: r.day ?? null, scope: r.scope === 'program' ? 'program' : 'day',
      from: r.from ?? { name: '' }, to: r.to ?? { name: '' }, meta: r.meta ?? {},
      rationale: typeof r.rationale === 'string' ? r.rationale : '',
      summary: typeof r.summary === 'string' && r.summary.trim() ? r.summary : 'Proposed exercise swap',
    };
  }
  // Coerce summary to a non-empty string: the v1 client renders it directly
  // as a <Text> child, and an object/undefined trips its ErrorBoundary.
  const summary = typeof r.summary === 'string' && r.summary.trim() ? r.summary : 'Program update proposed';
  return { kind: r.kind ?? 'program_update', updatedProgram: r.updatedProgram, summary, changedDays: Array.isArray(r.changedDays) ? r.changedDays : [] };
}

/** System prompt as a cacheable block: stable instructions, then the per-user context. */
function systemBlocks(base: string, ctxText: string): Anthropic.TextBlockParam[] {
  return [
    { type: 'text', text: base, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: ctxText },
  ];
}

/** One model call; if the API rejects tool search, retry once without it. */
async function createWithFallback(
  anthropic: Pick<Anthropic, 'messages'>,
  params: { system: Anthropic.TextBlockParam[]; tools: AgentTool[]; messages: Anthropic.MessageParam[] },
  stream: false,
): Promise<Anthropic.Message>;
async function createWithFallback(
  anthropic: Pick<Anthropic, 'messages'>,
  params: { system: Anthropic.TextBlockParam[]; tools: AgentTool[]; messages: Anthropic.MessageParam[]; onText: (d: string) => void },
  stream: true,
): Promise<Anthropic.Message>;
async function createWithFallback(anthropic: Pick<Anthropic, 'messages'>, params: any, stream: boolean): Promise<Anthropic.Message> {
  const attempt = async () => {
    const req = { model: MODEL, max_tokens: MAX_TOKENS, system: params.system, tools: toolParams(params.tools), messages: params.messages };
    if (!stream) return anthropic.messages.create(req as any) as Promise<Anthropic.Message>;
    const st = anthropic.messages.stream(req as any);
    st.on('text', params.onText);
    return st.finalMessage();
  };
  try {
    return await attempt();
  } catch (err: any) {
    if (isToolSearchRejection(err)) {
      disableToolSearch(err?.message ?? 'rejected');
      return attempt();
    }
    throw err;
  }
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
  const depth = opts.depth ?? 0;

  // Offer the delegate tool only above the depth ceiling so sub-agents can't
  // recurse. Built here (not in the static registry) so it can capture the
  // current depth + the injected client for nested calls.
  const delegateTools: AgentTool[] = depth < MAX_SUBAGENT_DEPTH ? [{
    name: 'delegate_task',
    kind: 'read',
    core: true,
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
  const tools = [...toolsFor(opts.cardContract === 2 ? 2 : 1), ...delegateTools, ...(opts.extraTools ?? []).map((t) => ({ core: true, ...t }))];
  const byName: Record<string, AgentTool> = Object.fromEntries(tools.map((t) => [t.name, t]));

  const [ctx, tctx] = await Promise.all([assembleContext(userId), toolCtx(userId)]);
  const system = systemBlocks(opts.systemOverride ?? (opts.cardContract === 2 ? SYSTEM_PROMPT : `${SYSTEM_PROMPT}\n\n${V1_ADDENDUM}`), renderContext(ctx));

  setTurnMessage(userId, userMessage);
  const messages: Anthropic.MessageParam[] = [...history, { role: 'user', content: userMessage }];
  const toolsUsed: string[] = [];
  let iterations = 0;
  // Captured the last time the agent called a propose_* tool — surfaced on
  // the turn result so the client can render a confirm-before-apply UI.
  let proposal: AgentProposal | undefined;
  const cards: Card[] = [];
  // One-shot guard for a max_tokens stop that produced no text (typically the
  // cap landing mid-tool-call): retry once, telling the model to answer in
  // prose with what it already has instead of surfacing an empty reply.
  let truncationRetried = false;

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    const res = await createWithFallback(anthropic, { system, tools, messages }, false);
    // Record the assistant turn verbatim so tool_use ids line up with the
    // tool_result blocks we send next (tool-search blocks included).
    messages.push({ role: 'assistant', content: res.content });

    if (res.stop_reason !== 'tool_use') {
      const raw = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      const reply = stripCardNotes(raw);
      if (!reply && res.stop_reason === 'max_tokens' && !truncationRetried) {
        truncationRetried = true;
        // The truncated turn may end in a partial tool_use with no paired
        // tool_result — leaving it in history makes the next call invalid.
        messages.pop();
        messages.push({
          role: 'user',
          content: '(Your previous attempt was cut off before any text was produced. Answer the question now in concise prose using the information you already gathered — do not call more tools.)',
        });
        continue;
      }
      if (!reply) console.warn(`[agent] empty reply (stop_reason=${res.stop_reason}) user=${userId.slice(0, 8)}`);
      return {
        reply: reply || "I lost my train of thought there — mind asking that again?",
        toolsUsed,
        iterations,
        proposal,
        ...(opts.cardContract === 2 ? { cards: await capCards(userId, cards) } : {}),
      };
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of res.content) {
      if (block.type !== 'tool_use') continue;
      toolsUsed.push(block.name);
      const tool = byName[block.name];
      if (!tool) {
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: `Unknown tool: ${block.name}`, is_error: true });
        continue;
      }
      try {
        const out = await runToolCall(tool, (block.input ?? {}) as Record<string, unknown>, userId, tctx, { buildCards: opts.cardContract === 2 });
        proposal = extractProposal(out.raw) ?? proposal;
        cards.push(...out.cards);
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(out.modelResult) });
      } catch (err: any) {
        // Feed the error back to the model rather than throwing — it can
        // recover (try a different tool, or explain to the user).
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: `Error: ${err?.message ?? String(err)}`, is_error: true });
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
    ...(opts.cardContract === 2 ? { cards: await capCards(userId, cards) } : {}),
  };
}

/** Joins the text of each step of a turn into one reply. */
function joinSteps(parts: string[]): string {
  return parts.map((p) => p.trim()).filter(Boolean).join(' ');
}

// ─── Streaming variant ────────────────────────────────────────────────────────

export type AgentStreamEvent =
  | { type: 'status'; phase: 'thinking' | 'tool'; tool?: string }
  | { type: 'delta'; text: string }
  // Receipts: one per tool call, keyed by `id`. Emitted once when the tool
  // is called and again (same id, `final: true`) when its result sharpened
  // the text. `indent` marks a sub-agent's tool. Verb is the tool class —
  // never something the model wrote.
  | { type: 'receipt'; id: string; verb: ReceiptVerb; text: string; indent?: boolean; final?: boolean }
  // Legacy (contract 1) inline card: week / bench / food / proposal.
  | { type: 'card'; card: AgentCard }
  // Contract 2: server-id cards, up to 3 per turn, in execution order.
  | { type: 'card2'; turnId: string; card: Card }
  // A card already in the thread changed during this turn (a "yes" in chat
  // logged the preview card's batch): replace it in place.
  | { type: 'card_update'; cardId: string; patch: Partial<Card> }
  | { type: 'done'; reply: string; toolsUsed: string[]; iterations: number; card?: AgentCard | null; proposal?: AgentProposal; cards?: Card[]; turnId?: string }
  | { type: 'error'; error: string };

export interface StreamOptions {
  history?: Anthropic.MessageParam[];
  injectClient?: Pick<Anthropic, 'messages'>;
  /** 2 = the agent-first card contract (server ids, many cards). */
  cardContract?: 1 | 2;
  turnId?: string;
}

/**
 * Streaming version of a coach turn. Emits events as the loop runs:
 *  - status (thinking / calling a tool)
 *  - receipt (one per tool call)
 *  - delta  (text tokens of the assistant's reply, as they generate)
 *  - card / card2 (the cards under the reply)
 *  - done   (final reply + telemetry)
 */
export async function streamAgentTurn(
  userId: string,
  userMessage: string,
  onEvent: (e: AgentStreamEvent) => void,
  historyOrOpts: Anthropic.MessageParam[] | StreamOptions = [],
  injectClientLegacy?: Pick<Anthropic, 'messages'>,
): Promise<AgentTurnResult> {
  const opts: StreamOptions = Array.isArray(historyOrOpts) ? { history: historyOrOpts, injectClient: injectClientLegacy } : historyOrOpts;
  const anthropic = opts.injectClient ?? getClient();
  const contract = opts.cardContract ?? 1;
  const turnId = opts.turnId ?? `t${Date.now().toString(36)}`;
  const [ctx, tctx] = await Promise.all([assembleContext(userId), toolCtx(userId)]);
  const system = systemBlocks(contract === 2 ? SYSTEM_PROMPT : `${SYSTEM_PROMPT}\n\n${V1_ADDENDUM}`, renderContext(ctx));
  const tools = toolsFor(contract);
  const byName: Record<string, AgentTool> = Object.fromEntries(tools.map((t) => [t.name, t]));

  setTurnMessage(userId, userMessage);
  const messages: Anthropic.MessageParam[] = [...(opts.history ?? []), { role: 'user', content: userMessage }];
  const toolsUsed: string[] = [];
  let iterations = 0;
  let finalText = '';
  // Text the model wrote before a tool call. It often starts its answer,
  // calls one more tool, then carries on mid-sentence — so the reply is every
  // step's text in order, not just the last step's.
  const earlier: string[] = [];
  // Card notes the model writes itself never reach the client (cardNotes.ts).
  const notes = new CardNoteFilter();
  const emitText = (t: string) => { if (t) onEvent({ type: 'delta', text: t }); };
  let proposal: AgentProposal | undefined;
  // Contract 1: the one legacy card (last relevant tool wins).
  let card: AgentCard | null = null;
  // Contract 2: every card, capped at the end of the turn.
  const cards: Card[] = [];
  let receiptSeq = 0;
  // Every turn begins by reading the assembled context (profile, today's
  // nutrition, weight, last check-in, memory). That read is real, so it gets
  // a receipt — and it means no turn ever renders without one.
  onEvent({ type: 'receipt', id: 'r0', verb: 'Read', text: ctx.todayNutrition ? 'Your profile and today' : 'Your profile', final: true });
  let truncationRetried = false;

  const finish = async (reply: string): Promise<AgentTurnResult> => {
    if (contract === 2) {
      const shown = await capCards(userId, cards);
      for (const c of shown) onEvent({ type: 'card2', turnId, card: c });
      onEvent({ type: 'done', reply, toolsUsed, iterations, proposal, cards: shown, turnId });
      return { reply, toolsUsed, iterations, proposal, cards: shown };
    }
    if (card) onEvent({ type: 'card', card });
    onEvent({ type: 'done', reply, toolsUsed, iterations, card, proposal });
    return { reply, toolsUsed, iterations, proposal };
  };

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    onEvent({ type: 'status', phase: 'thinking' });
    const res = await createWithFallback(anthropic, {
      system, tools, messages,
      onText: (delta: string) => { finalText += delta; emitText(notes.push(delta)); },
    }, true);
    emitText(notes.flush());
    messages.push({ role: 'assistant', content: res.content });

    if (res.stop_reason !== 'tool_use') {
      const last = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text).join('').trim() || finalText.trim();
      const text = stripCardNotes(joinSteps([...earlier, last]));
      if (!text && res.stop_reason === 'max_tokens' && !truncationRetried) {
        truncationRetried = true;
        messages.pop(); // drop the truncated turn (may hold a partial tool_use)
        messages.push({
          role: 'user',
          content: '(Your previous attempt was cut off before any text was produced. Answer the question now in concise prose using the information you already gathered — do not call more tools.)',
        });
        continue;
      }
      if (!text) console.warn(`[agent] empty streamed reply (stop_reason=${res.stop_reason}) user=${userId.slice(0, 8)}`);
      return finish(text || "I lost my train of thought there — mind asking that again?");
    }

    // Text before a tool call is kept: it is the start of the answer. The
    // client has shown it already; a space keeps the next step from running on.
    if (finalText.trim()) { earlier.push(finalText.trim()); emitText(' '); }
    finalText = '';
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of res.content) {
      if (block.type !== 'tool_use') continue;
      toolsUsed.push(block.name);
      onEvent({ type: 'status', phase: 'tool', tool: block.name });
      const toolInput = (block.input ?? {}) as Record<string, unknown>;
      const receiptId = `r${iterations}-${receiptSeq++}`;
      const tool = byName[block.name];
      const callReceipt = tool?.receipt ? tool.receipt(toolInput, userId) : receiptForCall(block.name, toolInput);
      onEvent({ type: 'receipt', id: receiptId, verb: callReceipt.verb as ReceiptVerb, text: callReceipt.text });
      if (!tool) {
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: `Unknown tool: ${block.name}`, is_error: true });
        continue;
      }
      try {
        const out = await runToolCall(tool, toolInput, userId, tctx, { buildCards: contract === 2 });
        const result = out.raw;
        // Sharpen the receipt with what the tool found, and surface nested
        // (sub-agent) tool calls as indented receipts.
        const refined = tool.refine ? tool.refine(result, toolInput) : summarizeResult(block.name, result);
        if (refined) {
          const r = typeof refined === 'string' ? { verb: callReceipt.verb, text: refined } : refined;
          onEvent({ type: 'receipt', id: receiptId, verb: r.verb as ReceiptVerb, text: r.text, final: true });
        }
        if (block.name === 'delegate_task' && result && typeof result === 'object' && Array.isArray((result as any).toolsUsed)) {
          for (const sub of (result as any).toolsUsed as string[]) {
            const st = byName[sub];
            const sr = st?.receipt ? st.receipt({}) : receiptForCall(sub, {});
            onEvent({ type: 'receipt', id: `${receiptId}-${receiptSeq++}`, verb: sr.verb as ReceiptVerb, text: sr.text, indent: true, final: true });
          }
        }
        if (contract === 1) card = cardForResult(block.name, toolInput, result, card);
        cards.push(...out.cards);
        if (contract === 2 && result && typeof result === 'object' && Array.isArray((result as any)._cardUpdates)) {
          for (const c of (result as any)._cardUpdates as Card[]) onEvent({ type: 'card_update', cardId: c.id, patch: c });
        }
        proposal = extractProposal(result) ?? proposal;
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(out.modelResult) });
      } catch (err: any) {
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: `Error: ${err?.message ?? String(err)}`, is_error: true });
      }
    }
    messages.push({ role: 'user', content: toolResults });
  }

  return finish("I ran out of steps working through that. Could you narrow the question a bit?");
}
