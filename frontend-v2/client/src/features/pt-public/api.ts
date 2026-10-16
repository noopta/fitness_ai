// Web binding for a practice's public page. Anonymous: plain fetch, no
// cookies, no Authorization header — nothing here may carry an Axiom session.

import { createPublicApi, PersonalTrainingApiError, type Fetcher } from '@axiom/personal-training-core';

export const API_BASE: string = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

export function makePublicFetcher(opts: { base?: string; fetchImpl?: typeof fetch } = {}): Fetcher {
  const base = opts.base ?? API_BASE;
  return async (path, init) => {
    const doFetch = opts.fetchImpl ?? fetch;
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method: init?.method ?? 'GET',
        body: init?.body,
        credentials: 'omit',
        headers: init?.body !== undefined ? { 'Content-Type': 'application/json' } : {},
      });
    } catch {
      throw new PersonalTrainingApiError('You seem to be offline. Check your connection and try again.', 0, 'network');
    }
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new PersonalTrainingApiError(body?.error ?? res.statusText, res.status, body?.code ?? null);
    }
    return res.json();
  };
}

export const publicApi = createPublicApi(makePublicFetcher());
