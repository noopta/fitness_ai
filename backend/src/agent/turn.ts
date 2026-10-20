// Shared per-call machinery for both agent loops: which tools are sent to
// the model (core loaded, the rest behind tool search), how one tool call
// runs (write guard by kind), and how its cards are built and capped.

import { CONSENT_GATED, consentRefusal, readConsent } from './consent.js';
import type Anthropic from '@anthropic-ai/sdk';
import { PrismaClient } from '@prisma/client';
import type { AgentTool, ToolCtx } from './types.js';
import type { Card, CardDraft } from './cards/types.js';
import { withWriteGuard, type ExecutedChange } from './ops.js';
import { saveCard, userTz } from './cards/store.js';
import { todayIn } from './cards/format.js';
import { isUntrustedTool, isImmediateWrite, untrustedEnvelope, WRITE_BLOCKED_RESULT } from './untrusted.js';

const prisma = new PrismaClient();

// ── Tool search ──────────────────────────────────────────────────────────────
// ~120 tools is too many to send in full on every call. Core tools stay
// loaded; everything else is declared with defer_loading and found through
// the BM25 tool-search tool. If the API ever rejects it (model or platform
// without tool search), fall back to sending everything for the rest of the
// process's life.
let toolSearchDisabled = process.env.AGENT_TOOL_SEARCH === '0';
export function disableToolSearch(reason: string) {
  if (!toolSearchDisabled) console.warn(`[agent] tool search disabled: ${reason}`);
  toolSearchDisabled = true;
}
export function toolSearchActive(tools: AgentTool[]): boolean {
  return !toolSearchDisabled && tools.some((t) => !t.core);
}
export function isToolSearchRejection(err: any): boolean {
  const msg = String(err?.message ?? err?.error?.message ?? '');
  return err?.status === 400 && /defer_loading|tool_search|tool search/i.test(msg);
}

export function toolParams(tools: AgentTool[]): Anthropic.Tool[] {
  // Stable order keeps the cached prompt prefix identical across calls.
  const sorted = [...tools].sort((a, b) => (a.core === b.core ? a.name.localeCompare(b.name) : a.core ? -1 : 1));
  const defs: any[] = sorted.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
  if (!toolSearchActive(tools)) return defs as Anthropic.Tool[];
  for (let i = 0; i < defs.length; i++) if (!sorted[i].core) defs[i].defer_loading = true;
  defs.push({ type: 'tool_search_tool_bm25_20251119', name: 'tool_search_tool_bm25' });
  return defs as Anthropic.Tool[];
}

/**
 * Tools loaded for this user's turn only: a flow they're in the middle of
 * keeps its tools in hand (20 Oct 2026: plain-chat answers to the gut
 * questions went unrecorded because the tool was deferred and never searched).
 */
export async function promoteTools(userId: string, tools: AgentTool[]): Promise<AgentTool[]> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { coachProfile: true } }).catch(() => null);
  let cp: any = {};
  try { cp = u?.coachProfile ? JSON.parse(u.coachProfile) : {}; } catch { cp = {}; }
  const names = new Set<string>();
  if (Array.isArray(cp.nutritionDraft?.answered) && cp.nutritionDraft.answered.length) ['answer_nutrition_questions', 'start_nutrition_assessment'].forEach((n) => names.add(n));
  if (!names.size) return tools;
  return tools.map((t) => (names.has(t.name) && !t.core ? { ...t, core: true } : t));
}

// ── Per-turn context for card builders ──────────────────────────────────────
export async function toolCtx(userId: string): Promise<ToolCtx> {
  const [u, tz] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { unitPreference: true } }).catch(() => null),
    userTz(userId),
  ]);
  return { userId, unit: u?.unitPreference === 'metric' ? 'metric' : 'imperial', tz, today: todayIn(tz) };
}

// ── One tool call ────────────────────────────────────────────────────────────
export interface ToolCallOutcome {
  /** What goes back to the model as the tool_result. */
  modelResult: unknown;
  /** Raw result (for legacy card + proposal handling). */
  raw: unknown;
  cards: Card[];
  change?: ExecutedChange;
  /** The result carried third-party / external text (untrusted.ts). */
  untrusted?: boolean;
  /** The call was refused by the untrusted-text write downgrade. */
  blocked?: boolean;
}

