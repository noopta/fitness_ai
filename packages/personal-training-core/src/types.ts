// Contract types for the personal-training dashboard (design handoff v1, §8).
// The server is the source of truth for every derived field — status, the
// reason behind it, the engagement series and PR flags. Views render these;
// they never recompute them.

// 'notJoined' is a client brought in by a spreadsheet import who has no Axiom
// account yet: the trainer can see their imported history, but nothing can be
// sent to them until they accept an invite.
export type ClientStatus = 'support' | 'new' | 'onPlan' | 'paused' | 'notJoined';
export type Channel = 'app' | 'webLink';
export type EngagementTrend = 'rising' | 'steady' | 'falling';
export type Tone = 'red' | 'amber' | 'green' | 'zinc';

export type BodyPart =
  | 'neck' | 'shoulder' | 'elbow' | 'wrist_hand' | 'chest' | 'upper_back' | 'lower_back' | 'abdominal'
  | 'hip' | 'groin' | 'hamstring' | 'quad' | 'knee' | 'calf_achilles' | 'ankle_foot' | 'systemic';
export type Clearance = 'not_cleared' | 'modified' | 'cleared';
export type ContraindicationSource = 'trainer' | 'client_reported' | 'intake' | 'import' | 'medical';

export interface Contraindication {
  /** A row id, or `inferred:<ref>` for one read from the client's own words and not yet confirmed. */
  id?: string;
  label: string;
  note?: string;
  /** False once it is cleared, or the client marked the injury resolved. */
  active: boolean;
  bodyPart?: BodyPart | 'unknown';
  side?: 'left' | 'right' | 'both' | null;
  severity?: 'mild' | 'moderate' | 'severe';
  /** The rules engine refuses conflicting work until this is 'cleared'; 'modified' turns some refusals into warnings. */
  clearance?: Clearance;
  source?: ContraindicationSource;
  onsetDate?: string;
  /** Movement patterns the trainer refused on top of the body part's defaults. */
  extraBlocks?: string[];
  /** Movement patterns the trainer allowed despite the defaults. */
  allow?: string[];
  /** True until a trainer has confirmed or edited it. */
  needsReview?: boolean;
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
  /** Practice-defined labels. */
  tags?: string[];
  /** Paused clients keep their history but drop out of the briefing and every automated send. */
  state?: ClientState;
  /** When a pause ends by itself. */
  pausedUntil?: string | null;
  /** Multi-coach practices: who this client is assigned to; null = the whole practice. */
  assignedTrainerId?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
}

export type ClientState = 'active' | 'paused' | 'archived';

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
  trainer: { id: string; name: string; initials: string; unit?: 'kg' | 'lb' };
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

// ─── Spreadsheet import ──────────────────────────────────────────────────────

export type ImportSheetKind = 'clients' | 'workouts' | 'bodyweight' | 'ignore';
export type ImportField =
  | 'client' | 'firstName' | 'lastName' | 'email' | 'phone' | 'goal' | 'injuries' | 'notes'
  | 'date' | 'exercise' | 'sets' | 'reps' | 'weight' | 'rpe' | 'sessionTitle' | 'bodyweight';

/** How one sheet is read. Proposed automatically, then corrected by the trainer before anything is imported. */
export interface SheetMapping {
  sheet: string;
  kind: ImportSheetKind;
  /** Zero-based index of the row holding the column headers. */
  headerRow: number;
  /** Zero-based column index for each field the sheet has. */
  columns: Partial<Record<ImportField, number>>;
  /** Where the client's name comes from: a column, or the sheet's own name (one sheet per client). */
  clientFrom: 'column' | 'sheetName';
  unit: 'kg' | 'lb';
  dateOrder: 'dmy' | 'mdy' | 'ymd';
}

export interface ImportUpload {
  fileName: string;
  sheets: { name: string; rows: string[][] }[];
}

export interface ImportSheetPreview {
  name: string;
  rowCount: number;
  /** The first rows as uploaded, for checking the mapping against. */
  sample: string[][];
  mapping: SheetMapping;
}

