import { useEffect, useRef, useState } from 'react';
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
import { posthog, identifyUser, resetUser } from '../src/lib/analytics';
import { WhatsNewModal, shouldShowWhatsNew, markWhatsNewSeen } from '../src/components/WhatsNewModal';
import { hydrateCacheFromStorage } from '../src/lib/cache';
import { runBootPrefetch } from '../src/lib/prefetch';

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
    void runBootPrefetch(user.id, (user as any).savedProgram);
  }, [cacheReady, loading, user?.id, needsDobCheck]);

  usePushNotifications(!!user);

  // First launch of this build version → show the What's New modal once.
  // Gated on `user` so new sign-ups go through onboarding before being
  // interrupted; once they hit the tabs and the WHATS_NEW_VERSION key
  // doesn't match storage, we open it.
  useEffect(() => {
    if (loading || !user || needsDobCheck) return;
    let cancelled = false;
    void shouldShowWhatsNew().then(should => {
      if (!cancelled && should) setWhatsNewOpen(true);
    });
    return () => { cancelled = true; };
  }, [user?.id, loading, needsDobCheck]);

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

  useEffect(() => {
    if (loading) return;
    const inAuthGroup = segments[0] === '(auth)';
    const inAgeCheck = (segments[0] as string) === 'age-check';
    if (!user && !inAuthGroup) {
      router.replace('/(auth)/welcome');
    } else if (user && needsDobCheck && !inAgeCheck) {
      router.replace('/age-check' as any);
    } else if (user && !needsDobCheck && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [user, loading, needsDobCheck, segments]);

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

export default function RootLayout() {
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
