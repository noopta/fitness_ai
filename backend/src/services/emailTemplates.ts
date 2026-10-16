import type { WeekReport } from './weeklyWins.js';
import { microHighlights } from './microInsights.js';
// HTML templates for outbound product mail: the one-time welcome and the
// blog/update broadcast. Plain inline-styled HTML (no framework) so it renders
// the same in Gmail, Apple Mail and Outlook.
export function escapeHtml(input: string): string {
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const APP_STORE_URL = 'https://apps.apple.com/us/app/axiom-ai-personal-trainer/id6761032954';
export const SITE_URL = process.env.FRONTEND_URL || 'https://axiomtraining.io';
export const SUPPORT_EMAIL = 'inquiries@axiomtraining.io';
/**
 * CAN-SPAM 15 U.S.C. 7704(a)(5)(A)(iii): every commercial email must carry a
 * valid physical postal address of the sender. One place for it — every
 * template goes through layout(), which prints it. Set EMAIL_POSTAL_ADDRESS
 * in the environment, or replace the placeholder before sending marketing.
 */
export const POSTAL_ADDRESS = process.env.EMAIL_POSTAL_ADDRESS || '[POSTAL ADDRESS]';

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function button(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;background:#09090b;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:10px;">${escapeHtml(label)}</a>`;
}

export function layout(opts: { preheader?: string; body: string; unsubscribeUrl?: string; footerNote: string }): string {
  const pre = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(opts.preheader)}</div>`
    : '';
  const unsub = opts.unsubscribeUrl
    ? ` &middot; <a href="${escapeHtml(opts.unsubscribeUrl)}" style="color:#71717a;">Unsubscribe from updates</a>`
    : '';
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f5;">${pre}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;font-family:${FONT};color:#0f0f0f;">
<tr><td style="background:#09090b;padding:22px 28px;">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td style="vertical-align:middle;"><img src="${SITE_URL}/axiom-icon.png" width="36" height="36" alt="" style="display:block;border-radius:9px;"></td>
    <td style="vertical-align:middle;padding-left:12px;color:#ffffff;font-weight:700;font-size:18px;letter-spacing:-0.01em;">Axiom</td>
  </tr></table>
</td></tr>
<tr><td style="padding:28px 28px 8px;font-size:16px;line-height:1.55;">${opts.body}</td></tr>
<tr><td style="padding:16px 28px 26px;font-size:12px;line-height:1.5;color:#71717a;border-top:1px solid #e4e4e7;">
  ${opts.footerNote}${unsub}<br>
  Axiom &middot; <a href="${SITE_URL}" style="color:#71717a;">axiomtraining.io</a> &middot; <a href="mailto:${SUPPORT_EMAIL}" style="color:#71717a;">${SUPPORT_EMAIL}</a><br>
  ${escapeHtml(POSTAL_ADDRESS)}
</td></tr>
</table>
</td></tr></table></body></html>`;
}

// ─── Welcome ────────────────────────────────────────────────────────────────

export interface WelcomeEmail { subject: string; html: string; text: string }

export interface WelcomeOptions {
  /**
   * True only when the user opted in to marketing (User.marketingConsentAt set).
   * Without it the welcome is purely transactional: account confirmation,
   * how to get started, how to reach us. No feature promotion, no unsubscribe
   * link (there's nothing to unsubscribe from).
   */
  marketing?: boolean;
  unsubscribeUrl?: string;
}

