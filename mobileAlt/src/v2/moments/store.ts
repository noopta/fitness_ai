// Progress moments on the phone (spec "Progress Moments", 19 Oct 2026).
//
// Every log that earns a moment returns it inline (POST /workouts, /nutrition/
// meals, /coach/body-weight). The api wrappers hand it to `momentArrived`; the
// presenter in the v2 shell shows the prompt sheet — unless a screen has
// claimed moments because it shows them itself (the session Done screen).
// Chat moments arrive on cards instead and render inline.

import { apiFetch } from '../../lib/api';
import { peek } from './bus';
import type { ProgressMoment } from '@axiom/agent-ui-core';

const cache = new Map<string, ProgressMoment>();
// The bus lives in its own import-free module so src/lib/api.ts can feed it without a cycle.
export { momentArrived, onMoment, claimMoments, lastMoment, withMoment } from './bus';

export function cachedMoment(id: string) { return cache.get(id) ?? peek(id); }
export function rememberMoment(m: ProgressMoment) { cache.set(m.id, m); }

export const momentsApi = {
  get: async (id: string): Promise<ProgressMoment> => { const m = await apiFetch(`/moments/${id}`); cache.set(m.id, m); return m; },
  shared: (id: string) => apiFetch(`/moments/${id}/shared`, { method: 'POST' }).catch(() => {}),
  dismiss: (id: string) => apiFetch(`/moments/${id}/dismiss`, { method: 'POST' }).catch(() => {}),
};
