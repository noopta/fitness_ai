// Contract types for the personal-training dashboard (design handoff v1, §8).
// The server is the source of truth for every derived field — status, the
// reason behind it, the engagement series and PR flags. Views render these;
// they never recompute them.

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
