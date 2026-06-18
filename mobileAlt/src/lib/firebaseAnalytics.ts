// Firebase Analytics — TEMPORARILY DISABLED (no-op stub).
//
// @react-native-firebase was removed in 2.2.2 because it requires
// useFrameworks:"static", which under the mandatory Xcode 26 toolchain caused a
// libc++ ABI collision between the prebuilt Hermes (LLVM 18) and from-source
// reanimated (LLVM 20) — corrupting Hermes' heap and crashing every build on
// launch. Dropping Firebase returns the app to the standard Expo SDK-54 config
// (dynamic linking, shared system libc++) that launches cleanly under Xcode 26.
//
// Product analytics are unaffected — they go through PostHog. These functions
// keep their original signatures so every call site (analytics.ts) stays intact;
// they're just no-ops now. Re-introduce Firebase (for Google Ads conversion
// tracking) via Expo SDK 55+ precompiled modules, which fix the ABI issue.

import { Platform } from 'react-native';

// ─── Public surface (no-op) ──────────────────────────────────────────────────

/** No-op: Firebase Analytics removed. Product analytics go through PostHog. */
export function logFirebaseEvent(_name: string, _params?: Record<string, unknown>): void {}

/** No-op: Firebase Analytics removed. */
export function setFirebaseUserId(_userId: string | null): void {}

/** No-op: Firebase Analytics removed. */
export function setFirebaseUserProperty(_name: string, _value: string | null): void {}

/** No-op: Firebase Analytics removed. */
export function setFirebaseAnalyticsEnabled(_enabled: boolean): void {}

/** Firebase Analytics is not available (removed). */
export function isFirebaseAnalyticsAvailable(): boolean {
  // Referenced to keep the RN import meaningful for web/native parity checks.
  return Platform.OS === 'web' ? false : false;
}
