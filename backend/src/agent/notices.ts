// Things we detected that the user can act on, raised by Anakin the next time
// they open chat (the same hook that raises pending suggestions). Each notice
// is posted once per user — its key is remembered in the coach profile — and
// carries a card with what they can do about it.
//
// First detector (16 Oct 2026): guided sessions saved with no weights. The
// v2 session never put the plan's loads into its state, so from the v2 rollout
// (11 Oct) until the fix (954e9e9, 16 Oct) every set was saved weightless —
// no PRs, no progression, and Anakin read the gap as "your top sets dropped".

import { PrismaClient } from '@prisma/client';
import type { CardDraft } from './cards/types.js';
import { postInitiatedTurn } from './initiated.js';
import { parseBlob, mergeBlobKeys } from './profile/coachProfile.js';
import { dayLabel } from './cards/format.js';

const prisma = new PrismaClient();

export interface Notice { key: string; text: string; cards: CardDraft[] }

const BODYWEIGHT_MOVES = /\b(pull[- ]?ups?|chin[- ]?ups?|push[- ]?ups?|dips?|planks?|sit[- ]?ups?|crunch(es)?|burpees?|air squats?|mountain climbers?|hanging leg raises?)\b/i;
const BUG_FROM = Date.parse('2026-10-10T00:00:00Z');
const BUG_TO = Date.parse('2026-10-17T00:00:00Z');

interface LogRow { id: string; date: string; title: string | null; exercises: string | null; createdAt: Date | number | string }

/** Guided sessions from the bug window where every weighted lift saved without a weight. Pure. */
export function weightlessSessions(logs: LogRow[]): Array<{ id: string; date: string; title: string; lifts: string[] }> {
  const out: Array<{ id: string; date: string; title: string; lifts: string[] }> = [];
  for (const l of logs) {
    const at = new Date(l.createdAt as any).getTime();
    if (!(at >= BUG_FROM && at < BUG_TO)) continue;
    let exs: any[] = [];
    try { exs = JSON.parse(l.exercises ?? '[]'); } catch { continue; }
    if (!Array.isArray(exs) || !exs.some((e) => Array.isArray(e?.setEntries))) continue; // only the guided session writes setEntries
    const lifts = exs.filter((e) => e?.name && !BODYWEIGHT_MOVES.test(String(e.name)));
    if (!lifts.length) continue;
    const anyWeight = lifts.some((e) => Number(e.weightKg) > 0 || (e.setEntries ?? []).some((s: any) => Number(s?.weightKg) > 0));
    if (anyWeight) continue;
    out.push({ id: l.id, date: l.date, title: (l.title || 'Session').replace(/^\w+day — /, ''), lifts: lifts.map((e) => String(e.name)) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** The notice for those sessions, with buttons that hand the fix to Anakin. Pure. */
export function weightlessNotice(sessions: ReturnType<typeof weightlessSessions>): Notice | null {
  if (!sessions.length) return null;
  const days = [...new Set(sessions.map((s) => dayLabel(s.date)))];
  const list = days.length > 1 ? `${days.slice(0, -1).join(', ')} and ${days[days.length - 1]}` : days[0];
  return {
    key: 'weightless-sessions-2026-10',
    text: `Something broke on our side: your guided sessions on ${list} saved without the weights you lifted. So I couldn't track your lifts or spot PRs, and anything I said about those sessions' loads was wrong — they didn't drop. It's fixed now. If you remember what you lifted I'll add it, or I can fill in the weights your plan had for those days.`,
    cards: [{
      fn: 'NTC-01', pattern: 'glance', rule: 'show',
      meta: { label: 'Workouts missing weights' },
      rows: sessions.slice(0, 6).map((s) => ({ key: `${dayLabel(s.date)} · ${s.title}`, value: `${s.lifts.length} lift${s.lifts.length === 1 ? '' : 's'}`, sub: s.lifts.slice(0, 3).join(', ') + (s.lifts.length > 3 ? '…' : '') })),
      actions: [
        { id: 'add', label: 'Add my weights', kind: 'primary', client: { action: 'send_message', args: { text: `I want to add the weights I lifted for my sessions on ${list}. Go lift by lift and ask me.` } } },
        { id: 'planned', label: 'Use my planned weights', kind: 'secondary', client: { action: 'send_message', args: { text: `Fill in my planned weights for my sessions on ${list}. I lifted what the plan said.` } } },
      ],
    } as CardDraft],
  };
}

/** Run the detectors and post each new notice once. Returns how many were posted. */
export async function postPendingNotices(userId: string): Promise<number> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { coachProfile: true } }).catch(() => null);
  if (!u) return 0;
  const done = new Set<string>(Array.isArray(parseBlob(u.coachProfile).noticesPosted) ? parseBlob(u.coachProfile).noticesPosted : []);
  const logs = await prisma.workoutLog.findMany({
    where: { userId, createdAt: { gte: new Date(BUG_FROM), lt: new Date(BUG_TO) } },
    select: { id: true, date: true, title: true, exercises: true, createdAt: true },
  }).catch(() => [] as LogRow[]);
  const notices = [weightlessNotice(weightlessSessions(logs))].filter((n): n is Notice => !!n && !done.has(n.key));
  let posted = 0;
  for (const n of notices) {
    if (await postInitiatedTurn(userId, { text: n.text, cards: n.cards })) { done.add(n.key); posted++; }
  }
  if (posted) await mergeBlobKeys(userId, { noticesPosted: [...done] });
  return posted;
}
