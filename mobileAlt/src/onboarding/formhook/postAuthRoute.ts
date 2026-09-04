import { hasSeenFormHook, isOldEnoughForFormHook } from './storage';

/**
 * Where a freshly-authenticated user belongs.
 *
 * This exists because the first version of the onboarding hook did not work:
 * the gate lived only in app/_layout.tsx and fired on `inAuthGroup ||
 * inCinematic`, but every auth screen calls router.replace('/(tabs)/coach')
 * itself the moment sign-in succeeds. By the time auth state propagated, the
 * segment was already '(tabs)', the gate's branch never ran, and new users
 * were dropped straight into the intake — the exact thing the hook is meant
 * to come before.
 *
 * So the decision lives here, in one place, and every screen that routes a
 * user post-authentication calls it. A gate that has to out-race nine
 * hardcoded router.replace calls is not a gate.
 *
 * Order matters:
 *  1. Finished the intake already -> Home. Checked FIRST so a returning user
 *     re-authenticating never re-enters a first-run screen.
 *  2. Eligible for the hook and hasn't seen it -> the hook.
 *  3. Otherwise -> the intake.
 *
 * Eligibility fails closed on both counts: a storage error reads as "already
 * seen" is wrong, so hasSeenFormHook returns false and they see it once more;
 * a missing date of birth reads as not-an-adult and they skip it entirely.
 */
export async function postAuthDestination(user: {
  coachOnboardingDone?: boolean;
  dateOfBirth?: string | null;
} | null | undefined): Promise<string> {
  if (!user) return '/(auth)/welcome';
  if (user.coachOnboardingDone) return '/(tabs)';
  if (!isOldEnoughForFormHook(user.dateOfBirth)) return '/(tabs)/coach';
  return (await hasSeenFormHook()) ? '/(tabs)/coach' : '/onboarding-form';
}
