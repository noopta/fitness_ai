// Wire types for /api/personal-training. This is a verbatim copy of
// packages/personal-training-core/src/types.ts from `export type ClientStatus`
// onward — the backend build compiles src/ only, so it cannot import from
// packages/. personalTrainingContract.test.ts fails if the two drift.

export type ClientStatus = 'support' | 'new' | 'onPlan' | 'paused';
export type Channel = 'app' | 'webLink';
export type EngagementTrend = 'rising' | 'steady' | 'falling';
export type Tone = 'red' | 'amber' | 'green' | 'zinc';

export interface Contraindication {
  label: string;
  note?: string;
  /** False once the client (or coach) marked the injury resolved. */
  active: boolean;
}

export interface ClientProgram {
  blockLabel: string;
  week: number;
  weeks: number;
  goal: string;
}

export interface Client {
  id: string;
  name: string;
  initials: string;
  email: string | null;
  status: ClientStatus;
  /** Always present when status is 'support'. */
  statusReason?: string;
  channel: Channel;
  /** Null when the client has no saved program. */
  program: ClientProgram | null;
  /** Sessions a week the program expects; the default when there is no program. */
  sessionsPerWeek: number;
  /** Eight weekly scores, 0–10, oldest first. */
  engagement8w: number[];
  engagementTrend: EngagementTrend;
  lastCheckInAt?: string;
  lastSessionAt?: string;
  joinedAt: string;
  contraindications: Contraindication[];
}

export type StatusCounts = Record<'all' | ClientStatus, number>;

export interface RosterResponse {
  clients: Client[];
  counts: StatusCounts;
}

export type TimelineKind =
  | 'workout' | 'checkin' | 'message' | 'measurement'
  | 'photos' | 'program' | 'note' | 'billing';

export interface TimelineEvent {
  id: string;
  clientId: string;
  kind: TimelineKind;
  at: string;
  title: string;
  body: string;
  flag?: { label: string; tone: Tone };
  /** True for events Axiom produced (program suggestions). Renders the black icon tile. */
  ai?: boolean;
}

export interface TimelinePage {
  events: TimelineEvent[];
  /** Null when there is nothing earlier to load. */
  nextCursor: string | null;
}

export interface Practice {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
}

export interface MeResponse {
  trainer: { id: string; name: string; initials: string };
  /** Null until the trainer has set up a practice. */
  practice: Practice | null;
}

export interface InviteResponse {
  token: string;
  link: string;
  email: string | null;
  expiresAt: string;
}

export interface InvitePreview {
  practice: Practice;
  trainerName: string;
  email: string | null;
  expiresAt: string;
}

export type RosterFilter = 'all' | ClientStatus;

// ─── Evidence (handoff §2.2) ─────────────────────────────────────────────────
// Every AI-facing claim carries the reasons it was made and where they came
// from. A payload without reasons is an error, never something to render.

export interface SourceRef {
  kind: 'session' | 'checkin' | 'intake' | 'message' | 'measurement' | 'program' | 'rule';
  id: string;
  label: string;
}

export interface Evidence {
  reasons: string[];
  sources: SourceRef[];
}

// ─── Drafts ──────────────────────────────────────────────────────────────────

export type DraftStatus = 'pending' | 'sending' | 'sent' | 'discarded';

export interface Draft {
  id: string;
  clientId: string;
  text: string;
  channel: Channel;
  status: DraftStatus;
  sentAt?: string;
  /** While status is 'sending', the send can still be undone until this time. */
  undoUntil?: string;
}

// ─── Morning briefing (§6.1) ─────────────────────────────────────────────────

export type Severity = 'attention' | 'look';

export interface ClientRef {
  id: string;
  name: string;
  initials: string;
}

export interface BriefingItem {
  id: string;
  clientId: string;
  client: ClientRef & { status: ClientStatus; meta: string };
  severity: Severity;
  headline: string;
  detail: string;
  suggestion: { kind: 'message'; text: string; draftId: string };
  draft: Draft;
  primaryLabel: string;
  secondaryLabel: string;
  guardrail?: { checked: number; label: string };
  evidence: Evidence;
  dataThrough: string;
  resolution?: { action: 'messaged' | 'dismissed' | 'reviewed'; at: string; summary: string; undoUntil?: string };
}

export interface ScheduledResult {
  id: string;
  text: string;
  answer: string;
  count: number;
}

