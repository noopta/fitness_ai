// Deep-link target for OAuth callbacks. The redirect URI generated in
// AuthContext.googleLogin is `axiom://auth/callback`, and on iOS the
// WebBrowser session intercepts the redirect in-app before it ever
// becomes a real navigation. On Android, Chrome Custom Tabs sometimes
// hands the redirect off to the OS as a deep link instead, which opens
// this route fresh with `?token=...&needsDob=...` in the URL.
//
// Without this file, Expo Router would 404 ("Unmatched route — page
// could not be found"), stranding the user mid-auth. With it, we
// finish the same flow the in-browser interception would have run:
// persist the token, verify via /auth/me, set user state, and route
// to the appropriate landing screen.
//
// Also doubles as a defensive fallback for iOS in case
// openAuthSessionAsync fails to intercept for any reason — same
// recovery path either way.

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../src/context/AuthContext';
import { LoadingSpinner } from '../../src/components/ui/LoadingSpinner';
import { colors, fontSize, spacing } from '../../src/constants/theme';

export default function AuthCallbackScreen() {
  const router = useRouter();
  const { completeAuthCallback } = useAuth();
  const params = useLocalSearchParams<{
    token?: string | string[];
    auth?: string | string[];
    needsDob?: string | string[];
  }>();
  // Guard against StrictMode double-mount / re-render storms — once we've
  // kicked off the auth flow, don't re-fire it.
  const finalized = useRef(false);

  useEffect(() => {
    if (finalized.current) return;

    // useLocalSearchParams can return string | string[] when the same key
    // appears more than once. Always normalize to the first value.
    const first = (v: string | string[] | undefined): string | undefined =>
      Array.isArray(v) ? v[0] : v;

    const token = first(params.token);
    const authParam = first(params.auth);
    const needsDob = first(params.needsDob) === '1';

    if (authParam === 'error') {
      finalized.current = true;
      Alert.alert('Sign In Failed', 'Google sign-in failed. Please try again.');
      router.replace('/(auth)/welcome');
      return;
    }

    if (!token) {
      // Deep link with no token + no error — most likely a stale link, a
      // mis-typed URL, or a 3rd-party app opening the scheme. Punt to
      // welcome rather than sit on a spinner forever.
      finalized.current = true;
      router.replace('/(auth)/welcome');
      return;
    }

    finalized.current = true;
    void completeAuthCallback(token, { needsDob }).then((ok) => {
      if (!ok) {
        Alert.alert(
          'Sign In Failed',
          'We received your credentials but could not verify them. Please try signing in again.',
        );
        router.replace('/(auth)/welcome');
        return;
      }
      // RootNavigator's segment-watching useEffect will redirect to
      // /age-check if needsDobCheck is set, or to /(tabs) otherwise — so
      // we just need to leave the auth-callback route. Using replace()
      // (not push) so the back button doesn't return here.
      router.replace('/(tabs)');
    });
  }, [params.token, params.auth, params.needsDob, completeAuthCallback, router]);

  return (
    <View style={styles.container}>
      <LoadingSpinner size="large" />
      <Text style={styles.text}>Signing you in…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  text: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
  },
});
