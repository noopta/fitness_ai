// Receipts and turns — the chat thread's state.
//
// A turn is one user message and one agent reply. The agent reply arrives as
// a stream: receipts first (each keyed by id, possibly refined once), then
// text deltas, then an optional card, then done. This reducer folds those
// events into a thread; the RN thread renders it, and the same reducer runs
// under the home brief's "Checked N things" line.

import type { Card } from './cards';

export type ReceiptVerb =
  | 'Read' | 'Pulled' | 'Searched' | 'Computed' | 'Checked' | 'Heard' | 'Delegated'
  | 'Logged' | 'Adjusted' | 'Proposed' | 'Noted' | 'Saved' | 'Drafted' | 'Sent' | 'Posted'
  | 'Deleted' | 'Corrected' | 'Started' | 'Opened' | 'Forgot' | 'Removed';

// Muted = reads; crimson = writes (spec §2). Mirrors backend receipts.ts.
export const WRITE_VERBS: ReadonlySet<ReceiptVerb> = new Set(['Logged', 'Adjusted', 'Proposed', 'Noted', 'Saved', 'Drafted', 'Sent', 'Posted', 'Deleted', 'Corrected', 'Started', 'Opened', 'Forgot', 'Removed']);
export const isWriteVerb = (v: ReceiptVerb) => WRITE_VERBS.has(v);

export interface Receipt {
  id: string;
  verb: ReceiptVerb;
  text: string;
  indent?: boolean;
}

export interface AgentCard {
  type: 'week' | 'bench' | 'food' | 'proposal';
  data: any;
}

export interface Proposal {
  kind: string;
  summary: string;
  [k: string]: any;
}

export interface Turn {
  id: string;
  kind: 'user' | 'agent';
  text: string;
  receipts: Receipt[];
  /** false while the agent is still streaming. */
  done: boolean;
  card?: AgentCard | null;
  proposal?: Proposal | null;
  /** Set once the user resolved a proposal: the receipt line to show. */
  resolution?: string | null;
  /** Client-side card state (week swap status, food step, …). */
  cardState?: Record<string, any>;
  /** The receipts list is collapsed to a summary line unless open. */
  open?: boolean;
  /** Marks an unprompted (proactive) agent turn. */
  unprompted?: boolean;
  /** An inline Ask Anakin raises in the thread (question · reason · ≤4 rows). */
  ask?: { key: string; question: string; reason: string; options: string[] } | null;
  at?: number;
  /** Contract-2 cards under the reply, in execution order (server ids). */
  cards?: Card[];
  /** Ids from history, before the cards are fetched. */
  cardIds?: string[];
  /** Anakin started this turn (PR, weekly review, invite…), not the user. */
  origin?: 'anakin';
}

export type StreamEvent =
  | { type: 'status'; phase: 'thinking' | 'tool'; tool?: string }
  | { type: 'delta'; text: string }
  | { type: 'receipt'; id: string; verb: ReceiptVerb; text: string; indent?: boolean; final?: boolean }
  | { type: 'card'; card: AgentCard }
  | { type: 'card2'; turnId?: string; card: Card }
  | { type: 'card_update'; cardId: string; patch: Partial<Card> }
  | { type: 'done'; reply: string; toolsUsed: string[]; iterations: number; card?: AgentCard | null; proposal?: Proposal | null }
  | { type: 'error'; error: string };

export interface ThreadState {
  turns: Turn[];
  busy: boolean;
  busySince: number | null;
  error: string | null;
}

export const emptyThread = (): ThreadState => ({ turns: [], busy: false, busySince: null, error: null });

/** Busy lock: a new send is ignored while the agent is replying, with an 8 s safety unlock. */
export const BUSY_UNLOCK_MS = 8000;
export function canSend(s: ThreadState, now = Date.now()): boolean {
  if (!s.busy) return true;
  return s.busySince != null && now - s.busySince > BUSY_UNLOCK_MS;
}

