// The moment bus: no imports, so the api client can hand moments over without
// an import cycle (store.ts re-exports these).

type Moment = { id: string } & Record<string, any>;
type Listener = (m: any) => void;
const listeners = new Set<Listener>();
const seen = new Map<string, Moment>();
let claims = 0;
let lastArrived: Moment | null = null;

/** A log response carried a moment: remember it and tell the presenter (unless a screen claimed moments). */
export function momentArrived(m: Moment | null | undefined) {
  if (!m?.id) return;
  seen.set(m.id, m);
  lastArrived = m;
  if (claims > 0) return;
  listeners.forEach((l) => l(m));
}

export function onMoment(l: Listener) { listeners.add(l); return () => { listeners.delete(l); }; }

/** While a screen shows moments itself (the session Done screen), the presenter stays quiet. Returns the release. */
export function claimMoments() { claims++; let done = false; return () => { if (!done) { done = true; claims--; } }; }

/** The last moment that arrived. */
export const lastMoment = () => lastArrived as any;
export const peek = (id: string) => (seen.get(id) as any) ?? null;

/** Pull a moment off any log response and hand it on; returns the response untouched. */
export function withMoment<T>(res: T): T {
  try { momentArrived((res as any)?.moment); } catch { /* never block a log */ }
  return res;
}
