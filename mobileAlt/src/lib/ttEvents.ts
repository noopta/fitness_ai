// Train Together — tiny event bus for live pin-state updates.
//
// Pin state changes on the SERVER (a partner accepts, a schedule shifts a
// pin to 'changed'), so screens showing pin state go stale the moment
// someone else acts. Every mutation the user would notice arrives as a push
// notification; usePushNotifications forwards those (and app-foreground
// transitions) here, and any mounted Train Together surface refetches.

import { DeviceEventEmitter } from 'react-native';
import { useEffect } from 'react';

const TT_PINS_CHANGED = 'tt:pins-changed';

/** Fire when pin state may have changed (push received, app foregrounded). */
export function emitPinsChanged(): void {
  DeviceEventEmitter.emit(TT_PINS_CHANGED);
}

/**
 * Re-run `refetch` whenever pin state may have changed, and every
 * `intervalMs` as a fallback for pushes that never arrive (denied
 * permissions, dropped delivery). Interval is deliberately slow — the push
 * path is the real-time one.
 */
export function usePinsRefresh(refetch: () => void, intervalMs = 45_000): void {
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(TT_PINS_CHANGED, refetch);
    const timer = setInterval(refetch, intervalMs);
    return () => { sub.remove(); clearInterval(timer); };
  }, [refetch, intervalMs]);
}