export type ThreadAction =
  | { type: 'send'; id: string; agentId: string; text: string; now?: number }
  | { type: 'event'; agentId: string; event: StreamEvent }
  | { type: 'append_agent'; turn: Turn }
  | { type: 'resolve'; agentId: string; resolution: string }
  | { type: 'card_state'; agentId: string; patch: Record<string, any> }
  | { type: 'toggle'; id: string }
  | { type: 'hydrate'; turns: Turn[] }
  /** A card came back from a tap or a refresh: replace it wherever it is. */
  | { type: 'card_set'; card: Card }
  /** Many cards at once (history hydrate / refresh of live cards). */
  | { type: 'cards_set'; cards: Card[] }
  /** Insert a card after another in the same turn (the next Flow step, a capture result). */
  | { type: 'card_after'; afterId: string; card: Card }
  | { type: 'fail'; agentId: string; error: string };

const patchTurn = (s: ThreadState, id: string, fn: (t: Turn) => Turn): ThreadState => ({
  ...s, turns: s.turns.map((t) => (t.id === id ? fn(t) : t)),
});

export function threadReducer(s: ThreadState, a: ThreadAction): ThreadState {
  switch (a.type) {
    case 'send': {
      const now = a.now ?? Date.now();
      return {
        ...s, busy: true, busySince: now, error: null,
        turns: [
          ...s.turns.map((t) => ({ ...t, open: false })),
          { id: a.id, kind: 'user', text: a.text, receipts: [], done: true, at: now },
          { id: a.agentId, kind: 'agent', text: '', receipts: [], done: false, at: now },
        ],
      };
    }
    case 'append_agent':
      return { ...s, turns: [...s.turns.map((t) => ({ ...t, open: false })), a.turn] };
    case 'event': {
      const e = a.event;
      switch (e.type) {
        case 'receipt':
          return patchTurn(s, a.agentId, (t) => {
            const i = t.receipts.findIndex((r) => r.id === e.id);
            const r: Receipt = { id: e.id, verb: e.verb, text: e.text, indent: !!e.indent };
            const receipts = i >= 0 ? t.receipts.map((x, k) => (k === i ? r : x)) : [...t.receipts, r];
            return { ...t, receipts };
          });
        case 'delta':
          return patchTurn(s, a.agentId, (t) => ({ ...t, text: t.text + e.text }));
        case 'card':
          return patchTurn(s, a.agentId, (t) => ({ ...t, card: e.card, cardState: t.cardState ?? initialCardState(e.card) }));
        case 'done': {
          const next = patchTurn(s, a.agentId, (t) => ({
            ...t,
            // The done reply is authoritative — deltas may have been partial
            // or belonged to an intermediate (pre-tool) thought.
            text: e.reply || t.text,
            done: true,
            card: e.card ?? t.card ?? null,
            cardState: t.cardState ?? (e.card ? initialCardState(e.card) : undefined),
            proposal: e.proposal ?? t.proposal ?? null,
          }));
          return { ...next, busy: false, busySince: null };
        }
        case 'error':
          return { ...patchTurn(s, a.agentId, (t) => ({ ...t, done: true, text: t.text || '' })), busy: false, busySince: null, error: e.error };
        case 'card2':
          return patchTurn(s, a.agentId, (t) => ({ ...t, cards: upsertCard(t.cards, e.card) }));
        case 'card_update':
          return mapCards(s, (c) => (c.id === e.cardId ? { ...c, ...e.patch } : c));
        case 'status':
        default:
          return s;
      }
    }
    case 'card_set':
      return mapCards(s, (c) => (c.id === a.card.id ? a.card : c));
    case 'cards_set': {
      const byId = new Map(a.cards.map((c) => [c.id, c]));
      // Hydrate: turns that only had ids get their cards, in id order.
      const turns = s.turns.map((t) => {
        if (t.cardIds?.length && !t.cards?.length) {
          const cards = t.cardIds.map((id) => byId.get(id)).filter((c): c is Card => !!c);
          return cards.length ? { ...t, cards } : t;
        }
        if (!t.cards?.some((c) => byId.has(c.id))) return t;
        return { ...t, cards: t.cards.map((c) => byId.get(c.id) ?? c) };
      });
      return { ...s, turns };
    }
    case 'card_after':
      return {
        ...s,
        turns: s.turns.map((t) => {
          const i = t.cards?.findIndex((c) => c.id === a.afterId) ?? -1;
          if (i < 0 || t.cards!.some((c) => c.id === a.card.id)) return t;
          const cards = [...t.cards!];
          cards.splice(i + 1, 0, a.card);
          return { ...t, cards };
        }),
      };
    case 'fail':
      return { ...patchTurn(s, a.agentId, (t) => ({ ...t, done: true })), busy: false, busySince: null, error: a.error };
    case 'resolve':
      return patchTurn(s, a.agentId, (t) => ({ ...t, resolution: a.resolution }));
    case 'card_state':
      return patchTurn(s, a.agentId, (t) => ({ ...t, cardState: { ...(t.cardState ?? {}), ...a.patch } }));
    case 'toggle':
      return patchTurn(s, a.id, (t) => ({ ...t, open: !t.open }));
    case 'hydrate':
      return { ...s, turns: a.turns };
    default:
      return s;
  }
}

