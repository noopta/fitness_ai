// Keep Apple Health data fresh without the user thinking about it: once
// connected (a first sync has happened), sync when the app comes to the
// foreground if the last sync is more than an hour old. Failures are silent —
// the watch page shows when it last worked.

import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { healthKit, syncAppleHealth, lastAppleSync } from './appleHealth';

const EVERY_MS = 60 * 60_000;

export function useAppleHealthAutoSync() {
  const { user, getFeatures } = useAuth();
  const running = useRef(false);
  useEffect(() => {
    if (Platform.OS !== 'ios' || !user || !getFeatures().wearables || !healthKit()) return;
    const maybeSync = async () => {
      if (running.current) return;
      const last = await lastAppleSync();
      if (!last || Date.now() - last < EVERY_MS) return; // never connected, or fresh enough
      running.current = true;
      try { await syncAppleHealth(); } catch { /* try again next foreground */ }
      running.current = false;
    };
    void maybeSync();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void maybeSync(); });
    return () => sub.remove();
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
}
