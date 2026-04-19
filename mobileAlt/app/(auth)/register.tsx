import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  Alert, KeyboardAvoidingView, Platform, Linking, TouchableOpacity, ActivityIndicator,
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
import { colors, spacing, radius, fontSize, fontWeight } from '../../src/constants/theme';

export default function RegisterScreen() {
  const router = useRouter();
  const { register, googleLogin, appleLogin } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);

  async function handleRegister() {
    if (!name.trim()) { Alert.alert('Missing Name', 'Please enter your name.'); return; }
    if (!email.trim()) { Alert.alert('Missing Email', 'Please enter your email address.'); return; }
    if (!password || password.length < 8) { Alert.alert('Weak Password', 'Password must be at least 8 characters.'); return; }

    setSubmitting(true);
    try {
      await register(name.trim(), email.trim(), password, dateOfBirth.trim() || undefined);
      Analytics.register('email');
      router.replace('/(tabs)');
    } catch (err: any) {
      Alert.alert('Registration Failed', err?.message || 'Could not create your account. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogleLogin() {
    setGoogleLoading(true);
    try { await googleLogin(); Analytics.register('google'); } finally { setGoogleLoading(false); }
  }

  async function handleAppleLogin() {
    setAppleLoading(true);
    try { await appleLogin(); Analytics.register('apple'); } finally { setAppleLoading(false); }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardDoneBar />
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Branding */}
          <View style={styles.brandRow}>
            <AxiomLogo size={36} />
            <Text style={styles.brandName}>AXIOM</Text>
          </View>

          {/* Heading */}
          <Text style={styles.title}>Create account.</Text>
          <Text style={styles.subtitle}>Start your AI coaching journey</Text>

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

          {/* Divider */}
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>OR</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* Fields */}
          <Input label="Name" value={name} onChangeText={setName} autoCapitalize="words" autoCorrect={false} placeholder="Your full name" containerStyle={styles.inputContainer} />
          <Input label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} placeholder="you@example.com" containerStyle={styles.inputContainer} />
          <Input label="Password" value={password} onChangeText={setPassword} secureTextEntry placeholder="••••••••" containerStyle={styles.inputContainer} />
          <Input label="Date of Birth (optional)" value={dateOfBirth} onChangeText={setDateOfBirth} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" autoCorrect={false} containerStyle={styles.inputContainer} />

          {/* Primary CTA */}
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
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  keyboardView: { flex: 1 },
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