export interface ImportClientPreview {
  key: string;
  name: string;
  email: string | null;
  workouts: number;
  bodyweights: number;
  firstDate: string | null;
  lastDate: string | null;
  /** Their email matches someone already on the roster; the history will attach to that client. */
  matchesExisting: boolean;
  goal?: string;
  injuries?: string;
  sample: { date: string; summary: string }[];
}

export interface ImportPreview {
  id: string;
  fileName: string;
  status: 'review' | 'imported' | 'undone';
  createdAt: string;
  importedAt?: string;
  sheets: ImportSheetPreview[];
  summary: { clients: number; workouts: number; bodyweights: number; skippedRows: number };
  /** What was assumed while reading (units, date order, filled-down names). */
  assumptions: string[];
  /** What could not be read, with where. */
  warnings: string[];
  clients: ImportClientPreview[];
}

export interface ImportSummary {
  id: string;
  fileName: string;
  status: 'review' | 'imported' | 'undone';
  clients: number;
  workouts: number;
  createdAt: string;
  importedAt?: string;
}

// ─── Coach platform: dossier records (Oct 2026 handoff) ─────────────────────

export type GoalMetric = 'bodyweight' | 'sessions_per_week' | 'custom' | `e1rm:${LiftKey}` | `measurement:${string}`;

export interface ClientGoal {
  id: string;
  metric: GoalMetric;
  label: string;
  direction: 'up' | 'down' | 'hold';
  status: 'active' | 'achieved' | 'dropped';
  /** In the viewer's unit. */
  baseline: number | null;
  target: number | null;
  /** Read from the client's data, never typed. Null when nothing is logged. */
  current: number | null;
  unit: string;
  deadline?: string;
  daysLeft?: number | null;
  /** 0–100 from baseline to target; null when it cannot be computed. */
  progress: number | null;
}

export type MeasurementKind =
  | 'bodyweight' | 'waist' | 'hips' | 'chest' | 'arm' | 'thigh' | 'calf' | 'neck' | 'body_fat' | 'resting_hr' | 'custom';

export interface Measurement {
  id: string;
  kind: MeasurementKind;
  label: string;
  value: number;
  unit: string;
  date: string;
  source: 'trainer' | 'client';
  /** False for the client's own weigh-ins, which the trainer cannot remove. */
  deletable: boolean;
}

export interface ProgressPhoto {
  id: string;
  /** Short-lived signed URL. */
  url: string;
  pose: 'front' | 'side' | 'back' | 'other';
  date: string;
  note?: string;
  source: 'trainer' | 'client';
}

/** What the rules engine said about a set of exercises for one client. */
export interface GuardrailViolation {
  exercise: string;
  pattern: string;
  contraindicationId: string;
  condition: string;
  bodyPart: string;
  level: 'block' | 'warn';
  reason: string;
}

export interface GuardrailReport {
  checked: number;
  violations: GuardrailViolation[];
  unclassified: string[];
  unclassifiedConditions: string[];
  ok: boolean;
  label: string;
}

export interface ClientLinkInfo {
  url: string;
  createdAt: string;
  lastUsedAt?: string;
}

export interface CreateLinkClientResponse {
  client: Client;
  link: ClientLinkInfo;
}

export interface PracticeProfile {
  name: string;
  bio: string;
  specialties: string[];
  styleTags: string[];
  languages: string[];
  format: 'online' | 'hybrid' | 'in_person' | null;
  timezone: string | null;
  brandColor: string | null;
  accentColor: string | null;
  logoUrl: string | null;
  /** The opt-in public page at /p/<slug>, with an enquiry form. */
  publicPage: boolean;
}

export interface TagCount {
  tag: string;
  count: number;
}

// ─── Client portal (no-install web link) ────────────────────────────────────

export interface PortalBranding {
  practiceName: string;
  trainerName: string;
  logoUrl: string | null;
  brandColor: string | null;
  accentColor: string | null;
}

