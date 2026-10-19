// Crash-loop breaker for the v2 shell.
//
// The v2 group writes a boot marker when it mounts and clears it once it has
// been alive for a few seconds — or as soon as the app goes to the background
// (closing the app, an update reload, a phone call: none of those are crashes).
// Only a real crash loop — THREE boots in a row that died inside v2 while in
// the foreground — takes one launch of the classic app, so a bad update can
// never lock anyone out. Anything less stays in v2.
//
// History: on 2026-09-28 a first-render crash in v2 killed the app before the
// fix could download, which is why this exists. Until 19 Oct 2026 a single
// unfinished boot (closing the app within 6 s, or the reload that applies an
// OTA) was enough to drop a user into the classic app — that is how users kept
// seeing the old home. The user-facing "Switch to classic" was removed the same
// day (founder: nobody should ever see the old app); a stored preference from
// it is cleared here.

import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'v2:boot-marker:v1';
const STABLE_AFTER_MS = 6000;
const PREFER_CLASSIC = 'v2:prefer-classic:v1';
/** Consecutive unfinished v2 boots before one launch falls back to classic. */
export const CRASH_LOOP_BOOTS = 3;

let suppressedThisLaunch: boolean | null = null;
let unfinishedBoots = 0;

/** Pure: how many unfinished boots a stored marker records (old markers were a timestamp = 1). */
export function bootsFromMarker(v: string | null): number {
  if (!v) return 0;
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 && n < 100 ? Math.floor(n) : 1;
}

/** Read once per launch. True → skip v2 this launch (a genuine crash loop only). */
export async function v2SuppressedThisLaunch(): Promise<boolean> {
  if (suppressedThisLaunch != null) return suppressedThisLaunch;
  try {
    const v = await AsyncStorage.getItem(KEY);
    void AsyncStorage.removeItem(PREFER_CLASSIC).catch(() => {});
    unfinishedBoots = bootsFromMarker(v);
    suppressedThisLaunch = unfinishedBoots >= CRASH_LOOP_BOOTS;
    if (suppressedThisLaunch) { unfinishedBoots = 0; await AsyncStorage.removeItem(KEY); }
  } catch {
    suppressedThisLaunch = false;
  }
  if (suppressedThisLaunch) console.warn('[v2] v2 crashed on the last boots — using the classic app this launch');
  return suppressedThisLaunch;
}

/** Kept for classic's Settings "Try the new Axiom": back to the new UI at once. */
export async function setPreferClassic(on: boolean): Promise<void> {
  suppressedThisLaunch = on;
  try { await AsyncStorage.removeItem(PREFER_CLASSIC); } catch { /* nothing stored */ }
}

/** Synchronous view after the first read (the gate runs after auth resolves, which is after the read). */
export function v2SuppressedSync(): boolean {
  return suppressedThisLaunch === true;
}

/** Call when the v2 group mounts; returns a cleanup. */
export function markV2Boot(): () => void {
  void AsyncStorage.setItem(KEY, String(unfinishedBoots + 1)).catch(() => {});
  const stable = () => { unfinishedBoots = 0; void AsyncStorage.removeItem(KEY).catch(() => {}); };
  const t = setTimeout(stable, STABLE_AFTER_MS);
  // Leaving the app is not a crash.
  const sub = AppState.addEventListener('change', (s) => { if (s !== 'active') stable(); });
  return () => { clearTimeout(t); sub.remove(); };
}
