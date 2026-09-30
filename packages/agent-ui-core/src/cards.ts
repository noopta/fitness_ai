// Chat cards (CHAT_CARDS_RN_SPEC §2). Mirrors backend/src/agent/cards/types.ts:
// the server owns ids, state and what a tap does; the client renders the
// payload from primitives and posts taps back by card id + action id.

export type CardPattern = 'glance' | 'logged' | 'setting' | 'proposal' | 'ask' | 'capture' | 'draft' | 'confirm' | 'flow' | 'handoff';
export type CardRule = 'show' | 'log_undo' | 'change_undo' | 'propose' | 'draft_send' | 'confirm_delete' | 'handoff';
export type ClientAction =
  | 'start_session' | 'sign_out' | 'open_os_settings' | 'check_updates' | 'manage_subscription' | 'restore_purchases'
  | 'purchase' | 'new_conversation' | 'open_camera' | 'open_picker' | 'share' | 'play_video' | 'open_url' | 'download'
  | 'send_message' | 'open_page' | 'reset_password';

export interface CardRow {
  key: string;
  value?: string;
  sub?: string;
  mark?: 'add' | 'del' | 'chg' | 'muted' | 'lock';
  editable?: { field: string; kind: 'number' | 'text' | 'weightReps' | 'grams' | 'time' | 'date' };
  toggle?: { field: string; on: boolean };
  was?: string;
  action?: string;
}

export interface CardAction {
  id: string;
  label: string;
  kind: 'primary' | 'secondary' | 'undo' | 'cancel' | 'destructive';
  client?: { action: ClientAction; args?: Record<string, unknown> };
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

export interface CardRoute { page: string; params?: Record<string, string> }

export interface Card {
  id: string;
  fn: string;
  pattern: CardPattern;
  rule: CardRule;
  meta?: { label: string; open?: CardRoute };
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

/** Patterns that wait on the user's tap — never collapsed, and they steer the composer. */
export const AWAITING_PATTERNS: ReadonlySet<CardPattern> = new Set(['proposal', 'draft', 'confirm', 'ask', 'flow']);

export const isLive = (c: Card) => !c.state || c.state.status === 'live';

/** The primary action is the first one unless it's an undo / cancel / keep (spec §4 Actions). */
export function primaryActionIndex(actions: CardAction[] | undefined): number {
  if (!actions?.length) return -1;
  const a = actions[0];
  if (a.kind === 'undo' || a.kind === 'cancel' || /^(keep|pause|undo|cancel)\b/i.test(a.label)) return -1;
  return 0;
}

/** Undo is offered while the window is open (24 h logs/settings, 30 s deletes). */
export function undoOpen(c: Card, now = Date.now()): boolean {
  const s = c.state;
  if (!s?.changeId || !s.undoUntil) return false;
  if (!['applied', 'deleted', 'sent', 'posted', 'live'].includes(s.status)) return false;
  return new Date(s.undoUntil).getTime() > now;
}

export type ComposerMode =
  | { kind: 'ask'; cardId: string; placeholder: string }
  | { kind: 'draft'; cardId: string; placeholder: string; to: string; body: string }
  /** A normal message that refines the card (the server replaces it with a newer one). */
  | { kind: 'tweak'; cardId: string; placeholder: string }
  | { kind: 'default'; placeholder: string };

/**
 * What the composer does while the latest card waits (spec §7.2): answers an
 * Ask/Flow, rewrites a Draft, or tweaks a Proposal. Only the newest agent
 * turn's cards count — an old unanswered card doesn't hijack the composer.
 */
export function composerMode(cards: Card[] | undefined, editingDraft?: string | null): ComposerMode {
  const live = (cards ?? []).filter(isLive);
  const last = live[live.length - 1];
  if (editingDraft) {
    const d = live.find((c) => c.id === editingDraft && c.pattern === 'draft');
    if (d) return { kind: 'draft', cardId: d.id, placeholder: 'Edit message', to: d.draft?.to ?? '', body: d.draft?.body ?? '' };
  }
  if (!last) return { kind: 'default', placeholder: 'Ask Anakin' };
  if (last.pattern === 'ask' || last.pattern === 'flow') return { kind: 'ask', cardId: last.id, placeholder: 'Or type your answer' };
  if (last.pattern === 'draft') return { kind: 'tweak', cardId: last.id, placeholder: 'Change the message…' };
  if (last.pattern === 'proposal') return { kind: 'tweak', cardId: last.id, placeholder: 'Or tell me what to change' };
  return { kind: 'default', placeholder: 'Ask Anakin' };
}

/** "Applied 2:14 pm" — local clock time for a StateLine. */
export function clockTime(iso: string | undefined, locale?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return d.toLocaleTimeString(locale ?? 'en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s?([AP])M$/i, (_m, p) => ` ${p.toLowerCase()}m`);
  } catch {
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
}
