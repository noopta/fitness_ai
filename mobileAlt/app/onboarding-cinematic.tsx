import React, { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { OnboardingPager, markCinematicOnboardingSeen } from '../src/onboarding/OnboardingPager';

/**
 * Stand-alone route for the cinematic first-run flow. Gated to first launches
 * only by `_layout.tsx` which redirects unauthed users with an unseen flag
 * here instead of `/(auth)/welcome`.
 *
 * On successful sign-in inside Scene07, we mark the seen flag and let the
 * AuthContext update — _layout's main routing useEffect then takes the user
 * to /(tabs)/coach (program generation) because they're now authed and
 * coachOnboardingDone is still false.
 */
export default function CinematicOnboardingScreen() {
  const router = useRouter();

  const handleSignedIn = useCallback(async () => {
    await markCinematicOnboardingSeen();
    // Don't navigate here. AuthContext + _layout will route to /(tabs)/coach
    // as soon as the user object is populated. Just clear this screen.
    router.replace('/(tabs)/coach' as any);
  }, [router]);

  return <OnboardingPager onSignedIn={handleSignedIn} />;
}
