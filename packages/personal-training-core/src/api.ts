// Typed client for /api/personal-training. Each platform injects its own
// authenticated fetcher (web: authFetch + cookie/Bearer, mobile: apiFetch), so
// this file has no DOM or React Native imports.

import type {
  Client, InvitePreview, InviteResponse, MeResponse, Practice, RosterResponse, TimelineKind, TimelinePage,
} from './types';

export const API_PREFIX = '/personal-training';

/** Carries the HTTP status so views can tell "not enabled" (404) and "no practice" (409) from a real failure. */
export class PersonalTrainingApiError extends Error {
  status: number;
  code: string | null;
  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = 'PersonalTrainingApiError';
    this.status = status;
    this.code = code;
  }
}

/** Resolves with parsed JSON, or throws PersonalTrainingApiError. `path` is relative to the API base. */
export type Fetcher = (path: string, init?: { method?: string; body?: string }) => Promise<unknown>;

export const queryKeys = {
  me: ['personal-training', 'me'] as const,
  roster: ['personal-training', 'clients'] as const,
  client: (id: string) => ['personal-training', 'clients', id] as const,
  timeline: (id: string, kinds: TimelineKind[]) =>
    ['personal-training', 'clients', id, 'timeline', [...kinds].sort().join(',')] as const,
  invite: (token: string) => ['personal-training', 'invites', token] as const,
};

export function timelinePath(clientId: string, kinds: TimelineKind[], cursor?: string | null): string {
  const params: string[] = [];
  if (kinds.length) params.push(`kind=${encodeURIComponent(kinds.join(','))}`);
  if (cursor) params.push(`cursor=${encodeURIComponent(cursor)}`);
  const qs = params.length ? `?${params.join('&')}` : '';
  return `${API_PREFIX}/clients/${encodeURIComponent(clientId)}/timeline${qs}`;
}

export function createApi(fetcher: Fetcher) {
  return {
    me: () => fetcher(`${API_PREFIX}/me`) as Promise<MeResponse>,
    createPractice: (name: string) =>
      fetcher(`${API_PREFIX}/practice`, { method: 'POST', body: JSON.stringify({ name }) }) as Promise<{ practice: Practice }>,
    roster: () => fetcher(`${API_PREFIX}/clients`) as Promise<RosterResponse>,
    client: (id: string) =>
      fetcher(`${API_PREFIX}/clients/${encodeURIComponent(id)}`) as Promise<{ client: Client }>,
    timeline: (id: string, kinds: TimelineKind[], cursor?: string | null) =>
      fetcher(timelinePath(id, kinds, cursor)) as Promise<TimelinePage>,
    invite: (email?: string) =>
      fetcher(`${API_PREFIX}/clients/invite`, {
        method: 'POST',
        body: JSON.stringify({ mode: 'app', ...(email ? { email } : {}) }),
      }) as Promise<InviteResponse>,
    invitePreview: (token: string) =>
      fetcher(`${API_PREFIX}/invites/${encodeURIComponent(token)}`) as Promise<InvitePreview>,
    acceptInvite: (token: string) =>
      fetcher(`${API_PREFIX}/invites/${encodeURIComponent(token)}/accept`, { method: 'POST' }) as Promise<{ practice: Practice }>,
  };
}

export type PersonalTrainingApi = ReturnType<typeof createApi>;
