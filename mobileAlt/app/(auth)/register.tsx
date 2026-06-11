import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  Alert, Platform, Linking, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as AppleAuthentication from 'expo-apple-authentication';
import { AxiomLogo } from '../../src/components/ui/AxiomLogo';
import { GoogleLogo } from '../../src/components/ui/GoogleLogo';
import { Input } from '../../src/components/ui/Input';
import { KeyboardDoneBar } from '../../src/components/ui/KeyboardDoneBar';
import { useAuth } from '../../src/context/AuthContext';
import { Analytics } from '../../src/lib/analytics';
import { authApi } from '../../src/lib/api';
import { colors, spacing, radius, fontSize, fontWeight } from '../../src/constants/theme';

export default function RegisterScreen() {
  const router = useRouter();
  const { register, googleLogin, appleLogin } = useAuth();

  // Name is no longer collected at signup — defer to post-auth (the
  // diagnostic flow already asks for profile detail). Removing this field
  // takes the signup form from 4 fields to 3 and cuts visual friction on
  // the highest-leverage drop-off step per the user-psychology report.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);

  // C.1: email form collapsed by default — OAuth gets the visual weight.
  // Tapping "Continue with email" expands the form so the user-base that
  // wants email still gets it, but the default visual is one-tap OAuth.
  const [emailFormOpen, setEmailFormOpen] = useState(false);

  // C.3: live user count for social proof. Falls back gracefully on error.
  const [userCount, setUserCount] = useState<number | null>(null);

  // C.11: fire screen-shown event once on mount + pull the user count for
  // social proof. The count endpoint is public + cached server-side.
  useEffect(() => {
    Analytics.authScreenShown('register');
    authApi.userCount()
      .then((n) => {
        if (typeof n === 'number' && n > 0) {
          setUserCount(n);
          Analytics.socialProofShown(n);
        }
      })
      .catch(() => { /* silent — social proof is non-critical */ });
  }, []);

  async function handleRegister() {
    if (!email.trim()) { Analytics.signupSubmitFailed('register', 'missing_email'); Alert.alert('Missing Email', 'Please enter your email address.'); return; }
    if (!password || password.length < 8) { Analytics.signupSubmitFailed('register', 'weak_password'); Alert.alert('Weak Password', 'Password must be at least 8 characters.'); return; }
    if (!dateOfBirth.trim()) { Analytics.signupSubmitFailed('register', 'missing_dob'); Alert.alert('Missing Date of Birth', 'Please enter your date of birth.'); return; }
    const dob = new Date(dateOfBirth.trim());
    if (isNaN(dob.getTime())) { Analytics.signupSubmitFailed('register', 'invalid_dob'); Alert.alert('Invalid Date', 'Please enter your date of birth in YYYY-MM-DD format.'); return; }
    const ageDays = (Date.now() - dob.getTime()) / 86400000;
    if (ageDays < 13 * 365.25) { Analytics.signupSubmitFailed('register', 'underage'); Alert.alert('Age Restriction', 'You must be at least 13 years old to use this app.'); return; }

    Analytics.signupSubmitAttempted('register');
    setSubmitting(true);
    try {
      // Use the email prefix as a starter name — the user can edit it
      // later in their profile / during the diagnostic flow.
      const nameFromEmail = email.trim().split('@')[0] || 'Athlete';
      const pending = await register(nameFromEmail, email.trim(), password, dateOfBirth.trim());
      Analytics.register('email');
      if (pending) {
        router.replace({ pathname: '/(auth)/verify-email', params: { email: pending.email } });
      } else {
        router.replace('/(tabs)');
      }
    } catch (err: any) {
      Analytics.signupSubmitFailed('register', err?.message ?? 'unknown');
      Alert.alert('Registration Failed', err?.message || 'Could not create your account. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogleLogin() {
    Analytics.authProviderTapped('google', 'register');
    setGoogleLoading(true);
    try { await googleLogin(); Analytics.register('google'); } finally { setGoogleLoading(false); }
  }

  async function handleAppleLogin() {
    Analytics.authProviderTapped('apple', 'register');
    setAppleLoading(true);
    try { await appleLogin(); Analytics.register('apple'); } finally { setAppleLoading(false); }
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
          <Text style={styles.title}>Create account.</Text>
          <Text style={styles.subtitle}>
            {userCount && userCount > 0
              ? `Join ${userCount.toLocaleString()} strength athletes.`
              : 'Start your AI coaching journey'}
          </Text>

          {/* Apple Sign In — iOS only */}
          {Platform.OS === 'ios' && (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
              cornerRadius={radius.md}
              style={[styles.appleButton, appleLoading && { opacity: 0.5 }]}
              onPress={handleAppleLogin}
            />
          )}

          {/* Google OAuth */}
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

          {/* Email-form toggle. Collapsed by default to push users toward
              one-tap OAuth. C.1 + C.2: drop visual weight of email path. */}
          {!emailFormOpen ? (
            <TouchableOpacity
              style={styles.emailToggleBtn}
              activeOpacity={0.82}
              onPress={() => {
                Analytics.authProviderTapped('email_toggle', 'register');
                setEmailFormOpen(true);
              }}
            >
              <Text style={styles.emailToggleBtnText}>Continue with email</Text>
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
                onChangeText={(v) => { setEmail(v); if (v.length === 1) Analytics.signupFieldFilled('email', 'register'); }}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="you@example.com"
                containerStyle={styles.inputContainer}
              />
              <Input
                label="Password"
                value={password}
                onChangeText={(v) => { setPassword(v); if (v.length === 1) Analytics.signupFieldFilled('password', 'register'); }}
                secureTextEntry
                placeholder="At least 8 characters"
                containerStyle={styles.inputContainer}
              />
              <Input
                label="Date of Birth"
                value={dateOfBirth}
                onChangeText={(v) => { setDateOfBirth(v); if (v.length === 1) Analytics.signupFieldFilled('dob', 'register'); }}
                placeholder="YYYY-MM-DD"
                keyboardType="numbers-and-punctuation"
                autoCorrect={false}
                containerStyle={styles.inputContainer}
              />
              <TouchableOpacity
                style={[styles.signUpPill, submitting && { opacity: 0.5 }]}
                activeOpacity={0.82}
                onPress={handleRegister}
                disabled={submitting}
              >
                <Text style={styles.signUpPillText}>
                  {submitting ? 'Creating account…' : 'Create account'}
                </Text>
              </TouchableOpacity>
            </>
          )}

          {/* Terms */}
          <View style={styles.termsContainer}>
            <Text style={styles.termsText}>
              By signing up, you agree to our{' '}
              <Text style={styles.termsLink} onPress={() => Linking.openURL('https://axiomtraining.io/terms').catch(() => {})}>
                Terms of Service
              </Text>
              {' '}and{' '}
              <Text style={styles.termsLink} onPress={() => Linking.openURL('https://axiomtraining.io/privacy').catch(() => {})}>
                Privacy Policy
              </Text>
            </Text>
          </View>

          {/* Sign in link */}
          <Pressable onPress={() => router.push('/(auth)/login')} style={styles.signInLink}>
            <Text style={styles.signInLinkText}>
              Already have an account?{' '}
              <Text style={styles.signInLinkHighlight}>Sign in</Text>
            </Text>
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
  signUpPill: {
    backgroundColor: colors.foreground,
    borderRadius: radius.xl,
    paddingVertical: 17,
    alignItems: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  signUpPillText: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.primaryForeground,
  },

  termsContainer: { marginBottom: spacing.lg, paddingHorizontal: spacing.sm },
  termsText: { fontSize: fontSize.xs, color: colors.mutedForeground, textAlign: 'center', lineHeight: 18 },
  termsLink: { color: colors.foreground, fontWeight: fontWeight.medium },

  signInLink: { alignItems: 'center', paddingVertical: spacing.sm },
  signInLinkText: { fontSize: fontSize.sm, color: colors.mutedForeground },
  signInLinkHighlight: { color: colors.foreground, fontWeight: fontWeight.semibold },
});
