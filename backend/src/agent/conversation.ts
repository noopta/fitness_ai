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

// Keep the last N turns (a turn = one user + one assistant message). 12
// turns ≈ a long single session; older context is dropped FIFO. The
// UserContext carries the durable facts, so trimming dialogue is low-risk.
const MAX_MESSAGES = 24; // 12 user + 12 assistant

interface StoredMessage {
  role: 'user' | 'assistant';
  text: string;
  /** 'anakin' = a turn Anakin started (form check ready, a PR…), not a reply. */
  origin?: 'anakin';
  at?: string;
  /** Cards shown under this reply. Kept out of `text` — see cardNotes.ts. */
  cards?: CardRef[];
}

/** Stored messages as-is (for the history endpoint). */
export async function loadStoredMessages(userId: string): Promise<StoredMessage[]> {
  const row = await prisma.agentConversation.findUnique({ where: { userId } });
  if (!row) return [];
  try { const parsed = JSON.parse(row.messagesJson); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

/** Append a turn Anakin started. It has no user message before it. */
export async function appendInitiated(userId: string, text: string, cards: CardRef[] = []): Promise<void> {
  const history = await loadStoredMessages(userId);
  history.push({ role: 'assistant', text, origin: 'anakin', at: new Date().toISOString(), ...(cards.length ? { cards } : {}) });
  const trimmed = history.slice(-MAX_MESSAGES);
  await prisma.agentConversation.upsert({ where: { userId }, create: { userId, messagesJson: JSON.stringify(trimmed) }, update: { messagesJson: JSON.stringify(trimmed) } });
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
      msgs.push({ role: 'user', content: note ? `${note}\n\n${m.text}` : m.text });
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
  return modelHistory(await loadStoredMessages(userId)).history;
}

/**
 * History plus the message to send for this turn: the user's text, led by the
 * note about the cards under the last reply. Store the user's own text, not this.
 */
export async function loadTurn(userId: string, userText: string): Promise<{ history: Anthropic.MessageParam[]; message: string }> {
  const { history, pending } = modelHistory(await loadStoredMessages(userId));
  return { history, message: pending ? `${pending}\n\n${userText}` : userText };
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
  const trimmed = history.slice(-MAX_MESSAGES);
  await prisma.agentConversation.upsert({
    where: { userId },
    create: { userId, messagesJson: JSON.stringify(trimmed) },
    update: { messagesJson: JSON.stringify(trimmed) },
  });
}

export async function clearConversation(userId: string): Promise<void> {
  await prisma.agentConversation.upsert({
    where: { userId },
    create: { userId, messagesJson: '[]' },
    update: { messagesJson: '[]' },
  });
}
