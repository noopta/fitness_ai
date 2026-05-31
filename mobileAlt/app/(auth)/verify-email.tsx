// 6-digit OTP entry screen. The user reaches this from /(auth)/register or
// /(auth)/login when the backend says `requiresVerification`. We pre-send
// the code from the route handler that brought them here, so this screen
// only handles input + resend.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ActivityIndicator, Alert, Keyboard, Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/context/AuthContext';
import { colors, fontSize, fontWeight, radius, spacing } from '../../src/constants/theme';

const CODE_LENGTH = 6;

export default function VerifyEmailScreen() {
  const router = useRouter();
  const { email: emailParam } = useLocalSearchParams<{ email: string }>();
  const email = (emailParam ?? '').trim();
  const { verifyEmail, resendVerification, logout } = useAuth();

  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(''));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const inputRefs = useRef<Array<TextInput | null>>([]);

  // Hard guard against a deep-link landing here without the email param —
  // bounce back to login rather than show a half-broken screen.
  useEffect(() => {
    if (!email) router.replace('/(auth)/login');
  }, [email, router]);

  // Auto-focus the first cell once on mount.
  useEffect(() => {
    const t = setTimeout(() => inputRefs.current[0]?.focus(), 200);
    return () => clearTimeout(t);
  }, []);

  // Tick the resend cooldown down to 0.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => (c > 0 ? c - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const setDigit = (idx: number, val: string) => {
    setError(null);
    // Support paste: if more than one digit landed in a cell, distribute
    // across the remaining cells starting at idx.
    if (val.length > 1) {
      const cleaned = val.replace(/\D/g, '').slice(0, CODE_LENGTH - idx);
      if (!cleaned) return;
      const next = [...digits];
      for (let i = 0; i < cleaned.length; i++) next[idx + i] = cleaned[i];
      setDigits(next);
      const focusIdx = Math.min(idx + cleaned.length, CODE_LENGTH - 1);
      inputRefs.current[focusIdx]?.focus();
      if (next.every((d) => d !== '')) submit(next.join(''));
      return;
    }
    const cleaned = val.replace(/\D/g, '').slice(0, 1);
    const next = [...digits];
    next[idx] = cleaned;
    setDigits(next);
    if (cleaned && idx < CODE_LENGTH - 1) inputRefs.current[idx + 1]?.focus();
    // Auto-submit when all 6 are filled.
    if (next.every((d) => d !== '')) submit(next.join(''));
  };

  const onKeyPress = (idx: number, key: string) => {
    if (key === 'Backspace' && !digits[idx] && idx > 0) {
      // Move to previous cell on backspace in an empty cell — common OTP UX.
      const next = [...digits];
      next[idx - 1] = '';
      setDigits(next);
      inputRefs.current[idx - 1]?.focus();
    }
  };

  const submit = useCallback(async (code: string) => {
    if (code.length !== CODE_LENGTH || submitting) return;
    Keyboard.dismiss();
    setSubmitting(true);
    setError(null);
    try {
      await verifyEmail(email, code);
      router.replace('/(tabs)');
    } catch (err: any) {
      setError(err?.message ?? 'That code didn\'t match. Try again.');
      // Clear digits so the user can re-type without manually wiping each.
      setDigits(Array(CODE_LENGTH).fill(''));
      setTimeout(() => inputRefs.current[0]?.focus(), 50);
    } finally {
      setSubmitting(false);
    }
  }, [email, verifyEmail, router, submitting]);

  const onResend = async () => {
    if (cooldown > 0 || resending) return;
    setResending(true);
    setError(null);
    try {
      const r = await resendVerification(email);
      if (r.sent) {
        setCooldown(60);
        Alert.alert('Code sent', 'Check your inbox for a fresh code.');
      } else if (r.reason === 'cooldown' && typeof r.cooldownRemainingSec === 'number') {
        setCooldown(r.cooldownRemainingSec);
      } else if (r.reason === 'already_verified') {
        Alert.alert('Already verified', 'Try signing in.');
        await logout();
        router.replace('/(auth)/login');
      } else {
        setError('Could not send a new code. Check your connection and try again.');
      }
    } catch (err: any) {
      setError(err?.message ?? 'Could not send a new code.');
    } finally {
      setResending(false);
    }
  };

  const onUseDifferentEmail = async () => {
    await logout();
    router.replace('/(auth)/register');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Verify your email</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.body}>
        <Text style={styles.title}>Check your email</Text>
        <Text style={styles.subtitle}>
          We sent a 6-digit code to{'\n'}
          <Text style={styles.email}>{email || 'your inbox'}</Text>
        </Text>

        <View style={styles.codeRow}>
          {digits.map((d, i) => (
            <TextInput
              key={i}
              ref={(el) => { inputRefs.current[i] = el; }}
              style={[styles.cell, error ? styles.cellError : null]}
              value={d}
              onChangeText={(v) => setDigit(i, v)}
              onKeyPress={(e) => onKeyPress(i, e.nativeEvent.key)}
              keyboardType="number-pad"
              maxLength={i === 0 ? CODE_LENGTH : 1}
              textContentType="oneTimeCode"
              autoComplete={i === 0 ? 'one-time-code' : 'off'}
              selectTextOnFocus
              editable={!submitting}
            />
          ))}
        </View>

        {submitting ? (
          <View style={styles.submittingRow}>
            <ActivityIndicator color={colors.foreground} />
            <Text style={styles.submittingText}>Verifying…</Text>
          </View>
        ) : error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : (
          <Text style={styles.hintText}>The code expires in 15 minutes.</Text>
        )}

        <View style={styles.actions}>
          <Pressable onPress={onResend} disabled={cooldown > 0 || resending} hitSlop={8}>
            <Text style={[styles.linkText, (cooldown > 0 || resending) && styles.linkDisabled]}>
              {resending ? 'Sending…' : cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
            </Text>
          </Pressable>
          <Pressable onPress={onUseDifferentEmail} hitSlop={8}>
            <Text style={styles.linkText}>Use a different email</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.foreground },
  body: { flex: 1, padding: spacing.lg, gap: spacing.md, alignItems: 'center' },
  title: { fontSize: fontSize.xxl, fontWeight: fontWeight.bold, color: colors.foreground, marginTop: spacing.xl, textAlign: 'center' },
  subtitle: { fontSize: fontSize.sm, color: colors.mutedForeground, textAlign: 'center', lineHeight: 22 },
  email: { color: colors.foreground, fontWeight: fontWeight.semibold },

  codeRow: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.lg },
  cell: {
    width: 44, height: 56,
    borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.muted,
    color: colors.foreground,
    fontSize: 24, fontWeight: fontWeight.bold, textAlign: 'center',
  },
  cellError: { borderColor: colors.destructive },

  submittingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
  submittingText: { fontSize: fontSize.sm, color: colors.mutedForeground },
  hintText: { fontSize: fontSize.sm, color: colors.mutedForeground, marginTop: spacing.sm },
  errorText: { fontSize: fontSize.sm, color: colors.destructive, marginTop: spacing.sm, textAlign: 'center' },

  actions: { marginTop: spacing.xl, gap: spacing.md, alignItems: 'center' },
  linkText: { fontSize: fontSize.sm, color: colors.primary, fontWeight: fontWeight.semibold },
  linkDisabled: { color: colors.mutedForeground },
});
