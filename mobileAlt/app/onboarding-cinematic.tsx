import React, { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { OnboardingPager, markCinematicOnboardingSeen } from '../src/onboarding/OnboardingPager';
import { postAuthDestination } from '../src/onboarding/formhook/postAuthRoute';
import { useAuth } from '../src/context/AuthContext';

/**
 * Stand-alone route for the cinematic first-run flow. Gated to first launches
 * only by `_layout.tsx` which redirects unauthed users with an unseen flag
 * here instead of `/(auth)/welcome`.
 *
 * On successful sign-in inside Scene07 we mark the seen flag and route via
 * postAuthDestination — the single source of truth for where a just-signed-in
 * user belongs. Routing here rather than deferring to _layout is deliberate:
 * _layout's branch is conditioned on the user still being in the auth or
 * cinematic segment, and every auth screen replaces the route itself first,
 * so relying on it silently dropped new users straight into the intake.
 */
export default function CinematicOnboardingScreen() {
  const router = useRouter();
  const { getLatestUser, getFeatures } = useAuth();

  const handleSignedIn = useCallback(async () => {
    await markCinematicOnboardingSeen();
    router.replace((await postAuthDestination(getLatestUser(), getFeatures())) as any);
  }, [router, getLatestUser, getFeatures]);

  return <OnboardingPager onSignedIn={handleSignedIn} />;
}