export function welcomeEmail(name: string | null | undefined, opts: WelcomeOptions = {}): WelcomeEmail {
  const first = (name || '').trim().split(/\s+/)[0] || '';
  const hi = first ? `Hi ${escapeHtml(first)},` : 'Hi there,';
  const subject = first ? `Welcome to Axiom, ${first}` : 'Welcome to Axiom';
  const marketing = !!opts.marketing && !!opts.unsubscribeUrl;

  // Promotional block: only for users who opted in to marketing email.
  const promoHtml = marketing ? `
<p style="margin:22px 0 8px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#71717a;">What members use most</p>
<ul style="margin:0 0 14px;padding-left:20px;">
  <li style="margin:0 0 8px;"><strong>Anakin, your coach.</strong> Ask anything: swap an exercise, plan around an injury, or get a straight answer on your programming. It knows your logs.</li>
  <li style="margin:0 0 8px;"><strong>Adaptive progression.</strong> When your logs say a lift is ready to move, Axiom proposes the change, explains the reasoning, and asks before applying it.</li>
  <li style="margin:0 0 8px;"><strong>Form check.</strong> Film a set and get written feedback on what to fix.</li>
  <li style="margin:0 0 8px;"><strong>Nutrition that talks to your training.</strong> Log meals by photo or voice, and see how your eating lines up with your training goals.</li>
  <li style="margin:0 0 8px;"><strong>Train together.</strong> Add friends, share workout cards, and keep each other honest.</li>
</ul>` : '';
  const promoText = marketing ? [
    'What members use most:',
    '- Anakin, your coach: ask anything, it knows your logs.',
    '- Adaptive progression: proposes changes with reasoning, asks before applying.',
    '- Form check: film a set, get written feedback.',
    '- Nutrition that talks to your training: log meals by photo or voice.',
    '- Train together: friends, shared workout cards.',
    '',
  ] : [];

  const body = `
<p style="margin:0 0 14px;font-size:22px;font-weight:700;letter-spacing:-0.01em;">${hi} welcome to Axiom</p>
<p style="margin:0 0 14px;">Your account is set up and ready. Axiom builds your training program from your own numbers and adjusts it as you log.</p>
${promoHtml}
<p style="margin:22px 0 8px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#71717a;">Where to start</p>
<ol style="margin:0 0 18px;padding-left:20px;">
  <li style="margin:0 0 6px;"><strong>Finish your coach intake</strong>: about five minutes. The more accurate it is, the better the program.</li>
  <li style="margin:0 0 6px;"><strong>Log your first session.</strong> Everything Axiom does gets sharper with each set you log.</li>
  <li style="margin:0 0 6px;"><strong>Log a meal</strong> if you want nutrition guidance too.</li>
</ol>
<p style="margin:0 0 22px;">${button(APP_STORE_URL, 'Open Axiom')}&nbsp;&nbsp;<a href="${SITE_URL}/coach" style="color:#09090b;font-weight:600;">or continue on the web →</a></p>

<p style="margin:0 0 6px;font-size:14px;color:#52525b;">Axiom gives coaching feedback, not medical advice. If you have an injury or medical condition, check with a clinician before starting a new program.</p>
<p style="margin:14px 0 6px;">Questions, feedback, something not working? Reply to this email. A real person reads every one.</p>
<p style="margin:0;color:#3f3f46;">The Axiom team</p>`;

  const text = [
    `${first ? `Hi ${first},` : 'Hi there,'} welcome to Axiom.`,
    '',
    'Your account is set up and ready. Axiom builds your training program from your own numbers and adjusts it as you log.',
    '',
    ...promoText,
    'Where to start:',
    '1. Finish your coach intake (about five minutes).',
    '2. Log your first session.',
    '3. Log a meal if you want nutrition guidance too.',
    `Open Axiom: ${APP_STORE_URL}  |  Web: ${SITE_URL}/coach`,
    '',
    'Axiom gives coaching feedback, not medical advice. If you have an injury or medical condition, check with a clinician before starting a new program.',
    '',
    'Questions? Reply to this email. A real person reads every one.',
    'The Axiom team',
    ...(marketing ? ['', `Unsubscribe from updates: ${opts.unsubscribeUrl}`] : []),
    '',
    POSTAL_ADDRESS,
  ].join('\n');

  const html = layout({
    preheader: 'Your Axiom account is ready. Here is how to get started.',
    body,
    unsubscribeUrl: marketing ? opts.unsubscribeUrl : undefined,
    footerNote: 'You’re receiving this because you just created an Axiom account.',
  });
  return { subject, html, text };
}

// ─── Double opt-in confirmation (BlogSubscriber) ─────────────────────────────

