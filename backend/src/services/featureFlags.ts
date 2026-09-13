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

/** Global switch for the diagnostic-first onboarding funnel. Off unless '1'. */
const DIAGNOSTIC_FIRST_ENABLED = process.env.DIAGNOSTIC_FIRST_ONBOARDING_ENABLED === '1';

/** Per-user allowlist, same shape and reasoning as the onboarding hook's. */
const DIAGNOSTIC_FIRST_ALLOWLIST = new Set(
  (process.env.DIAGNOSTIC_FIRST_ONBOARDING_USERS ?? '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean),
);

/**
 * Whether the diagnostic-first onboarding funnel is on for this user.
 *
 * When on, a new user's cold start is the lift diagnostic instead of the
 * coach intake, and the free tier gets the diagnosis but not the
 * prescription — the plan endpoints strip the fix for free users and the
 * paywall sells it back. Both the /auth/me advertisement and the plan
 * routes' enforcement read this same predicate, so the client is never told
 * the funnel is on while the server would serve the old shape (or vice
 * versa — a free user shown a locked card the server would have filled in).
 */
export function diagnosticFirstAvailableFor(userId: string, email?: string | null): boolean {
  if (DIAGNOSTIC_FIRST_ENABLED) return true;
  if (DIAGNOSTIC_FIRST_ALLOWLIST.has(userId.toLowerCase())) return true;
  return !!email && DIAGNOSTIC_FIRST_ALLOWLIST.has(email.toLowerCase());
}

/** Global switch for the conversational lift diagnostic. Off unless '1'. */
const LIFT_CONVERSATION_ENABLED = process.env.LIFT_DIAGNOSTIC_CONVERSATION_ENABLED === '1';

/** Per-user allowlist (ids and/or emails), same shape as the flags above. */
const LIFT_CONVERSATION_ALLOWLIST = new Set(
  (process.env.LIFT_DIAGNOSTIC_CONVERSATION_USERS ?? '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean),
);

/**
 * Whether the conversational lift diagnostic (single Anakin thread, handoff
 * "Axiom form diagnostic flow") replaces the 4-screen wizard for this user.
 * Off = today's wizard everywhere. /auth/me advertises it and the
 * /lift-diagnostics routes enforce it, from this one predicate.
 */
export function liftConversationAvailableFor(userId: string, email?: string | null): boolean {
  if (LIFT_CONVERSATION_ENABLED) return true;
  if (LIFT_CONVERSATION_ALLOWLIST.has(userId.toLowerCase())) return true;
  return !!email && LIFT_CONVERSATION_ALLOWLIST.has(email.toLowerCase());
}
