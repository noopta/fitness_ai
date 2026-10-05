import { hasSeenFormHook, isOldEnoughForFormHook } from './storage';
import { hasSeenDiagnosticFirst } from '../diagnosticFirst';
import { diagnosticEntryRoute } from '../../diagnostic/entry';
import { v2SuppressedSync } from '../../v2/crashGuard';

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
export async function postAuthDestination(
  user: { coachOnboardingDone?: boolean; dateOfBirth?: string | null } | null | undefined,
  features?: { onboardingFormHook?: boolean; diagnosticFirstOnboarding?: boolean; liftDiagnosticConversation?: boolean; uiV2?: boolean; directEntryPaywall?: boolean; freestyle?: boolean; logAdaptation?: boolean; phaseInference?: boolean; mealPhotoV2?: boolean },
): Promise<string> {
  if (!user) return '/(auth)/welcome';
  // Agent-first v2 shell: onboarded users land on the track; new users go
  // straight into the v2 program onboarding (program-first — the diagnostic
  // is offered inside it rather than gating it). Checked before every other
  // funnel flag so the v1 funnels never fire for a v2 user.
  if (features?.uiV2 && !v2SuppressedSync()) return user.coachOnboardingDone ? '/(v2)' : '/(v2)/onboarding';
  if (user.coachOnboardingDone) return '/(tabs)';
  // Classic paywall (server flag): new users go straight into the app. The coach
  // tab is Pro-only there, so no free intake, diagnostic or form hook first.
  // The funnels below stay in place for when the flag is off.
  if (features?.directEntryPaywall) return '/(tabs)';
  // Diagnostic-first funnel: the cold start is the lift diagnostic, not the
  // intake — verdict first, paywall on the verdict, intake only inside the
  // trial. Takes precedence over the form hook: when both flags are on the
  // diagnostic IS the funnel and the hook stays an alternate entry. A user
  // who already reached a verdict and declined lands on Home, where the
  // coach tab shows the locked upsell rather than a free full-program intake.
  if (features?.diagnosticFirstOnboarding) {
    return (await hasSeenDiagnosticFirst()) ? '/(tabs)' : diagnosticEntryRoute(features);
  }
  // Conversational lift diagnostic: a new user's first stop after sign-in,
  // ahead of the form hook and the intake. Once they've reached a verdict or
  // exited it, later sign-ins fall through to the chain below as before.
  if (features?.liftDiagnosticConversation && !(await hasSeenDiagnosticFirst())) {
    return '/diagnostic/conversation';
  }
  // The server's kill switch, checked BEFORE we route anyone into the hook.
  // Without this the feature being dark would still show the whole capture
  // flow and only fail on upload — the user films a set for nothing. Omitted
  // or false both mean off, so an older client or a failed /auth/me leaves it
  // dark rather than guessing.
  if (!features?.onboardingFormHook) return '/(tabs)/coach';
  if (!isOldEnoughForFormHook(user.dateOfBirth)) return '/(tabs)/coach';
  return (await hasSeenFormHook()) ? '/(tabs)/coach' : '/onboarding-form';
}
