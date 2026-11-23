// Which pending suggestions chat raises (pure; adaptationSurface.ts does the I/O).

// Repeats (Oct 29 2026): in a week Tarek got 33 suggestion cards (11 distinct)
// and Rashad 30 (11 distinct) — the same suggestion re-filed by the detectors
// under new ids, and anything unanswered re-raised every 48 h with no limit.
// Nov 2026: Tarek still got 32 cards in three weeks ("Looks like you're
// cutting" five times) — two showings per 14 days kept coming round, and
// nothing noticed he never tapped any. Now two showings per 60 days, and after
// four suggestion cards in a row with no answer, a week's pause.
export const SHOWN_WINDOW_MS = 60 * 86_400_000;
const MAX_SHOWINGS = 2;
const DAILY_GAP_MS = 20 * 3600_000;
const IGNORED_RUN = 4;
const IGNORED_PAUSE_MS = 7 * 86_400_000;

/** status: the card's state — 'replaced' or 'live' means nobody acted on it. */
export interface ShownCard { proposalId: string | null; title: string; at: number; status?: string }
const unanswered = (s: ShownCard) => !s.status || s.status === 'live' || s.status === 'replaced' || s.status === 'expired';
/** "Proposed · Your Lateral Raise is ahead of plan" and the proposal's title compare equal. */
export const suggestionSig = (title: string) => String(title ?? '').replace(/^proposed\s*·\s*/i, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Pure: which pending suggestions to raise now. One per title (the detectors
 * re-file the same one), none shown twice already in 14 days (it stays on
 * Training), and at most one suggestion message a day. `force` (right after a
 * notice) skips the daily gap only.
 */
export function pickToSurface<P extends { id: string; title: string }>(pending: P[], shown: ShownCard[], now: number, opts: { force?: boolean } = {}): P[] {
  const recent = shown.filter((s) => now - s.at <= SHOWN_WINDOW_MS);
  if (!opts.force && recent.some((s) => now - s.at < DAILY_GAP_MS)) return [];
  const lastRun = [...recent].sort((a, b) => b.at - a.at).slice(0, IGNORED_RUN);
  if (!opts.force && lastRun.length === IGNORED_RUN && lastRun.every(unanswered) && now - lastRun[0].at < IGNORED_PAUSE_MS) return [];
  const seen = new Set<string>();
  const out: P[] = [];
  for (const p of pending) {
    const sig = suggestionSig(p.title);
    if (seen.has(sig)) continue;
    seen.add(sig);
    const times = recent.filter((s) => s.proposalId === p.id || suggestionSig(s.title) === sig).length;
    if (times >= MAX_SHOWINGS) continue;
    out.push(p);
  }
  return out;
}
