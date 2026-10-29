// Suggestions reach chat (v2 feedback 8 Oct). A progression suggestion is
// created after an in-app workout (which already posts its card) and by the
// background detectors (which didn't). When the user next opens chat, every
// pending suggestion without a live card there gets one — once. Deciding it
// on the Training tab settles that card, and deciding it in chat removes it
// from Training (it's no longer pending), so neither place shows a decided one.

import { listPending, type ProposalRow } from '../adaptation/proposalService.js';
import { adaptationCard } from './toolkits/adaptation.js';
import { hasLiveCard, settleLiveCards } from './cards/store.js';
import { postInitiatedTurn } from './initiated.js';
import { PrismaClient } from '@prisma/client';
import { pickToSurface, SHOWN_WINDOW_MS, type ShownCard } from './adaptationSurfacePick.js';

export { pickToSurface, suggestionSig } from './adaptationSurfacePick.js';

const prisma = new PrismaClient();
import { toolCtx } from './turn.js';

export const ADAPT_FNS = ['ADP-01', 'ADP-05'];
const BURIED_AFTER_MS = 48 * 3600_000;
const forProposal = (id: string) => (pending: any) => pending?.actions?.apply?.args?.id === id;

async function shownSuggestions(userId: string, now: number): Promise<ShownCard[]> {
  const rows = await prisma.agentCard.findMany({ where: { userId, fn: { in: ADAPT_FNS }, createdAt: { gte: new Date(now - SHOWN_WINDOW_MS) } }, select: { payloadJson: true, pendingJson: true, createdAt: true } }).catch(() => []);
  return rows.map((r) => {
    let title = ''; let proposalId: string | null = null;
    try { title = JSON.parse(r.payloadJson)?.meta?.label ?? ''; } catch { /* skip */ }
    try { proposalId = (r.pendingJson ? JSON.parse(r.pendingJson) : null)?.actions?.apply?.args?.id ?? null; } catch { /* skip */ }
    return { proposalId, title, at: new Date(r.createdAt).getTime() };
  });
}

/** The chat opener for the suggestions being raised. Pure. */
export function surfaceText(ps: Pick<ProposalRow, 'kind' | 'title' | 'proposal'>[]): string {
  if (ps.length > 1) return `I have ${ps.length} suggestions from your training.`;
  const p = ps[0];
  if (p.kind === 'deload') return 'Your last few sessions point to a lighter week.';
  if (p.kind === 'next_session') return `I have a suggestion for your next ${(p.proposal as any)?.exercise ?? 'session'}.`;
  return `${p.title}.`;
}

/** Post a card for each pending suggestion chat hasn't shown yet (at most 2). Returns how many. */
export async function surfacePendingAdaptations(userId: string, opts: { force?: boolean } = {}): Promise<number> {
  const all = await listPending(userId).catch(() => [] as ProposalRow[]);
  const pending = pickToSurface(all, await shownSuggestions(userId, Date.now()), Date.now(), opts);
  const fresh: ProposalRow[] = [];
  // A card more than two days back has scrolled out of sight (Tarek's sat
  // untouched for 9 days): raise it again at the bottom and retire the old one.
  const recent = new Date(Date.now() - BURIED_AFTER_MS);
  for (const p of pending) {
    if (fresh.length >= 2) break;
    // force: right after a notice, so the suggestion sits under it rather than further up.
    if (opts.force || !(await hasLiveCard(userId, ADAPT_FNS, forProposal(p.id), recent))) fresh.push(p);
  }
  if (!fresh.length) return 0;
  for (const p of fresh) await settleLiveCards(userId, ADAPT_FNS, forProposal(p.id), { status: 'replaced', line: 'Moved to your latest message' });
  const ctx = await toolCtx(userId);
  const ok = await postInitiatedTurn(userId, { text: surfaceText(fresh), cards: fresh.map((p) => adaptationCard(p, ctx)) });
  return ok ? fresh.length : 0;
}

/** A suggestion decided outside chat: its chat card stops offering Apply. */
export function settleAdaptationCards(userId: string, id: string, action: 'apply' | 'decline' | 'snooze') {
  const line = action === 'apply' ? 'Applied from Training' : action === 'snooze' ? 'Set aside for now' : 'Won’t suggest this again';
  return settleLiveCards(userId, ADAPT_FNS, forProposal(id), { status: action === 'apply' ? 'applied' : 'kept', line });
}
