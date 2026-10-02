// React Native binding for the shared personal-training client. apiFetch
// already attaches the Bearer token, applies the request deadline and throws
// an Error carrying `status`; this only re-types that error for the views.

import { fetch as expoFetch } from 'expo/fetch';
import { createApi, createEventParser, PersonalTrainingApiError, type Fetcher } from '@axiom/personal-training-core';
import { API_BASE, apiFetch, getToken } from '../../lib/api';

const fetcher: Fetcher = async (path, init) => {
  try {
    // silent404: "not enabled for this account" is an expected answer, not a console error.
    // X-PT-Caps tells the API this build can draw the "Not joined" status.
    return await apiFetch(path, { ...init, headers: { 'X-PT-Caps': 'not-joined' }, silent404: true } as any);
  } catch (err: any) {
    throw new PersonalTrainingApiError(err?.message ?? 'Request failed', typeof err?.status === 'number' ? err.status : 0);
  }
};

export const ptApi = createApi(fetcher);

/**
 * Read a streamed endpoint. RN's global fetch cannot expose a readable body,
 * so this uses expo/fetch and parses the same `data:` frames as the web.
 */
export async function streamEvents<T>(
  path: string,
  init: { method?: string; body?: string; signal?: AbortSignal },
  onEvent: (event: T) => void,
): Promise<void> {
  const token = await getToken();
  const res = await expoFetch(`${API_BASE}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Accept: 'text/event-stream',
      'X-PT-Caps': 'not-joined',
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: init.body,
    signal: init.signal,
  });
  if (!res.ok || !res.body) {
    let body: any = null;
    try { body = await res.json(); } catch { /* keep the status */ }
    throw new PersonalTrainingApiError(body?.error ?? `HTTP ${res.status}`, res.status, body?.code ?? null);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const feed = createEventParser<T>(onEvent);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      feed(decoder.decode(value, { stream: true }));
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
}
