// Receipts and turns — the chat thread's state.
//
// A turn is one user message and one agent reply. The agent reply arrives as
// a stream: receipts first (each keyed by id, possibly refined once), then
// text deltas, then an optional card, then done. This reducer folds those
// events into a thread; the RN thread renders it, and the same reducer runs
// under the home brief's "Checked N things" line.

export type ReceiptVerb =
  | 'Read' | 'Pulled' | 'Searched' | 'Checked'
  | 'Logged' | 'Adjusted' | 'Noted' | 'Proposed' | 'Delegated';

export const WRITE_VERBS: ReadonlySet<ReceiptVerb> = new Set(['Logged', 'Adjusted', 'Proposed']);
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
  at?: number;
}

export type StreamEvent =
  | { type: 'status'; phase: 'thinking' | 'tool'; tool?: string }
  | { type: 'delta'; text: string }
  | { type: 'receipt'; id: string; verb: ReceiptVerb; text: string; indent?: boolean; final?: boolean }
  | { type: 'card'; card: AgentCard }
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
        case 'status':
        default:
          return s;
      }
    }
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
