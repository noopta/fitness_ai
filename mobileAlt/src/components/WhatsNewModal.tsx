import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Modal, ScrollView, TouchableOpacity, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, fontSize, fontWeight, radius, spacing } from '../constants/theme';

// Bump this string when shipping a new round of headline features. Users on
// any prior version (or fresh installs) see the modal exactly once after
// updating; users who already saw it for this version don't.
export const WHATS_NEW_VERSION = '3.1.0';
const STORAGE_KEY = 'whatsNew:lastSeenVersion';

interface Feature {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  title: string;
  body: string;
}

const FEATURES: Feature[] = [
  {
    icon: 'clipboard',
    iconColor: '#09090b',
    title: 'Nutrition & gut health',
    body: "Take the 3-minute assessment — the questions an elite nutritionist would ask — and get a personalized nutrition plan: targets for 18 nutrients, the foods that hit them, and a gut protocol with cited research behind every recommendation.",
  },
  {
    icon: 'analytics',
    iconColor: '#2a78d6',
    title: 'Micronutrients, tracked',
    body: "Not just macros. Iron, magnesium, fiber, B12 and more fill in automatically as you log — with honest estimates and clear on-track / low status, right on the confirm screen.",
  },
  {
    icon: 'leaf',
    iconColor: '#22c55e',
    title: 'Your Plant Collection',
    body: "Thirty different plants a week is one of the strongest predictors of gut health in the research. Every distinct plant you eat fills a slot — herbs and spices count.",
  },
  {
    icon: 'receipt',
    iconColor: '#7c5cff',
    title: 'Log takeout from a screenshot',
    body: "Screenshot an UberEats or DoorDash order and we extract every item. Untick what wasn't yours, set your portion, done — the image is read once and never stored.",
  },
  {
    icon: 'book',
    iconColor: '#f59e0b',
    title: 'Recipes',
    body: "Save a recipe once — paste the whole thing and Anakin splits it into ingredients — then log a serving in two taps from the Manual sheet.",
  },
  {
    icon: 'pulse',
    iconColor: '#ef4444',
    title: 'How your food is acting',
    body: "The Nutrition Profile under Strength now shows how meals hit your energy, recovery, and focus — with 7-day and 30-day trends and per-ingredient breakdowns.",
  },
];

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function WhatsNewModal({ visible, onClose }: Props) {
  const { height } = useWindowDimensions();

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>What's new</Text>
            <Text style={styles.title}>Welcome to Axiom {WHATS_NEW_VERSION}</Text>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={8}>
            <Ionicons name="close" size={22} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
          style={{ maxHeight: height * 0.75 }}
        >
          {FEATURES.map((f, i) => (
            <View key={i} style={styles.feature}>
              <View style={[styles.iconBubble, { backgroundColor: f.iconColor + '18' }]}>
                <Ionicons name={f.icon} size={22} color={f.iconColor} />
              </View>
              <View style={styles.textCol}>
                <Text style={styles.featureTitle}>{f.title}</Text>
                <Text style={styles.featureBody}>{f.body}</Text>
              </View>
            </View>
          ))}
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity style={styles.cta} onPress={onClose} activeOpacity={0.85}>
            <Text style={styles.ctaText}>Got it — let's go</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

/**
 * Returns true if the user has not yet acknowledged the current version's
 * What's New modal. Resolves to false on AsyncStorage read errors so we don't
 * spam the modal in failure cases.
 */
export async function shouldShowWhatsNew(): Promise<boolean> {
  try {
    const seen = await AsyncStorage.getItem(STORAGE_KEY);
    // Fresh installs see it too (product decision 2026-07-26): the caller
    // gates on onboarding completion, so brand-new users get the tour right
    // after finishing intake rather than mid-signup.
    return seen !== WHATS_NEW_VERSION;
  } catch {
    return false;
  }
}

export async function markWhatsNewSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, WHATS_NEW_VERSION);
  } catch { /* swallow */ }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: fontWeight.bold,
    letterSpacing: 1.2,
    color: colors.mutedForeground,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
    marginTop: 2,
  },
  closeBtn: { padding: 4 },
  body: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xl },
  feature: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  iconBubble: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textCol: { flex: 1 },
  featureTitle: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
    marginBottom: 2,
  },
  featureBody: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    lineHeight: 20,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  cta: {
    backgroundColor: colors.foreground,
    borderRadius: radius.lg,
    paddingVertical: 14,
    alignItems: 'center',
  },
  ctaText: {
    color: colors.primaryForeground,
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
  },
});
