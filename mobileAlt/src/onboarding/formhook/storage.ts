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
