// Chat card contract (design: CHAT_CARDS_RN_SPEC.md §2). A card is data; the
// client renders it from ~20 primitives. The server owns ids, state and the
// operation a tap runs — the client never sends an operation of its own.

export type CardPattern = 'glance' | 'logged' | 'setting' | 'proposal' | 'ask' | 'capture' | 'draft' | 'confirm' | 'flow' | 'handoff';
export type CardRule = 'show' | 'log_undo' | 'change_undo' | 'propose' | 'draft_send' | 'confirm_delete' | 'handoff';
export type ClientAction =
  | 'start_session' | 'sign_out' | 'open_os_settings' | 'check_updates' | 'manage_subscription' | 'restore_purchases'
  | 'purchase' | 'new_conversation' | 'open_camera' | 'open_picker' | 'share' | 'play_video' | 'open_url' | 'download'
  // Sends the args.text as the user's next message (follow-ups like "Rebuild my program").
  | 'send_message' | 'open_page' | 'reset_password';

export interface CardRow {
  key: string;
  value?: string;
  sub?: string;
  mark?: 'add' | 'del' | 'chg' | 'muted' | 'lock';
  editable?: { field: string; kind: 'number' | 'text' | 'weightReps' | 'grams' | 'time' | 'date' };
  toggle?: { field: string; on: boolean };
  was?: string;
  /** Tapping the row runs this card action (e.g. "Forget" on a memory note). */
  action?: string;
}

export interface CardAction {
  id: string;
  label: string;
  kind: 'primary' | 'secondary' | 'undo' | 'cancel' | 'destructive';
  /** Client-side action instead of a server call (hand-off, share…). */
  client?: { action: ClientAction; args?: Record<string, unknown> };
  /** Disabled until the typed-confirm text matches (ACC-09). */
  requiresTyped?: string;
}

export type CardStatus = 'live' | 'applied' | 'kept' | 'undone' | 'replaced' | 'changed' | 'sent' | 'posted' | 'deleted' | 'cancelled' | 'expired' | 'answered';

export interface CardState {
  status: CardStatus;
  line?: string;
  at?: string;
  undoUntil?: string;
  changeId?: string;
}

export interface Route { page: string; params?: Record<string, string> }

export interface Card {
  id: string;
  fn: string;
  pattern: CardPattern;
  rule: CardRule;
  meta?: { label: string; open?: Route };
  private?: boolean;
  pro?: boolean;
  step?: { i: number; n: number; done: [string, string][] };
  hero?: { value: string; unit?: string; delta?: string };
  line?: number[];
  bars?: { v: number[]; labels?: string[]; hi?: number; dim?: number };
  tiles?: { d: string; n?: string; s: 'done' | 'today' | 'planned' | 'rest' | 'moved'; date?: string }[];
  media?: { kind: 'photo' | 'video' | 'avatar'; uri?: string; caption?: string };
  change?: { key: string; from: string; to: string; note?: string };
  diff?: { key: string; from?: string; to: string; removed?: boolean }[];
  rows?: CardRow[];
  ask?: { q: string; options: string[]; typeInstead?: boolean };
  options?: string[];
  choice?: { options: string[]; value: number; field: string };
  draft?: { to: string; audience: string; body?: string; attachment?: { title: string; sub?: string } };
  lose?: { items: string[]; keep?: string; typed?: string };
  why?: string;
  note?: string;
  empty?: string;
  skeleton?: number;
  handoff?: { label: string; action: ClientAction; args?: Record<string, unknown> };
  actions?: CardAction[];
  state?: CardState;
}

/** What a tool's card builder returns: a card without its server id. */
export type CardDraft = Omit<Card, 'id'> & {
  pending?: PendingActions;
  /** A newer card for the same entity marks older live ones "Replaced". */
  entity?: string;
  /** StateLine after Undo, e.g. "Undone — back to lb". */
  undoLine?: string;
};

/** Server-side meaning of each action id on a card. Never sent to the client. */
export interface PendingOp { op: string; args: Record<string, unknown>; status?: CardStatus; line?: string }
export interface PendingActions {
  actions?: Record<string, PendingOp | { kind: 'keep' | 'cancel' | 'dismiss'; line?: string }>;
  /** Inline edits: field → op run with { ...args, [valueKey]: value }. */
  edits?: Record<string, { op: string; args: Record<string, unknown>; valueKey: string; parse?: 'number' | 'text' | 'weightReps' | 'date' | 'time' }
    // Staged edit: changes the pending action's args (a proposal's numbers)
    // without running anything — the change happens only on Apply.
    | { stage: { action: string; key: string; unit?: 'metric' | 'imperial' }; parse?: 'number'; display?: 'weight' }>;
  /** Toggles: field → op run with { ...args, [valueKey]: boolean }. */
  toggles?: Record<string, { op: string; args: Record<string, unknown>; valueKey: string }>;
  /** Segmented choice: field → arg name the chosen index/option is written to on apply. */
  choice?: { field: string; argKey: string; values: unknown[] };
  /** Ask / Flow answers: either run an op, or post the answer back into the conversation. */
  answer?: { op?: string; args?: Record<string, unknown>; valueKey?: string; asMessage?: string };
  /** The change this card already made (Logged / Setting cards). */
  changeId?: string;
}
