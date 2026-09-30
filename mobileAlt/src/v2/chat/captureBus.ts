// Capture round-trip (spec §7.7): a capture card opens the camera with its
// card id; when the capture screen logs something it reports the ids back
// here, and the thread answers the card so the Logged card replaces the
// placeholder in place.

type Listener = (cardId: string, ids: string[]) => void;
const listeners = new Set<Listener>();

export const captureBus = {
  on(fn: Listener) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  done(cardId: string | undefined, ids: string[]) {
    if (!cardId || !ids.length) return;
    for (const fn of listeners) fn(cardId, ids);
  },
};