export interface Briefing {
  id: string;
  date: string;
  generatedAt?: string;
  status: 'pending' | 'streaming' | 'ready' | 'failed';
  summary: { attention: number; look: number; onPlan: number };
  items: BriefingItem[];
  onPlanClients: ClientRef[];
  scheduled: ScheduledResult[];
}

export interface BriefingResponse {
  trainerFirstName: string;
  /** Today's date in the briefing time zone, so the client knows what "today" is. */
  today: string;
  clientCount: number;
  /** Null for a brand-new practice with nothing generated yet. */
  briefing: Briefing | null;
  /** True when `briefing` is an earlier day's because today's is not ready. */
  stale: boolean;
  /** Clients who logged anything since the stale briefing was generated. */
  loggedSince: number;
  rosterStats: { checkInsThisWeek: number; adherence7d: number; prs7d: number };
}

export type BriefingSource = 'workouts' | 'checkIns' | 'messages' | 'programs';

export type BriefingStreamEvent =
  | { type: 'status'; text: string }
  | { type: 'source'; source: BriefingSource }
  | { type: 'item'; item: BriefingItem }
  | { type: 'done'; briefing: Briefing }
  | { type: 'error'; message: string };

export type ResolveAction = 'messaged' | 'dismissed' | 'reviewed';

// ─── Check-ins (§6.4) ────────────────────────────────────────────────────────

export type QuestionType = 'text' | 'scale' | 'number';
export type SignalKey = 'energy' | 'sleep' | 'stress' | 'pain';

export interface CheckInQuestion {
  id: string;
  text: string;
  type: QuestionType;
  /** Lets the analysis read the answer as a recovery signal. */
  signal?: SignalKey;
}

export interface CheckInSchedule {
  id: string | null;
  /** Null for the practice default. */
  clientId: string | null;
  clientName?: string;
  frequency: 'weekly' | 'biweekly';
  dayOfWeek: number;
  hour: number;
  questions: CheckInQuestion[];
  nudgeAfterHours: number;
  flagAfterHours: number;
  pauseAfterMisses: number;
  active: boolean;
}

export interface CheckInSignal {
  label: string;
  tone: Tone;
}

export interface CheckIn {
  id: string;
  clientId: string;
  client: ClientRef;
  submittedAt: string;
  channel: Channel;
  classification: 'flag' | 'look' | 'routine';
  summary: string;
  signals: CheckInSignal[];
  answers: { question: string; answer: string }[];
  evidence: Evidence;
  draft: Draft;
  reviewedAt?: string;
}

export interface MissedCheckIn {
  id: string;
  client: ClientRef;
  dueAt: string;
  status: 'due' | 'missed';
  /** The escalation steps that have already run, in order. */
  path: string[];
}

export interface CheckInInbox {
  checkIns: CheckIn[];
  missed: MissedCheckIn[];
  routinePending: number;
}

/** What a client sees when asked to check in. */
export interface CheckInRequest {
  id: string;
  practiceName: string;
  trainerName: string;
  status: 'due' | 'submitted' | 'missed';
  dueAt: string;
  questions: CheckInQuestion[];
}

// ─── Progress and reports (§6.5) ─────────────────────────────────────────────

export type LiftKey = 'squat' | 'bench' | 'deadlift' | 'ohp';
export type ProgressStatus = 'progressing' | 'plateau' | 'regressing' | 'noData';

export interface ProgressRow {
  clientId: string;
  client: ClientRef;
  lift: string;
  /** Latest estimated 1RM in the trainer's unit; null when the lift was never logged. */
  e1rm: number | null;
  /** One value per week, oldest first, gaps carried forward. */
  series: number[];
  change: number | null;
  /** 0–100. */
  adherence: number;
  status: ProgressStatus;
  note?: string;
}

export interface ProgressResponse {
  lift: LiftKey;
  lifts: { key: LiftKey; label: string }[];
  weeks: number;
  unit: 'kg' | 'lbs';
  kpis: { progressing: number; plateau: number; prsThisMonth: number };
  rows: ProgressRow[];
}

export interface ReportStats {
  sessions: number;
  adherence: number;
  prs: { lift: string; value: string; date: string }[];
  bodyweight: { start: string; end: string; change: string } | null;
  measurements: { date: string; value: string }[];
  headline: { label: string; value: string }[];
}

export interface Report {
  id: string;
  clientId: string;
  client: ClientRef;
  month: string;
  monthLabel: string;
  status: 'draft' | 'sent';
  title: string;
  narrative: string;
  coachNote: string;
  nextLine: string;
  trainerName: string;
  practiceName: string;
  stats: ReportStats;
  sentAt?: string;
  /** Present while a send can still be undone. */
  undoUntil?: string;
}

