// Where a card's `Open →` (and `open_page`) goes. Server routes are
// { page, params }; most are a pushed page `kind:arg`, a few are the shell's
// tabs, the rest are classic screens that haven't moved to the new shell.

import type { CardRoute } from '@axiom/agent-ui-core';

export type Destination =
  | { kind: 'tab'; index: number }
  | { kind: 'push'; pathname: string; params?: Record<string, string> };

const TABS: Record<string, number> = { home: 0, anakin: 0, training: 1, fuel: 2, feed: 3, you: 4 };

// Pushed page kinds and the param that becomes their `:arg`.
const PUSHED: Record<string, string | null> = {
  phase: 'i', day: 'date', past: null, pastprogram: 'id', diag: null, systems: null, sys: 'id', micros: null, mic: 'key',
  meal: 'id', strength: null, ratios: null, lift: 'name', body: null, streak: null, memory: null, billing: null, prefs: null,
  groups: null, leaderboard: null, together: 'id', person: 'id',
  // New pages for chat Open → targets (spec §10).
  profile: null, notifications: null, recipes: null, savedfoods: null, plan: null,
  // The nutrition plan page and its sources (bug fixes 5 Oct, 2b).
  fuelplan: null, plansources: null,
};
const ALIAS: Record<string, string> = { traintogether: 'together', account: 'prefs', usage: 'plan', saved_foods: 'savedfoods', history: 'past', gut: 'systems' };

export function destinationFor(route: CardRoute): Destination | null {
  const page = ALIAS[route.page] ?? route.page;
  const p = route.params ?? {};
  if (page in TABS) return { kind: 'tab', index: TABS[page] };
  if (page === 'session') return { kind: 'push', pathname: '/(v2)/session' };
  if (page in PUSHED) {
    const argKey = PUSHED[page];
    const arg = argKey ? p[argKey] : undefined;
    return { kind: 'push', pathname: '/(v2)/p/[key]', params: { ...p, key: arg ? `${page}:${arg}` : page } };
  }
  // Classic screens.
  switch (page) {
    case 'conversation': return { kind: 'push', pathname: '/social/conversation', params: p };
    case 'messages': return { kind: 'push', pathname: '/social/messages' };
    case 'report': return { kind: 'push', pathname: '/diagnostic/report', params: { sessionId: p.id ?? p.sessionId ?? '' } };
    // The lift diagnostic is a hand-off to its own conversational screen.
    case 'diagnostic': return { kind: 'push', pathname: '/diagnostic/conversation', params: p.id ? { sessionId: p.id } : {} };
    case 'form': return { kind: 'push', pathname: '/form-analysis', params: p.id ? { id: p.id } : {} };
    default: return null;
  }
}
