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

/** A typed error that keeps the parsed body, so a 409 can carry the rules engine's `check`. */
export type ApiErrorWithBody = PersonalTrainingApiError & { body?: Record<string, unknown> | null };

const fetcher: Fetcher = async (path, init) => {
  const res = await authFetch(`${API_BASE}${withCaps(path)}`, init);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const err: ApiErrorWithBody = new PersonalTrainingApiError(body?.error ?? res.statusText, res.status, body?.code ?? null);
    err.body = body;
    throw err;
  }
  return res.json();
};

export const ptApi = createApi(fetcher);

/**
 * Download an authenticated file (the data export). A plain link cannot carry
 * the Bearer fallback, so this fetches the bytes and saves them as a blob,
 * named by the server's Content-Disposition when it gives one.
 */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const res = await authFetch(`${API_BASE}${path}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new PersonalTrainingApiError(body?.error ?? res.statusText, res.status, body?.code ?? null);
  }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

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
