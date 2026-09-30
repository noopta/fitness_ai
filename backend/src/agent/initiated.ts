// Turns Anakin starts (design §9): a form check is ready, a PR, a new
// progression suggestion, the weekly review, a program is ready, a partner
// invite, a friend request, a message. Stored in the conversation with their
// cards so the app shows them ("While you were away · 3") when it opens.
// Only for users on the agent-first app — the classic chat can't show cards.

import { PrismaClient } from '@prisma/client';
import { saveCard } from './cards/store.js';
import { appendInitiated } from './conversation.js';
import { uiV2AvailableFor } from '../services/featureFlags.js';
import type { CardDraft } from './cards/types.js';

const prisma = new PrismaClient();

export async function postInitiatedTurn(userId: string, turn: { text: string; cards?: CardDraft[] }): Promise<boolean> {
  try {
    if (process.env.AGENT_ENABLED !== 'true') return false;
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!u || !uiV2AvailableFor(userId, u.email)) return false;
    const saved = [];
    for (const d of (turn.cards ?? []).slice(0, 3)) saved.push(await saveCard(userId, d));
    const notes = saved.map((c) => `[card ${c.fn} ${c.pattern} id=${c.id}: ${c.meta?.label ?? c.fn}]`);
    await appendInitiated(userId, [turn.text, ...notes].join('\n'));
    return true;
  } catch (err: any) {
    console.error('[initiated] failed:', err?.message ?? err);
    return false;
  }
}

/** Fire-and-forget wrapper for hooks in request paths. */
export function postInitiatedLater(userId: string, build: () => Promise<{ text: string; cards?: CardDraft[] } | null>): void {
  void (async () => {
    try { const t = await build(); if (t) await postInitiatedTurn(userId, t); } catch (err: any) { console.error('[initiated] build failed:', err?.message ?? err); }
  })();
}
