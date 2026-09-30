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
}

/** Stored messages as-is (for the history endpoint). */
export async function loadStoredMessages(userId: string): Promise<StoredMessage[]> {
  const row = await prisma.agentConversation.findUnique({ where: { userId } });
  if (!row) return [];
  try { const parsed = JSON.parse(row.messagesJson); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

/** Append a turn Anakin started. It has no user message before it. */
export async function appendInitiated(userId: string, text: string): Promise<void> {
  const history = await loadStoredMessages(userId);
  history.push({ role: 'assistant', text, origin: 'anakin', at: new Date().toISOString() });
  const trimmed = history.slice(-MAX_MESSAGES);
  await prisma.agentConversation.upsert({ where: { userId }, create: { userId, messagesJson: JSON.stringify(trimmed) }, update: { messagesJson: JSON.stringify(trimmed) } });
}

export async function loadConversation(userId: string): Promise<Anthropic.MessageParam[]> {
  const row = await prisma.agentConversation.findUnique({ where: { userId } });
  if (!row) return [];
  try {
    const parsed = JSON.parse(row.messagesJson) as StoredMessage[];
    if (!Array.isArray(parsed)) return [];
    const msgs = parsed
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
      .map((m) => ({ role: m.role, content: m.origin === 'anakin' ? `(You started this, unprompted:) ${m.text}` : m.text }));
    // The API needs the first message to be the user's; a thread that opens
    // with Anakin-initiated turns drops them from the model's history.
    while (msgs.length && msgs[0].role !== 'user') msgs.shift();
    return msgs;
  } catch {
    return [];
  }
}

export async function appendTurn(
  userId: string,
  userText: string,
  assistantText: string,
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
  history.push({ role: 'assistant', text: assistantText, at });
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
