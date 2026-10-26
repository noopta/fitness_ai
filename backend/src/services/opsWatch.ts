// Ops watchdog (Oct 2026): tell the owner on Telegram when the app is quietly
// degrading, instead of finding out from users.
//
// Why it exists: for a week (Oct 17–24) the pinned LLM hosts answered 429 to
// ~4,300 calls and every Fuel load waited 4–16 s, while nothing errored —
// the OpenAI fallback kept answering, so there was no 5xx and no Sentry issue.
// This watches the symptoms that week produced:
//
//   llm_primary      the OpenRouter primary keeps failing (fallback carrying the load)
//   aborts:<route>   users leaving before a route answers (nginx 499s)
//   slow:<route>     a route that should be quick is slow at p90
//   provider_cover   too few pinned hosts actually serve the primary model
//   event_loop       synchronous work froze the server (every request waits)
//
// Counters live in memory over a 15-minute window; each alert key is sent at
// most once per 6 hours. Long-running routes (agent turns, video, program
// generation…) are expected to be slow and are not watched for latency.

import type { NextFunction, Request, Response } from 'express';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { sendTelegramMessage } from './growth/telegramPublisher.js';

export const WINDOW_MS = 15 * 60_000;
export const REALERT_MS = 6 * 60 * 60_000;
export const SLOW_P90_MS = 5_000;
const MIN_SAMPLES = 8;
const MIN_ABORTS = 3;
const MIN_LLM_FAILS = 10;
/** A single stall this long means every in-flight request waited on it (Oct 2026: 1–3 s from exercise-name fuzzy matching). */
export const EVENT_LOOP_BLOCK_MS = 750;

/** Routes that are long by design: never alerted for latency or client aborts. */
export const LONG_ROUTE = /agent|coach|form-analysis|program|diagnostic|stream|photo|scan|analy[sz]|generate|import|upload|transcri|video|chat|lookup|backfill/i;

type RouteSample = { at: number; ms: number; aborted: boolean };
const routes = new Map<string, RouteSample[]>();
let llm: { at: number; ok: boolean }[] = [];
const lastSent = new Map<string, number>();

function prune<T extends { at: number }>(list: T[], now: number): T[] {
  const from = now - WINDOW_MS;
  let i = 0;
  while (i < list.length && list[i].at < from) i++;
  return i ? list.slice(i) : list;
}

/** Called by chatClient for each call that tried (or skipped) the OpenRouter primary. */
export function recordLlmPrimary(ok: boolean, now = Date.now()) {
  llm = prune(llm, now);
  llm.push({ at: now, ok });
}

export function recordRoute(key: string, ms: number, aborted: boolean, now = Date.now()) {
  if (LONG_ROUTE.test(key)) return;
  const list = prune(routes.get(key) ?? [], now);
  list.push({ at: now, ms, aborted });
  routes.set(key, list);
}

/** Express middleware: time every matched route; a closed-before-finish response is an abort. */
export function opsTiming(req: Request, res: Response, next: NextFunction) {
  const t0 = Date.now();
  let done = false;
  const record = (aborted: boolean) => {
    if (done) return;
    done = true;
    const path = (req.route as { path?: string } | undefined)?.path;
    if (!path || typeof path !== 'string') return; // 404s and static: nothing to watch
    recordRoute(`${req.method} ${path}`, Date.now() - t0, aborted);
  };
  res.on('finish', () => record(false));
  res.on('close', () => record(!res.writableFinished));
  next();
}

export interface OpsAlert { key: string; text: string }

function p90(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.9))] ?? 0;
}

/** Pure: an alert for the worst event-loop stall since the last check, if it was long. */
export function eventLoopAlert(maxBlockMs: number): OpsAlert | null {
  if (maxBlockMs < EVENT_LOOP_BLOCK_MS) return null;
  return { key: 'event_loop', text: `The server froze for ${(maxBlockMs / 1000).toFixed(1)} s on synchronous work: every request in flight waited. Profile the slow route (node --cpu-prof).` };
}

