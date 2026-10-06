// Pro gate for the v2 shell (direct-entry paywall, founder 6 Oct 2026).
//
// New users land on Home and can look around; attempting a feature — chat with
// Anakin, logging food or a session, building a program — opens the paywall.
// Only while the server's DIRECT_ENTRY_PAYWALL_ENABLED flag is on: with it off
// the shell behaves as before (onboarding → paywall → Home).
//
// Two shapes:
//  - requirePro(action) for inline actions (send a chat, one-tap log). Runs the
//    action for Pro users; otherwise pushes the paywall and returns false.
//  - useProScreen() at the top of a gated screen (session, capture, food
//    search, onboarding). Swaps the screen for the paywall so "Not now" goes
//    back to wherever the user tapped from.

import { useCallback, useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useAuth } from '../../context/AuthContext';

export function isProTier(tier?: string | null): boolean {
  return tier === 'pro' || tier === 'enterprise';
}

/** True when this user must pay before using features. */
export function useNeedsPro(): boolean {
  const { user, getFeatures } = useAuth();
  return !!user && getFeatures().directEntryPaywall && !isProTier(user.tier);
}

export function useRequirePro() {
  const router = useRouter();
  const needsPro = useNeedsPro();
  return useCallback(<T,>(action?: () => T): T | false => {
    if (needsPro) {
      router.push({ pathname: '/(v2)/paywall', params: { gate: '1' } } as any);
      return false;
    }
    return action ? action() : (true as any);
  }, [needsPro, router]);
}

/** Call first thing in a gated screen. Returns true while the screen should render nothing. */
export function useProScreen(): boolean {
  const router = useRouter();
  const needsPro = useNeedsPro();
  useEffect(() => {
    if (needsPro) router.replace({ pathname: '/(v2)/paywall', params: { gate: '1' } } as any);
  }, [needsPro, router]);
  return needsPro;
}
