// Light haptics for row select, set rating and send.
//
// expo-haptics is a native module that the 3.1.x store binaries do not
// include. The v2 shell ships OTA onto those binaries first, so the import is
// guarded: on a binary without the module every call is a no-op, and on the
// 3.2.0 build (which links it) it works. Never let a missing module throw at
// module-load time — that was the shape of the last launch crash.

type HapticsModule = typeof import('expo-haptics');

let mod: HapticsModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  mod = require('expo-haptics');
} catch {
  mod = null;
}

const safe = (fn: () => Promise<void> | void) => {
  try { void Promise.resolve(fn()).catch(() => {}); } catch { /* no-op */ }
};

export const haptics = {
  /** Row select, option pick. */
  select: () => safe(() => mod?.selectionAsync?.()),
  /** Light tap — send, begin. */
  light: () => safe(() => mod?.impactAsync?.(mod.ImpactFeedbackStyle.Light)),
  /** Set rated, meal logged. */
  success: () => safe(() => mod?.notificationAsync?.(mod.NotificationFeedbackType.Success)),
  warning: () => safe(() => mod?.notificationAsync?.(mod.NotificationFeedbackType.Warning)),
  available: () => mod != null,
};
