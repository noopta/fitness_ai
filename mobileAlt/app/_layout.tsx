import { useEffect, useState } from 'react';
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

const queryClient = new QueryClient();

function RootNavigator() {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  usePushNotifications(!!user);

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