export async function runToolCall(
  tool: AgentTool,
  input: Record<string, unknown>,
  userId: string,
  ctx: ToolCtx,
  opts: { buildCards: boolean; blockWrites?: boolean },
): Promise<ToolCallOutcome> {
  const kind = tool.kind ?? 'log';
  // Untrusted text was read earlier in this turn and the user didn't ask for a
  // write: immediate writes are refused (proposals / drafts still work).
  if (opts.blockWrites && isImmediateWrite(kind)) {
    console.warn(`[agent] write blocked after untrusted read user=${userId.slice(0, 8)} tool=${tool.name}`);
    return { modelResult: WRITE_BLOCKED_RESULT, raw: null, cards: [], change: undefined, blocked: true };
  }
  const gate = kind === 'read' ? CONSENT_GATED[tool.name] : undefined;
  if (gate && !(await readConsent(userId))[gate]) {
    return { modelResult: consentRefusal(gate), raw: null, cards: [], change: undefined };
  }
  const writes = kind === 'log' || kind === 'set' ? 'allow' : 'deny';
  const raw: any = await withWriteGuard(writes, tool.name, () => tool.execute(input, userId));
  const change: ExecutedChange | undefined = raw && typeof raw === 'object' ? raw._change : undefined;

  const cards: Card[] = [];
  if (opts.buildCards && tool.card) {
    try {
      const built = await tool.card(input, raw, ctx);
      const drafts: CardDraft[] = !built ? [] : Array.isArray(built) ? built : [built];
      // A log that earned a progress moment (PR, protein goal, cut) gets its Moment card under the tool's own.
      const moment = (change?.result as any)?.moment;
      if (moment?.id && drafts.length && !drafts.some((d) => d.moment)) drafts.push((await import('./toolkits/workouts.js')).momentCard(moment));
      for (let i = 0; i < drafts.length; i++) {
        const d = drafts[i];
        if (!d.fn) d.fn = tool.fn ?? tool.name;
        cards.push(await saveCard(userId, d, i === 0 && change ? { change } : {}));
      }
    } catch (err: any) {
      console.error(`[agent] card build failed for ${tool.name}:`, err?.message ?? err);
    }
  }

  // The model sees the result without server internals, plus what changed.
  let modelResult: unknown = raw;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const { _change } = raw as any;
    // Internal fields (prefixed _) and whole-program / whole-week payloads are
    // for the card and the apply op; the model only needs the summary.
    const rest = Object.fromEntries(Object.entries(raw as any).filter(([k]) => !k.startsWith('_') && k !== 'updatedProgram' && k !== 'proposedWeek' && k !== 'program'));
    modelResult = {
      ...rest,
      ...(_change ? { changed: _change.summary, undoable: _change.reversible } : {}),
      // What the log earned, in their numbers: congratulate from this (the card offers the share cards).
      ...(!('moment' in (rest as any)) && _change?.result?.moment?.id ? { moment: { title: _change.result.moment.title, praise: _change.result.moment.praise, why: _change.result.moment.why, shareCardShown: true } } : {}),
      ...(cards.length ? { card_shown: cards.map((c) => c.meta?.label ?? c.pattern).join('; '), awaiting_tap: cards.some((c) => ['proposal', 'draft', 'confirm'].includes(c.pattern)) } : {}),
    };
  }
  const untrusted = isUntrustedTool(tool.name, tool.untrusted);
  if (untrusted) {
    // Third-party text goes back inside an envelope; card meta stays outside it.
    const m: any = modelResult;
    const meta = m && typeof m === 'object' && !Array.isArray(m) && 'card_shown' in m ? { card_shown: m.card_shown, awaiting_tap: m.awaiting_tap } : {};
    const inner = m && typeof m === 'object' && !Array.isArray(m) ? Object.fromEntries(Object.entries(m).filter(([k]) => k !== 'card_shown' && k !== 'awaiting_tap')) : m;
    modelResult = { ...untrustedEnvelope(inner, tool.name), ...meta };
  }
  return { modelResult, raw, cards, change, untrusted };
}

/**
 * At most 3 cards per reply, in execution order (design §2). Beyond that,
 * one summary card lists the rest as collapsed rows.
 */
export async function capCards(userId: string, cards: Card[]): Promise<Card[]> {
  if (cards.length <= 3) return cards;
  // Cards awaiting a tap are never collapsed — a hidden proposal could never
  // be applied. Informational cards collapse first.
  const needsTap = (c: Card) => ['proposal', 'draft', 'confirm', 'ask', 'flow', 'capture'].includes(c.pattern) && (c.state?.status ?? 'live') === 'live';
  const keep = new Set<Card>();
  for (const c of cards) if (needsTap(c) && keep.size < 3) keep.add(c);
  for (const c of cards) if (keep.size < 2 && !keep.has(c)) keep.add(c);
  const rest = cards.filter((c) => !keep.has(c));
  if (!rest.length) return cards.filter((c) => keep.has(c));
  const summary = await saveCard(userId, {
    fn: 'SUMMARY',
    pattern: 'glance',
    rule: 'show',
    meta: { label: `${rest.length} more ${rest.length === 1 ? 'change' : 'changes'}` },
    rows: rest.map((c) => ({ key: c.meta?.label ?? c.fn, value: c.change ? `${c.change.from} → ${c.change.to}` : c.state?.line ?? '' })),
  });
  return [...cards.filter((c) => keep.has(c)), summary];
}
