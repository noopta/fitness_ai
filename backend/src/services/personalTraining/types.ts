// Wire types for /api/personal-training. Mirrors
// packages/personal-training-core/src/types.ts — the backend does not import
// from packages/, so the two are kept in step by hand (handoff §8).

export type ClientStatus = 'support' | 'new' | 'onPlan' | 'paused';
export type EngagementTrend = 'rising' | 'steady' | 'falling';
export type Tone = 'red' | 'amber' | 'green' | 'zinc';

export interface Contraindication { label: string; note?: string; active: boolean }

export interface Client {
  id: string;
  name: string;
  initials: string;
  email: string | null;
  status: ClientStatus;
  statusReason?: string;
  channel: 'app' | 'webLink';
  program: { blockLabel: string; week: number; weeks: number; goal: string } | null;
  engagement8w: number[];
  engagementTrend: EngagementTrend;
  lastCheckInAt?: string;
  lastSessionAt?: string;
  joinedAt: string;
  contraindications: Contraindication[];
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
  ai?: boolean;
}
