import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors, spacing, radius, fontSize, fontWeight } from '../../src/constants/theme';
import { Button } from '../../src/components/ui/Button';
import { Input } from '../../src/components/ui/Input';
import { useAuth } from '../../src/context/AuthContext';

export default function RegisterScreen() {
  const router = useRouter();
  const { register, googleLogin } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  async function handleRegister() {
    if (!name.trim()) {
      Alert.alert('Missing Name', 'Please enter your name.');
      return;
    }
    if (!email.trim()) {
      Alert.alert('Missing Email', 'Please enter your email address.');
      return;
    }
    if (!password || password.length < 8) {
      Alert.alert('Weak Password', 'Password must be at least 8 characters.');
      return;
    }

    setSubmitting(true);
    try {
      const dob = dateOfBirth.trim() || undefined;
      await register(name.trim(), email.trim(), password, dob);
      router.replace('/(tabs)');
    } catch (err: any) {
      Alert.alert(
        'Registration Failed',
        err?.message || 'Could not create your account. Please try again.'
      );
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

  function openTerms() {
    Linking.openURL('https://axiom.app/terms').catch(() => {
      Alert.alert('Error', 'Could not open Terms of Service.');
    });
  }

  function openPrivacy() {
    Linking.openURL('https://axiom.app/privacy').catch(() => {
      Alert.alert('Error', 'Could not open Privacy Policy.');
    });
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
          <View style={styles.brandingSection}>
            <View style={styles.logoMark}>
              <Text style={styles.logoLetter}>A</Text>
            </View>
            <Text style={styles.appName}>Axiom</Text>
          </View>

          {/* Title */}
          <Text style={styles.title}>Create your account</Text>

          {/* Google OAuth */}
          <Button
            variant="outline"
            fullWidth
            size="lg"
            onPress={handleGoogleLogin}
            loading={googleLoading}
            style={styles.googleButton}
          >
            Continue with Google
          </Button>

          {/* OR Divider */}
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>OR</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* Name Input */}
          <Input
            label="Name"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            autoCorrect={false}
            placeholder="Your full name"
            containerStyle={styles.inputContainer}
          />

          {/* Email Input */}
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

          {/* Password Input */}
          <Input
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="••••••••"
            containerStyle={styles.inputContainer}
          />

          {/* Date of Birth Input */}
          <Input
            label="Date of Birth (optional)"
            value={dateOfBirth}
            onChangeText={setDateOfBirth}
            placeholder="YYYY-MM-DD"
            keyboardType="numbers-and-punctuation"
            autoCorrect={false}
            containerStyle={styles.inputContainer}
          />

          {/* Sign Up Button */}
          <Button
            variant="default"
            fullWidth
            size="lg"
            onPress={handleRegister}
            loading={submitting}
            style={styles.signUpButton}
          >
            Sign up
          </Button>

          {/* Terms Text */}
          <View style={styles.termsContainer}>
            <Text style={styles.termsText}>
              By signing up, you agree to our{' '}
              <Text style={styles.termsLink} onPress={openTerms}>
                Terms of Service
              </Text>
              {' '}and{' '}
              <Text style={styles.termsLink} onPress={openPrivacy}>
                Privacy Policy
              </Text>
            </Text>
          </View>

          {/* Sign In Link */}
          <Pressable
            onPress={() => router.push('/(auth)/login')}
            style={styles.signInLink}
          >
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
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xxl,
  },
  brandingSection: {
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  logoMark: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoLetter: {
    fontSize: 28,
    fontWeight: fontWeight.bold,
    color: '#ffffff',
  },
  appName: {
    fontSize: 22,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
    letterSpacing: -0.5,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  googleButton: {
    marginBottom: spacing.lg,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    fontWeight: fontWeight.medium,
    letterSpacing: 1,
  },
  inputContainer: {
    marginBottom: spacing.md,
  },
  signUpButton: {
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  termsContainer: {
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.sm,
  },
  termsText: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    textAlign: 'center',
    lineHeight: 18,
  },
  termsLink: {
    color: colors.primary,
    fontWeight: fontWeight.medium,
  },
  signInLink: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  signInLinkText: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
  },
  signInLinkHighlight: {
    color: colors.primary,
    fontWeight: fontWeight.semibold,
  },
});
