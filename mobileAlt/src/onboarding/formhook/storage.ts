import AsyncStorage from '@react-native-async-storage/async-storage';

// Mirrors the cinematic pager's flag (see OnboardingPager) so the two
// first-run gates behave the same way and fail the same way — a storage
// error reads as "not seen", which costs an extra screen rather than
// trapping the user outside the funnel.
const FORM_HOOK_SEEN_KEY = 'onboardingFormHookSeen.v1';

/**
 * True once the user has finished OR skipped the first-run form-analysis
 * hook. Deliberately covers skip as well as completion: a user who declined
 * to film themselves at signup must not be asked again every cold start.
 */
export async function hasSeenFormHook(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(FORM_HOOK_SEEN_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function markFormHookSeen(): Promise<void> {
  try { await AsyncStorage.setItem(FORM_HOOK_SEEN_KEY, '1'); } catch { /* ignore */ }
}

/**
 * Minimum age for the onboarding form-analysis hook. Deliberately 18, not the
 * app's 13+ minimum — it matches the line already drawn for retained stills,
 * and the backend enforces the same number independently (a client-side age
 * check is a UX affordance, never a control).
 */
export const FORM_HOOK_MIN_AGE = 18;

/**
 * Fails CLOSED: a user with no date of birth on file is not treated as an
 * adult. They skip the hook and go straight to intake, which is a strictly
 * better outcome than guessing and a better one than blocking them entirely.
 */
export function isOldEnoughForFormHook(dateOfBirth?: string | null): boolean {
  if (!dateOfBirth) return false;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return false;
  const years = (Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  return years >= FORM_HOOK_MIN_AGE;
}
