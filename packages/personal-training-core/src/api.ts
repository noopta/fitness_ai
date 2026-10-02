// Typed client for /api/personal-training. Each platform injects its own
// authenticated fetcher (web: authFetch + cookie/Bearer, mobile: apiFetch), so
// this file has no DOM or React Native imports.

import type {
  AnakinFilter, AnakinMessage, AnakinScope, AnakinThreadSummary, BriefingItem, BriefingResponse, CheckInInbox, CheckInRequest,
  CheckInSchedule, Client, Draft, InvitePreview, InviteResponse, LiftKey, MeResponse, NotificationFeed, NotificationSettings,
  NotificationSettingsPatch, Practice, ProgressResponse, Report, ResolveAction, RosterResponse, ScheduledQuestion, TimelineKind,
  TimelinePage,
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
  briefing: ['personal-training', 'briefing'] as const,
  checkIns: ['personal-training', 'check-ins'] as const,
  schedules: ['personal-training', 'check-in-schedules'] as const,
  checkInRequest: (id: string) => ['personal-training', 'check-in-requests', id] as const,
  progress: (lift: LiftKey, weeks: number) => ['personal-training', 'progress', lift, weeks] as const,
  report: (clientId: string, month: string) => ['personal-training', 'reports', clientId, month] as const,
  anakinThreads: ['personal-training', 'anakin', 'threads'] as const,
  anakinThread: (id: string) => ['personal-training', 'anakin', 'threads', id] as const,
  anakinFilter: (threadId: string, messageId: string) => ['personal-training', 'anakin', 'filter', threadId, messageId] as const,
  notifications: ['personal-training', 'notifications'] as const,
  notificationSettings: ['personal-training', 'notification-settings'] as const,
};

/** Streamed endpoints: the platform opens these itself and feeds chunks to createEventParser. */
export const BRIEFING_STREAM_PATH = `${API_PREFIX}/briefing/today/stream`;
export const anakinMessagePath = (threadId: string | null) => `${API_PREFIX}/anakin/threads/${threadId ? encodeURIComponent(threadId) : 'new'}/messages`;

/**
 * Incremental parser for the `data: {json}\n\n` frames the streamed endpoints
 * send. Feed it text chunks as they arrive; it calls back once per complete
 * event and keeps any partial frame for the next chunk.
 */