export function subscriberConfirmationEmail(confirmUrl: string): { subject: string; html: string; text: string } {
  const subject = 'Confirm your Axiom updates subscription';
  const body = `
<p style="margin:0 0 14px;font-size:20px;font-weight:700;">Please confirm your subscription</p>
<p style="margin:0 0 14px;">Someone (hopefully you) asked for this address to receive Axiom blog posts and product updates. We won’t email you anything else until you confirm.</p>
<p style="margin:0 0 22px;">${button(confirmUrl, 'Yes, send me updates')}</p>
<p style="margin:0 0 6px;font-size:14px;color:#52525b;">Didn’t ask for this? Ignore this email and you won’t hear from us again.</p>`;
  const text = [
    subject, '',
    'Someone (hopefully you) asked for this address to receive Axiom blog posts and product updates. We won’t email you anything else until you confirm.',
    '', `Confirm: ${confirmUrl}`, '',
    'Didn’t ask for this? Ignore this email and you won’t hear from us again.', '', POSTAL_ADDRESS,
  ].join('\n');
  const html = layout({ preheader: 'One click to confirm, or ignore this email.', body, footerNote: 'This is a one-time confirmation request.' });
  return { subject, html, text };
}

// ─── Waitlist confirmation ───────────────────────────────────────────────────

export interface WaitlistEmailInput {
  name?: string | null;
  /** True only when the signup form sent marketingConsent: true. */
  marketing: boolean;
}

export function waitlistConfirmationEmail(w: WaitlistEmailInput): { subject: string; html: string; text: string } {
  const first = (w.name || '').trim().split(/\s+/)[0] || '';
  const hi = first ? `Hi ${escapeHtml(first)},` : 'Hi there,';
  const subject = 'You’re on the Axiom waitlist';
  const what = w.marketing
    ? 'We’ll email you about product updates, early access and offers, because you said yes to that. You can stop these any time by replying “unsubscribe” or emailing us.'
    : 'We’ll email you once when early access opens. That’s it, unless you sign up for more.';
  const body = `
<p style="margin:0 0 14px;font-size:20px;font-weight:700;">${hi} you’re on the list</p>
<p style="margin:0 0 14px;">Thanks for joining the Axiom waitlist.</p>
<p style="margin:0 0 14px;">${escapeHtml(what)}</p>
<p style="margin:0 0 22px;">${button(`${SITE_URL}/onboarding`, 'Try Axiom now')}</p>`;
  const unsubLine = `Don’t want these emails? Reply “unsubscribe” or email ${SUPPORT_EMAIL} and we’ll remove you.`;
  const html = layout({
    preheader: 'Thanks for joining the Axiom waitlist.',
    body,
    footerNote: `You’re receiving this because you signed up for the Axiom waitlist. ${escapeHtml(unsubLine)}`,
  });
  const text = [`${first ? `Hi ${first},` : 'Hi there,'} you’re on the list.`, '', 'Thanks for joining the Axiom waitlist.', what, '',
    `Try Axiom now: ${SITE_URL}/onboarding`, '', unsubLine, '', POSTAL_ADDRESS].join('\n');
  return { subject, html, text };
}

// ─── Blog / update broadcast ─────────────────────────────────────────────────

/**
 * Minimal Markdown → email HTML. Covers what a founder update actually uses
 * (headings, paragraphs, bold/italic, links, images, lists, quotes, rules,
 * inline code). Everything is escaped first, so post text can't inject markup.
 */
export function markdownToEmailHtml(md: string): string {
  const inline = (s: string) => escapeHtml(s)
    .replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;border-radius:10px;display:block;margin:12px 0;">')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" style="color:#09090b;">$1</a>')
    .replace(/`([^`]+)`/g, '<code style="background:#f4f4f5;padding:1px 5px;border-radius:4px;font-size:14px;">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[^_])_([^_]+)_/g, '$1<em>$2</em>');

  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let list: { type: 'ul' | 'ol'; items: string[] } | null = null;

  const flushPara = () => { if (para.length) { out.push(`<p style="margin:0 0 14px;">${inline(para.join(' '))}</p>`); para = []; } };
  const flushList = () => {
    if (list) {
      out.push(`<${list.type} style="margin:0 0 14px;padding-left:22px;">${list.items.map(i => `<li style="margin:0 0 6px;">${inline(i)}</li>`).join('')}</${list.type}>`);
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const quote = /^>\s?(.*)$/.exec(line);
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) { flushPara(); flushList(); out.push('<hr style="border:0;border-top:1px solid #e4e4e7;margin:20px 0;">'); continue; }
    if (h) {
      flushPara(); flushList();
      const size = h[1].length <= 1 ? 22 : h[1].length === 2 ? 19 : 16;
      out.push(`<p style="margin:22px 0 8px;font-size:${size}px;font-weight:700;letter-spacing:-0.01em;">${inline(h[2])}</p>`);
      continue;
    }
    if (ul || ol) {
      flushPara();
      const type = ul ? 'ul' : 'ol';
      if (!list || list.type !== type) { flushList(); list = { type, items: [] }; }
      list.items.push((ul ?? ol)![1]);
      continue;
    }
    if (quote) {
      flushPara(); flushList();
      out.push(`<blockquote style="margin:0 0 14px;padding:4px 0 4px 14px;border-left:3px solid #e4e4e7;color:#52525b;font-style:italic;">${inline(quote[1])}</blockquote>`);
      continue;
    }
    if (list && /^\s{2,}/.test(raw)) { list.items[list.items.length - 1] += ' ' + line.trim(); continue; }
    flushList();
    para.push(line.trim());
  }
  flushPara(); flushList();
  return out.join('\n');
}

export interface BlogEmailPost { slug: string; title: string; excerpt: string; content: string; category: string }

export function blogPostEmail(post: BlogEmailPost, unsubscribeUrl: string): { subject: string; html: string; text: string } {
  const url = `${SITE_URL}/blog/${post.slug}`;
  const subject = post.title;
  const body = `
