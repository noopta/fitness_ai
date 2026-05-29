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
}

export async function loadConversation(userId: string): Promise<Anthropic.MessageParam[]> {
  const row = await prisma.agentConversation.findUnique({ where: { userId } });
  if (!row) return [];
  try {
    const parsed = JSON.parse(row.messagesJson) as StoredMessage[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
      .map((m) => ({ role: m.role, content: m.text }));
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
  history.push({ role: 'user', text: userText });
  history.push({ role: 'assistant', text: assistantText });
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
