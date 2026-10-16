// Replaying client-supplied chat history safely (/coach/chat/stream).

/**
 * Client-supplied history, made safe to replay (audit MEDIUM-2): only the
 * user's own turns survive — assistant turns are dropped, because the client
 * could write anything into them ("sure, here's a 700 kcal cut") — and the
 * kept turns are the most recent that fit in HISTORY_MAX_CHARS.
 */
export const HISTORY_MAX_CHARS = 12_000;
export function sanitizeClientHistory(history: Array<{ role: string; content: string }> | undefined): Array<{ role: 'user'; content: string }> {
  const out: Array<{ role: 'user'; content: string }> = [];
  let total = 0;
  for (const h of [...(history ?? [])].reverse()) {
    if (h?.role !== 'user' || typeof h.content !== 'string' || !h.content.trim()) continue;
    if (out.length >= 12 || total + h.content.length > HISTORY_MAX_CHARS) break;
    total += h.content.length;
    out.unshift({ role: 'user', content: h.content });
  }
  return out;
}