<p style="margin:0 0 6px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#71717a;">${escapeHtml(post.category || 'Update')} from Axiom</p>
<p style="margin:0 0 12px;font-size:24px;font-weight:800;letter-spacing:-0.015em;line-height:1.25;">${escapeHtml(post.title)}</p>
${post.excerpt ? `<p style="margin:0 0 18px;font-size:17px;color:#52525b;">${escapeHtml(post.excerpt)}</p>` : ''}
${markdownToEmailHtml(post.content)}
<p style="margin:22px 0 8px;">${button(url, 'Read on axiomtraining.io')}</p>
<p style="margin:14px 0 0;color:#3f3f46;">Thoughts? Reply to this email — we read everything.</p>`;
  const text = [
    `${post.category || 'Update'} from Axiom`,
    post.title,
    '',
    post.excerpt,
    '',
    post.content,
    '',
    `Read on the web: ${url}`,
    '',
    `Unsubscribe from updates: ${unsubscribeUrl}`,
    '',
    POSTAL_ADDRESS,
  ].filter(l => l !== undefined).join('\n');
  const html = layout({
    preheader: post.excerpt || post.title,
    body,
    unsubscribeUrl,
    footerNote: 'You’re receiving Axiom updates because you opted in to them.',
  });
  return { subject, html, text };
}

// ─── Weekly summary (opt-in, You › Notifications › Weekly summary email) ─────

export interface WeeklySummaryInput {
  name: string | null | undefined;
  sessions: number;
  avgProtein: number | null;
  bwDelta: number | null;
  unit: string;
  streak: number;
}

export function weeklySummaryEmail(w: WeeklySummaryInput): { subject: string; html: string; text: string } {
  const first = (w.name || '').trim().split(/\s+/)[0] || '';
  const subject = first ? `Your week in review, ${first}` : 'Your week in review';
  const rows: Array<[string, string]> = [['Workouts logged', String(w.sessions)]];
  if (w.avgProtein != null) rows.push(['Average protein', `${w.avgProtein} g`]);
  if (w.bwDelta != null) rows.push(['Body weight', `${w.bwDelta >= 0 ? '+' : ''}${w.bwDelta} ${w.unit}`]);
  if (w.streak > 0) rows.push(['Streak', `${w.streak} day${w.streak === 1 ? '' : 's'}`]);
  const table = rows.map(([k, v]) => `<tr><td style="padding:8px 0;color:#52525b;">${escapeHtml(k)}</td><td style="padding:8px 0;text-align:right;font-weight:700;">${escapeHtml(v)}</td></tr>`).join('');
  const body = `
