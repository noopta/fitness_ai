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
import { buildWeekReport, loadWeekInput, localDate, type Win } from '../services/weeklyWins.js';

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

/**
 * Progress worth celebrating, from the same engine as the Sunday email. Strength
 * bests are left out: they're celebrated the moment the workout is logged.
 * Pure: the wins not yet celebrated → one message with the numbers and a Share.
 */
// Progress worth a chat note: the scale moving toward their goal, or nutrition
// targets hit consistently. Strength bests post when the workout is logged;
// routine counts (workouts, days logged) wait for the Sunday recap. Not spam:
// each win once, and at most one progress note every 3 days.
const NOTEWORTHY = (w: Win) => w.kind === 'weight' || (w.kind === 'nutrition' && !w.key.startsWith('logged:'));
export const PROGRESS_NOTE_GAP_DAYS = 3;

const lc = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

export function winsNotice(wins: Win[], celebrated: Set<string>): Notice | null {
  const fresh = wins.filter((w) => NOTEWORTHY(w) && !celebrated.has(w.key)).slice(0, 3);
  if (!fresh.length) return null;
  const lead = fresh[0];
  const text = fresh.length === 1
    ? `${lead.title}! ${lead.detail} That's real progress — you're doing the work and it's showing. Proud of you.`
    : `Look at this: ${fresh.map((w) => lc(w.title)).join(', and ')}. You're doing the work and it's showing — keep it going.`;
  return {
    key: `wins:${fresh.map((w) => w.key).join('|')}`,
    text,
    cards: [{
      fn: 'NTC-02', pattern: 'glance', rule: 'show', meta: { label: 'Progress' },
      hero: { value: lead.share.value, unit: lead.share.line },
      rows: fresh.map((w) => ({ key: w.title, sub: w.detail, mark: 'add' as const })),
      actions: [{ id: 'share', label: 'Share', kind: 'secondary', client: { action: 'share', args: { text: `${lead.title} — ${lead.detail} (via Axiom)` } } }],
    } as CardDraft],
  };
}

/** Run the detectors and post each new notice once. Returns how many were posted. */
export async function postPendingNotices(userId: string): Promise<number> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { coachProfile: true, timezone: true } }).catch(() => null);
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
  // Progress to celebrate: at most one message a day, each win once.
  const blob = parseBlob(u.coachProfile);
  const celebrated = new Set<string>(Array.isArray(blob.winsCelebrated) ? blob.winsCelebrated : []);
  const today = localDate(u.timezone);
  let winsPatch: Record<string, unknown> = {};
  const daysSince = blob.winsPostedOn ? Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${blob.winsPostedOn}T12:00:00Z`)) / 86_400_000) : Infinity;
  if (daysSince >= PROGRESS_NOTE_GAP_DAYS) {
    const input = await loadWeekInput(userId, today).catch(() => null);
    const wn = input ? winsNotice(buildWeekReport(input).wins, celebrated) : null;
    if (wn && await postInitiatedTurn(userId, { text: wn.text, cards: wn.cards })) {
      wn.key.slice(5).split('|').forEach((k) => celebrated.add(k));
      winsPatch = { winsCelebrated: [...celebrated].slice(-200), winsPostedOn: today };
      posted++;
    }
  }
  if (posted) await mergeBlobKeys(userId, { noticesPosted: [...done], ...winsPatch });
  return posted;
}