export interface PortalMessage {
  id: string;
  fromClient: boolean;
  body: string;
  at: string;
}

export interface PortalHome {
  client: { firstName: string; name: string; unit: 'kg' | 'lb' };
  branding: PortalBranding;
  /** Check-ins waiting for an answer, oldest first. */
  checkIns: { id: string; dueAt: string; questionCount: number }[];
  goals: ClientGoal[];
  unreadMessages: number;
  hasProgram: boolean;
  intake: { status: 'not_started' | 'in_progress' | 'complete'; completeness: number } | null;
  /** False when the server has no photo storage: the portal says so before anyone picks a photo. */
  photosEnabled: boolean;
  reports: { id: string; month: string; title: string; sentAt: string }[];
}

// ─── Conversational intake ──────────────────────────────────────────────────

export type IntakeField =
  | 'goal' | 'experience' | 'schedule' | 'equipment' | 'injuries' | 'medical' | 'lifestyle' | 'nutrition' | 'preferences';

export interface IntakeTurn {
  role: 'trainer' | 'client';
  text: string;
  at: string;
  /** The field a trainer turn asks about. */
  field?: IntakeField;
  /** True when the turn is a follow-up to a vague answer. */
  probe?: boolean;
}

export interface IntakeState {
  status: 'not_started' | 'in_progress' | 'complete';
  /** 0–100, computed by rules from the answers. */
  completeness: number;
  transcript: IntakeTurn[];
  /** The trainer's view lists every field, answered or not; the client's only what they answered. */
  fields: { key: IntakeField; label: string; required: boolean; answer?: string; vague?: boolean }[];
  /** The field being asked now; null once complete. */
  current: IntakeField | null;
  completedAt?: string;
}

// ─── Nutrition (targets + compliance) ───────────────────────────────────────

export interface NutritionTargets {
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
}

export interface NutritionRollup {
  windowDays: number;
  daysLogged: number;
  avgCalories: number | null;
  avgProteinG: number | null;
  avgCarbsG: number | null;
  avgFatG: number | null;
  /** Logged days within ±10% of the calorie target; null without a target. */
  caloriesOnTarget: number | null;
  /** Logged days at 90% or more of the protein target; null without a target. */
  proteinOnTarget: number | null;
}

export interface NutritionSummary {
  /** What the trainer set; null until they set something. */
  targets: NutritionTargets | null;
  /** The client's own calorie target in the app, for reference. */
  appCalorieTarget: number | null;
  week: NutritionRollup;
  month: NutritionRollup;
  /** One sentence on what the log says. */
  line: string;
  /** Patterns over four weeks worth a conversation, stated as observations. */
  patterns: string[];
  days: { date: string; calories: number; proteinG: number; carbsG: number; fatG: number }[];
}

// ─── Messaging inbox ────────────────────────────────────────────────────────

export interface InboxThread {
  clientId: string;
  client: ClientRef & { status: ClientStatus; channel: Channel };
  lastMessage: { body: string; at: string; fromClient: boolean } | null;
  /** Messages from the client the trainer has not opened. */
  unread: number;
  /** The client wrote last. */
  awaitingReply: boolean;
}

export interface InboxContext {
  status: ClientStatus;
  statusReason?: string;
  block: ClientProgram | null;
  lastSessionAt?: string;
  nextCheckInDue?: string;
  contraindications: string[];
  goals: string[];
  nutrition?: string;
}

export interface InboxConversation {
  client: ClientRef & { status: ClientStatus; channel: Channel };
  context: InboxContext;
  messages: { id: string; body: string; at: string; fromClient: boolean }[];
}

// ─── Exercise library and program builder (phase 2) ─────────────────────────

export interface LibraryExercise {
  /** A PtExercise id, or `builtin:<key>` for Axiom's own. */
  id: string;
  name: string;
  builtIn: boolean;
  /** What the rules engine reads. */
  patterns: string[];
  equipment: string[];
  primaryMuscle: string | null;
  videoUrl: string | null;
  cues: string | null;
}

