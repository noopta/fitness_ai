import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, fontSize, fontWeight, radius } from '../constants/theme';
import { PRO_PRICE_FALLBACK } from './UpgradeSheet';

interface UpgradePromptProps {
  userId?: string;
  reason?: string;
  onUpgrade?: () => void;
}

// ── Feature categories ────────────────────────────────────────────────────────

const FEATURE_SECTIONS = [
  {
    icon: 'barbell-outline' as const,
    color: '#6366f1',
    title: 'AI Strength Diagnostics',
    features: [
      'Unlimited lift analyses per day',
      'Science-based phase detection (strength, hypertrophy, peaking)',
      'Muscle-group balance & weakness identification',
      'AI-generated accessory prescription',
    ],
  },
  {
    icon: 'chatbubble-ellipses-outline' as const,
    color: '#22c55e',
    title: 'Personal AI Coach — Anakin',
    features: [
      'Unlimited 24/7 AI coach conversations',
      'Periodized training program (linear, undulating, block)',
      'Evidence-based progression: progressive overload + deload scheduling',
      'Program adjustments based on fatigue and wellness data',
    ],
  },
  {
    icon: 'nutrition-outline' as const,
    color: '#f59e0b',
    title: 'Nutrition Intelligence',
    features: [
      'AI meal logging with photo recognition',
      'Personalized macro targets (protein/kg based on bodyweight + goal)',
      'Nutrition-performance correlation tracking',
      'Caloric periodization aligned to training phases',
    ],
  },
  {
    icon: 'pulse-outline' as const,
    color: '#ef4444',
    title: 'Wellness & Recovery Science',
    features: [
      'HRV, sleep, stress, and mood tracking',
      'Readiness scores to guide training intensity',
      'Fatigue-aware load management',
      'Longitudinal wellness ↔ performance correlation',
    ],
  },
  {
    icon: 'stats-chart-outline' as const,
    color: '#8b5cf6',
    title: 'Strength Profile & Analytics',
    features: [
      'Live 1RM estimation via Epley formula',
      'Strength tier ranking (Beginner → Elite)',
      'Weekly 1RM trend tracking per lift',
      'Movement balance radar (Push / Pull / Legs / Hinge / Core)',
    ],
  },
];

// Pro upgrade is managed via the web portal at axiomtraining.io.
// In-app upgrade UI is hidden until App Store IAP setup is complete.
export function UpgradePrompt({ userId: _userId, reason: _reason, onUpgrade: _onUpgrade }: UpgradePromptProps) {
  return null;
}

function _UpgradePromptContent({ reason }: UpgradePromptProps) {
  return (
    <View style={styles.container}>
      {/* Hero */}
      <View style={styles.hero}>
        <View style={styles.heroIcon}>
          <Ionicons name="star" size={28} color="#f59e0b" />
        </View>
        <Text style={styles.heroTitle}>Upgrade to Pro</Text>
        <Text style={styles.heroSubtitle}>
          {reason ?? 'Science-backed AI coaching, personalized to you.'}
        </Text>
        {/* Pricing text hidden until IAP is re-enabled */}
      </View>

      {/* Feature sections */}
      {FEATURE_SECTIONS.map((section) => (
        <View key={section.title} style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={[styles.sectionIcon, { backgroundColor: section.color + '20' }]}>
              <Ionicons name={section.icon} size={16} color={section.color} />
            </View>
            <Text style={styles.sectionTitle}>{section.title}</Text>
          </View>
          {section.features.map((feat) => (
            <View key={feat} style={styles.featureRow}>
              <Ionicons name="checkmark-circle" size={15} color={section.color} style={styles.checkIcon} />
              <Text style={styles.featureText}>{feat}</Text>
            </View>
          ))}
        </View>
      ))}

      {/* CTA — hidden: in-app purchase disabled pending App Store approval */}
      {/* Restore when IAP is re-enabled: uncomment TouchableOpacity block above */}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
  },
  hero: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    gap: 6,
    backgroundColor: colors.card,
  },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(245,158,11,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  heroTitle: {
    fontSize: fontSize.xxl ?? 24,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
  },
  heroSubtitle: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    textAlign: 'center',
    lineHeight: 20,
  },
  heroPricing: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    marginTop: 2,
  },

  section: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: 8,
    backgroundColor: colors.card,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  sectionIcon: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
    flex: 1,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  checkIcon: { flexShrink: 0, marginTop: 1 },
  featureText: {
    fontSize: fontSize.sm - 1,
    color: colors.mutedForeground,
    flex: 1,
    lineHeight: 18,
  },

  upgradeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.foreground,
    borderRadius: radius.xl,
    paddingVertical: 16,
  },
  upgradeButtonText: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.primaryForeground,
  },
  legal: {
    fontSize: 11,
    color: colors.mutedForeground,
    textAlign: 'center',
    lineHeight: 16,
    paddingHorizontal: spacing.md,
  },
});