/** Pure: the alerts the current window supports. */
export function evaluate(now = Date.now()): OpsAlert[] {
  const out: OpsAlert[] = [];
  llm = prune(llm, now);
  const fails = llm.filter((x) => !x.ok).length;
  if (fails >= MIN_LLM_FAILS && fails / llm.length >= 0.5) {
    out.push({ key: 'llm_primary', text: `LLM primary failing: ${fails}/${llm.length} OpenRouter calls in 15 min fell back to OpenAI (rate limits or no providers). Responses are slower; check the pinned host list.` });
  }
  for (const [key, raw] of routes) {
    const list = prune(raw, now);
    routes.set(key, list);
    const aborts = list.filter((x) => x.aborted).length;
    if (aborts >= MIN_ABORTS) out.push({ key: `aborts:${key}`, text: `Users are leaving before ${key} answers: ${aborts} aborted requests in 15 min.` });
    const done = list.filter((x) => !x.aborted).map((x) => x.ms);
    if (done.length >= MIN_SAMPLES) {
      const slow = p90(done);
      if (slow > SLOW_P90_MS) out.push({ key: `slow:${key}`, text: `${key} is slow: p90 ${(slow / 1000).toFixed(1)} s over ${done.length} requests in 15 min.` });
    }
  }
  return out;
}

/** Pure: which alerts are due (not sent in the last REALERT_MS); marks them sent. */
export function due(alerts: OpsAlert[], now = Date.now()): OpsAlert[] {
  return alerts.filter((a) => {
    const last = lastSent.get(a.key) ?? 0;
    if (now - last < REALERT_MS) return false;
    lastSent.set(a.key, now);
    return true;
  });
}

/** Pure: how many of the pinned provider slugs serve the model, from OpenRouter's endpoints listing. */
export function servingProviders(pinned: string[], endpoints: { tag?: string; provider_name?: string }[]): string[] {
  const serving = new Set(endpoints.map((e) => String(e.tag ?? e.provider_name ?? '').split('/')[0].toLowerCase()).filter(Boolean));
  return pinned.filter((p) => serving.has(p.toLowerCase()));
}

async function checkProviderCoverage(): Promise<OpsAlert | null> {
  const { PRIMARY_CHAT_MODEL, OPENROUTER_PROVIDERS } = await import('./chatClient.js');
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch(`https://openrouter.ai/api/v1/models/${PRIMARY_CHAT_MODEL}/endpoints`, { headers: { Authorization: `Bearer ${key}` } });
    if (!r.ok) return null;
    const body = await r.json() as { data?: { endpoints?: { tag?: string; provider_name?: string }[] } };
    const ok = servingProviders(OPENROUTER_PROVIDERS, body.data?.endpoints ?? []);
    if (ok.length >= 2) return null;
    return { key: 'provider_cover', text: `Only ${ok.length} of the pinned OpenRouter hosts (${OPENROUTER_PROVIDERS.join(', ')}) serve ${PRIMARY_CHAT_MODEL}${ok.length ? ` (${ok.join(', ')})` : ''}. One host rate-limiting means every call falls back to OpenAI.` };
  } catch {
    return null;
  }
}

async function send(alerts: OpsAlert[]) {
  for (const a of alerts) {
    console.warn(`[ops-watch] ${a.key}: ${a.text}`);
    const r = await sendTelegramMessage(`⚠️ Axiom ops: ${a.text}`).catch((e) => ({ delivered: 0, errors: [String(e)] }));
    if (!r.delivered) console.warn(`[ops-watch] alert not delivered: ${r.errors.join('; ')}`);
  }
}

export function resetOpsWatchForTests() { routes.clear(); llm = []; lastSent.clear(); }

/** Start the 5-minute evaluation and the daily provider check. OPS_ALERTS=0 turns it off. */
export function startOpsWatch() {
  if (process.env.OPS_ALERTS === '0' || process.env.VITEST) return;
  const loop = monitorEventLoopDelay({ resolution: 20 });
  loop.enable();
  setInterval(() => {
    const stall = eventLoopAlert(loop.max / 1e6);
    loop.reset();
    void send(due([...evaluate(), ...(stall ? [stall] : [])]));
  }, 5 * 60_000).unref();
  const daily = async () => { const a = await checkProviderCoverage(); if (a) await send(due([a])); };
  setTimeout(() => { void daily(); }, 60_000).unref();
  setInterval(() => { void daily(); }, 24 * 60 * 60_000).unref();
}
