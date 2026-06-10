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
export const WHATS_NEW_VERSION = '2.0.2';
const STORAGE_KEY = 'whatsNew:lastSeenVersion';

interface Feature {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  title: string;
  body: string;
}

const FEATURES: Feature[] = [
  {
    icon: 'swap-horizontal',
    iconColor: '#6366f1',
    title: "Swap today's workout",
    body: "Not feeling today's session? Tap Swap on the Program tab to pull another day's workout into today. Anakin re-sequences the rest of your week so you still get the right recovery between hard sessions.",
  },
  {
    icon: 'share-social',
    iconColor: '#22c55e',
    title: 'Share your wins',
    body: "Hit a protein goal or a new weight milestone? Tap the share icon to export a clean card to your stories. Built-in for both nutrition and weight progress.",
  },
  {
    icon: 'people-circle',
    iconColor: '#0ea5e9',
    title: 'Group chats',
    body: "Train with friends? Start a group in Messages, share progress, and pull Anakin in for a daily check-in. Avatars, push notifications, and a shared coach in one thread.",
  },
  {
    icon: 'trophy',
    iconColor: '#f59e0b',
    title: 'Protein goal celebration',
    body: "Hit your daily protein target and we'll celebrate it in-app instead of pinging you with another push notification. The protein push is gone — the moment lives where it belongs, in the Nutrition tab.",
  },
  {
    icon: 'lock-closed',
    iconColor: '#a855f7',
    title: 'Private posts',
    body: 'Choose who sees each social post — friends only or fully private. The toggle is right next to the post button when you share.',
  },
  {
    icon: 'shield-checkmark',
    iconColor: '#ef4444',
    title: 'More stable, faster',
    body: 'Crash protection around the Coach tab, faster social feed loads, and lighter avatars throughout. Less waiting, fewer surprises.',
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
