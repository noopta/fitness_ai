// Product events for the v2 app (Oct 2026). PostHog is a third party: ids,
// counts, timings and short labels only — never what someone wrote or ate, and
// analytics never breaks a screen. Most events are sent by the server, which is
// more reliable and needs no update; these are the ones only the app can see.

import { posthog } from '../lib/analytics';

type Value = string | number | boolean | null | undefined;

export function track(event: string, props: Record<string, Value> = {}): void {
  try {
    const clean: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(props)) {
      if (v == null) continue;
      if (typeof v === 'string' ? /^[\w.:\-]{1,48}$/.test(v) : typeof v === 'boolean' || Number.isFinite(v)) clean[k] = v;
    }
    posthog.capture(event, clean);
  } catch { /* analytics never breaks a screen */ }
}
