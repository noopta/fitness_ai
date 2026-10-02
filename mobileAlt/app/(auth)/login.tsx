import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  Alert, Platform, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Ionicons } from '@expo/vector-icons';
import { AxiomLogo } from '../../src/components/ui/AxiomLogo';
import { GoogleLogo } from '../../src/components/ui/GoogleLogo';
import { Input } from '../../src/components/ui/Input';
import { KeyboardDoneBar } from '../../src/components/ui/KeyboardDoneBar';
import { useAuth } from '../../src/context/AuthContext';
import { Analytics } from '../../src/lib/analytics';
import { colors, spacing, radius, fontSize, fontWeight } from '../../src/constants/theme';
import { postAuthDestination } from '../../src/onboarding/formhook/postAuthRoute';
import { COPY as PT_COPY } from '@axiom/personal-training-core';
import { loadTrainerMode, setTrainerMode } from '../../src/features/personal-training/mode';

export default function LoginScreen() {
  const router = useRouter();
  const { login, googleLogin, appleLogin, getLatestUser, getFeatures } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'ios') {
      AppleAuthentication.isAvailableAsync()
        .then(setAppleAvailable)
        .catch(() => setAppleAvailable(false));
    }
  }, []);

  // Personal trainers sign in with the same account system — email, Google or
  // Apple. The toggle only records that this sign-in is a trainer's, which
  // postAuthDestination reads to land them on the dashboard instead of the
  // athlete app. (This replaced the old organization-slug sign-in.)
  const [trainerMode, setTrainerModeState] = useState(false);
  // The mode outlives the screen, so the toggle must show what is stored —
  // otherwise it could read "off" while a sign-in still routes to the dashboard.
  useEffect(() => {
    void loadTrainerMode().then(setTrainerModeState);
  }, []);

  // C.1: collapse the email form behind a tap by default — OAuth gets the
  // visual weight. Returning users who default to email tap one extra time.
  const [emailFormOpen, setEmailFormOpen] = useState(false);
  const shownOnceRef = useRef(false);
  // Live user count for the social-proof line. Falls back to a clean string
  // when the call fails so the UI still reads as confident.
  const [userCount, setUserCount] = useState<number | null>(null);
  useEffect(() => {
    if (shownOnceRef.current) return;
    shownOnceRef.current = true;
    Analytics.authScreenShown('login');
    // Public, cached server-side — safe to call before auth.
    void (async () => {
      try {
        const { authApi } = await import('../../src/lib/api');
        const n = await authApi.userCount();
        if (typeof n === 'number' && n > 0) {
          setUserCount(n);
          Analytics.socialProofShown(n);
        }
      } catch { /* silent */ }
    })();
  }, []);

  async function handleLogin() {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Missing Fields', 'Please enter your email and password.');
      return;
    }
    setSubmitting(true);
    try {
      const pending = await login(email.trim(), password);
      Analytics.login('email');
      if (pending) {
        // User has a row but never verified — fresh code was auto-sent.
        router.replace({ pathname: '/(auth)/verify-email', params: { email: pending.email } });
        return;
      }
      router.replace((await postAuthDestination(getLatestUser(), getFeatures())) as any);
    } catch (err: any) {
      Alert.alert('Sign In Failed', err?.message || 'Invalid email or password. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogleLogin() {
    Analytics.authProviderTapped('google', 'login');
    setGoogleLoading(true);
    try {
      // false = cancelled/failed — don't count a phantom login conversion.
      const ok = await googleLogin();
      if (ok) Analytics.login('google');
    } finally {
      setGoogleLoading(false);
    }
  }

  async function handleAppleLogin() {
    Analytics.authProviderTapped('apple', 'login');
    setAppleLoading(true);
    try {
      const ok = await appleLogin();
      if (ok) Analytics.login('apple');
    } finally {
      setAppleLoading(false);
    }
  }

  // Persisted before any sign-in starts, so the Google/Apple round trip —
  // which can cold-start the app on the way back — still knows.
  function handleTrainerMode(on: boolean) {
    setTrainerModeState(on);
    void setTrainerMode(on);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardDoneBar />
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          automaticallyAdjustKeyboardInsets
        >
          {/* Branding */}
          <View style={styles.brandRow}>
            <AxiomLogo size={36} />
            <Text style={styles.brandName}>AXIOM</Text>
          </View>

          {/* Heading */}
          <Text style={styles.title}>Welcome back.</Text>
          <Text style={styles.subtitle}>
            {trainerMode ? PT_COPY.login.subtitle : 'Sign in to your account'}
          </Text>

          {/* OAuth buttons — trainers use them too */}
          {(
            <>
              {/* Apple Sign In — only shown when native module is available */}
              {appleAvailable && (
                <AppleAuthentication.AppleAuthenticationButton
                  buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                  buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                  cornerRadius={radius.md}
                  style={[styles.appleButton, appleLoading && { opacity: 0.5 }]}
                  onPress={handleAppleLogin}
                />
              )}

              <TouchableOpacity
                style={[styles.googleButton, googleLoading && { opacity: 0.5 }]}
                activeOpacity={0.82}
                onPress={handleGoogleLogin}
                disabled={googleLoading}
              >
                {googleLoading ? (
                  <ActivityIndicator size="small" color={colors.foreground} />
                ) : (
                  <>
                    <GoogleLogo size={20} />
                    <Text style={styles.googleButtonText}>Continue with Google</Text>
                  </>
                )}
              </TouchableOpacity>

            </>
          )}

          {/* Email-form toggle — collapsed by default. C.1 conversion fix. */}
          {!emailFormOpen ? (
            <TouchableOpacity
              style={styles.emailToggleBtn}
              activeOpacity={0.82}
              onPress={() => {
                Analytics.authProviderTapped('email_toggle', 'login');
                setEmailFormOpen(true);
              }}
            >
              <Text style={styles.emailToggleBtnText}>Sign in with email</Text>
            </TouchableOpacity>
          ) : (
            <>
              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>OR EMAIL</Text>
                <View style={styles.dividerLine} />
              </View>

              <Input
                label="Email"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="you@example.com"
                containerStyle={styles.inputContainer}
              />
              <Input
                label="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                placeholder="••••••••"
                containerStyle={styles.inputContainer}
              />
              <Pressable
                onPress={() => router.push({ pathname: '/(auth)/reset-password', params: email.trim() ? { email: email.trim() } : {} } as any)}
                style={styles.forgotLink}
                hitSlop={8}
                accessibilityRole="link"
              >
                <Text style={styles.registerLinkText}>Forgot password?</Text>
              </Pressable>

              <TouchableOpacity
                style={[styles.signInPill, submitting && { opacity: 0.5 }]}
                activeOpacity={0.82}
                onPress={handleLogin}
                disabled={submitting}
              >
                <Text style={styles.signInPillText}>
                  {submitting
                    ? 'Signing in…'
                    : trainerMode
                      ? PT_COPY.login.submit
                      : 'Sign in'}
                </Text>
              </TouchableOpacity>
            </>
          )}

          {/* Social proof — replaces the previous diagnostic-preview teaser.
              "Join 200+ athletes using the most advanced training tech."
              Pulled live from /auth/user-count when possible, with a clean
              fallback string so the UI stays confident when the call fails.
              Athlete-facing, so it steps aside for a trainer signing in. */}
          {!trainerMode && (
            <View style={styles.socialProofBox}>
              <Ionicons name="trophy" size={16} color={colors.primary} style={{ marginRight: 6 }} />
              <Text style={styles.socialProofText}>
                Join <Text style={styles.socialProofHighlight}>
                  {userCount && userCount > 0 ? `${userCount.toLocaleString()}+ athletes` : 'a growing community'}
                </Text> using the most advanced training tech.
              </Text>
            </View>
          )}

          {/* Register link — a new trainer registers here too; trainer mode is
              already persisted, so they land on the dashboard afterwards. */}
          {(
            <Pressable
              onPress={() => router.push('/(auth)/register')}
              style={styles.registerLink}
            >
              <Text style={styles.registerLinkText}>
                Don't have an account?{' '}
                <Text style={styles.registerLinkHighlight}>Register</Text>
              </Text>
            </Pressable>
          )}

          {/* Personal trainer sign-in toggle */}
          <Pressable
            onPress={() => handleTrainerMode(!trainerMode)}
            style={styles.orgToggleLink}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityState={{ selected: trainerMode }}
          >
            <Text style={styles.orgToggleLinkText}>{trainerMode ? PT_COPY.login.cancel : PT_COPY.login.toggle}</Text>
          </Pressable>
        </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
  },

  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: spacing.xxl,
  },
  brandName: {
    fontSize: 13,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
    letterSpacing: 2,
  },

  title: {
    fontSize: 32,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
    letterSpacing: -0.8,
    lineHeight: 36,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: fontSize.base,
    color: colors.mutedForeground,
    marginBottom: spacing.xl,
  },

  appleButton: {
    width: '100%',
    height: 54,
    marginBottom: spacing.sm,
  },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    width: '100%',
    paddingVertical: 16,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    marginBottom: spacing.lg,
  },
  googleButtonText: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
  },

  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    fontWeight: fontWeight.medium,
    letterSpacing: 1,
  },

  inputContainer: { marginBottom: spacing.md },

  // Collapsed email-form toggle (C.1 — push OAuth as primary path)
  emailToggleBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  emailToggleBtnText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
  },

  // Black pill CTA
  signInPill: {
    backgroundColor: colors.foreground,
    borderRadius: radius.xl,
    paddingVertical: 17,
    alignItems: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
  },
  signInPillText: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.primaryForeground,
  },

  registerLink: { alignItems: 'center', paddingVertical: spacing.sm },
  forgotLink: { alignSelf: 'flex-end', marginTop: -spacing.xs, marginBottom: spacing.md },

  // Social-proof box on the login screen (replaced the diagnostic-preview pill)
  socialProofBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: `${colors.primary}10`,
    marginTop: spacing.sm,
  },
  socialProofText: { fontSize: fontSize.sm, color: colors.foreground, textAlign: 'center', flexShrink: 1 },
  socialProofHighlight: { color: colors.primary, fontWeight: fontWeight.bold },
  registerLinkText: { fontSize: fontSize.sm, color: colors.mutedForeground },
  registerLinkHighlight: { color: colors.foreground, fontWeight: fontWeight.semibold },

  orgToggleLink: { alignItems: 'center', paddingVertical: spacing.sm, marginTop: spacing.xs },
  orgToggleLinkText: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    textDecorationLine: 'underline',
  },
});