// ─── Ask Anakin (§6.6) ───────────────────────────────────────────────────────

export type AnakinScope = 'all' | 'new' | 'support';

export interface AnakinRow {
  clientId: string;
  client: ClientRef;
  evidence: string;
  series?: number[];
}

export type AnakinEvent =
  | { type: 'status'; text: string }
  | { type: 'thread'; threadId: string; messageId: string }
  | { type: 'clarify'; text: string; options: string[] }
  | {
      type: 'answer';
      messageId: string;
      text: string;
      rows: AnakinRow[];
      note?: string;
      sources: string;
      followUps: string[];
      /** False when there is nothing to filter: small talk, or a question about one client. */
      actionable: boolean;
      /**
       * The roster query behind this answer, as a question with a fixed meaning.
       * Present only when the answer came from one; it is what "Run every
       * morning" schedules, rather than whatever the trainer happened to type.
       */
      scheduleText?: string;
    }
  | { type: 'drafts'; text: string; drafts: (Draft & { client: ClientRef })[] }
  | { type: 'error'; message: string }
  | { type: 'done' };

export interface AnakinMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  events: AnakinEvent[];
}

export interface AnakinThreadSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export interface ScheduledQuestion {
  id: string;
  text: string;
  scope: AnakinScope;
  active: boolean;
  lastRunAt?: string;
  lastCount?: number;
}

/** An Anakin answer applied to the roster: per-client evidence replaces the reason line. */
export interface AnakinFilter {
  question: string;
  rows: { clientId: string; evidence: string }[];
}

// ─── Notifications (§6.7) ────────────────────────────────────────────────────

export type Tier = 'immediate' | 'briefing' | 'timeline';
export type NotificationGroup = 'Safety' | 'Engagement' | 'Client activity' | 'Insights';

export interface NotificationRule {
  eventType: string;
  label: string;
  group: NotificationGroup;
  tier: Tier;
  defaultTier: Tier;
  /** Safety events can never be set to 'timeline'. */
  locked?: boolean;
  /** Events of this type over the trailing four weeks, per week. */
  perWeek: number;
}

export interface NotificationOverride {
  clientId: string;
  clientName?: string;
  eventType: string;
  tier: Tier;
  note?: string;
  expiresAt?: string;
}

export interface NotificationSettings {
  rules: NotificationRule[];
  tierCounts: Record<Tier, number>;
  weeklyEstimate: number;
  channels: { push: boolean; email: boolean };
  quietHours: { start: number; end: number };
  overrides: NotificationOverride[];
}

export interface NotificationSettingsPatch {
  rules?: Record<string, Tier>;
  channels?: Partial<{ push: boolean; email: boolean }>;
  quietHours?: { start: number; end: number };
  overrides?: NotificationOverride[];
}

export interface NotificationItem {
  id: string;
  clientId: string | null;
  eventType: string;
  title: string;
  body: string;
  at: string;
  read: boolean;
}

export interface NotificationFeed {
  immediate: NotificationItem[];
  unread: number;
  heldForBriefing: number;
  recordedQuietly: number;
}

// ─── Client dossier: overview, program, notes (§6.3) ─────────────────────────

export interface ClientOverview {
  /** One paragraph built from the facts below it; never free-form. */
  summary: { text: string; updatedAt: string; evidence: Evidence };
  /** Key stats, each with its change over the last six weeks where known. */
  stats: { label: string; value: string; delta?: string; tone?: Tone }[];
  block: ClientProgram | null;
  /** What is waiting on the trainer for this client, strongest first. */
  openItems: { id: string; headline: string; detail: string; severity: Severity }[];
  recentPrs: { lift: string; value: string; date: string }[];
}

export interface ProgramDayView {
  day: string;
  focus: string;
  exercises: { name: string; scheme: string; target?: string; notes?: string }[];
}

export interface ClientProgramView {
  goal: string;
  daysPerWeek: number;
  totalWeeks: number;
  currentWeek: number;
  startedAt: string | null;
  phases: { name: string; weeksLabel: string; rationale: string; current: boolean; days: ProgramDayView[] }[];
  /** Changes Axiom has proposed that the client has not answered yet. */
  pending: { id: string; title: string; reasoning: string; proposedAt: string }[];
}

/** A trainer's private note on a client. Never shown to the client. */
export interface ClientNote {
  id: string;
  body: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
}