export type LoadType = 'percent1rm' | 'rpe' | 'rir' | 'kg' | 'lb' | 'bodyweight' | 'none';
export type BlockKind = 'single' | 'superset' | 'circuit' | 'amrap' | 'emom';

export interface ProgramItem {
  id: string;
  exerciseId?: string;
  name: string;
  sets: number;
  /** "5", "8-10", "AMRAP", "30s". */
  reps: string;
  load?: { type: LoadType; value?: number };
  restSec?: number;
  tempo?: string;
  notes?: string;
}

export interface ProgramBlock {
  id: string;
  kind: BlockKind;
  /** Circuits and supersets: rounds through the items. */
  rounds?: number;
  /** AMRAP / EMOM: minutes. */
  timeCapMin?: number;
  items: ProgramItem[];
}

export interface ProgramDayDoc {
  id: string;
  name: string;
  /** 0 = Sunday … 6 = Saturday; null when unscheduled. */
  weekday?: number | null;
  notes?: string;
  blocks: ProgramBlock[];
}

export interface ProgramWeekDoc {
  id: string;
  label?: string;
  days: ProgramDayDoc[];
}

export interface ProgramDoc {
  weeks: ProgramWeekDoc[];
}

/** Why Axiom made a decision on the canvas, or what a guardrail did. */
export interface ProgramAnnotation {
  /** An item, day or week id, or 'program'. */
  target: string;
  kind: 'rationale' | 'guardrail' | 'removed';
  text: string;
}

export interface ProgramIssue {
  level: 'block' | 'warn';
  /** An item, day or week id, or 'program'. */
  where: string;
  text: string;
}

export interface ProgramCheck {
  guardrails: GuardrailReport | null;
  issues: ProgramIssue[];
  /** No refusals, no unaccepted warnings, and a client to publish to. */
  publishable: boolean;
}

export interface ProgramAiRequest {
  brief: string;
  weeks: number;
  daysPerWeek: number;
  sessionMinutes?: number;
  equipment?: string[];
  focus?: string;
  experience?: 'beginner' | 'intermediate' | 'advanced';
}

export interface TrainerProgram {
  id: string;
  clientId: string | null;
  name: string;
  description: string;
  status: 'draft' | 'published' | 'archived';
  isTemplate: boolean;
  doc: ProgramDoc;
  source: 'manual' | 'ai' | 'template' | 'copy';
  annotations: ProgramAnnotation[];
  /** `${exercise lower-cased}|${contraindicationId}` warnings the trainer accepted. */
  acknowledged: string[];
  startDate: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  appliedAt?: string;
  aiRequest?: ProgramAiRequest;
  check: ProgramCheck;
}

export interface ProgramSummary {
  id: string;
  clientId: string | null;
  clientName?: string;
  name: string;
  status: TrainerProgram['status'];
  isTemplate: boolean;
  weeks: number;
  daysPerWeek: number;
  source: TrainerProgram['source'];
  updatedAt: string;
  publishedAt?: string;
}

/** A published trainer program as the client sees it in the portal. */
export interface PortalProgram {
  id: string;
  name: string;
  description: string;
  startDate: string | null;
  version: number;
  doc: ProgramDoc;
  /** Lower-cased exercise names a contraindication now refuses: shown as "skip until your trainer updates this". */
  skip: string[];
  /** App clients can run it in the Axiom app; link clients follow it here. */
  canApplyInApp: boolean;
  appliedAt: string | null;
}

// ─── Billing (Stripe Connect, 0% platform fee) ──────────────────────────────

export interface BillingStatus {
  /** False when this server has no Stripe keys. */
  available: boolean;
  connected: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  currency: string;
  dunningNudges: boolean;
  bookingNeedsCredit: boolean;
  /** Always 0: Axiom takes no cut. */
  platformFeePercent: number;
}

