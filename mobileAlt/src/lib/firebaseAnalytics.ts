// Firebase Analytics — exists ONLY to feed Google Ads conversion tracking.
// Product analytics still go through PostHog. This file is a thin mirror
// of the events Google needs to see (sign_up, login, tutorial_complete,
// level_up, purchase, etc.) — Google's conversion bidding can't optimize
// against PostHog events directly.
//
// IMPORTANT — same pattern as expo-camera + vision-camera + Sentry:
// @react-native-firebase/analytics is a NATIVE module. An OTA-delivered
// JS bundle that references it on a binary that wasn't built with the
// Firebase plugin will crash at module load. We lazy-load via require()
// inside try/catch so the analytics calls become no-ops on old binaries.

import { Platform } from 'react-native';

type FirebaseAnalyticsModule = {
  default: () => {
    logEvent: (name: string, params?: Record<string, unknown>) => Promise<void>;
    setUserId: (id: string | null) => Promise<void>;
    setUserProperty: (name: string, value: string | null) => Promise<void>;
    setAnalyticsCollectionEnabled: (enabled: boolean) => Promise<void>;
  };
};

let _analytics: ReturnType<FirebaseAnalyticsModule['default']> | null = null;
let _probed = false;

function getAnalytics() {
  if (_probed) return _analytics;
  _probed = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const mod = require('@react-native-firebase/analytics') as FirebaseAnalyticsModule;
    _analytics = mod.default();
    return _analytics;
  } catch {
    _analytics = null;
    return null;
  }
}

// ─── Public surface ────────────────────────────────────────────────────────

/**
 * Fire-and-forget Firebase Analytics event. Safe to call on any binary —
 * silently no-ops when the native module isn't present (OTA-on-old-binary
 * case) or when the runtime is web (no Firebase RN SDK there).
 *
 * Use Firebase's recommended event names for conversion tracking
 * (https://support.google.com/firebase/answer/9267735):
 *   - sign_up       — user account created (any method)
 *   - login         — returning user authenticated
 *   - tutorial_complete — onboarding finished (= coach onboarding done)
 *   - level_up      — milestone reached (= first plan generated)
 *   - purchase      — paid conversion (Pro upgrade via any payment method)
 *   - generate_lead — free signup → some commitment step
 *   - app_open      — auto-fired on cold start (no need to call manually)
 */
export function logFirebaseEvent(name: string, params?: Record<string, unknown>): void {
  if (Platform.OS === 'web') return;
  const a = getAnalytics();
  if (!a) return;
  a.logEvent(name, params as any).catch(() => {});
}

/** Associate the current Firebase distinct id with our user id. */
export function setFirebaseUserId(userId: string | null): void {
  if (Platform.OS === 'web') return;
  const a = getAnalytics();
  if (!a) return;
  a.setUserId(userId).catch(() => {});
}

/** Free-form user property for cohort analysis. */
export function setFirebaseUserProperty(name: string, value: string | null): void {
  if (Platform.OS === 'web') return;
  const a = getAnalytics();
  if (!a) return;
  a.setUserProperty(name, value).catch(() => {});
}

/** Master kill switch (e.g. if user opts out of analytics in settings). */
export function setFirebaseAnalyticsEnabled(enabled: boolean): void {
  if (Platform.OS === 'web') return;
  const a = getAnalytics();
  if (!a) return;
  a.setAnalyticsCollectionEnabled(enabled).catch(() => {});
}

/** Cheap availability probe (used in tests / debug screens). */
export function isFirebaseAnalyticsAvailable(): boolean {
  return getAnalytics() !== null;
}
