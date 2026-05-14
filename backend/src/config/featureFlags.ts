// Server-side feature flags. Keep this file tiny — every flag here is also
// duplicated on the mobile side, so the names need to match for clarity.
//
// Pattern: each flag has a default (off in production) AND an allowlist of
// user IDs/emails it's on for regardless of default. Lets us ship behind
// the flag, dogfood with a handful of accounts, then flip the default when
// we're confident.

const ENV_BOOL = (k: string) => {
  const v = process.env[k];
  return v === '1' || v === 'true' || v === 'yes';
};

// Muscle-level drill-down on the Strength Profile radar (Phase 1 of the
// Anakin Body Build feature). When ON for a user, /strength/profile
// computes and returns muscleScores. When OFF, the field is omitted —
// clients fall back to the existing 6-axis movement view unchanged.
export const MUSCLE_DRILLDOWN_DEFAULT = ENV_BOOL('FEATURE_MUSCLE_DRILLDOWN');

// Email allowlist — these accounts see the feature regardless of default.
// Add tester emails here for staged rollout. Compared lowercase, trimmed.
const MUSCLE_DRILLDOWN_EMAIL_ALLOWLIST = new Set<string>([
  'anuptaislam33@gmail.com',
  'inquiries@axiomtraining.io',
]);

/**
 * Returns true if the muscle drill-down feature should be enabled for a
 * given viewer. Email match takes precedence over the env default so we
 * can dogfood without flipping the global flag.
 */
export function isMuscleDrillDownEnabled(viewer: { email?: string | null }): boolean {
  if (MUSCLE_DRILLDOWN_DEFAULT) return true;
  const email = (viewer.email ?? '').trim().toLowerCase();
  return email !== '' && MUSCLE_DRILLDOWN_EMAIL_ALLOWLIST.has(email);
}
