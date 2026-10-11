// Polite fetching for chain nutrition pages — the rules we committed to:
//   - honour robots.txt (our UA and *), longest-match Allow/Disallow
//   - an honest user agent with a contact
//   - at most one request every 2 s per host
//   - any block (401/403/429, captcha/bot page) stops that chain: no retries,
//     no header games, no proxies. Blocked = skipped.
// Every fetch is logged (url, status, bytes, time) to .runtime/chain-fetch.jsonl.

import fs from 'node:fs';
import path from 'node:path';

export const UA = 'AxiomNutritionBot/1.0 (+https://axiomtraining.io; nutrition facts only; support@axiomtraining.io)';
const BOT_NAME = 'axiomnutritionbot';
const GAP_MS = 2000;
const lastHit = new Map();
const robotsCache = new Map();

export class BlockedError extends Error { constructor(url, why) { super(`blocked: ${why} — ${url}`); this.url = url; this.why = why; } }

const log = (row) => {
  const f = path.join(process.cwd(), '.runtime', 'chain-fetch.jsonl');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.appendFileSync(f, `${JSON.stringify({ at: new Date().toISOString(), ...row })}\n`);
};

async function pace(host) {
  const wait = (lastHit.get(host) ?? 0) + GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastHit.set(host, Date.now());
}

/** Parse robots.txt into the rule list that applies to us (our group, else *). Pure; exported for tests. */
export function robotsRules(text) {
  const groups = []; let cur = null; let lastWasAgent = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i); if (!m) continue;
    const key = m[1].toLowerCase(); const val = m[2].trim();
    if (key === 'user-agent') { if (!lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(val.toLowerCase()); lastWasAgent = true; continue; }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === 'allow' || key === 'disallow') cur.rules.push({ allow: key === 'allow', path: val });
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && BOT_NAME.includes(a)));
  const star = groups.filter((g) => g.agents.includes('*'));
  return (mine.length ? mine : star).flatMap((g) => g.rules);
}

/** Longest-match allow/disallow (Google semantics, * and $ supported). Pure; exported for tests. */
export function robotsAllows(rules, pathname) {
  let best = null;
  for (const r of rules) {
    if (!r.path) continue; // "Disallow:" empty = allow all
    const re = new RegExp('^' + r.path.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
    if (re.test(pathname) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return !best || best.allow;
}

export async function allowedByRobots(url) {
  const u = new URL(url);
  if (!robotsCache.has(u.host)) {
    let rules = [];
    try {
      await pace(u.host);
      const r = await fetch(`${u.protocol}//${u.host}/robots.txt`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
      log({ url: `${u.protocol}//${u.host}/robots.txt`, status: r.status });
      if (r.status >= 500) rules = [{ allow: false, path: '/' }]; // server error: treat as disallow
      else if (r.ok) rules = robotsRules(await r.text());
      // 4xx: no robots file → allowed
    } catch { rules = [{ allow: false, path: '/' }]; }
    robotsCache.set(u.host, rules);
  }
  return robotsAllows(robotsCache.get(u.host), u.pathname + u.search);
}

/** Fetch one URL politely. Returns { buf, type, finalUrl } or throws BlockedError. */
export async function politeFetch(url) {
  if (!(await allowedByRobots(url))) { log({ url, skipped: 'robots' }); throw new BlockedError(url, 'robots.txt disallows'); }
  const u = new URL(url);
  await pace(u.host);
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/pdf,application/json,text/html;q=0.9,*/*;q=0.5' }, redirect: 'follow', signal: AbortSignal.timeout(45000) });
  const buf = Buffer.from(await r.arrayBuffer());
  const type = r.headers.get('content-type') ?? '';
  log({ url, status: r.status, bytes: buf.length, type });
  if ([401, 403, 429].includes(r.status)) throw new BlockedError(url, `HTTP ${r.status}`);
  if (!r.ok) throw new Error(`HTTP ${r.status} — ${url}`);
  // A real bot wall is a short page whose title/body is the challenge — not any page that mentions a CDN.
  const head = buf.subarray(0, 6000).toString();
  if (/text\/html/.test(type) && (/<title>[^<]*(access denied|attention required|just a moment|are you a robot|captcha)[^<]*<\/title>/i.test(head) || (buf.length < 8000 && /(captcha|verify you are human|cf-chl-|request unsuccessful\. incapsula)/i.test(head)))) throw new BlockedError(url, 'bot check page');
  return { buf, type, finalUrl: r.url };
}
