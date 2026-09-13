import { coachApi } from './api';

// Reply recovery for lost agent turns.
//
// Agent turns hold one HTTP request open for 20–30s while the tool loop runs,
// and mobile reality (radio handoffs, app lifecycle, OS socket policy) kills
// ~10% of those before the response arrives — nginx shows a 499, the app
// shows "couldn't reach Anakin". But the SERVER almost always finishes the
// turn after the client is gone and appendTurn persists both the user
// message and the reply. So a "network error" here very often means "the
// answer exists, you just never received it".
//
// appendTurn writes the user message and reply together, atomically, AFTER
// the turn completes — which makes detection clean: the sent text appearing
// in history at all means the turn landed, and the entry after it is the
// reply. While the turn is still running the sent text is absent entirely.

const POLL_INTERVAL_MS = 4_000;
const MAX_ATTEMPTS = 12; // ~48s — covers the slow tail of tool-loop turns

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Poll the agent's server-side transcript for the reply to `sentText`.
 * Resolves the reply text, or null if the turn genuinely never landed.
 * A 404 from the history route means this user isn't on the agent at all —
 * bail immediately rather than burning 48s of polling on the classic coach.
 */
export async function recoverAgentReply(sentText: string): Promise<string | null> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    await delay(POLL_INTERVAL_MS);
    try {
      const history = await coachApi.agentHistory();
      const msgs = history?.messages;
      if (!Array.isArray(msgs)) continue;
      // LAST matching user entry — the same text may have been sent before.
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role !== 'user' || msgs[i].content !== sentText) continue;
        const next = msgs[i + 1];
        if (next?.role === 'assistant' && next.content) return next.content;
        break; // present but no reply yet (shouldn't happen) — keep polling
      }
    } catch (err: any) {
      if (err?.status === 404) return null;
      // transient — the network that killed the turn may still be flaky
    }
  }
  return null;
}
