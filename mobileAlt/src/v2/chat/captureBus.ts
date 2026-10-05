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

// A turn added to the thread outside a reply (a Logged card from food search):
// the home chat re-reads its history so the card shows up in place.
const rehydrators = new Set<() => void>();
export const threadBus = {
  on(fn: () => void) { rehydrators.add(fn); return () => { rehydrators.delete(fn); }; },
  rehydrate() { for (const fn of rehydrators) fn(); },
};
