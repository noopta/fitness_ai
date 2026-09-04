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
import { hasSeenFormHook, isOldEnoughForFormHook } from '../src/onboarding/formhook/storage';
import * as Sentry from '@sentry/react-native';
// Sentry.init runs in index.js (the app entry) BEFORE any of these imports, so
// it captures module-load startup errors. Here we only wrap the root component.

const queryClient = new QueryClient();

function RootNavigator() {
  const { user, loading, needsDobCheck } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  // Pre-warm the in-memory cache from AsyncStorage so a cold app launch can
  // serve every screen's synchronous getCached() read instead of refetching.
  // The hydration is fast (~50-100ms for our small cache footprint) and runs
  // in parallel with auth bootstrap.
  const [cacheReady, setCacheReady] = useState(false);

  useEffect(() => {
    void hydrateCacheFromStorage().finally(() => setCacheReady(true));
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

  // First launch of this build version → show the What's New modal once.
  // Gated on `user` so new sign-ups go through onboarding before being
  // interrupted; once they hit the tabs and the WHATS_NEW_VERSION key
  // doesn't match storage, we open it.
  useEffect(() => {
    // coachOnboardingDone === false → brand-new user mid-intake; wait until
    // they finish so the tour lands on the dashboard, not over onboarding.
    if (loading || !user || needsDobCheck || (user as any).coachOnboardingDone === false) return;
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

  useEffect(() => {
    if (loading || seenCinematic === null || seenFormHook === null) return;
    const inAuthGroup = segments[0] === '(auth)';
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
    if (!user && !inAuthGroup && !inCinematic && !inAuthCallback && !inFormHook) {
      // Signed-out users: first-timers (downloaded the app, not signed in) get the
      // cinematic onboarding; users who've already seen it go straight to login.
      router.replace(seenCinematic ? '/(auth)/welcome' : ('/onboarding-cinematic' as any));
    } else if (user && needsDobCheck && !inAgeCheck) {
      router.replace('/age-check' as any);
    } else if (user && !needsDobCheck && (inAuthGroup || inCinematic)) {
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
      if (user.coachOnboardingDone) {
        router.replace('/(tabs)' as any);
      } else if (!seenFormHook && isOldEnoughForFormHook(user.dateOfBirth)) {
        // 18+ only. Under-18s (and anyone with no DOB on file) go straight to
        // the intake — the hook is never shown and never mentioned, so there
        // is nothing to feel excluded from. The backend enforces the same age
        // independently; this only avoids showing a screen that would 403.
        router.replace('/onboarding-form' as any);
      } else {
        router.replace('/(tabs)/coach' as any);
      }
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

function RootLayout() {
  return (
    <PostHogProvider client={posthog} autocapture>
      <GestureHandlerRootView style={{ flex: 1 }}>
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
      </GestureHandlerRootView>
    </PostHogProvider>
  );
}

// Wrapped so Sentry captures render errors + native crashes (re-enabled for the
// SDK-55 build that links the Sentry native module — see top-of-file note).
export default Sentry.wrap(RootLayout);
