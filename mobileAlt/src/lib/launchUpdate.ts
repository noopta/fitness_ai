import * as Updates from 'expo-updates';

/**
 * Bring a signed-out session onto the latest OTA before the user signs in.
 *
 * Why: with `fallbackToCacheTimeout: 0`, a fresh install's FIRST launch runs
 * the JS embedded in the store binary and only downloads the current OTA in
 * the background. Everything first-run — post-sign-in routing, the lift
 * diagnostic, flag handling — then runs code that can be months old (a
 * July 3.1.0 binary sent new users to the coach intake long after the
 * diagnostic replaced it). Signed out, there is no state to lose, so if a
 * newer update exists we fetch it and restart into it before sign-in.
 *
 * Bounded: one attempt per process, and a slow network just leaves the user
 * on the embedded bundle (the next launch applies the download anyway).
 */
let attempted = false;
const TIMEOUT_MS = 8000;

export async function applyPendingUpdateWhileSignedOut(): Promise<void> {
  if (attempted || __DEV__ || !Updates.isEnabled) return;
  attempted = true;
  try {
    const result = await withTimeout(
      (async () => {
        const check = await Updates.checkForUpdateAsync();
        if (!check.isAvailable) return false;
        const fetched = await Updates.fetchUpdateAsync();
        return fetched.isNew;
      })(),
      TIMEOUT_MS,
    );
    if (result) await Updates.reloadAsync();
  } catch {
    /* offline / timed out — keep going on the current bundle */
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | false> {
  return Promise.race([p, new Promise<false>((resolve) => setTimeout(() => resolve(false), ms))]);
}
