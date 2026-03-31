import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  Alert, KeyboardAvoidingView, Platform, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { AxiomLogo } from '../../src/components/ui/AxiomLogo';
import { GoogleLogo } from '../../src/components/ui/GoogleLogo';
import { Input } from '../../src/components/ui/Input';
import { useAuth } from '../../src/context/AuthContext';
import { colors, spacing, radius, fontSize, fontWeight } from '../../src/constants/theme';

export default function LoginScreen() {
  const router = useRouter();
  const { login, googleLogin } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  // Org mode state
  const [orgMode, setOrgMode] = useState(false);
  const [orgSlug, setOrgSlug] = useState('');

  async function handleLogin() {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Missing Fields', 'Please enter your email and password.');
      return;
    }
    if (orgMode && !orgSlug.trim()) {
      Alert.alert('Missing Fields', 'Please enter your organization slug.');
      return;
    }
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      if (orgMode) {
        router.replace(`/institution/athlete?slug=${encodeURIComponent(orgSlug.trim())}` as any);
      } else {
        router.replace('/(tabs)');
      }
    } catch (err: any) {
      Alert.alert('Sign In Failed', err?.message || 'Invalid email or password. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogleLogin() {
    setGoogleLoading(true);
    try {
      await googleLogin();
    } finally {
      setGoogleLoading(false);
    }
  }

  function handleToggleOrgMode() {
    setOrgMode(true);
    setOrgSlug('');
  }

  function handleCancelOrgMode() {
    setOrgMode(false);
    setOrgSlug('');
  }

  return (
    <SafeAreaView style={styles.safeArea}>
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
          <Text style={styles.title}>Welcome back.</Text>
          <Text style={styles.subtitle}>
            {orgMode ? 'Sign in to your organization' : 'Sign in to your account'}
          </Text>

          {/* Google OAuth — only shown outside org mode */}
          {!orgMode && (
            <>
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
            </>
          )}

          {/* Fields */}
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

          {/* Org slug field — shown only in org mode */}
          {orgMode && (
            <Input
              label="Organization slug"
              value={orgSlug}
              onChangeText={setOrgSlug}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="e.g. state-university"
              containerStyle={styles.inputContainer}
            />
          )}

          {/* Primary CTA */}
          <TouchableOpacity
            style={[styles.signInPill, submitting && { opacity: 0.5 }]}
            activeOpacity={0.82}
            onPress={handleLogin}
            disabled={submitting}
          >
            <Text style={styles.signInPillText}>
              {submitting
                ? 'Signing in…'
                : orgMode
                  ? 'Sign in to organization'
                  : 'Sign in'}
            </Text>
          </TouchableOpacity>

          {/* Register link */}
          {!orgMode && (
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

          {/* Org mode toggle / cancel */}
          {orgMode ? (
            <Pressable onPress={handleCancelOrgMode} style={styles.orgToggleLink}>
              <Text style={styles.orgToggleLinkText}>Cancel</Text>
            </Pressable>
          ) : (
            <Pressable onPress={handleToggleOrgMode} style={styles.orgToggleLink}>
              <Text style={styles.orgToggleLinkText}>Sign in with organization</Text>
            </Pressable>
          )}
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
  registerLinkText: { fontSize: fontSize.sm, color: colors.mutedForeground },
  registerLinkHighlight: { color: colors.foreground, fontWeight: fontWeight.semibold },

  orgToggleLink: { alignItems: 'center', paddingVertical: spacing.sm, marginTop: spacing.xs },
  orgToggleLinkText: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    textDecorationLine: 'underline',
  },
});
