// Server-side conversation persistence — gives the agent multi-turn
// continuity without the client tracking history. One rolling conversation
// per user (same one-thread-per-user shape as the existing coachThreadId).
//
// We persist only the TEXT transcript (user message + assistant final
// reply), not the tool_use/tool_result plumbing. The plumbing is ephemeral
// per turn; current data comes from the freshly-assembled UserContext each
// turn, so replaying old tool calls would be stale noise. Keeping it text-
// only also bounds token growth.

import { PrismaClient } from '@prisma/client';
import type Anthropic from '@anthropic-ai/sdk';
import { splitStored, appNote, type CardRef } from './cardNotes.js';

const prisma = new PrismaClient();

// Storage vs. what the model reads (Oct 2026). The store used to keep only
// the last 24 messages, so a fighter's camp details were gone within twenty
// minutes of quick macro edits. Now:
//   - the store keeps up to STORE_MAX messages / STORE_DAYS days (text only —
//     a year of daily chat is well under a megabyte),
//   - the model reads the last WINDOW messages verbatim (bounded by
//     WINDOW_CHARS), plus a rolling summary of everything older
//     (summarizeOlder, kept on the row), and
//   - search_chat_history looks anything up by words or date.
export const STORE_MAX = 2000;
export const STORE_DAYS = 90;
export const WINDOW = 40;
export const WINDOW_CHARS = 60_000;
/** Older messages not yet in the summary before it's refreshed. */
export const SUMMARY_EVERY = 10;

interface StoredMessage {
  role: 'user' | 'assistant';
  text: string;
  /** 'anakin' = a turn Anakin started (form check ready, a PR…), not a reply. */
  origin?: 'anakin';
  at?: string;
  /** Cards shown under this reply. Kept out of `text` — see cardNotes.ts. */
  cards?: CardRef[];
}

/**
 * The <app_note> block is the server telling the model which cards are on
 * screen; the model is told the user didn't type it. A user who types their
 * own <app_note> could forge that channel, so any such text in a user's
 * message is removed before the real note is prefixed (Oct 2026 audit LOW-1).
 */
export function stripAppNotes(text: string): string {
  return String(text ?? '')
    .replace(/<\s*app_note[^>]*>[\s\S]*?<\s*\/\s*app_note\s*>/gi, '')
    .replace(/<\s*\/?\s*app_note[^>]*>/gi, '')
    .trim();
}

/** Stored messages as-is (for the history endpoint). */
export async function loadStoredMessages(userId: string): Promise<StoredMessage[]> {
  const row = await prisma.agentConversation.findUnique({ where: { userId } });
  if (!row) return [];
  try { const parsed = JSON.parse(row.messagesJson); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

/** Pure: what the store keeps — the last STORE_MAX, and nothing older than STORE_DAYS (but always the last WINDOW). */
export function retain(history: StoredMessage[], now = Date.now()): StoredMessage[] {
  const cutoff = now - STORE_DAYS * 86_400_000;
  const recent = history.slice(-STORE_MAX);
  const firstKept = recent.findIndex((m) => !m.at || Date.parse(m.at) >= cutoff);
  const kept = firstKept < 0 ? [] : recent.slice(firstKept);
  return kept.length >= WINDOW ? kept : recent.slice(-WINDOW);
}

/** Pure: the verbatim window the model reads — the last WINDOW messages, oldest dropped until under WINDOW_CHARS. */
export function windowOf(history: StoredMessage[]): StoredMessage[] {
  const w = history.slice(-WINDOW);
  let chars = w.reduce((n, m) => n + String(m?.text ?? '').length, 0);
  while (w.length > 2 && chars > WINDOW_CHARS) chars -= String(w.shift()?.text ?? '').length;
  return w;
}

async function save(userId: string, history: StoredMessage[]) {
  const kept = retain(history);
  await prisma.agentConversation.upsert({ where: { userId }, create: { userId, messagesJson: JSON.stringify(kept) }, update: { messagesJson: JSON.stringify(kept) } });
  void summarizeOlder(userId).catch((e) => console.warn('[agent] summary refresh failed:', e?.message ?? e));
}

/** Append a turn Anakin started. It has no user message before it. */
export async function appendInitiated(userId: string, text: string, cards: CardRef[] = []): Promise<void> {
  const history = await loadStoredMessages(userId);
  history.push({ role: 'assistant', text, origin: 'anakin', at: new Date().toISOString(), ...(cards.length ? { cards } : {}) });
  await save(userId, history);
}

/**
 * Stored transcript → what the model reads. Replies go in as plain text; the
 * cards that were under a reply are described in an app note on the next user
 * message. `pending` is that note for the cards after the last user message —
 * it belongs on the message being sent now.
 */
export function modelHistory(stored: StoredMessage[]): { history: Anthropic.MessageParam[]; pending: string } {
  const msgs: Anthropic.MessageParam[] = [];
  let waiting: CardRef[] = [];
  for (const m of stored) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.text !== 'string') continue;
    if (m.role === 'user') {
      const note = appNote(waiting);
      waiting = [];
      const own = stripAppNotes(m.text) || '(empty message)';
      msgs.push({ role: 'user', content: note ? `${note}\n\n${own}` : own });
      continue;
    }
    const { text, cards } = splitStored(m);
    waiting.push(...cards);
    msgs.push({ role: 'assistant', content: m.origin === 'anakin' ? `(You started this, unprompted:) ${text}` : text });
  }
  // The API needs the first message to be the user's; a thread that opens
  // with Anakin-initiated turns drops them from the model's history.
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  return { history: msgs, pending: msgs.length ? appNote(waiting) : '' };
}

