// Which events exist, their default delivery tier, and how a trainer's
// settings resolve to a tier for one event on one client (handoff §6.7).
// Pure — the briefing engine and the notification sweep both ask this.

import type { NotificationGroup, NotificationOverride, Tier } from './types.js';

export interface EventTypeDef {
  type: string;
  label: string;
  group: NotificationGroup;
  defaultTier: Tier;
  /** Safety events always reach the trainer: they can never be 'timeline' and they bypass quiet hours. */
  locked?: boolean;
}

export const EVENT_TYPES: EventTypeDef[] = [
  { type: 'painReported', label: 'Pain reported', group: 'Safety', defaultTier: 'immediate', locked: true },
  { type: 'guardrailBlocked', label: 'Guardrail blocked a change', group: 'Safety', defaultTier: 'briefing', locked: true },
  { type: 'missedCheckIn', label: 'Missed check-in', group: 'Engagement', defaultTier: 'briefing' },
  { type: 'noSession7d', label: 'No session for 7 days', group: 'Engagement', defaultTier: 'briefing' },
  { type: 'engagementDrop', label: 'Engagement falling', group: 'Engagement', defaultTier: 'briefing' },
  { type: 'messageWaiting', label: 'Message waiting on a reply', group: 'Engagement', defaultTier: 'briefing' },
  { type: 'workoutLogged', label: 'Workout logged', group: 'Client activity', defaultTier: 'timeline' },
  { type: 'checkInSubmitted', label: 'Check-in submitted', group: 'Client activity', defaultTier: 'briefing' },
  { type: 'bodyweightLogged', label: 'Bodyweight logged', group: 'Client activity', defaultTier: 'timeline' },
  { type: 'pr', label: 'New PR', group: 'Client activity', defaultTier: 'briefing' },
  { type: 'plateau', label: 'Plateau', group: 'Insights', defaultTier: 'briefing' },
  { type: 'recoveryTrend', label: 'Recovery trend', group: 'Insights', defaultTier: 'briefing' },
  { type: 'anakinSuggestion', label: 'Axiom suggestion waiting', group: 'Insights', defaultTier: 'briefing' },
];

export const TIERS: Tier[] = ['immediate', 'briefing', 'timeline'];
export const isTier = (v: unknown): v is Tier => typeof v === 'string' && (TIERS as string[]).includes(v);
export const eventDef = (type: string) => EVENT_TYPES.find((e) => e.type === type);

export interface TierSettings {
  rules: Record<string, Tier>;
  overrides: NotificationOverride[];
}

const lockTier = (def: EventTypeDef | undefined, tier: Tier): Tier => (def?.locked && tier === 'timeline' ? 'briefing' : tier);

/**
 * Tier for one event on one client. A live per-client override wins over the
 * trainer's rule, which wins over the default. Locked events are lifted to at
 * least 'briefing' whatever is stored, so a bad row can never silence them.
 */
export function resolveTier(settings: TierSettings, eventType: string, clientId: string | null, now: Date): Tier {
  const def = eventDef(eventType);
  const base = settings.rules[eventType] ?? def?.defaultTier ?? 'timeline';
  if (clientId) {
    const live = settings.overrides.filter(
      (o) => o.clientId === clientId && (!o.expiresAt || new Date(o.expiresAt).getTime() > now.getTime()),
    );
    const override = live.find((o) => o.eventType === eventType) ?? live.find((o) => o.eventType === '*');
    if (override) return lockTier(def, override.tier);
  }
  return lockTier(def, base);
}

export const DEFAULT_TIER_SETTINGS: TierSettings = { rules: {}, overrides: [] };
