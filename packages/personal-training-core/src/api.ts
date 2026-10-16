// Typed client for /api/personal-training. Each platform injects its own
// authenticated fetcher (web: authFetch + cookie/Bearer, mobile: apiFetch), so
// this file has no DOM or React Native imports.

import type {
  AnakinFilter, AnakinMessage, AnakinScope, AnakinThreadSummary, BriefingItem, BriefingResponse, CheckInInbox, CheckInRequest,
  CheckInSchedule, Client, ClientNote, ClientOverview, ClientProgramView, Draft, ImportPreview, ImportSummary, ImportUpload, InvitePreview, InviteResponse, LiftKey, MeResponse, NotificationFeed, NotificationSettings,
  NotificationSettingsPatch, Practice, ProgressResponse, Report, ResolveAction, RosterResponse, ScheduledQuestion, TimelineKind,
  SheetMapping, TimelinePage, ClientGoal, ClientLinkInfo, Contraindication, CreateLinkClientResponse, GuardrailReport, Measurement,
  MeasurementKind, PracticeProfile, ProgressPhoto, TagCount, ClientState,
  IntakeState, NutritionSummary, InboxThread, InboxConversation, LibraryExercise, ProgramSummary, TrainerProgram, ProgramDoc, ProgramAiRequest,
  BillingStatus, OfferView, ClientPlanView, PaymentView, RevenueSummary, AvailabilityWindow, BookingView, Slot,
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
  overview: (id: string) => ['personal-training', 'clients', id, 'overview'] as const,
  program: (id: string) => ['personal-training', 'clients', id, 'program'] as const,
  notes: (id: string) => ['personal-training', 'clients', id, 'notes'] as const,
  imports: ['personal-training', 'imports'] as const,
  notifications: ['personal-training', 'notifications'] as const,
  notificationSettings: ['personal-training', 'notification-settings'] as const,
  practiceProfile: ['personal-training', 'practice', 'profile'] as const,
  tags: ['personal-training', 'tags'] as const,
  link: (id: string) => ['personal-training', 'clients', id, 'link'] as const,
  contraindications: (id: string) => ['personal-training', 'clients', id, 'contraindications'] as const,
  contraindicationMeta: ['personal-training', 'contraindications', 'meta'] as const,
  goals: (id: string) => ['personal-training', 'clients', id, 'goals'] as const,
  measurements: (id: string) => ['personal-training', 'clients', id, 'measurements'] as const,
  photos: (id: string) => ['personal-training', 'clients', id, 'photos'] as const,
  intake: (id: string) => ['personal-training', 'clients', id, 'intake'] as const,
  nutrition: (id: string) => ['personal-training', 'clients', id, 'nutrition'] as const,
  inbox: ['personal-training', 'inbox'] as const,
  inboxThread: (id: string) => ['personal-training', 'inbox', id] as const,
  exercises: (q: string) => ['personal-training', 'exercises', q] as const,
  programs: (filter: string) => ['personal-training', 'programs', filter] as const,
  programDetail: (id: string) => ['personal-training', 'program', id] as const,
  billingStatus: ['personal-training', 'billing', 'status'] as const,
  offers: ['personal-training', 'billing', 'offers'] as const,
  revenue: ['personal-training', 'billing', 'revenue'] as const,
  clientBilling: (id: string) => ['personal-training', 'clients', id, 'billing'] as const,
  availability: ['personal-training', 'schedule', 'availability'] as const,
  bookings: (range: string) => ['personal-training', 'schedule', 'bookings', range] as const,
};

/** One body part the editor offers, with the movement patterns it refuses by default. */
export interface BodyPartMeta { key: string; label: string; primary: string[]; secondary: string[] }

export interface ClientPatch {
  name?: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  tags?: string[];
  state?: ClientState;
  pausedUntil?: string | null;
  stateReason?: string | null;
}

export interface ContraindicationInput {
  bodyPart?: string;
  side?: 'left' | 'right' | 'both' | null;
  condition?: string;
  severity?: 'mild' | 'moderate' | 'severe';
  source?: Contraindication['source'];
  onsetDate?: string | null;
  clearance?: 'not_cleared' | 'modified' | 'cleared';
  extraBlocks?: string[];
  allow?: string[];
  notes?: string | null;
  /** Confirm one read from the client's own words (its `inferred:` id). */
  fromInferred?: string;
}

