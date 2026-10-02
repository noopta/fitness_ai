// Web binding for the shared personal-training client: authFetch carries the
// cookie plus the Bearer fallback, and failures become typed errors so views
// can tell "not enabled" and "no practice" from a real outage.

import { createApi, createEventParser, PersonalTrainingApiError, type Fetcher } from '@axiom/personal-training-core';
import { authFetch } from '@/lib/api';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

/**
 * Tells the API this client can draw the "Not joined" status. A query
 * parameter rather than a header, so it needs no CORS allowance.
 */
const withCaps = (path: string) => `${path}${path.includes('?') ? '&' : '?'}caps=not-joined`;

const fetcher: Fetcher = async (path, init) => {
  const res = await authFetch(`${API_BASE}${withCaps(path)}`, init);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new PersonalTrainingApiError(body?.error ?? res.statusText, res.status, body?.code ?? null);
  }
  return res.json();
};

export const ptApi = createApi(fetcher);

/**
 * Read a streamed endpoint. EventSource cannot carry the Bearer fallback, so
 * this reads the fetch body and parses the same `data:` frames by hand.
 */
export async function streamEvents<T>(
  path: string,
  init: { method?: string; body?: string; signal?: AbortSignal },
  onEvent: (event: T) => void,
): Promise<void> {
  const res = await authFetch(`${API_BASE}${withCaps(path)}`, init);
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => null);
    throw new PersonalTrainingApiError(body?.error ?? res.statusText, res.status, body?.code ?? null);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const feed = createEventParser<T>(onEvent);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    feed(decoder.decode(value, { stream: true }));
  }
}
