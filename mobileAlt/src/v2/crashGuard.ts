// Crash-loop breaker for the v2 shell.
//
// The v2 group writes a boot marker when it mounts and clears it once it has
// been alive for a few seconds. If the marker is still there at the next
// launch, the previous boot died inside v2 — so that launch takes the classic
// app instead (and clears the marker). One bad update can then never lock a
// user out: the classic app runs, expo-updates finishes downloading the fix in
// the background, and the launch after that is v2 again.
//
// This exists because on 2026-09-28 a first-render crash in v2 killed the app
// ~100 ms after mount — before the 14 MB fix could download — for the only
// account on the flag. The server kill switch got them back in; this makes
// the client recover on its own.
//
// The same switch carries the user's own choice (Account → Switch to classic,
// v2 A-04): on this phone, until they pick "Try the new Axiom" in classic's
// Settings. Per phone, not per account — no server field.

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'v2:boot-marker:v1';
const STABLE_AFTER_MS = 6000;
const PREFER_CLASSIC = 'v2:prefer-classic:v1';

let suppressedThisLaunch: boolean | null = null;

/** Read once per launch. True → skip v2 this launch. */
export async function v2SuppressedThisLaunch(): Promise<boolean> {
  if (suppressedThisLaunch != null) return suppressedThisLaunch;
  try {
    const [v, prefer] = await Promise.all([AsyncStorage.getItem(KEY), AsyncStorage.getItem(PREFER_CLASSIC)]);
    suppressedThisLaunch = !!v || prefer === '1';
    if (v) await AsyncStorage.removeItem(KEY);
  } catch {
    suppressedThisLaunch = false;
  }
  if (suppressedThisLaunch) console.warn('[v2] previous boot died inside v2 — using the classic app this launch');
  return suppressedThisLaunch;
}

/** The user's own choice: true → classic on this phone from now on; false → back to the new UI. Takes effect at once. */
export async function setPreferClassic(on: boolean): Promise<void> {
  suppressedThisLaunch = on;
  try {
    if (on) await AsyncStorage.setItem(PREFER_CLASSIC, '1');
    else await AsyncStorage.removeItem(PREFER_CLASSIC);
  } catch { /* the in-memory switch still holds for this launch */ }
}

/** Synchronous view after the first read (the gate runs after auth resolves, which is after the read). */
export function v2SuppressedSync(): boolean {
  return suppressedThisLaunch === true;
}

/** Call when the v2 group mounts; returns a cleanup that cancels the stable timer. */
export function markV2Boot(): () => void {
  void AsyncStorage.setItem(KEY, String(Date.now())).catch(() => {});
  const t = setTimeout(() => { void AsyncStorage.removeItem(KEY).catch(() => {}); }, STABLE_AFTER_MS);
  return () => clearTimeout(t);
}
