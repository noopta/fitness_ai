// Server-owned feature flags.
//
// Kept out of the route modules so that anything needing to answer "is this
// on for this user" — the route that enforces it and the /auth/me payload
// that tells the client — reads the same predicate rather than importing a
// router for a boolean.

/** Global switch. Off unless explicitly '1'. */
const ONBOARDING_HOOK_ENABLED = process.env.ONBOARDING_FORM_HOOK_ENABLED === '1';

/**
 * Per-user allowlist, so the hook can be exercised on real devices without
 * turning it on for real signups.
 *
 * This exists because the two states we actually need are not "on" and "off"
 * — they are "off for the public" and "on for whoever is testing it".
 * Without it, the only way to see the flow is to enable it for every new
 * user, which is exactly what the outstanding DPIA conditions say must not
 * happen yet. Comma-separated user ids and/or emails.
 */
const ONBOARDING_HOOK_ALLOWLIST = new Set(
  (process.env.ONBOARDING_FORM_HOOK_USERS ?? '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean),
);

/**
 * Whether the onboarding form hook is available to this user: the global
 * switch, or an explicit allowlist entry by id or email.
 *
 * Both the enforcement point (the upload route) and the advertisement point
 * (/auth/me) call this, so the client can never be told the feature is on
 * while the route would refuse it — the bug that would otherwise have users
 * film a set for nothing.
 */
export function onboardingHookAvailableFor(userId: string, email?: string | null): boolean {
  if (ONBOARDING_HOOK_ENABLED) return true;
  if (ONBOARDING_HOOK_ALLOWLIST.has(userId.toLowerCase())) return true;
  return !!email && ONBOARDING_HOOK_ALLOWLIST.has(email.toLowerCase());
}
