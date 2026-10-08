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
  // Feed pages (bug fixes 5 Oct, 3b–3d): Messages, a thread, Search, Saved, a post.
  messages: null, thread: 'id', feedsearch: null, saved: null, post: 'id',
  // Logged workouts, newest first (chat's history cards open this, not Past programs).
  workouts: null,
  // Account (handoff A-01, A-03).
  account: null, deleteaccount: null,
  // Wellness check-in (H-04).
  checkin: null,
  // Wave 2: Today, an exercise, the whole program, a new program's review, freestyle, suggestions.
  today: null, exercise: 'name', program: null, programreview: 'id', freestyle: null, suggestions: null, patterns: null,
  // Wave 3: Library, a recipe, set my target, the nutrition profile.
  library: null, recipe: 'id', targets: null, nutrition: null,
};
const ALIAS: Record<string, string> = { conversation: 'thread', search: 'feedsearch', traintogether: 'together',  usage: 'plan', saved_foods: 'savedfoods', history: 'workouts', workout_history: 'workouts', gut: 'systems' };

export function destinationFor(route: CardRoute): Destination | null {
  const page = ALIAS[route.page] ?? route.page;
  const p = route.params ?? {};
  if (page in TABS) return { kind: 'tab', index: TABS[page] };
  if (page === 'session') return { kind: 'push', pathname: '/(v2)/session' };
  // Search-first food logging (bug fixes 5 Oct, 4a); `from: chat` sends the Logged card back here.
  if (page === 'foodsearch' || page === 'log_food') return { kind: 'push', pathname: '/(v2)/food-search', params: p };
  if (page in PUSHED) {
    const argKey = PUSHED[page];
    const arg = argKey ? p[argKey] : undefined;
    return { kind: 'push', pathname: '/(v2)/p/[key]', params: { ...p, key: arg ? `${page}:${arg}` : page } };
  }
  // Classic screens.
  switch (page) {
    case 'report': return { kind: 'push', pathname: '/diagnostic/report', params: { sessionId: p.id ?? p.sessionId ?? '' } };
    // The lift diagnostic is a hand-off to its own conversational screen.
    case 'diagnostic': return { kind: 'push', pathname: '/diagnostic/conversation', params: p.id ? { sessionId: p.id } : {} };
    case 'form': return { kind: 'push', pathname: '/form-analysis', params: p.id ? { id: p.id } : {} };
    default: return null;
  }
}
