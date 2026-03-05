import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { AxiomLogo } from '../../src/components/ui/AxiomLogo';
import { colors, spacing, radius, fontSize, fontWeight } from '../../src/constants/theme';

const FEATURES = [
  {
    icon: 'hardware-chip-outline' as const,
    title: 'AI-Powered Analysis',
    description: 'Data-driven diagnostics for every lift.',
  },
  {
    icon: 'pulse-outline' as const,
    title: 'Science-Backed',
    description: 'Trained on 10 certifications & 7,000+ pages.',
  },
  {
    icon: 'shield-checkmark-outline' as const,
    title: '24/7 Availability',
    description: 'Judgment-free coaching anytime, anywhere.',
  },
];

export default function WelcomeScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* ── Brand row ── */}
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <AxiomLogo size={40} />
          <Text style={styles.brandName}>AXIOM</Text>
        </View>
      </View>

      {/* ── Hero headline ── */}
      <View style={styles.heroSection}>
        <Text style={styles.heroTitle}>Your personal{'\n'}AI coach.</Text>
      </View>

      {/* ── Features list ── */}
      <View style={styles.featuresSection}>
        {FEATURES.map((feat) => (
          <View key={feat.title} style={styles.featureRow}>
            <View style={styles.featureIconBox}>
              <Ionicons name={feat.icon} size={20} color={colors.foreground} />
            </View>
            <View style={styles.featureText}>
              <Text style={styles.featureTitle}>{feat.title}</Text>
              <Text style={styles.featureDescription}>{feat.description}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.spacer} />

      {/* ── Floating bottom pill ── */}
      <View style={styles.actionContainer}>
        <View style={styles.actionPill}>
          <TouchableOpacity
            style={styles.loginButton}
            activeOpacity={0.7}
            onPress={() => router.push('/(auth)/login')}
          >
            <Text style={styles.loginText}>Log In</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.getStartedButton}
            activeOpacity={0.85}
            onPress={() => router.push('/(auth)/register')}
          >
            <Text style={styles.getStartedText}>Get Started</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },

  // Header
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brandName: {
    fontSize: 13,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
    letterSpacing: 2,
  },

  // Hero
  heroSection: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  heroTitle: {
    fontSize: 40,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
    letterSpacing: -1,
    lineHeight: 46,
  },

  // Features
  featuresSection: {
    paddingHorizontal: spacing.lg,
    gap: spacing.lg,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  featureIconBox: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  featureText: {
    flex: 1,
    gap: 2,
  },
  featureTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
  },
  featureDescription: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    lineHeight: 20,
  },

  spacer: { flex: 1 },

  // Bottom pill
  actionContainer: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    paddingTop: spacing.md,
  },
  actionPill: {
    flexDirection: 'row',
    backgroundColor: colors.foreground,
    borderRadius: radius.xxl,
    padding: 6,
    alignItems: 'center',
  },
  loginButton: {
    flex: 1,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.xl,
  },
  loginText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: 'rgba(255,255,255,0.65)',
  },
  getStartedButton: {
    flex: 1,
    backgroundColor: colors.background,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.xl,
  },
  getStartedText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
  },
});
