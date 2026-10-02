// Web binding for the shared personal-training client: authFetch carries the
// cookie plus the Bearer fallback, and failures become typed errors so views
// can tell "not enabled" and "no practice" from a real outage.

import { createApi, PersonalTrainingApiError, type Fetcher } from '@axiom/personal-training-core';
import { authFetch } from '@/lib/api';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

const fetcher: Fetcher = async (path, init) => {
  const res = await authFetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new PersonalTrainingApiError(body?.error ?? res.statusText, res.status, body?.code ?? null);
  }
  return res.json();
};

export const ptApi = createApi(fetcher);
