// Sunday 6 pm in each user's own time zone: their week, measured
// (weeklyWins.ts), as a chat recap, a push and an email. Replaces the old
// Sunday 20:00-UTC summary (which read protein from the legacy table and had
// no dedupe). Runs hourly; a user is claimed for the week before anything is
// sent, so a restart or a second instance can't send twice.

import { PrismaClient } from '@prisma/client';
import { buildWeekReport, loadWeekInput, localDate, weekKey, type WeekReport, type Win } from './weeklyWins.js';
import { weeklyWinsEmail, SUPPORT_EMAIL } from './emailTemplates.js';
import { isMailConfigured, sendEmail } from './mailService.js';
import { unsubscribeUrl } from './emailUnsubscribe.js';
import { parseNotificationPrefs } from './userPrefs.js';
import { displayWeight, normalizePreference } from './weightUnits.js';
import { parseBlob, mergeBlobKeys } from '../agent/profile/coachProfile.js';
import { postInitiatedLater } from '../agent/initiated.js';
import type { CardDraft } from '../agent/cards/types.js';

const prisma = new PrismaClient();
export const SEND_HOUR = 18;

/** Is it Sunday at SEND_HOUR in this zone? Pure. */
export function isSendHour(tz: string | null | undefined, now = new Date()): boolean {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz || 'America/New_York', weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(now).map((x) => [x.type, x.value]));
    return p.weekday === 'Sun' && Number(p.hour) === SEND_HOUR;
  } catch { return false; }
}

/** The chat recap card: wins with numbers, then the focus. Pure. */
export function weekCard(rep: WeekReport): CardDraft {
  return {
    fn: 'MEM-05', pattern: 'glance', rule: 'show',
    meta: { label: 'Your week' },
    rows: [
      ...rep.wins.slice(0, 4).map((w) => ({ key: w.title, sub: w.detail, mark: 'add' as const })),
      ...rep.focus.map((f) => ({ key: 'Next week', sub: f })),
    ],
    ...(rep.wins[0] ? { hero: { value: rep.wins[0].share.value, unit: rep.wins[0].share.line } } : {}),
    actions: [
      { id: 'next', label: 'What changes next week?', kind: 'primary', client: { action: 'send_message', args: { text: 'Look at my week and tell me what to change for next week.' } } },
      ...(rep.wins[0] ? [{ id: 'share', label: 'Share', kind: 'secondary' as const, client: { action: 'share' as const, args: { text: `${rep.wins[0].title} — ${rep.wins[0].detail} (via Axiom)` } } }] : []),
    ],
  } as CardDraft;
}

/** The Sunday chat opener: warm, leading with the best win. Pure. */
export function recapText(rep: WeekReport, first: string): string {
  const name = first ? `, ${first}` : '';
  const top = rep.wins[0];
  if (!top) return `Here's your week${name} — the full picture is below, and I've got a couple of ideas for next week.`;
  const more = rep.wins.length > 1 ? ` Plus ${rep.wins.length - 1} more win${rep.wins.length > 2 ? 's' : ''} below.` : '';
  return `What a week${name}! ${top.title} — ${top.detail.charAt(0).toLowerCase()}${top.detail.slice(1)}${more} I've put your week and next week's level-ups below. Proud of you.`;
}

const hasActivity = (r: WeekReport) => r.training.sessions > 0 || r.nutrition.loggedDays > 0 || r.body.logs > 0;

/** Send one user's week (if it's theirs to get). Returns what went out. */
export async function sendWeekFor(userId: string, opts: { now?: Date; force?: boolean } = {}): Promise<{ chat: boolean; email: boolean; push: boolean; wins: number } | null> {
  const now = opts.now ?? new Date();
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, timezone: true, unitPreference: true, coachProfile: true, notificationPrefsJson: true, marketingEmailsOptOut: true, expoPushToken: true } });
  if (!u) return null;
  const end = localDate(u.timezone, now);
  const wk = weekKey(end);
  const blob = parseBlob(u.coachProfile);
  if (!opts.force && blob.weeklyWinsWeek === wk) return null;
  const input = await loadWeekInput(userId, end);
  if (!input) return null;
  const rep = buildWeekReport(input);
  if (!hasActivity(rep)) return null;
  // Claim the week first; then send. Wins shown here aren't celebrated again on open.
  const celebrated = new Set<string>(Array.isArray(blob.winsCelebrated) ? blob.winsCelebrated : []);
  rep.wins.forEach((w: Win) => celebrated.add(w.key));
  await mergeBlobKeys(userId, { weeklyWinsWeek: wk, winsCelebrated: [...celebrated].slice(-200) });

  const first = (u.name || '').trim().split(/\s+/)[0];
  postInitiatedLater(userId, async () => ({ text: recapText(rep, first), cards: [weekCard(rep)] }));

  const prefs = parseNotificationPrefs(u.notificationPrefsJson);
  let push = false;
  if (u.expoPushToken && prefs.weeklySummary !== false) {
    try {
      const { sendPushNotification } = await import('./notificationService.js');
      await sendPushNotification({ to: u.expoPushToken, title: `Your week${first ? `, ${first}` : ''}`, body: rep.wins[0] ? `${rep.wins[0].title}. ${rep.wins[0].detail}` : rep.analysis[0] ?? 'Your weekly review is in.', data: { screen: 'coach' } } as any);
      push = true;
    } catch { /* push is best effort */ }
  }
  let email = false;
  if (u.email && prefs.weeklyEmail !== false && !u.marketingEmailsOptOut && isMailConfigured()) {
    const pref = normalizePreference(u.unitPreference);
    const msg = weeklyWinsEmail(rep, { name: u.name, unsubscribeUrl: unsubscribeUrl(userId, 'weekly'), toKgDisplay: (kg) => displayWeight(kg, pref, 1) });
    const res = await sendEmail({ to: u.email, subject: msg.subject, html: msg.html, text: msg.text, replyTo: SUPPORT_EMAIL }).catch((e) => ({ sent: false, reason: e?.message }));
    email = !!res.sent;
    if (!res.sent) console.error('[weekly-wins] email failed for', userId, (res as any).reason);
  }
  return { chat: true, email, push, wins: rep.wins.length };
}

/** Hourly: everyone for whom it's now Sunday 6 pm. */
export async function runWeeklyWinsHour(now = new Date()): Promise<number> {
  if (process.env.WEEKLY_WINS_ENABLED === '0') return 0;
  const users = await prisma.user.findMany({ where: { email: { not: null } }, select: { id: true, timezone: true } });
  let sent = 0;
  for (const u of users) {
    if (!isSendHour(u.timezone, now)) continue;
    try { if (await sendWeekFor(u.id, { now })) sent++; } catch (e: any) { console.error('[weekly-wins]', u.id, e?.message ?? e); }
  }
  if (sent) console.log(`[weekly-wins] sent ${sent} week(s)`);
  return sent;
}