<p style="margin:0 0 14px;font-size:22px;font-weight:700;letter-spacing:-0.01em;">${first ? `${escapeHtml(first)}, here's your week` : "Here's your week"}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;border-top:1px solid #e4e4e7;border-bottom:1px solid #e4e4e7;">${table}</table>
<p style="margin:0 0 18px;">Anakin has the full review waiting in chat, with what to change next week.</p>
<p style="margin:0 0 8px;"><a href="${SITE_URL}" style="display:inline-block;background:#09090b;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px;">Open Axiom</a></p>`;
  const html = layout({
    preheader: rows.map(([k, v]) => `${k}: ${v}`).join(' · '),
    body,
    footerNote: 'You get this because you turned on the weekly summary email. Turn it off in You › Notifications, or tell Anakin.',
  });
  const text = [`${subject}`, '', ...rows.map(([k, v]) => `${k}: ${v}`), '', 'Anakin has the full review waiting in chat.', SITE_URL, '',
    'Turn this email off in You › Notifications, or tell Anakin.', '', POSTAL_ADDRESS].join('\n');
  return { subject, html, text };
}

// ─── Weekly wins (Sunday evening, local time; on by default, one-click off) ──
// A celebration first: a warm opening from their real wins, the wins with the
// numbers, what their food did for them (micronutrients → body, goals, sleep,
// focus), easy top-ups, the week in plain words, and next week's level-ups.

const r1 = (x: number) => Math.round(x * 10) / 10;
const lc = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

/** Two or three warm sentences built from the week's real wins. Pure; exported for tests. */
export function warmOpening(rep: WeekReport, first: string): string {
  const who = first ? `${first}, ` : '';
  const w = rep.wins;
  const weight = w.find((x) => x.kind === 'weight');
  const lead = weight
    ? `${who}look at you go! You're ${lc(weight.title)} — that's what showing up, day after day, looks like.`
    : rep.training.sessions >= 3
      ? `${who}what a week! ${rep.training.sessions} workouts and ${rep.training.sets} sets — that's real momentum.`
      : w[0] ? `${who}nice work this week — ${lc(w[0].title)}.` : `${who}here's your week.`;
  // The wins the lead sentence didn't already say.
  const said = (x: (typeof w)[number]) => (weight ? x === weight : rep.training.sessions >= 3 ? x.kind === 'training' : x === w[0]);
  const extras = w.filter((x) => !said(x)).slice(0, 2).map((x) => lc(x.title));
  const more = extras.length ? ` On top of that: ${extras.join(', and ')}.` : '';
  return `${lead}${more}${w.length ? ' Be proud of this one.' : ''}`;
}

const eyebrow = (t: string, crimson = false) => `<p style="margin:26px 0 10px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:${crimson ? '#A51C30' : '#71717a'};font-weight:700;">${escapeHtml(t)}</p>`;

