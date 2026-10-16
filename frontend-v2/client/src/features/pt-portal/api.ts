// Web binding for the no-install client portal. The secret link is the only
// credential: every call carries `Authorization: PtLink <token>` and never the
// Axiom session cookie, so it works for someone with no account and cannot
// leak a signed-in trainer's session into a client's page.

import { createPortalApi, createPortalApiExtra, PersonalTrainingApiError, type Fetcher, type PortalApi } from '@axiom/personal-training-core';

/** Everything the portal calls: the base routes plus intake, meals and the trainer's program. */
export type FullPortalApi = PortalApi & ReturnType<typeof createPortalApiExtra>;

export const API_BASE: string = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

/** The link was never valid, or the trainer revoked it. */
export function isInactiveLinkError(err: unknown): boolean {
  return err instanceof PersonalTrainingApiError && (err.code === 'link_inactive' || err.code === 'no_link');
}

/** The server has no photo storage configured. */
export function isPhotosUnavailable(err: unknown): boolean {
  return err instanceof PersonalTrainingApiError && err.status === 503;
}

export function errorMessage(err: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (err instanceof PersonalTrainingApiError && err.status < 500 && err.message) return err.message;
  return fallback;
}

export function makePortalFetcher(
  token: string,
  opts: { base?: string; fetchImpl?: typeof fetch; onInactive?: () => void } = {},
): Fetcher {
  const base = opts.base ?? API_BASE;
  return async (path, init) => {
    const doFetch = opts.fetchImpl ?? fetch;
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method: init?.method ?? 'GET',
        body: init?.body,
        credentials: 'omit',
        headers: {
          Authorization: `PtLink ${token}`,
          ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
      });
    } catch {
      throw new PersonalTrainingApiError('You seem to be offline. Check your connection and try again.', 0, 'network');
    }
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const err = new PersonalTrainingApiError(body?.error ?? res.statusText, res.status, body?.code ?? null);
      if (isInactiveLinkError(err)) opts.onInactive?.();
      throw err;
    }
    return res.json();
  };
}

export function createPortalClient(token: string, opts?: Parameters<typeof makePortalFetcher>[1]): FullPortalApi {
  const fetcher = makePortalFetcher(token, opts);
  return { ...createPortalApi(fetcher), ...createPortalApiExtra(fetcher) };
}
