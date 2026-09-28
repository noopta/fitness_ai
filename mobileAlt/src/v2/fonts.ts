// Inter for the v2 shell.
//
// The app used system fonts until v2. Fonts are loaded by the v2 route group
// (not the root layout) so the boot path of the v1 app is unchanged — the
// root has three subsystems disabled for SDK-55 launch-crash isolation and
// gains nothing new here. If loading fails or takes too long the shell
// renders with the system fallback rather than blocking: `fontFamily`
// resolves to the platform default when the face isn't registered.

import { useEffect, useState } from 'react';
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';

const FONT_TIMEOUT_MS = 2500;

export function useV2Fonts(): boolean {
  const [loaded, error] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (loaded || error) return;
    const t = setTimeout(() => setTimedOut(true), FONT_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [loaded, error]);
  if (error) console.warn('[v2] Inter failed to load; using system font', error);
  return loaded || !!error || timedOut;
}