export function createEventParser<T>(onEvent: (event: T) => void) {
  let buffer = '';
  return (chunk: string) => {
    buffer += chunk;
    let end: number;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        try { onEvent(JSON.parse(line.slice(6)) as T); } catch { /* a malformed frame is skipped, not fatal */ }
      }
    }
  };
}

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

    briefing: () => fetcher(`${API_PREFIX}/briefing/today`) as Promise<BriefingResponse>,
    resolveItem: (id: string, action: ResolveAction, editedText?: string) =>
      fetcher(`${API_PREFIX}/briefing/items/${id}/resolve`, { method: 'POST', body: JSON.stringify({ action, ...(editedText !== undefined ? { editedText } : {}) }) }) as Promise<{ item: BriefingItem }>,
    undoItem: (id: string) => fetcher(`${API_PREFIX}/briefing/items/${id}/resolve`, { method: 'DELETE' }) as Promise<{ item: BriefingItem }>,

    sendDraft: (id: string, text?: string) =>
      fetcher(`${API_PREFIX}/drafts/${id}/send`, { method: 'POST', body: JSON.stringify(text !== undefined ? { text } : {}) }) as Promise<{ draft: Draft }>,
    undoDraft: (id: string) => fetcher(`${API_PREFIX}/drafts/${id}/send`, { method: 'DELETE' }) as Promise<{ draft: Draft }>,
    redraft: (id: string, text: string) =>
      fetcher(`${API_PREFIX}/drafts/${id}/redraft`, { method: 'POST', body: JSON.stringify({ style: 'shorter', text }) }) as Promise<{ draft: Draft }>,

    checkIns: () => fetcher(`${API_PREFIX}/check-ins`) as Promise<CheckInInbox>,
    requestCheckIns: (clientIds: string[]) =>
      fetcher(`${API_PREFIX}/check-ins/request`, { method: 'POST', body: JSON.stringify({ clientIds }) }) as Promise<{ requested: number }>,
    sendRoutineReplies: () => fetcher(`${API_PREFIX}/check-ins/send-routine`, { method: 'POST' }) as Promise<{ sent: number }>,
    markCheckInRead: (id: string) => fetcher(`${API_PREFIX}/check-ins/${id}/read`, { method: 'POST' }) as Promise<{ ok: true }>,
    schedules: () => fetcher(`${API_PREFIX}/check-in-schedules`) as Promise<{ schedules: CheckInSchedule[] }>,
    saveSchedule: (schedule: Omit<CheckInSchedule, 'id' | 'clientName'>) =>
      fetcher(`${API_PREFIX}/check-in-schedules`, { method: 'PUT', body: JSON.stringify(schedule) }) as Promise<{ schedule: CheckInSchedule }>,
    deleteSchedule: (clientId: string) => fetcher(`${API_PREFIX}/check-in-schedules/${encodeURIComponent(clientId)}`, { method: 'DELETE' }) as Promise<{ ok: true }>,
    checkInRequest: (id: string) => fetcher(`${API_PREFIX}/check-in-requests/${encodeURIComponent(id)}`) as Promise<CheckInRequest>,
    submitCheckIn: (id: string, answers: Record<string, string | number>) =>
      fetcher(`${API_PREFIX}/check-in-requests/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify({ answers }) }) as Promise<{ ok: true }>,

    progress: (lift: LiftKey, weeks: number) => fetcher(`${API_PREFIX}/progress?lift=${lift}&weeks=${weeks}`) as Promise<ProgressResponse>,
    report: (clientId: string, month: string) =>
      fetcher(`${API_PREFIX}/reports?clientId=${encodeURIComponent(clientId)}&month=${month}`) as Promise<{ report: Report }>,
    patchReport: (id: string, patch: Partial<Pick<Report, 'coachNote' | 'narrative' | 'nextLine'>>) =>
      fetcher(`${API_PREFIX}/reports/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }) as Promise<{ report: Report }>,
    sendReport: (id: string) => fetcher(`${API_PREFIX}/reports/${id}/send`, { method: 'POST' }) as Promise<{ report: Report }>,
    undoReport: (id: string) => fetcher(`${API_PREFIX}/reports/${id}/send`, { method: 'DELETE' }) as Promise<{ report: Report }>,

    anakinThreads: () => fetcher(`${API_PREFIX}/anakin/threads`) as Promise<{ threads: AnakinThreadSummary[]; scheduled: ScheduledQuestion[] }>,
    anakinThread: (id: string) => fetcher(`${API_PREFIX}/anakin/threads/${encodeURIComponent(id)}`) as Promise<{ id: string; title: string; messages: AnakinMessage[] }>,
    anakinFilter: (threadId: string, messageId: string) =>
      fetcher(`${API_PREFIX}/anakin/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}/filter`) as Promise<AnakinFilter>,
    addScheduled: (text: string, scope: AnakinScope) =>
      fetcher(`${API_PREFIX}/anakin/scheduled`, { method: 'POST', body: JSON.stringify({ text, scope }) }) as Promise<{ scheduled: ScheduledQuestion[] }>,
    setScheduled: (id: string, active: boolean) =>
      fetcher(`${API_PREFIX}/anakin/scheduled/${id}`, { method: 'PATCH', body: JSON.stringify({ active }) }) as Promise<{ scheduled: ScheduledQuestion[] }>,
    removeScheduled: (id: string) => fetcher(`${API_PREFIX}/anakin/scheduled/${id}`, { method: 'DELETE' }) as Promise<{ scheduled: ScheduledQuestion[] }>,

    notifications: () => fetcher(`${API_PREFIX}/notifications`) as Promise<NotificationFeed>,
    markNotificationsRead: (ids?: string[]) =>
      fetcher(`${API_PREFIX}/notifications/read`, { method: 'PATCH', body: JSON.stringify(ids ? { ids } : {}) }) as Promise<NotificationFeed>,
    notificationSettings: () => fetcher(`${API_PREFIX}/notification-settings`) as Promise<NotificationSettings>,
    saveNotificationSettings: (patch: NotificationSettingsPatch) =>
      fetcher(`${API_PREFIX}/notification-settings`, { method: 'PUT', body: JSON.stringify(patch) }) as Promise<NotificationSettings>,
  };
}

export type PersonalTrainingApi = ReturnType<typeof createApi>;
