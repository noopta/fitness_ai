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
  /** After Undo on a card that supports it: Redo stays offered until then. */
  redoUntil?: string;
}

/**
 * A batch of past sessions to log (WRK-13, "Past workouts" spec 7 Oct 2026).
 * `list`: up to 12 sessions, each tickable and expandable. `weeks`: a count
 * hero, sessions-per-week bars, then one row per week that opens to its days.
 * Ticks and dates for undated sessions are local until the tap; they travel
 * with the apply action as `selection`.
 */
export interface BatchSession {
  /** Index into the card's pending inputs; what `selection` refers to. */
  i: number;
  /** YYYY-MM-DD, or null for a session the parse couldn't date. */
  date: string | null;
  /** "Wed 15 Jul", or null when undated. */
  day: string | null;
  title: string | null;
  /** First lift names, e.g. "Bench press, Incline dumbbell press, …". */
  names: string;
  /** "4 lifts". */
  count: string;
  /** One line per exercise: name and "3 × 5 · 225 lb" / "3 sets · 12, 10, 8". */
  detail: { name: string; value: string }[];
}
export interface BatchBlock {
  kind: 'list' | 'weeks';
  sessions: BatchSession[];
  /** weeks mode: rows in date order; `ids` are session indices. */
  weeks?: { label: string; sub: string; count: string; ids: number[] }[];
  /** weeks mode: "41" · "workouts" · "11 weeks · 163 exercises · 492 sets". */
  hero?: { value: string; unit: string; sub: string };
  /** weeks mode: sessions per week, with the first and last day under the bars. */
  bars?: { v: number[]; from: string; to: string };
  /** Footer: "Left out: 1 already logged (Wed 15 Jul · Push) · 2 lines that weren't training." */
  leftOut?: string;
  /** Per-session ticks (list mode). Big batches log whole, or by asking Anakin to skip a week. */
  selectable: boolean;
  /** After logging: "2 were bests at the time — squat 230 × 5, deadlift 320 × 4." */
  bests?: string;
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
  batch?: BatchBlock;
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
  /** Apply takes a `selection` (ticks, dates for undated rows) over this action's `inputs` arg. */
  batch?: { action: string };
  /** What Apply ran, so Redo can run it again after an Undo. */
  applied?: { op: string; args: Record<string, unknown>; status?: CardStatus; line?: string };
}
