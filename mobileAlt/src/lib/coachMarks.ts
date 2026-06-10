import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Coach-mark / spotlight-tour gating. Each tour has a stable id; once a user
// has run it (or explicitly dismissed) we record `coachmark:<id>=seen` in
// AsyncStorage and never run it again. ids include a version suffix
// (`-v1`, `-v2`) so a tour can be re-rolled to existing users by bumping it.
//
// Usage:
//   const tour = useCoachMarkGate('swap-workout-v1');
//   useEffect(() => { if (tour.shouldShow) start(); }, [tour.shouldShow]);
//   // When the tour finishes / dismisses:
//   tour.markSeen();
//
// Single source of truth — never read/write the AsyncStorage key directly.

const PREFIX = 'coachmark:';

interface TourGate {
  /** null while we're still reading AsyncStorage on mount. Treat as "not yet". */
  shouldShow: boolean | null;
  /** Persist this tour as seen. Idempotent. */
  markSeen: () => Promise<void>;
  /** Force the tour to re-run (debug / "show me again" affordance). */
  reset: () => Promise<void>;
}

export function useCoachMarkGate(tourId: string): TourGate {
  const [shouldShow, setShouldShow] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(PREFIX + tourId)
      .then((v) => { if (!cancelled) setShouldShow(v !== 'seen'); })
      .catch(() => { if (!cancelled) setShouldShow(false); });
    return () => { cancelled = true; };
  }, [tourId]);

  return {
    shouldShow,
    markSeen: async () => {
      await AsyncStorage.setItem(PREFIX + tourId, 'seen').catch(() => {});
      setShouldShow(false);
    },
    reset: async () => {
      await AsyncStorage.removeItem(PREFIX + tourId).catch(() => {});
      setShouldShow(true);
    },
  };
}

// One-shot version: for spots where the consumer doesn't need state, just
// "have I already shown this?". Avoids a re-render on read.
export async function hasSeenTour(tourId: string): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(PREFIX + tourId);
    return v === 'seen';
  } catch { return false; }
}

export async function markTourSeen(tourId: string): Promise<void> {
  await AsyncStorage.setItem(PREFIX + tourId, 'seen').catch(() => {});
}

// Catalog of tour ids in current use. Keeping them centralized so adding a
// new tour means adding one entry here and one consumer wiring — and so
// `git grep` lands you on the full inventory in one shot.
export const TOURS = {
  /** Program tab: points at the Swap button + explains the LLM rebalance flow. */
  SWAP_WORKOUT: 'swap-workout-v1',
  /** Nutrition tab: highlights the share-card button on a hit-goal day. */
  SHARE_NUTRITION: 'share-nutrition-v1',
  /** Weight detail: highlights the share-progress button. */
  SHARE_WEIGHT: 'share-weight-v1',
  /** Messages: highlights the group-chat create button. */
  GROUP_CHATS: 'group-chats-v1',
  /** Social composer: highlights the public/private toggle. */
  POST_VISIBILITY: 'post-visibility-v1',
} as const;
