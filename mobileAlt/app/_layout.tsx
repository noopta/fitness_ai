// NOTE: Sentry JS init is intentionally DISABLED here. `@sentry/react-native`
// is a native module — its `import` throws at startup on any binary that
// wasn't built with the Sentry config plugin. The App Store binary (1.2.1)
// predates the plugin, so OTA-shipping this import crashed every production
// user on launch. Re-enable ONLY after a fresh `eas build --profile
// production` ships a binary that includes the native module (1.2.2+). The
// dependency + app.json plugin stay in place so that build links it.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { PostHogProvider } from 'posthog-react-native';
import { AuthProvider, useAuth } from '../src/context/AuthContext';
import { UnitsProvider } from '../src/context/UnitsContext';
import { LoadingSpinner } from '../src/components/ui/LoadingSpinner';
import { colors } from '../src/constants/theme';
import { usePushNotifications } from '../src/lib/usePushNotifications';
import { ensureDailyReminderScheduled, cancelDailyReminder } from '../src/lib/dailyReminder';
import { posthog, identifyUser, resetUser } from '../src/lib/analytics';
import { WhatsNewModal, shouldShowWhatsNew, markWhatsNewSeen } from '../src/components/WhatsNewModal';
import { hydrateCacheFromStorage } from '../src/lib/cache';
import { runBootPrefetch } from '../src/lib/prefetch';
import { hasSeenCinematicOnboarding } from '../src/onboarding/OnboardingPager';
import { hasSeenFormHook } from '../src/onboarding/formhook/storage';
import { postAuthDestination } from '../src/onboarding/formhook/postAuthRoute';
import { hasSeenDiagnosticFirst } from '../src/onboarding/diagnosticFirst';
import { applyPendingUpdateWhileSignedOut } from '../src/lib/launchUpdate';
import { v2SuppressedThisLaunch, v2SuppressedSync } from '../src/v2/crashGuard';
import { TRAINER_HOME, loadTrainerMode } from '../src/features/personal-training/mode';
import * as Sentry from '@sentry/react-native';
// Sentry.init runs in index.js (the app entry) BEFORE any of these imports, so
// it captures module-load startup errors. Here we only wrap the root component.

const queryClient = new QueryClient();