export function weeklyWinsEmail(rep: WeekReport, opts: { name: string | null | undefined; unsubscribeUrl: string; toKgDisplay: (kg: number) => number }): { subject: string; html: string; text: string } {
  const first = (opts.name || '').trim().split(/\s+/)[0] || '';
  const top = rep.wins[0];
  const subject = top ? `${first ? `${first}, ` : ''}${lc(top.title)}` : `${first ? `${first}, your` : 'Your'} week in numbers`;
  const n = rep.nutrition;
  const { stars, topUps } = microHighlights(n.micros ?? [], rep.goal);
  const opening = warmOpening(rep, first);

  const rows: Array<[string, string]> = [];
  if (rep.training.sessions) rows.push(['Workouts', `${rep.training.sessions} · ${rep.training.sets} sets`]);
  if (rep.body.avgKg != null) rows.push(['Weight (7-day average)', `${r1(opts.toKgDisplay(rep.body.avgKg))} ${rep.unit}${rep.body.changeKg != null ? ` (${rep.body.changeKg < 0 ? '−' : '+'}${r1(Math.abs(opts.toKgDisplay(rep.body.changeKg)))})` : ''}`]);
  else if (rep.body.sinceStartKg != null) rows.push(['Since your first weigh-in', `${rep.body.sinceStartKg < 0 ? '−' : '+'}${r1(Math.abs(opts.toKgDisplay(rep.body.sinceStartKg)))} ${rep.unit}`]);
  if (n.loggedDays) rows.push(['Days of food logged', `${n.loggedDays} of 7`]);
  if (n.avgKcal != null) rows.push(['Calories a day', `${n.avgKcal}${n.kcalTarget ? ` of ${n.kcalTarget}` : ''}`]);
  if (n.avgProtein != null) rows.push(['Protein a day', `${n.avgProtein} g${n.proteinTarget ? ` of ${n.proteinTarget} g` : ''}`]);
  const table = rows.map(([k, v]) => `<tr><td style="padding:9px 0;color:#52525b;">${escapeHtml(k)}</td><td style="padding:9px 0;text-align:right;font-weight:700;">${escapeHtml(v)}</td></tr>`).join('');

  const winsHtml = rep.wins.length ? eyebrow('Your wins this week', true) + rep.wins.slice(0, 5).map((w) => `<p style="margin:0 0 10px;"><span style="color:#A51C30;font-weight:700;">✓</span> <strong>${escapeHtml(w.title)}.</strong> <span style="color:#52525b;">${escapeHtml(w.detail)}</span></p>`).join('') : '';
  const foodHtml = stars.length
    ? eyebrow('What your food did for you') + `<p style="margin:0 0 12px;color:#52525b;">From what you logged this week, you gave your body a lot to work with:</p>` +
      stars.map((m) => `<p style="margin:0 0 12px;"><strong>${escapeHtml(m.label)}</strong> <span style="color:#71717a;">· ${escapeHtml(m.area)} · ${escapeHtml(m.amount)}</span><br/>${escapeHtml(m.line)}</p>`).join('')
    : '';
  const topUpHtml = topUps.length
    ? eyebrow('Easy top-ups for next week') + topUps.map((t) => `<p style="margin:0 0 12px;"><strong>${escapeHtml(t.label)}</strong> <span style="color:#71717a;">· ${escapeHtml(t.area)} · about ${t.pct}% of your target</span><br/>${escapeHtml(t.line)} A little more goes a long way — try ${escapeHtml(t.foods)}.</p>`).join('')
    : '';
  const analysisHtml = rep.analysis.length ? eyebrow('How the week went') + `<p style="margin:0;">${rep.analysis.map(escapeHtml).join(' ')}</p>` : '';
  const focusHtml = rep.focus.length ? eyebrow('Your next level-ups') + rep.focus.map((f) => `<p style="margin:0 0 8px;">→ ${escapeHtml(f)}</p>`).join('') : '';

  const body = `
<p style="margin:0 0 12px;font-size:24px;font-weight:700;letter-spacing:-0.01em;">${top ? escapeHtml(top.title) : "Here's your week"}</p>
<p style="margin:0 0 18px;font-size:16px;line-height:1.55;">${escapeHtml(opening)}</p>
${rows.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 6px;border-top:1px solid #e4e4e7;border-bottom:1px solid #e4e4e7;">${table}</table>` : ''}
${winsHtml}${foodHtml}${topUpHtml}${analysisHtml}${focusHtml}
<p style="margin:26px 0 6px;font-size:16px;">Keep going${first ? `, ${escapeHtml(first)}` : ''} — I'm in your corner.</p>
<p style="margin:0 0 18px;color:#52525b;">— Anakin</p>
<p style="margin:0 0 8px;"><a href="${SITE_URL}" style="display:inline-block;background:#09090b;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px;">Open Axiom</a></p>
<p style="margin:8px 0 0;color:#71717a;font-size:13px;">Want to change anything for next week? Just tell me in the app.</p>`;
  const html = layout({ preheader: opening, body, unsubscribeUrl: opts.unsubscribeUrl, footerNote: 'Your weekly wins from Axiom, every Sunday evening. Nutrient notes are general information, not medical advice.' });
  const text = [
    subject, '', opening, '',
    ...rows.map(([k, v]) => `${k}: ${v}`), '',
    ...(rep.wins.length ? ['YOUR WINS THIS WEEK', ...rep.wins.slice(0, 5).map((w) => `✓ ${w.title}. ${w.detail}`), ''] : []),
    ...(stars.length ? ['WHAT YOUR FOOD DID FOR YOU', ...stars.map((m) => `${m.label} (${m.area}) — ${m.amount}. ${m.line}`), ''] : []),
    ...(topUps.length ? ['EASY TOP-UPS FOR NEXT WEEK', ...topUps.map((t) => `${t.label} (${t.area}, about ${t.pct}% of target) — ${t.line} Try ${t.foods}.`), ''] : []),
    ...(rep.analysis.length ? ['HOW THE WEEK WENT', rep.analysis.join(' '), ''] : []),
    ...(rep.focus.length ? ['YOUR NEXT LEVEL-UPS', ...rep.focus.map((f) => `→ ${f}`), ''] : []),
    `Keep going${first ? `, ${first}` : ''} — I'm in your corner.`, '— Anakin', '', SITE_URL, '', `Stop these emails: ${opts.unsubscribeUrl}`, '', POSTAL_ADDRESS,
  ].join('\n');
  return { subject, html, text };
}
