// Password reset (ACC-07): email → 6-digit code + new password → signed in.
// Reached from "Forgot password?" on sign-in, or from Anakin's reset card
// (client action reset_password, which passes the email).

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Input } from '../../src/components/ui/Input';
import { KeyboardAvoider } from '../../src/components/ui/KeyboardAvoider';
import { useAuth } from '../../src/context/AuthContext';
import { authApi } from '../../src/lib/api';
import { postAuthDestination } from '../../src/onboarding/formhook/postAuthRoute';
import { colors, spacing, radius, fontSize, fontWeight } from '../../src/constants/theme';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const { user, completeAuthCallback, getLatestUser, getFeatures } = useAuth();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState(params.email ?? '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => { if (cooldown <= 0) return; const t = setTimeout(() => setCooldown((c) => c - 1), 1000); return () => clearTimeout(t); }, [cooldown]);

  const sendCode = async () => {
    const e = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(e)) { setError('Enter the email you signed up with.'); return; }
    setBusy(true); setError(null);
    try {
      const r = await authApi.forgotPassword(e);
      setCooldown(r.cooldownRemainingSec ?? 60);
      setStep('code');
    } catch (err: any) { setError(err?.message ?? 'Couldn’t send a code. Try again.'); }
    setBusy(false);
  };

  const reset = async () => {
    if (!/^\d{6}$/.test(code.trim())) { setError('Enter the 6-digit code from the email.'); return; }
    if (password.length < 8) { setError('Use at least 8 characters.'); return; }
    setBusy(true); setError(null);
    try {
      const r = await authApi.resetPassword(email.trim(), code.trim(), password);
      const wasSignedIn = !!user;
      await completeAuthCallback(r.token);
      if (wasSignedIn && router.canGoBack()) router.back();
      else router.replace((await postAuthDestination(getLatestUser(), getFeatures())) as any);
    } catch (err: any) { setError(err?.message ?? 'Couldn’t reset your password. Try again.'); }
    setBusy(false);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoider style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" style={{ marginBottom: spacing.xl }}>
            <Text style={styles.muted}>← Back</Text>
          </Pressable>
          <Text style={styles.title}>{step === 'email' ? 'Reset your password' : 'Check your email'}</Text>
          <Text style={styles.subtitle}>
            {step === 'email'
              ? 'We’ll email you a 6-digit code.'
              : `If ${email.trim()} has an account, a code is on its way. It works for 15 minutes.`}
          </Text>

          {step === 'email' ? (
            <Input label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
              placeholder="you@example.com" containerStyle={styles.input} />
          ) : (
            <>
              <Input label="Code" value={code} onChangeText={(t: string) => setCode(t.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad"
                placeholder="123456" containerStyle={styles.input} textContentType="oneTimeCode" autoComplete="one-time-code" />
              <Input label="New password" value={password} onChangeText={setPassword} secureTextEntry placeholder="8+ characters"
                containerStyle={styles.input} textContentType="newPassword" autoComplete="new-password" />
            </>
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity style={[styles.pill, busy && { opacity: 0.5 }]} activeOpacity={0.82} disabled={busy} onPress={step === 'email' ? sendCode : reset}>
            <Text style={styles.pillText}>{busy ? 'One moment…' : step === 'email' ? 'Send code' : 'Set new password'}</Text>
          </TouchableOpacity>

          {step === 'code' ? (
            <Pressable onPress={cooldown > 0 ? undefined : sendCode} disabled={cooldown > 0 || busy} style={styles.link}>
              <Text style={styles.muted}>{cooldown > 0 ? `Send a new code in ${cooldown}s` : 'Send a new code'}</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </KeyboardAvoider>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  scroll: { flexGrow: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xxl },
  title: { fontSize: 32, fontWeight: fontWeight.bold, color: colors.foreground, letterSpacing: -0.8, lineHeight: 36, marginBottom: 6 },
  subtitle: { fontSize: fontSize.md, color: colors.mutedForeground, marginBottom: spacing.xl, lineHeight: 22 },
  input: { marginBottom: spacing.md },
  error: { fontSize: fontSize.sm, color: colors.destructive ?? '#b91c1c', marginBottom: spacing.md },
  pill: { height: 52, borderRadius: radius.full ?? 999, backgroundColor: colors.foreground, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm },
  pillText: { color: colors.background, fontSize: fontSize.md, fontWeight: fontWeight.semibold },
  link: { alignItems: 'center', paddingVertical: spacing.md },
  muted: { fontSize: fontSize.sm, color: colors.mutedForeground },
});
