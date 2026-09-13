import AsyncStorage from '@react-native-async-storage/async-storage';

// Diagnostic-first onboarding: when the server flag is on, a new user's cold
// start is the lift diagnostic (pick lift → working sets → verdict) instead
// of the coach intake, and the paywall fires on the verdict screen. This flag
// mirrors the form hook's (see formhook/storage.ts): once the user has
// REACHED the verdict, later cold starts go to Home rather than marching
// them back through the diagnostic every launch.
//
// Failure direction matches the other first-run gates: a storage error reads
// as "not seen", which costs a repeat screen rather than stranding a brand-new
// user outside the funnel.
const DIAGNOSTIC_FIRST_SEEN_KEY = 'diagnosticFirstSeen.v1';

/** True once the user has reached the verdict screen at least once. */
export async function hasSeenDiagnosticFirst(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(DIAGNOSTIC_FIRST_SEEN_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function markDiagnosticFirstSeen(): Promise<void> {
  try { await AsyncStorage.setItem(DIAGNOSTIC_FIRST_SEEN_KEY, '1'); } catch { /* ignore */ }
}