function upsertCard(cards: Card[] | undefined, card: Card): Card[] {
  const list = cards ?? [];
  const i = list.findIndex((c) => c.id === card.id);
  return i >= 0 ? list.map((c, k) => (k === i ? card : c)) : [...list, card];
}

function mapCards(s: ThreadState, fn: (c: Card) => Card): ThreadState {
  let any = false;
  const turns = s.turns.map((t) => {
    if (!t.cards?.length) return t;
    let changed = false;
    const cards = t.cards.map((c) => { const n = fn(c); if (n !== c) changed = true; return n; });
    if (!changed) return t;
    any = true;
    return { ...t, cards };
  });
  return any ? { ...s, turns } : s;
}

/** Every card in the thread, oldest first. */
export function allCards(s: ThreadState): Card[] {
  return s.turns.flatMap((t) => t.cards ?? []);
}

/** The newest agent turn's cards — what the composer reacts to (spec §7.2). */
export function latestAgentCards(s: ThreadState): Card[] {
  for (let i = s.turns.length - 1; i >= 0; i--) {
    const t = s.turns[i];
    if (t.kind === 'user') return [];
    if (t.kind === 'agent' && t.cards?.length) return t.cards;
  }
  return [];
}

/**
 * Anakin-initiated turns since the user's last message form one collapsed
 * "While you were away · N" row (spec §9). Returns the index range to fold.
 */
export function awayRange(turns: Turn[]): { start: number; count: number } | null {
  let end = turns.length;
  let start = end;
  while (start > 0 && turns[start - 1].origin === 'anakin') start--;
  const count = turns.slice(start, end).reduce((n, t) => n + Math.max(1, t.cards?.length ?? t.cardIds?.length ?? 0), 0);
  return end > start ? { start, count } : null;
}

export function initialCardState(card: AgentCard): Record<string, any> {
  switch (card.type) {
    case 'week': return { status: card.data?.proposal ? 'pending' : 'idle' };
    case 'food': return { step: 'pick' };
    case 'bench': return { drawn: false };
    default: return {};
  }
}

/** "Checked 3 things · read, pulled" — the collapsed summary of a turn's receipts. */
export function receiptSummary(t: Turn): string {
  const recs = t.receipts;
  if (!t.done) {
    if (!recs.length) return 'Thinking';
    const last = recs[recs.length - 1];
    return `${last.verb} — ${last.text}`;
  }
  if (!recs.length) return '';
  const verbs = [...new Set(recs.map((r) => r.verb.toLowerCase()))];
  return `Checked ${recs.length} thing${recs.length === 1 ? '' : 's'} · ${verbs.join(', ')}`;
}

/** Map the legacy (non-stream) turn result into a finished agent turn. */
export function turnFromResult(id: string, r: { reply: string; toolsUsed?: string[]; proposal?: Proposal | null; card?: AgentCard | null }, receiptFor: (tool: string) => { verb: ReceiptVerb; text: string }): Turn {
  const receipts = (r.toolsUsed ?? []).map((tool, i) => ({ id: `${id}-${i}`, ...receiptFor(tool) }));
  return { id, kind: 'agent', text: r.reply, receipts, done: true, card: r.card ?? null, proposal: r.proposal ?? null, cardState: r.card ? initialCardState(r.card) : undefined };
}
