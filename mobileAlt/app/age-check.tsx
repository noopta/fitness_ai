import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Alert, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { AxiomLogo } from '../src/components/ui/AxiomLogo';
import { Input } from '../src/components/ui/Input';
import { KeyboardDoneBar } from '../src/components/ui/KeyboardDoneBar';
import { useAuth } from '../src/context/AuthContext';
import { authApi } from '../src/lib/api';
import { colors, spacing, radius, fontSize, fontWeight } from '../src/constants/theme';

export default function AgeCheckScreen() {
  const router = useRouter();
  const { logout, clearDobCheck } = useAuth();

  const [dateOfBirth, setDateOfBirth] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleContinue() {
    if (!dateOfBirth.trim()) {
      Alert.alert('Required', 'Please enter your date of birth.');
      return;
    }
    const dob = new Date(dateOfBirth.trim());
    if (isNaN(dob.getTime())) {
      Alert.alert('Invalid Date', 'Please enter your date of birth in YYYY-MM-DD format.');
      return;
    }
    const ageDays = (Date.now() - dob.getTime()) / 86400000;
    if (ageDays < 13 * 365.25) {
      Alert.alert(
        'Age Restriction',
        'You must be at least 13 years old to use this app.',
        [{ text: 'OK', onPress: () => logout() }],
      );
      return;
    }

    setSubmitting(true);
    try {
      await authApi.setDob(dateOfBirth.trim());
      clearDobCheck();
      router.replace('/(tabs)');
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not save your date of birth. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel() {
    await logout();
    router.replace('/(auth)/welcome' as any);
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
        <View style={styles.brandRow}>
          <AxiomLogo size={36} />
          <Text style={styles.brandName}>AXIOM</Text>
        </View>

        <Text style={styles.title}>One more step.</Text>
        <Text style={styles.subtitle}>
          We need your date of birth to confirm you meet the minimum age requirement (13+).
        </Text>

        <Input
          label="Date of Birth"
          value={dateOfBirth}
          onChangeText={setDateOfBirth}
          placeholder="YYYY-MM-DD"
          keyboardType="numbers-and-punctuation"
          autoCorrect={false}
          containerStyle={styles.inputContainer}
        />

        <TouchableOpacity
          style={[styles.continuePill, submitting && { opacity: 0.5 }]}
          activeOpacity={0.82}
          onPress={handleContinue}
          disabled={submitting}
        >
          <Text style={styles.continuePillText}>
            {submitting ? 'Saving…' : 'Continue'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={handleCancel} style={styles.cancelRow}>
          <Text style={styles.cancelText}>Cancel and sign out</Text>
        </TouchableOpacity>
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
    lineHeight: 22,
  },

  inputContainer: { marginBottom: spacing.md },

  continuePill: {
    backgroundColor: colors.foreground,
    borderRadius: radius.xl,
    paddingVertical: 17,
    alignItems: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
  },
  continuePillText: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.primaryForeground,
  },

  cancelRow: { alignItems: 'center', paddingVertical: spacing.sm },
  cancelText: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    textDecorationLine: 'underline',
  },
});