function RootNavigator() {
  const { user, loading, needsDobCheck, getFeatures } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  // Pre-warm the in-memory cache from AsyncStorage so a cold app launch can
  // serve every screen's synchronous getCached() read instead of refetching.
  // The hydration is fast (~50-100ms for our small cache footprint) and runs
  // in parallel with auth bootstrap.
  const [cacheReady, setCacheReady] = useState(false);

  useEffect(() => {
    // The v2 crash guard is read before anything routes (cacheReady gates the tree).
    void Promise.all([hydrateCacheFromStorage(), v2SuppressedThisLaunch()]).finally(() => setCacheReady(true));
  }, []);

  // Global JS error capture → PostHog. The previous handler still runs after
  // we report, so React Native's red box / fatal-on-fatal behavior is
  // unchanged. Sentry's native module isn't initialised in JS (see top of
  // file), so without this hook uncaught render/exception errors vanish into
  // console.error with no remote breadcrumb. PostHog captures them as
  // $exception events visible in Activity → Errors.
  useEffect(() => {
    const g: any = (globalThis as any).ErrorUtils;
    if (!g) return;
    const prev = g.getGlobalHandler?.();
    g.setGlobalHandler?.((error: Error, isFatal?: boolean) => {
      // Report to Sentry explicitly — reliable upload even mid-startup, unlike
      // PostHog's batched queue.
      try { Sentry.captureException(error); } catch { /* noop */ }
      try {
        posthog.capture('$exception', {
          $exception_message: error?.message ?? String(error),
          $exception_stack_trace_raw: error?.stack ?? '',
          $exception_type: (error as any)?.name ?? 'Error',
          is_fatal: !!isFatal,
        });
      } catch { /* never let our reporter mask the real error */ }
      // Do NOT escalate fatals to React Native's RCTFatal — that hard-crashes
      // the app at startup before the report can upload, and lets a single bad
      // async startup call take the whole app down. Swallow fatals (app stays
      // alive, possibly degraded) so we can both capture the error AND keep
      // running. Non-fatals pass through unchanged. Hardening for the SDK-55
      // launch crashes; revisit escalation once startup is verified clean.
      if (!isFatal) prev?.(error, isFatal);
    });
    return () => { if (prev) g.setGlobalHandler?.(prev); };
  }, []);

  // Boot-time prefetch. Fires after auth resolves to a real user (skips
  // pre-auth + age-check states), once per session per userId. Warms the
  // in-memory caches that Coach/Social/Nutrition/Strength tabs read on
  // mount so tab switches are instant.
  //
  // Fire-and-forget: failures are swallowed inside runBootPrefetch. Gated
  // on `cacheReady` so we don't race against the AsyncStorage hydration
  // — without that gate we could overwrite a fresh disk entry with a
  // slightly-staler network response, or vice versa.
  const prefetchedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!cacheReady || loading || !user?.id || needsDobCheck) return;
    if (prefetchedFor.current === user.id) return;
    prefetchedFor.current = user.id;
    // TEMP (SDK-55 launch-crash isolation): boot prefetch disabled.
    // void runBootPrefetch(user.id, (user as any).savedProgram);
  }, [cacheReady, loading, user?.id, needsDobCheck]);

  // TEMP (SDK-55 launch-crash isolation): push-token registration disabled —
  // registerForRemoteNotifications was on the blocked main thread in the crash.
  // Passing false makes the hook a no-op (no getExpoPushTokenAsync at startup).
  usePushNotifications(false);

  // Schedule the daily training reminder when the user signs in (or boots
  // already-signed-in). Cancel when they log out so we don't keep nagging
  // an account that's no longer active on this device. Targets the
  // 6% week-1 retention finding from the user-psychology audit.
  useEffect(() => {
    if (loading) return;
    // TEMP (SDK-55 launch-crash isolation): expo-notifications scheduling
    // disabled (the SchedulableTrigger API changed in SDK 55 and notifications
    // are implicated in the startup crash). Re-enable once launch is verified.
    // if (user?.id) void ensureDailyReminderScheduled();
    // else void cancelDailyReminder();
  }, [loading, user?.id]);

  // Signed out (intro slides / sign-in): get onto the latest OTA before the
  // user signs in, so first-run routing never runs stale store-bundle code.
  useEffect(() => {
    if (!loading && !user) void applyPendingUpdateWhileSignedOut();
  }, [loading, user]);

  // First launch of this build version → show the What's New modal once.
  // Gated on `user` so new sign-ups go through onboarding before being
  // interrupted; once they hit the tabs and the WHATS_NEW_VERSION key
  // doesn't match storage, we open it.
  useEffect(() => {
    // coachOnboardingDone === false → brand-new user mid-intake; wait until
    // they finish so the tour lands on the dashboard, not over onboarding.
    // `!== true`, not `=== false`: the sign-in responses carry a partial user
    // with the field absent, and a brand-new account was getting the tour
    // over its first screen before /auth/me filled it in.
    if (loading || !user || needsDobCheck || (user as any).coachOnboardingDone !== true) return;
    let cancelled = false;
    void shouldShowWhatsNew().then(should => {
      if (!cancelled && should) setWhatsNewOpen(true);
    });
    return () => { cancelled = true; };
  }, [user?.id, loading, needsDobCheck, (user as any)?.coachOnboardingDone]);

  function handleWhatsNewClose() {
    setWhatsNewOpen(false);
    void markWhatsNewSeen();
  }

  // Sync PostHog identity whenever auth state changes
  useEffect(() => {
    if (loading) return;
    if (user) {
      identifyUser(user.id, {
        name: user.name,
        email: user.email,
        username: (user as any).username ?? null,
        tier: user.tier ?? 'free',
      });
    } else {
      resetUser();
    }
  }, [user?.id, loading]);

  // First-launch gate: have they seen the cinematic onboarding? `null` = still
  // checking (treat as "seen" to avoid a flash). First-time unauthed users go to
  // the cinematic flow; returning unauthed users see the existing welcome/login.
  const [seenCinematic, setSeenCinematic] = useState<boolean | null>(null);
  useEffect(() => {
    void hasSeenCinematicOnboarding().then(setSeenCinematic);
  }, []);

  // The first-run form-analysis hook sits between sign-in and the intake.
  // Read once at mount alongside the cinematic flag; the hook screen writes
  // it on both completion and skip, and `refreshFormHook` re-reads it so the
  // gate below stops firing the moment the user leaves that screen.
  const [seenFormHook, setSeenFormHook] = useState<boolean | null>(null);
  const refreshFormHook = useCallback(() => { void hasSeenFormHook().then(setSeenFormHook); }, []);
  useEffect(() => { refreshFormHook(); }, [refreshFormHook]);

  // Fresh installs run the App Store bundle on their FIRST launch, and that
  // bundle predates the conversational diagnostic — it signs a new user in
  // and drops them into the coach intake. The first launch that runs this
  // (updated) bundle catches them: a signed-in user who hasn't finished the
  // intake and hasn't seen the diagnostic goes there once, before anything else.
  const diagnosticCatchDone = useRef(false);
  useEffect(() => {
    if (loading || !user || needsDobCheck || diagnosticCatchDone.current) return;
    if (getFeatures().uiV2 && !v2SuppressedSync()) return; // v2 users are program-first; the diagnostic is an offer, not a gate
    // Already routed into (or through) the diagnostic this launch — never bounce back.
    if ((segments[0] as string) === 'diagnostic') { diagnosticCatchDone.current = true; return; }
    if ((segments[0] as string) !== '(tabs)') return;
    diagnosticCatchDone.current = true;
    if (user.coachOnboardingDone || !getFeatures().liftDiagnosticConversation || getFeatures().directEntryPaywall) return;
    void hasSeenDiagnosticFirst().then((seen) => {
      if (!seen) router.replace('/diagnostic/conversation' as any);
    });
  }, [user, loading, needsDobCheck, segments]);

  // Personal trainers: a cold start routes a signed-in user into the athlete
  // app like anyone else. If this device last signed in as a trainer, send
  // them back to the dashboard — once per launch, and only from the athlete
  // home surfaces, so "Go to my training" (which clears the mode) and every
  // pushed screen are left alone.
  const trainerCatchDone = useRef(false);
  useEffect(() => {
    if (loading || !user || needsDobCheck || trainerCatchDone.current) return;
    const root = segments[0] as string;
    if (root !== '(tabs)' && root !== '(v2)') return;
    trainerCatchDone.current = true;
    void loadTrainerMode().then((on) => {
      if (on) router.replace(TRAINER_HOME as any);
    });
  }, [user, loading, needsDobCheck, segments]);

  useEffect(() => {
    if (loading || seenCinematic === null || seenFormHook === null) return;
    // A signed-in user can reset their password from chat (ACC-07); that one
    // auth screen must not bounce them back to the app.
    const inAuthGroup = segments[0] === '(auth)';
    const inPasswordReset = inAuthGroup && (segments[1] as string) === 'reset-password';
    const inAgeCheck = (segments[0] as string) === 'age-check';
    const inCinematic = (segments[0] as string) === 'onboarding-cinematic';
    // The OAuth deep-link target (app/auth/callback.tsx) sits at segment 'auth'
    // — NOT the '(auth)' group — and legitimately renders with `user` still
    // null while completeAuthCallback exchanges the token. Without this the
    // gate below fires on its first render and replaces it with the login
    // screen ("Welcome back."), killing the sign-in exactly when Google hands
    // control back. Most visible when Google inserts a "Yes, it's me"
    // challenge: the extra time backgrounded makes Android far more likely to
    // cold-start the app on the deep link rather than resume it in place.
    // The callback screen routes itself out on both success and failure.
    const inAuthCallback = (segments[0] as string) === 'auth';
    const inFormHook = (segments[0] as string) === 'onboarding-form';
    const inV2 = (segments[0] as string) === '(v2)';
    const inTabs = segments[0] === '(tabs)';
    // v2 shell: a signed-in, DOB-checked user on the flag who lands on the v1
    // tabs (cold start, a stale router.replace) is moved to the track. Only
    // from (tabs) — pushed v1 routes (form analysis, groups…) are reachable
    // from v2 on purpose and must not bounce.
    if (user && !needsDobCheck && getFeatures().uiV2 && !v2SuppressedSync() && inTabs && !inV2) {
      // The classic Social tab (notifications, train-together's back) is the v2 Feed tab, not home.
      const toFeed = (segments[1] as string) === 'social';
      router.replace(((user as any).coachOnboardingDone || getFeatures().directEntryPaywall ? (toFeed ? { pathname: '/(v2)', params: { tab: 'feed' } } : '/(v2)') : '/(v2)/onboarding') as any);
      return;
    }
    if (!user && !inAuthGroup && !inCinematic && !inAuthCallback && !inFormHook) {
      // Signed-out users: first-timers (downloaded the app, not signed in) get the
      // cinematic onboarding; users who've already seen it go straight to login.
      // The cinematic slideshow is switched off (founder, 4 Oct 2026); the screen and its
      // scenes stay in the codebase. Flip SHOW_CINEMATIC_ONBOARDING to bring it back.
      router.replace(SHOW_CINEMATIC_ONBOARDING && !seenCinematic ? ('/onboarding-cinematic' as any) : '/(auth)/welcome');
    } else if (user && needsDobCheck && !inAgeCheck) {
      router.replace('/age-check' as any);
    } else if (user && !needsDobCheck && ((inAuthGroup && !inPasswordReset) || inCinematic)) {
      // Funnel: users who haven't completed coach onboarding go straight into
      // it (intake → plan → paywall) rather than the Home tab. Onboarded users
      // land on Home as before.
      //
      // The form-analysis hook is spliced in ahead of the intake for users who
      // have neither finished the intake nor seen (or skipped) the hook. The
      // ordering matters: a piece of real coaching first, then the 8-step
      // interview it just made the case for. `coachOnboardingDone` is checked
      // first so an existing user re-authenticating never gets sent back
      // through a first-run screen.
      // Delegates to the same helper the auth screens use, so there is one
      // decision rather than two that can disagree. This branch is now the
      // backstop; the screens themselves route first and win the race.
      void postAuthDestination(user, getFeatures()).then((dest) => router.replace(dest as any));
    } else if (user && !needsDobCheck && inFormHook && seenFormHook) {
      // The hook screen marks the flag then replaces to the intake itself.
      // This is the belt-and-braces path for a cold start that lands back on
      // the hook route with the flag already set.
      router.replace('/(tabs)/coach' as any);
    }
  }, [user, loading, needsDobCheck, segments, seenCinematic, seenFormHook]);

  // Re-read the hook flag whenever we navigate away from the hook screen, so
  // the gate sees the write the screen just made rather than the stale mount
  // value (which would bounce the user straight back into it).
  useEffect(() => {
    if ((segments[0] as string) !== 'onboarding-form') refreshFormHook();
  }, [segments, refreshFormHook]);

  if (loading || !cacheReady) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <LoadingSpinner />
      </View>
    );
  }

  return (
    <>
      <Stack screenOptions={{ headerShown: false }} />
      <WhatsNewModal visible={whatsNewOpen} onClose={handleWhatsNewClose} />
    </>
  );
}

/** The pre-sign-in cinematic slideshow. Off: new users go straight to sign-in, then into the app. */
const SHOW_CINEMATIC_ONBOARDING = false;

function RootLayout() {
  return (
    <PostHogProvider client={posthog} autocapture>
      <GestureHandlerRootView style={{ flex: 1 }}>
        {/* Off by default: the classic app keeps its own KeyboardAvoider. The v2
            chat switches it on (and Android to adjustNothing) while it's open. */}
        <KeyboardProvider enabled={false} preserveEdgeToEdge>
        <SafeAreaProvider>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <UnitsProvider>
                <StatusBar style="dark" />
                <RootNavigator />
              </UnitsProvider>
            </AuthProvider>
          </QueryClientProvider>
        </SafeAreaProvider>
        </KeyboardProvider>
      </GestureHandlerRootView>
    </PostHogProvider>
  );
}

// Wrapped so Sentry captures render errors + native crashes (re-enabled for the
// SDK-55 build that links the Sentry native module — see top-of-file note).
export default Sentry.wrap(RootLayout);
