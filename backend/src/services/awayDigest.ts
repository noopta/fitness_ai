// "While you were away" (design 3b, Oct 2026): one dark card per absence that
// replaces the "While you were away · N" divider. It folds what Anakin posted
// while the user was gone into one-line rows; each row opens to a sentence of
// detail and one action, which unfolds the original message in the thread.
//
//   buildAwayItems   pure: Anakin-initiated turns since the user was last here → rows
//   openAwayDigest   on opening chat after ≥ AWAY_HOURS away with ≥ 1 unseen update:
//                    save the AWAY-01 card and post it as one turn (it stays in history)
//   markAwayOpened   a row opened → openedAt (the badge counts unopened rows)

import { PrismaClient } from '@prisma/client';
import type { AwayBlock, AwayItem, AwayKind, Card } from '../agent/cards/types.js';

const prisma = new PrismaClient();

export const AWAY_HOURS = Number(process.env.AWAY_HOURS) || 8;
export const AWAY_TEXT = 'While you were away.';
const MAX_ROWS = 6;

export interface AwayTurn { at: string; text: string; origin?: string; role: 'user' | 'assistant'; cardIds: string[] }

const clip = (s: string, n: number) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`; };
const firstSentence = (s: string) => String(s ?? '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0] ?? '';
/** Calendar days between two instants (UTC dates), so 40 hours back on a Tuesday is Sunday, not "yesterday". */
const calendarDays = (from: Date, to: Date) => Math.round((Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()) - Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())) / 86_400_000);
const dayOf = (iso: string, now: Date) => {
  const d = new Date(iso);
  const days = calendarDays(d, now);
  return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
};

/** Which kind of update a card is, or null for cards that aren't news (the Today glance under every turn). */
export function kindOf(card: Card): AwayKind | null {
  if (card.fn === 'LOG-01') return 'needs_you';
  if (card.pattern === 'proposal') return 'program_change';
  if (/^(MEM-05|MOM-|NTC-|PRG-1[0-9]|STR-)/.test(card.fn)) return 'insight';
  return null;
}

/**
 * Pure: rows for the turns Anakin started after `since` (and after the user's
 * last message), skipping turns an earlier away card already folded. One row
 * per news card; a turn with no news card is one row of its text. Repeats of
 * the same title keep only the newest. needs_you first, then newest first.
 */
export function buildAwayItems(turns: AwayTurn[], cards: Map<string, Card>, since: string, alreadyFolded: Set<string>, now = new Date()): { items: AwayItem[]; foldedAts: string[] } {
  const lastUser = [...turns].reverse().find((t) => t.role === 'user')?.at ?? '';
  const from = since > lastUser ? since : lastUser;
  // A turn with an unanswered proactive Ask (PRO-01/05/06/07) is never folded: it stays live under the card until answered or expired.
  const awaiting = (t: AwayTurn) => t.cardIds.some((id) => { const c = cards.get(id); return !!c && /^PRO-0[1567]$/.test(c.fn) && (!c.state || c.state.status === 'live'); });
  const fresh = turns.filter((t) => t.role === 'assistant' && t.origin === 'anakin' && t.at && t.at > from && !alreadyFolded.has(t.at) && t.text !== AWAY_TEXT && !awaiting(t));
  const items: AwayItem[] = [];
  for (const t of fresh) {
    const news = t.cardIds.map((id) => cards.get(id)).filter((c): c is Card => !!c && !!kindOf(c));
    if (!news.length) {
      items.push({ id: `${t.at}`, kind: 'announcement', title: clip(firstSentence(t.text), 48), detail: clip(t.text, 140), cta: { label: 'Read', turnAt: t.at }, occurredAt: t.at, day: dayOf(t.at, now) });
      continue;
    }
    for (const c of news) {
      const kind = kindOf(c)!;
      const label = String(c.meta?.label ?? '').replace(/^Proposed · /, '');
      const pending = c.review?.pending;
      const title = kind === 'needs_you' ? (pending === 0 ? 'Log check · all reviewed' : `${pending ?? ''} log ${pending === 1 ? 'entry needs' : 'entries need'} review`.trim())
        : clip(label || firstSentence(t.text), 48);
      const detail = clip(kind === 'needs_you' ? firstSentence(t.text) : (c.why ?? c.note ?? t.text), 140);
      const cta = { label: kind === 'needs_you' ? 'Review' : kind === 'program_change' ? 'Review suggestion' : kind === 'insight' ? 'See it' : 'Read', turnAt: t.at, cardId: c.id };
      items.push({ id: `${t.at}:${c.id}`, kind, title, detail, cta, occurredAt: t.at, day: dayOf(t.at, now), ...(kind === 'needs_you' && pending === 0 ? { resolvedAt: now.toISOString() } : {}) });
    }
  }
  // The same suggestion posted twice while they were away is one row (the newest).
  const byTitle = new Map<string, AwayItem>();
  for (const it of items) { const k = `${it.kind}|${it.title.toLowerCase()}`; const prev = byTitle.get(k); if (!prev || it.occurredAt > prev.occurredAt) byTitle.set(k, it); }
  const rows = [...byTitle.values()].sort((a, b) => Number(b.kind === 'needs_you') - Number(a.kind === 'needs_you') || b.occurredAt.localeCompare(a.occurredAt));
  return { items: rows, foldedAts: [...new Set(fresh.map((t) => t.at))] };
}

/** Pure: the card's block (summary text, overflow) from its rows. */
export function awayBlock(items: AwayItem[], sinceIso: string, foldedAts: string[], now = new Date()): AwayBlock {
  const needs = items.filter((i) => i.kind === 'needs_you' && !i.resolvedAt).length;
  const d = new Date(sinceIso);
  const days = calendarDays(d, now);
  const since = days <= 0 ? 'Since this morning' : days === 1 ? 'Since yesterday' : `Since ${d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })}`;
  return {
    since,
    summary: `${items.length} update${items.length === 1 ? '' : 's'}${needs ? ` · ${needs} needs you` : ''}`,
    items,
    shown: Math.min(MAX_ROWS, items.length),
    foldedAts,
    unopened: items.filter((i) => !i.openedAt).length,
  };
}

// ── With the database ─────────────────────────────────────────────────────────

/**
 * Opening chat: if they've been away ≥ AWAY_HOURS (from `lastOpenAt`, else
 * their last message) and Anakin posted anything since, save the card and post
 * it as one turn. One card per absence: returns null when there's nothing new.
 */
export async function openAwayDigest(userId: string, lastOpenAt: string | null, now = new Date()): Promise<Card | null> {
  const { loadStoredMessages, appendInitiated } = await import('../agent/conversation.js');
  const { saveCard } = await import('../agent/cards/store.js');
  const { cardRef } = await import('../agent/cardNotes.js');

  const stored = await loadStoredMessages(userId);
  const turns: AwayTurn[] = stored.map((m: any) => ({ role: m.role, text: m.text ?? '', origin: m.origin, at: m.at ?? '', cardIds: (m.cards ?? []).map((c: any) => c.id) }));
  const lastUser = [...turns].reverse().find((t) => t.role === 'user')?.at ?? '';
  const since = lastOpenAt && !Number.isNaN(Date.parse(lastOpenAt)) ? new Date(lastOpenAt).toISOString() : lastUser;
  if (!since || now.getTime() - Date.parse(since) < AWAY_HOURS * 3_600_000) return null;

  const earlier = await prisma.agentCard.findMany({ where: { userId, fn: 'AWAY-01' }, select: { payloadJson: true } });
  const folded = new Set<string>(earlier.flatMap((r) => { try { return (JSON.parse(r.payloadJson).away?.foldedAts ?? []) as string[]; } catch { return []; } }));
  const ids = [...new Set(turns.flatMap((t) => t.cardIds))];
  const rows = ids.length ? await prisma.agentCard.findMany({ where: { userId, id: { in: ids } }, select: { payloadJson: true } }) : [];
  const cards = new Map<string, Card>(rows.map((r) => { const c = JSON.parse(r.payloadJson) as Card; return [c.id, c]; }));

  const { items, foldedAts } = buildAwayItems(turns, cards, since, folded, now);
  if (!items.length) return null;
  const card = await saveCard(userId, { fn: 'AWAY-01', pattern: 'away', rule: 'show', meta: { label: 'While you were away' }, away: awayBlock(items, since, foldedAts, now) } as any);
  await appendInitiated(userId, AWAY_TEXT, [cardRef(card)]);
  return card;
}

/** A row opened: sets openedAt once, so the badge counts down. Returns the card. */
export async function markAwayOpened(userId: string, cardId: string, itemId: string): Promise<Card> {
  const row = await prisma.agentCard.findFirst({ where: { id: cardId, userId, fn: 'AWAY-01' } });
  if (!row) throw Object.assign(new Error('That card is gone.'), { status: 404 });
  const card = JSON.parse(row.payloadJson) as Card;
  const item = card.away?.items.find((i) => i.id === itemId);
  if (item && !item.openedAt) {
    item.openedAt = new Date().toISOString();
    card.away!.unopened = card.away!.items.filter((i) => !i.openedAt).length;
    await prisma.agentCard.update({ where: { id: cardId }, data: { payloadJson: JSON.stringify(card) } });
  }
  return card;
}

/** A log review digest resolved: its needs_you rows on away cards resolve too. */
export async function resolveNeedsYou(userId: string, digestId: string): Promise<void> {
  const rows = await prisma.agentCard.findMany({ where: { userId, fn: 'AWAY-01' }, select: { id: true, payloadJson: true } });
  for (const r of rows) {
    const card = JSON.parse(r.payloadJson) as Card;
    let touched = false;
    for (const it of card.away?.items ?? []) if (it.kind === 'needs_you' && it.cta.cardId === digestId && !it.resolvedAt) { it.resolvedAt = new Date().toISOString(); touched = true; }
    if (!touched) continue;
    const needs = card.away!.items.filter((i) => i.kind === 'needs_you' && !i.resolvedAt).length;
    card.away!.summary = `${card.away!.items.length} update${card.away!.items.length === 1 ? '' : 's'}${needs ? ` · ${needs} needs you` : ''}`;
    await prisma.agentCard.update({ where: { id: r.id }, data: { payloadJson: JSON.stringify(card) } });
  }
}