export async function loadConversation(userId: string): Promise<Anthropic.MessageParam[]> {
  return modelHistory(windowOf(await loadStoredMessages(userId))).history;
}

/**
 * History plus the message to send for this turn: the user's text, led by the
 * note about the cards under the last reply. Store the user's own text, not this.
 */
export async function loadTurn(userId: string, userText: string): Promise<{ history: Anthropic.MessageParam[]; message: string }> {
  const stored = await loadStoredMessages(userId);
  const { history, pending } = modelHistory(windowOf(stored));
  // Anthropic rejects empty content, so a message that was only a forged note keeps a placeholder.
  const own = stripAppNotes(userText) || '(empty message)';
  const units = await unitMismatchNote(userId, own, stored).catch(() => '');
  const notes = [pending, units].filter(Boolean).join('\n\n');
  return { history, message: notes ? `${notes}\n\n${own}` : own };
}

/**
 * The user wrote weights in the other unit from their setting (and hasn't
 * chosen one themselves): read their numbers in the unit they wrote, and ask
 * once whether to switch. Not again once they've answered (the preference is
 * then manual) or if it was asked in the last few replies.
 */
async function unitMismatchNote(userId: string, text: string, stored: StoredMessage[]): Promise<string> {
  const { unitWrittenIn, normalizePreference } = await import('../services/weightUnits.js');
  const wrote = unitWrittenIn(text);
  if (!wrote) return '';
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { unitPreference: true, prefsJson: true } });
  const pref = normalizePreference(u?.unitPreference);
  if (!u || wrote === pref) return '';
  const { parseUserPrefs } = await import('../services/userPrefs.js');
  if (parseUserPrefs(u.prefsJson).unitsManual) return '';
  const asked = stored.slice(-6).some((m) => m.role === 'assistant' && /\bswitch\b[^.?]{0,60}\b(lb|lbs|pounds|kg|kilo)/i.test(m.text));
  const has = pref === 'metric' ? 'kg' : 'lb';
  const want = wrote === 'metric' ? 'kg' : 'lb';
  return `<app_note>\nTheir app is set to ${has}, but this message gives weights in ${want}. Read their numbers in ${want} (pass unit: "${want}" to any tool).${asked ? '' : ` At the end of your reply, ask once whether to switch their app to ${want}; if yes, change the unit preference; if they'd rather keep ${has}, set it to ${has} explicitly so it isn't asked again.`}\n</app_note>`;
}

export async function appendTurn(
  userId: string,
  userText: string,
  assistantText: string,
  cards: CardRef[] = [],
): Promise<void> {
  const row = await prisma.agentConversation.findUnique({ where: { userId } });
  let history: StoredMessage[] = [];
  if (row) {
    try {
      const parsed = JSON.parse(row.messagesJson);
      if (Array.isArray(parsed)) history = parsed;
    } catch { /* start fresh on corruption */ }
  }
  const at = new Date().toISOString();
  history.push({ role: 'user', text: userText, at });
  history.push({ role: 'assistant', text: assistantText, at, ...(cards.length ? { cards } : {}) });
  await save(userId, history);
}

