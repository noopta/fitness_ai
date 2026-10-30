// Product analytics for the core features (Oct 2026). Before this PostHog saw
// a workout count and little else, so "are people leaving Fuel?" had no answer.
//
// PostHog is a third party (privacy audit, Oct 2026): events carry ids, counts,
// timings and short labels only — never what someone wrote or ate. `clean`
// enforces that, so a careless call site can't leak it.

import posthog from './posthogClient.js';

const BLOCKED_KEY = /name|text|message|email|description|brand|product|food|meal_title|note|query|content|prompt/i;
const LABEL = /^[\w.:\-]{1,48}$/;

type Value = string | number | boolean | null | undefined | string[];

/** Pure: only numbers, booleans and short labels, under keys that don't name content. */
export function cleanProps(props: Record<string, Value>): Record<string, string | number | boolean | string[]> {
  const out: Record<string, string | number | boolean | string[]> = {};
  for (const [k, v] of Object.entries(props)) {
    if (BLOCKED_KEY.test(k) || v == null) continue;
    if (typeof v === 'number') { if (Number.isFinite(v)) out[k] = v; }
    else if (typeof v === 'boolean') out[k] = v;
    else if (Array.isArray(v)) { const list = v.filter((x) => typeof x === 'string' && LABEL.test(x)).slice(0, 20); if (list.length) out[k] = list; }
    else if (LABEL.test(v)) out[k] = v;
  }
  return out;
}

/** Never throws, never blocks: analytics can't break a request. */
export function track(userId: string | null | undefined, event: string, props: Record<string, Value> = {}): void {
  if (!userId) return;
  try { posthog.capture({ distinctId: userId, event, properties: cleanProps(props) }); } catch { /* analytics never breaks a request */ }
}
