import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Onboarding test account: device-side half of the reset ───────────────────
//
// The server wipes the ACCOUNT back to new on every sign-in, but that alone
// does not restart the funnel. The gates that decide whether to show the cold
// start are device-local (`cinematicOnboardingSeen.v1`, `diagnosticFirstSeen.v1`,
// `onboardingFormHookSeen.v1`, …) and survive logout, so on the second run the
// same phone would skip straight to Home against a freshly blanked account —
// the worst of both states.
//
// Clearing them here is safe precisely because it is gated on the server's
// `onboardingTestAccount` flag: a normal user never reaches this code, and a
// compromised client cannot set the flag on itself.

/**
 * Device-local first-run keys. Explicitly enumerated rather than swept by
 * prefix so an unrelated `axiom_`-prefixed value (the IAP product id, for one)
 * can never be caught up in the wipe.
 */
const FIRST_RUN_KEYS = [
  // Cinematic intro pager.
  'cinematicOnboardingSeen.v1',
  'cinematicOnboardingIndex.v1',
  // Diagnostic-first funnel + onboarding form hook.
  'diagnosticFirstSeen.v1',
  'onboardingFormHookSeen.v1',
  // In-flight diagnostic draft (lift, targets, session).
  'axiom_session_id',
  'axiom_selected_lift',
  'axiom_target_weight',
  'axiom_target_sets',
  'axiom_target_reps',
  // Intake answers cached before the account existed.
  'axiom_height_ft',
  'axiom_height_in',
  'axiom_weight_lbs',
  'axiom_training_age',
  'axiom_equipment',
  'axiom_constraints',
  // First-run interstitials a new user would still see.
  'whatsNew:lastSeenVersion',
  '@tt_consent_seen',
];

/** Coach-mark tour keys are dynamic (`coachmark:<tourId>`), so sweep by prefix. */
const COACHMARK_PREFIX = 'coachmark:';

/**
 * Clear every device-local flag that would let this phone skip onboarding.
 *
 * Never throws. A storage failure here reads the same way the individual gates
 * already fail — as "not seen" — which costs a repeated screen rather than
 * breaking the sign-in that just succeeded.
 */
export async function clearLocalOnboardingState(): Promise<void> {
  try {
    const all = await AsyncStorage.getAllKeys();
    const coachmarks = all.filter((k) => k.startsWith(COACHMARK_PREFIX));
    await AsyncStorage.multiRemove([...FIRST_RUN_KEYS, ...coachmarks]);
  } catch {
    /* ignore — see above */
  }
}
