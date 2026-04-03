import { useEffect, useCallback, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Linking, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { StripeProvider, useStripe } from '@stripe/stripe-react-native';
import { AuthProvider, useAuth } from '../src/context/AuthContext';
import { UnitsProvider } from '../src/context/UnitsContext';
import { LoadingSpinner } from '../src/components/ui/LoadingSpinner';
import { colors } from '../src/constants/theme';
import { usePushNotifications } from '../src/lib/usePushNotifications';
import { paymentsApi } from '../src/lib/api';

const queryClient = new QueryClient();

// Handles Stripe deep-link redirects (3DS, bank auth, etc.)
function StripeDeepLinkHandler() {
  const { handleURLCallback } = useStripe();

  const handleDeepLink = useCallback(
    async (url: string | null) => {
      if (url) await handleURLCallback(url);
    },
    [handleURLCallback]
  );

  useEffect(() => {
    Linking.getInitialURL().then(handleDeepLink);
    const sub = Linking.addEventListener('url', (e) => handleDeepLink(e.url));
    return () => sub.remove();
  }, [handleDeepLink]);

  return null;
}

function RootNavigator() {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  usePushNotifications(!!user);

  useEffect(() => {
    if (loading) return;
    const inAuthGroup = segments[0] === '(auth)';
    if (!user && !inAuthGroup) {
      router.replace('/(auth)/welcome');
    } else if (user && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [user, loading, segments]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <LoadingSpinner />
      </View>
    );
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}

export default function RootLayout() {
  const [publishableKey, setPublishableKey] = useState('');

  useEffect(() => {
    paymentsApi.getConfig()
      .then((data) => setPublishableKey(data.publishableKey ?? ''))
      .catch(() => {});
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StripeProvider
          publishableKey={publishableKey}
          urlScheme="axiom"
          merchantIdentifier="merchant.io.axiomtraining.app"
        >
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <UnitsProvider>
                <StatusBar style="dark" />
                <StripeDeepLinkHandler />
                <RootNavigator />
              </UnitsProvider>
            </AuthProvider>
          </QueryClientProvider>
        </StripeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
