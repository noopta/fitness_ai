// Client-side feature flags. Mirrors backend/src/config/featureFlags.ts —
// flag names match exactly so server and client agree on what's enabled
// for a given user.
//
// Pattern: each flag has a default (off in production) AND an email
// allowlist that overrides the default. To dogfood: add your email to
// the allowlist below + the matching backend file, ship the build, and
// the feature is live for you while everyone else stays on the existing
// behavior.

const MUSCLE_DRILLDOWN_DEFAULT = false;

const MUSCLE_DRILLDOWN_EMAIL_ALLOWLIST = new Set<string>([
  'anuptaislam33@gmail.com',
]);

interface FlaggedUser {
  email?: string | null;
}

/**
 * Returns true if the muscle drill-down feature is enabled for this user.
 * Pass the `user` from `useAuth()` (or null when pre-auth — flag stays off
 * until auth resolves).
 */
export function isMuscleDrillDownEnabled(user: FlaggedUser | null | undefined): boolean {
  if (MUSCLE_DRILLDOWN_DEFAULT) return true;
  if (!user?.email) return false;
  return MUSCLE_DRILLDOWN_EMAIL_ALLOWLIST.has(user.email.trim().toLowerCase());
}
