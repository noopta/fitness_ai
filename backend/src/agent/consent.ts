// Consent — "what Anakin may use" (PRF-11, You › Privacy). Switching a source
// off stops the coach READING it: it drops out of the turn context and the
// read tools over it refuse. Writing on request (log this meal) still works;
// the user asked for that directly.

import { PrismaClient } from '@prisma/client';
import { parseBlob } from './profile/coachProfile.js';

const prisma = new PrismaClient();

export type ConsentKey = 'logs' | 'health' | 'research' | 'nutrition';
export type Consent = Record<ConsentKey, boolean>;

export const CONSENT_DEFAULTS: Consent = { logs: true, health: true, research: true, nutrition: true };

export function parseConsent(coachProfile: string | null | undefined): Consent {
  const raw = parseBlob(coachProfile).consent;
  const out = { ...CONSENT_DEFAULTS };
  if (raw && typeof raw === 'object') {
    for (const k of Object.keys(out) as ConsentKey[]) if (typeof raw[k] === 'boolean') out[k] = raw[k];
  }
  return out;
}

export async function readConsent(userId: string): Promise<Consent> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { coachProfile: true } });
  return parseConsent(u?.coachProfile);
}

/** Read tools that surface a consent-gated source. */
export const CONSENT_GATED: Record<string, ConsentKey> = {
  read_recent_workouts: 'logs', read_exercise_history: 'logs', read_prs: 'logs',
  read_strength_profile: 'logs', read_lift_progress: 'logs', read_activity: 'logs', suggest_session: 'logs',
  read_nutrition_today: 'nutrition', read_nutrition_history: 'nutrition', read_micro_status: 'nutrition',
  read_gut_week: 'nutrition', read_nutrition_profile: 'nutrition',
  query_research: 'research',
};

export const CONSENT_LABEL: Record<ConsentKey, string> = {
  logs: 'training logs', health: 'health notes', research: 'web research', nutrition: 'food logs',
};

/** The model-facing refusal when a gated read hits a switched-off source. */
export function consentRefusal(key: ConsentKey) {
  return {
    error: 'consent_off',
    message: `The user has switched off Anakin's access to their ${CONSENT_LABEL[key]} (You › Privacy). Don't guess at that data. Say so plainly, answer without it, and offer to turn access back on with update_consent if it would help.`,
  };
}