export interface OfferView {
  id: string;
  name: string;
  description: string;
  kind: 'subscription' | 'package' | 'one_time';
  priceCents: number;
  currency: string;
  interval: 'week' | 'month' | 'year' | null;
  intervalCount: number;
  sessionCredits: number | null;
  active: boolean;
}

export interface ClientPlanView {
  id: string;
  clientId: string;
  offer: OfferView | null;
  status: 'pending' | 'active' | 'past_due' | 'canceled' | 'complete';
  creditsTotal: number;
  creditsUsed: number;
  creditsLeft: number;
  currentPeriodEnd?: string;
  createdAt: string;
}

export interface PaymentView {
  id: string;
  clientId: string | null;
  kind: 'invoice' | 'checkout';
  amountDueCents: number;
  amountPaidCents: number;
  currency: string;
  status: 'open' | 'paid' | 'failed' | 'void' | 'uncollectible';
  attemptCount: number;
  nextAttemptAt?: string;
  paidAt?: string;
  hostedUrl?: string;
  createdAt: string;
}

export interface RevenueSummary {
  currency: string;
  mrrCents: number;
  collected30Cents: number;
  activeSubscriptions: number;
  pastDue: number;
  failingCents: number;
  churned30: number;
  /** Percent; null with no subscriptions at the start of the window. */
  churnRate30: number | null;
  perOffer: { offerId: string; name: string; active: number; sold30: number }[];
  recent: PaymentView[];
  platformFeePercent: number;
}

// ─── Scheduling ─────────────────────────────────────────────────────────────

export interface AvailabilityWindow {
  id?: string;
  weekday: number;
  startMinute: number;
  endMinute: number;
  slotMinutes: number;
  location: string | null;
}

export interface Slot {
  trainerId: string;
  trainerName: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
  /** The practice's local date and minute of day, for grouping without time-zone maths in the view. */
  localDate: string;
  localMinute: number;
}

export interface BookingView {
  id: string;
  clientId: string;
  clientName: string;
  trainerId: string;
  startsAt: string;
  endsAt: string;
  status: 'booked' | 'cancelled' | 'completed' | 'no_show';
  source: 'portal' | 'trainer';
  usedCredit: boolean;
  location: string | null;
  notes: string | null;
}

// ─── Retention and multi-coach teams ────────────────────────────────────────

export interface RetentionRow {
  clientId: string;
  client: ClientRef;
  /** 0–100, rules over data. */
  risk: number;
  level: 'low' | 'medium' | 'high';
  /** Written as what the trainer could help with, never as a verdict on the client. */
  reasons: string[];
  intervention: { kind: 'check_in' | 'lighten' | 'call' | 'billing'; text: string };
  engagement8w: number[];
}

export interface TeamMember {
  userId: string;
  name: string;
  email: string | null;
  role: 'owner' | 'coach';
  assignedClients: number;
  joinedAt: string;
}

export interface TeamAnalytics {
  trainers: {
    userId: string;
    name: string;
    role: 'owner' | 'coach';
    clients: number;
    needsSupport: number;
    highRisk: number;
    avgEngagement: number | null;
    sessionsNext7d: number;
    mrrCents: number;
  }[];
}

// ─── Leads and the public practice page ─────────────────────────────────────

export interface PublicPractice {
  slug: string;
  name: string;
  trainerName: string;
  bio: string;
  specialties: string[];
  styleTags: string[];
  languages: string[];
  format: PracticeProfile['format'];
  brandColor: string | null;
  accentColor: string | null;
  logoUrl: string | null;
  /** The trainer has availability, so the form offers a free consult slot. */
  offersConsults: boolean;
}

export interface LeadView {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  goal: string | null;
  message: string | null;
  source: 'public_page' | 'manual';
  status: 'new' | 'contacted' | 'consult_booked' | 'won' | 'lost';
  consultAt?: string;
  clientId: string | null;
  notes: string | null;
  followUpAt?: string;
  createdAt: string;
  /** New for more than a day, or a follow-up date has come. */
  needsFollowUp: boolean;
}
