// HTML templates for outbound product mail: the one-time welcome and the
// blog/update broadcast. Plain inline-styled HTML (no framework) so it renders
// the same in Gmail, Apple Mail and Outlook.
function escapeHtml(input: string): string {
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
  Axiom &middot; <a href="${SITE_URL}" style="color:#71717a;">axiomtraining.io</a> &middot; <a href="mailto:${SUPPORT_EMAIL}" style="color:#71717a;">${SUPPORT_EMAIL}</a>
</td></tr>
</table>
</td></tr></table></body></html>`;
}

// ─── Welcome ────────────────────────────────────────────────────────────────

export interface WelcomeEmail { subject: string; html: string; text: string }

export function welcomeEmail(name: string | null | undefined, unsubscribeUrl?: string): WelcomeEmail {
  const first = (name || '').trim().split(/\s+/)[0] || '';
  const hi = first ? `Hi ${escapeHtml(first)},` : 'Hi there,';
  const subject = first ? `Welcome to Axiom, ${first}` : 'Welcome to Axiom';

  const body = `
<p style="margin:0 0 14px;font-size:22px;font-weight:700;letter-spacing:-0.01em;">${hi} welcome to Axiom 👋</p>
<p style="margin:0 0 14px;">Really glad you're here. Axiom is an AI strength coach that figures out <em>why</em> a lift is stuck and writes a program that keeps adjusting as you train — built on your own numbers, not a template.</p>

<p style="margin:22px 0 8px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#71717a;">What members use most</p>
<ul style="margin:0 0 14px;padding-left:20px;">
  <li style="margin:0 0 8px;"><strong>Anakin, your coach.</strong> Ask anything — swap an exercise, plan around an injury, or get a straight answer on your programming. It knows your logs.</li>
  <li style="margin:0 0 8px;"><strong>Adaptive progression.</strong> When your logs say a lift is ready to move, Axiom proposes the change, explains the reasoning, and asks before applying it.</li>
  <li style="margin:0 0 8px;"><strong>Form check.</strong> Film a set and get a frame-by-frame breakdown with reference stills of what to fix.</li>
  <li style="margin:0 0 8px;"><strong>Nutrition that talks to your training.</strong> Log meals by photo or voice, and see how your eating lines up with your energy, recovery and goals.</li>
  <li style="margin:0 0 8px;"><strong>Train together.</strong> Add friends, share workout cards, and keep each other honest.</li>
</ul>

<p style="margin:22px 0 8px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#71717a;">Same person. Different data.</p>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f4f4f5;border-radius:12px;margin:0 0 14px;">
<tr><td style="padding:16px 18px;">
  <p style="margin:0 0 10px;">Alex, an Axiom member, ran the program for <strong>8 weeks, 5 sessions a week</strong>, with every set logged across 9 lifts:</p>
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="font-size:14px;">
    <tr><td style="padding:4px 0;">Hip thrust</td><td style="padding:4px 0;color:#52525b;">95 lb × 12 → 195 lb × 12</td><td align="right" style="padding:4px 0;font-weight:700;color:#047857;">+105% e1RM</td></tr>
    <tr><td style="padding:4px 0;">Cable crunch</td><td style="padding:4px 0;color:#52525b;">35 lb × 12 → 65 lb × 15</td><td align="right" style="padding:4px 0;font-weight:700;color:#047857;">+99%</td></tr>
    <tr><td style="padding:4px 0;">Incline bench</td><td style="padding:4px 0;color:#52525b;">32 lb × 12 → 62 lb × 12</td><td align="right" style="padding:4px 0;font-weight:700;color:#047857;">+94%</td></tr>
  </table>
  <p style="margin:12px 0 0;font-size:14px;color:#3f3f46;font-style:italic;">“Axiom has helped me get out of my comfort zone to perform exercises suited for my needs and body goals… I was able to quickly see results.” — Alex H.</p>
</td></tr></table>

<p style="margin:22px 0 8px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#71717a;">What makes Axiom different</p>
<p style="margin:0 0 14px;">Most apps hand you a template and a timer. Axiom starts with a diagnostic, builds the program from your working weights, and every change it makes comes with the reasoning — and your say-so. Training and nutrition live in one place, so the coach sees the whole picture.</p>

<p style="margin:22px 0 8px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#71717a;">Where to start</p>
<ol style="margin:0 0 18px;padding-left:20px;">
  <li style="margin:0 0 6px;"><strong>Finish your coach intake</strong> — about five minutes. The more honest it is, the better the program.</li>
  <li style="margin:0 0 6px;"><strong>Log your first session.</strong> Everything Axiom does gets sharper with each set you log.</li>
  <li style="margin:0 0 6px;"><strong>Snap a meal.</strong> One photo is enough to start your nutrition profile.</li>
</ol>
<p style="margin:0 0 22px;">${button(APP_STORE_URL, 'Open Axiom')}&nbsp;&nbsp;<a href="${SITE_URL}/coach" style="color:#09090b;font-weight:600;">or continue on the web →</a></p>

<p style="margin:0 0 6px;">Questions, feedback, something not working? Just reply to this email — a real person reads every one.</p>
<p style="margin:0;color:#3f3f46;">— The Axiom team</p>`;

  const text = [
    `${first ? `Hi ${first},` : 'Hi there,'} welcome to Axiom!`,
    '',
    "Axiom is an AI strength coach that figures out why a lift is stuck and writes a program that keeps adjusting as you train — built on your own numbers, not a template.",
    '',
    'What members use most:',
    '- Anakin, your coach: ask anything, it knows your logs.',
    '- Adaptive progression: proposes changes with reasoning, asks before applying.',
    '- Form check: film a set, get a frame-by-frame breakdown.',
    '- Nutrition that talks to your training: log meals by photo or voice.',
    '- Train together: friends, shared workout cards.',
    '',
    'Same person, different data — Alex, an Axiom member, 8 weeks, 5 sessions/week, 9 lifts tracked:',
    '  Hip thrust 95 lb x 12 -> 195 lb x 12 (+105% e1RM)',
    '  Cable crunch 35 lb x 12 -> 65 lb x 15 (+99%)',
    '  Incline bench 32 lb x 12 -> 62 lb x 12 (+94%)',
    '"Axiom has helped me get out of my comfort zone to perform exercises suited for my needs and body goals... I was able to quickly see results." — Alex H.',
    '',
    'What makes Axiom different: it starts with a diagnostic, builds the program from your working weights, and every change comes with the reasoning and your say-so. Training and nutrition in one place.',
    '',
    'Where to start:',
    '1. Finish your coach intake (about five minutes).',
    '2. Log your first session.',
    '3. Snap a meal.',
    `Open Axiom: ${APP_STORE_URL}  |  Web: ${SITE_URL}/coach`,
    '',
    'Questions? Just reply to this email — a real person reads every one.',
    '— The Axiom team',
  ].join('\n');

  const html = layout({
    preheader: 'Here’s how to get the most out of Axiom in your first week.',
    body,
    unsubscribeUrl,
    footerNote: 'You’re receiving this because you just created an Axiom account.',
  });
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
  ].filter(l => l !== undefined).join('\n');
  const html = layout({
    preheader: post.excerpt || post.title,
    body,
    unsubscribeUrl,
    footerNote: 'You’re receiving Axiom updates because you have an Axiom account.',
  });
  return { subject, html, text };
}