export interface GoalInput {
  metric?: string;
  label?: string;
  baseline?: number | null;
  target?: number | null;
  unit?: string;
  direction?: 'up' | 'down' | 'hold';
  deadline?: string | null;
  status?: 'active' | 'achieved' | 'dropped';
}

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

    overview: (id: string) => fetcher(`${API_PREFIX}/clients/${encodeURIComponent(id)}/overview`) as Promise<ClientOverview>,
    program: (id: string) => fetcher(`${API_PREFIX}/clients/${encodeURIComponent(id)}/program`) as Promise<{ program: ClientProgramView | null }>,
    notes: (id: string) => fetcher(`${API_PREFIX}/clients/${encodeURIComponent(id)}/notes`) as Promise<{ notes: ClientNote[] }>,
    addNote: (id: string, body: string) =>
      fetcher(`${API_PREFIX}/clients/${encodeURIComponent(id)}/notes`, { method: 'POST', body: JSON.stringify({ body }) }) as Promise<{ note: ClientNote }>,
    updateNote: (id: string, noteId: string, body: string) =>
      fetcher(`${API_PREFIX}/clients/${encodeURIComponent(id)}/notes/${noteId}`, { method: 'PATCH', body: JSON.stringify({ body }) }) as Promise<{ note: ClientNote }>,
    deleteNote: (id: string, noteId: string) =>
      fetcher(`${API_PREFIX}/clients/${encodeURIComponent(id)}/notes/${noteId}`, { method: 'DELETE' }) as Promise<{ ok: true }>,
    /** Write to a client directly. Goes through the same send → undo window → deliver path as every draft. */
    messageClient: (id: string, text: string) =>
      fetcher(`${API_PREFIX}/clients/${encodeURIComponent(id)}/message`, { method: 'POST', body: JSON.stringify({ text }) }) as Promise<{ draft: Draft }>,

    imports: () => fetcher(`${API_PREFIX}/imports`) as Promise<{ imports: ImportSummary[] }>,
    createImport: (upload: ImportUpload) => fetcher(`${API_PREFIX}/imports`, { method: 'POST', body: JSON.stringify(upload) }) as Promise<ImportPreview>,
    updateImportMapping: (id: string, mappings: SheetMapping[]) =>
      fetcher(`${API_PREFIX}/imports/${id}/mapping`, { method: 'PUT', body: JSON.stringify({ mappings }) }) as Promise<ImportPreview>,
    confirmImport: (id: string) => fetcher(`${API_PREFIX}/imports/${id}/confirm`, { method: 'POST' }) as Promise<{ import: ImportSummary }>,
    undoImport: (id: string) => fetcher(`${API_PREFIX}/imports/${id}/undo`, { method: 'POST' }) as Promise<{ ok: true }>,
    /** An invite link for a "Not joined" client, bound to their email. */
    inviteProspect: (id: string, email?: string) =>
      fetcher(`${API_PREFIX}/clients/${encodeURIComponent(id)}/invite`, { method: 'POST', body: JSON.stringify(email ? { email } : {}) }) as Promise<InviteResponse>,

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

    // ── Coach platform: practice, link clients, dossier records ──
    practiceProfile: () => fetcher(`${API_PREFIX}/practice/profile`) as Promise<{ profile: PracticeProfile }>,
    savePracticeProfile: (patch: Partial<Omit<PracticeProfile, 'logoUrl'>> & { name?: string }) =>
      fetcher(`${API_PREFIX}/practice/profile`, { method: 'PUT', body: JSON.stringify(patch) }) as Promise<{ profile: PracticeProfile }>,
    uploadLogo: (imageBase64: string) =>
      fetcher(`${API_PREFIX}/practice/logo`, { method: 'POST', body: JSON.stringify({ imageBase64 }) }) as Promise<{ profile: PracticeProfile }>,
    tags: () => fetcher(`${API_PREFIX}/tags`) as Promise<{ tags: TagCount[] }>,
    /** Add a client who will use a web link instead of the app. */
    createLinkClient: (input: { name: string; email?: string; phone?: string; tags?: string[] }) =>
      fetcher(`${API_PREFIX}/clients`, { method: 'POST', body: JSON.stringify(input) }) as Promise<CreateLinkClientResponse>,
    patchClient: (id: string, patch: ClientPatch) =>
      fetcher(`${API_PREFIX}/clients/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }) as Promise<{ client: Client }>,
    link: (id: string) => fetcher(`${API_PREFIX}/clients/${encodeURIComponent(id)}/link`) as Promise<{ link: ClientLinkInfo | null }>,
    /** A fresh link; any earlier one stops working. For a "Not joined" client this makes them a link client. */
    issueLink: (id: string) =>
      fetcher(`${API_PREFIX}/clients/${encodeURIComponent(id)}/link`, { method: 'POST' }) as Promise<{ link: ClientLinkInfo; client?: Client }>,
    revokeLink: (id: string) => fetcher(`${API_PREFIX}/clients/${encodeURIComponent(id)}/link`, { method: 'DELETE' }) as Promise<{ ok: true }>,

    contraindicationMeta: () => fetcher(`${API_PREFIX}/contraindications/meta`) as Promise<{ bodyParts: BodyPartMeta[]; patterns: string[] }>,
    contraindications: (id: string) =>
      fetcher(`${API_PREFIX}/clients/${encodeURIComponent(id)}/contraindications`) as Promise<{ contraindications: Contraindication[] }>,
    addContraindication: (id: string, input: ContraindicationInput) =>
      fetcher(`${API_PREFIX}/clients/${encodeURIComponent(id)}/contraindications`, { method: 'POST', body: JSON.stringify(input) }) as Promise<{ contraindication: Contraindication }>,
    updateContraindication: (id: string, cid: string, input: ContraindicationInput) =>
      fetcher(`${API_PREFIX}/clients/${encodeURIComponent(id)}/contraindications/${encodeURIComponent(cid)}`, { method: 'PATCH', body: JSON.stringify(input) }) as Promise<{ contraindication: Contraindication }>,
    archiveContraindication: (id: string, cid: string) =>
      fetcher(`${API_PREFIX}/clients/${encodeURIComponent(id)}/contraindications/${encodeURIComponent(cid)}`, { method: 'DELETE' }) as Promise<{ ok: true }>,
    checkGuardrails: (id: string, exercises: string[]) =>
      fetcher(`${API_PREFIX}/clients/${encodeURIComponent(id)}/guardrails/check`, { method: 'POST', body: JSON.stringify({ exercises }) }) as Promise<{ report: GuardrailReport }>,

    goals: (id: string) => fetcher(`${API_PREFIX}/clients/${encodeURIComponent(id)}/goals`) as Promise<{ goals: ClientGoal[] }>,
    addGoal: (id: string, input: GoalInput) =>
      fetcher(`${API_PREFIX}/clients/${encodeURIComponent(id)}/goals`, { method: 'POST', body: JSON.stringify(input) }) as Promise<{ goal: ClientGoal }>,
    updateGoal: (id: string, gid: string, input: GoalInput) =>
      fetcher(`${API_PREFIX}/clients/${encodeURIComponent(id)}/goals/${encodeURIComponent(gid)}`, { method: 'PATCH', body: JSON.stringify(input) }) as Promise<{ goal: ClientGoal }>,
    measurements: (id: string) => fetcher(`${API_PREFIX}/clients/${encodeURIComponent(id)}/measurements`) as Promise<{ measurements: Measurement[] }>,
    addMeasurement: (id: string, input: { kind: MeasurementKind; value: number; unit: string; date?: string; label?: string }) =>
      fetcher(`${API_PREFIX}/clients/${encodeURIComponent(id)}/measurements`, { method: 'POST', body: JSON.stringify(input) }) as Promise<{ measurements: Measurement[] }>,
    deleteMeasurement: (id: string, mid: string) =>
      fetcher(`${API_PREFIX}/clients/${encodeURIComponent(id)}/measurements/${encodeURIComponent(mid)}`, { method: 'DELETE' }) as Promise<{ ok: true }>,
    photos: (id: string) => fetcher(`${API_PREFIX}/clients/${encodeURIComponent(id)}/photos`) as Promise<{ photos: ProgressPhoto[] }>,
    addPhoto: (id: string, input: { imageBase64: string; pose?: ProgressPhoto['pose']; date?: string; note?: string }) =>
      fetcher(`${API_PREFIX}/clients/${encodeURIComponent(id)}/photos`, { method: 'POST', body: JSON.stringify(input) }) as Promise<{ photos: ProgressPhoto[] }>,
    deletePhoto: (id: string, pid: string) =>
      fetcher(`${API_PREFIX}/clients/${encodeURIComponent(id)}/photos/${encodeURIComponent(pid)}`, { method: 'DELETE' }) as Promise<{ ok: true }>,

    // ── Intake, nutrition, inbox, export ──
    intake: (id: string) => fetcher(`${API_PREFIX}/clients/${encodeURIComponent(id)}/intake`) as Promise<{ intake: IntakeState }>,
    resetIntake: (id: string) => fetcher(`${API_PREFIX}/clients/${encodeURIComponent(id)}/intake`, { method: 'DELETE' }) as Promise<{ intake: IntakeState }>,
    nutrition: (id: string) => fetcher(`${API_PREFIX}/clients/${encodeURIComponent(id)}/nutrition`) as Promise<{ nutrition: NutritionSummary }>,
    setNutritionTargets: (id: string, t: { calories?: number | null; proteinG?: number | null; carbsG?: number | null; fatG?: number | null }) =>
      fetcher(`${API_PREFIX}/clients/${encodeURIComponent(id)}/nutrition-targets`, { method: 'PUT', body: JSON.stringify(t) }) as Promise<{ nutrition: NutritionSummary }>,
    inbox: () => fetcher(`${API_PREFIX}/inbox`) as Promise<{ threads: InboxThread[] }>,
    inboxThread: (clientId: string) => fetcher(`${API_PREFIX}/inbox/${encodeURIComponent(clientId)}`) as Promise<InboxConversation>,
    /** A drafted reply (pending). Send it with sendDraft; it goes through the undo window like every draft. */
    draftInboxReply: (clientId: string) => fetcher(`${API_PREFIX}/inbox/${encodeURIComponent(clientId)}/draft`, { method: 'POST' }) as Promise<{ draft: Draft }>,
    /** Relative paths for download links; the platform prefixes its API base. */
    exportPaths: { json: `${API_PREFIX}/export`, clients: `${API_PREFIX}/export/clients.csv`, workouts: `${API_PREFIX}/export/workouts.csv`, measurements: `${API_PREFIX}/export/measurements.csv`, contraindications: `${API_PREFIX}/export/contraindications.csv` },

    // ── Exercise library and programs ──
    exercises: (q: { q?: string; pattern?: string; equipment?: string } = {}) => {
      const qs = Object.entries(q).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&');
      return fetcher(`${API_PREFIX}/exercises${qs ? `?${qs}` : ''}`) as Promise<{ exercises: LibraryExercise[]; equipment: string[] }>;
    },
    createExercise: (input: { name: string; patterns?: string[]; equipment?: string[]; videoUrl?: string | null; cues?: string; primaryMuscle?: string }) =>
      fetcher(`${API_PREFIX}/exercises`, { method: 'POST', body: JSON.stringify(input) }) as Promise<{ exercise: LibraryExercise }>,
    updateExercise: (eid: string, input: { name?: string; patterns?: string[]; equipment?: string[]; videoUrl?: string | null; cues?: string; primaryMuscle?: string }) =>
      fetcher(`${API_PREFIX}/exercises/${encodeURIComponent(eid)}`, { method: 'PATCH', body: JSON.stringify(input) }) as Promise<{ exercise: LibraryExercise }>,
    archiveExercise: (eid: string) => fetcher(`${API_PREFIX}/exercises/${encodeURIComponent(eid)}`, { method: 'DELETE' }) as Promise<{ ok: true }>,
    programs: (filter: { clientId?: string; templates?: boolean } = {}) =>
      fetcher(`${API_PREFIX}/programs${filter.clientId ? `?clientId=${encodeURIComponent(filter.clientId)}` : filter.templates ? '?templates=1' : ''}`) as Promise<{ programs: ProgramSummary[] }>,
    program: (pid: string) => fetcher(`${API_PREFIX}/programs/${encodeURIComponent(pid)}`) as Promise<{ program: TrainerProgram }>,
    createProgram: (input: { clientId?: string; isTemplate?: boolean; name?: string; description?: string; doc?: ProgramDoc; fromProgramId?: string; daysPerWeek?: number; startDate?: string }) =>
      fetcher(`${API_PREFIX}/programs`, { method: 'POST', body: JSON.stringify(input) }) as Promise<{ program: TrainerProgram }>,
    /** Axiom drafts it; the rules engine checks it; it lands as a draft on the canvas. */
    generateProgram: (clientId: string, req: ProgramAiRequest) =>
      fetcher(`${API_PREFIX}/programs/generate`, { method: 'POST', body: JSON.stringify({ clientId, ...req }) }) as Promise<{ program: TrainerProgram }>,
    /** 409 with `check` on a live program the rules engine refuses (nothing saved). */
    saveProgram: (pid: string, patch: { doc?: ProgramDoc; name?: string; description?: string; startDate?: string | null }) =>
      fetcher(`${API_PREFIX}/programs/${encodeURIComponent(pid)}`, { method: 'PUT', body: JSON.stringify(patch) }) as Promise<{ program: TrainerProgram }>,
    acknowledgeWarnings: (pid: string, keys: string[]) =>
      fetcher(`${API_PREFIX}/programs/${encodeURIComponent(pid)}/acknowledge`, { method: 'POST', body: JSON.stringify({ keys }) }) as Promise<{ program: TrainerProgram }>,
    publishProgram: (pid: string) => fetcher(`${API_PREFIX}/programs/${encodeURIComponent(pid)}/publish`, { method: 'POST' }) as Promise<{ program: TrainerProgram }>,
    copyProgram: (pid: string, input: { clientIds?: string[]; asTemplate?: boolean; name?: string }) =>
      fetcher(`${API_PREFIX}/programs/${encodeURIComponent(pid)}/copy`, { method: 'POST', body: JSON.stringify(input) }) as Promise<{ programs: TrainerProgram[] }>,
    archiveProgram: (pid: string) => fetcher(`${API_PREFIX}/programs/${encodeURIComponent(pid)}`, { method: 'DELETE' }) as Promise<{ ok: true }>,

    // ── Billing and scheduling ──
    billingStatus: (refresh = false) => fetcher(`${API_PREFIX}/billing/status${refresh ? '?refresh=1' : ''}`) as Promise<{ status: BillingStatus }>,
    connectStripe: () => fetcher(`${API_PREFIX}/billing/connect`, { method: 'POST' }) as Promise<{ url: string }>,
    saveBillingSettings: (s: { dunningNudges?: boolean; bookingNeedsCredit?: boolean }) =>
      fetcher(`${API_PREFIX}/billing/settings`, { method: 'PUT', body: JSON.stringify(s) }) as Promise<{ status: BillingStatus }>,
    offers: () => fetcher(`${API_PREFIX}/billing/offers`) as Promise<{ offers: OfferView[] }>,
    createOffer: (o: { name: string; description?: string; kind: OfferView['kind']; priceCents: number; interval?: 'week' | 'month' | 'year'; intervalCount?: number; sessionCredits?: number | null }) =>
      fetcher(`${API_PREFIX}/billing/offers`, { method: 'POST', body: JSON.stringify(o) }) as Promise<{ offer: OfferView }>,
    archiveOffer: (oid: string) => fetcher(`${API_PREFIX}/billing/offers/${encodeURIComponent(oid)}`, { method: 'DELETE' }) as Promise<{ ok: true }>,
    revenue: () => fetcher(`${API_PREFIX}/billing/revenue`) as Promise<{ revenue: RevenueSummary }>,
    clientBilling: (id: string) => fetcher(`${API_PREFIX}/clients/${encodeURIComponent(id)}/billing`) as Promise<{ plans: ClientPlanView[]; payments: PaymentView[] }>,
    /** A link to send the client: their portal's billing tab with this offer picked. */
    paymentRequestLink: (id: string, offerId: string) =>
      fetcher(`${API_PREFIX}/clients/${encodeURIComponent(id)}/billing/request`, { method: 'POST', body: JSON.stringify({ offerId }) }) as Promise<{ url: string }>,
    availability: () => fetcher(`${API_PREFIX}/schedule/availability`) as Promise<{ windows: AvailabilityWindow[] }>,
    setAvailability: (windows: AvailabilityWindow[]) =>
      fetcher(`${API_PREFIX}/schedule/availability`, { method: 'PUT', body: JSON.stringify({ windows }) }) as Promise<{ windows: AvailabilityWindow[] }>,
    bookings: (range: { from?: string; to?: string; clientId?: string } = {}) => {
      const qs = Object.entries(range).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&');
      return fetcher(`${API_PREFIX}/schedule/bookings${qs ? `?${qs}` : ''}`) as Promise<{ bookings: BookingView[] }>;
    },
    bookSession: (input: { clientId: string; startsAt: string; minutes?: number; notes?: string }) =>
      fetcher(`${API_PREFIX}/schedule/bookings`, { method: 'POST', body: JSON.stringify(input) }) as Promise<{ booking: BookingView }>,
    updateBooking: (bid: string, status: 'cancelled' | 'completed' | 'no_show') =>
      fetcher(`${API_PREFIX}/schedule/bookings/${encodeURIComponent(bid)}`, { method: 'PATCH', body: JSON.stringify({ status }) }) as Promise<{ booking: BookingView }>,
    slots: (days = 14) => fetcher(`${API_PREFIX}/schedule/slots?days=${days}`) as Promise<{ slots: Slot[] }>,
  };
}

export type PersonalTrainingApi = ReturnType<typeof createApi>;