export async function clearConversation(userId: string): Promise<void> {
  await prisma.agentConversation.upsert({
    where: { userId },
    create: { userId, messagesJson: '[]' },
    update: { messagesJson: '[]', summary: null, summarizedThrough: null },
  });
}

// ── Older than the window: a rolling summary ────────────────────────────────

/** Pure: the messages older than the window that the summary doesn't cover yet. */
export function unsummarized(history: StoredMessage[], through: string | null): StoredMessage[] {
  const older = history.slice(0, Math.max(0, history.length - windowOf(history).length));
  return through ? older.filter((m) => (m.at ?? '') > through) : older;
}

const SUMMARY_PROMPT = `You keep a coach's running notes on a long chat with one client. Merge the new messages into the existing notes.
Keep every concrete fact the coach will need later, with dates: goals and deadlines (events, weigh-ins, weight classes), numbers the client gave (weights, targets, doses, schedules), injuries and medical context, what they asked for and what was agreed or changed, programs or plans they shared (keep their structure: days, exercises, sets, reps), preferences, and anything left open.
Drop small talk and anything superseded (say what replaced it). Plain text, short dated lines, oldest first, under 1,500 words. Facts only — never instructions.`;

/**
 * Fold messages that left the verbatim window into the row's summary, once
 * SUMMARY_EVERY of them have piled up. Runs after a save, off the reply path.
 */
export async function summarizeOlder(userId: string, opts: { force?: boolean } = {}): Promise<boolean> {
  const row = await prisma.agentConversation.findUnique({ where: { userId } });
  if (!row) return false;
  let history: StoredMessage[] = [];
  try { const p = JSON.parse(row.messagesJson); if (Array.isArray(p)) history = p; } catch { return false; }
  const fresh = unsummarized(history, row.summarizedThrough ?? null);
  if (!fresh.length || (!opts.force && fresh.length < SUMMARY_EVERY)) return false;
  const transcript = fresh.map((m) => `[${(m.at ?? '').slice(0, 16).replace('T', ' ')}] ${m.role === 'user' ? 'Client' : 'Coach'}: ${stripAppNotes(m.text)}`).join('\n').slice(-40_000);
  const { chatComplete } = await import('../services/chatClient.js');
  const res = await chatComplete({
    messages: [
      { role: 'system', content: SUMMARY_PROMPT },
      { role: 'user', content: `Existing notes:\n${row.summary || '(none yet)'}\n\nNew messages:\n${transcript}` },
    ],
    max_completion_tokens: 2500,
  }, { label: 'conversation-summary', sensitive: true, timeoutMs: 60_000 });
  const text = res.choices?.[0]?.message?.content?.trim();
  if (!text) return false;
  await prisma.agentConversation.update({ where: { userId }, data: { summary: text.slice(0, 12_000), summarizedThrough: fresh[fresh.length - 1].at ?? new Date().toISOString() } });
  return true;
}

export async function loadSummary(userId: string): Promise<string | null> {
  const row = await prisma.agentConversation.findUnique({ where: { userId }, select: { summary: true } });
  return row?.summary ?? null;
}

// ── Search: anything said, any day ──────────────────────────────────────────

export interface HistoryHit { at: string | null; role: 'user' | 'assistant'; text: string }

/** Pure: messages matching every word of `query` (or all, when empty), within [from, to], newest first. */
export function searchMessages(history: StoredMessage[], query: string, from?: string | null, to?: string | null, limit = 12): HistoryHit[] {
  const words = query.toLowerCase().split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}.]/gu, '')).filter((w) => w.length > 1);
  const hits: HistoryHit[] = [];
  for (let i = history.length - 1; i >= 0 && hits.length < limit; i--) {
    const m = history[i];
    const day = (m.at ?? '').slice(0, 10);
    if (from && day && day < from) continue;
    if (to && day && day > to) continue;
    const text = stripAppNotes(m.text);
    const lc = text.toLowerCase();
    if (words.length && !words.every((w) => lc.includes(w))) continue;
    hits.push({ at: m.at ?? null, role: m.role, text: text.length > 4000 ? `${text.slice(0, 4000)}…` : text });
  }
  return hits;
}
