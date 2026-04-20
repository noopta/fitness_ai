import React, { useRef, useEffect } from 'react';
import { Linking } from 'react-native';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal,
  ScrollView, Animated, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, radius, spacing } from '../constants/theme';
import { Analytics } from '../lib/analytics';

// ─── Constants ────────────────────────────────────────────────────────────────

const WEB_UPGRADE_URL = 'https://axiomtraining.io/pricing';

// TODO: Restore in-app payments (Stripe + Apple IAP) once CRA business
// registration and App Store tax forms are complete (~3-4 weeks).
// All original payment code is preserved below in the commented PaymentSheetContent_DISABLED block.
// Steps to restore:
//   1. Uncomment PaymentSheetContent_DISABLED and rename to PaymentSheetContent
//   2. Restore original imports (useAuth, iap lib, react-native-iap types)
//   3. Remove WebUpgradeContent and its usage
export const PRO_PRICE_FALLBACK = '$12.99';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const PERKS = [
  { icon: 'infinite-outline',              text: 'Unlimited daily analyses' },
  { icon: 'barbell-outline',               text: 'Full diagnostic interview + AI plan' },
  { icon: 'chatbubble-ellipses-outline',   text: 'Unlimited AI coach chat' },
  { icon: 'stats-chart-outline',           text: 'Strength profile & history' },
  { icon: 'nutrition-outline',             text: 'Nutrition intelligence & tracking' },
];

// ── Temporary web upgrade prompt ──────────────────────────────────────────────
// Replaces in-app payment while business registration completes.
// TODO: swap back to PaymentSheetContent_DISABLED when ready.
function WebUpgradeContent({ onClose }: { onClose: () => void }) {
  async function handleOpenWeb() {
    Analytics.upgradeTapped('web_redirect');
    try {
      await Linking.openURL(WEB_UPGRADE_URL);
    } catch {
      // fallback — nothing to do
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
      {/* Perks */}
      <View style={styles.perksCard}>
        {PERKS.map((perk) => (
          <View key={perk.text} style={styles.perkRow}>
            <View style={styles.perkIcon}>
              <Ionicons name={perk.icon as any} size={16} color={colors.foreground} />
            </View>
            <Text style={styles.perkText}>{perk.text}</Text>
          </View>
        ))}
      </View>

      {/* Web redirect notice */}
      <View style={styles.webNoticeCard}>
        <View style={styles.webNoticeIcon}>
          <Ionicons name="globe-outline" size={22} color={colors.foreground} />
        </View>
        <Text style={styles.webNoticeTitle}>Upgrade on the web</Text>
        <Text style={styles.webNoticeBody}>
          In-app purchase is coming soon. For now, upgrade at{' '}
          <Text style={styles.webNoticeLink}>axiomtraining.io</Text> — takes 2 minutes and
          your Pro access works instantly across all your devices.
        </Text>
        <TouchableOpacity style={styles.webBtn} onPress={handleOpenWeb} activeOpacity={0.85}>
          <Ionicons name="open-outline" size={16} color="#fff" style={{ marginRight: 8 }} />
          <Text style={styles.webBtnText}>Go to axiomtraining.io</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.webDismiss} onPress={onClose}>
          <Text style={styles.webDismissText}>Maybe later</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.legal}>
        <Text style={styles.legalLink} onPress={() => Linking.openURL('https://axiomtraining.io/terms').catch(() => {})}>Terms</Text>
        {'  ·  '}
        <Text style={styles.legalLink} onPress={() => Linking.openURL('https://axiomtraining.io/privacy').catch(() => {})}>Privacy</Text>
      </Text>
    </ScrollView>
  );
}

// ── TODO: restore PaymentSheetContent when CRA registration + App Store tax forms done ──
// Original Stripe + Apple IAP code is in git history. To restore:
//   git show 704057d:mobileAlt/src/components/UpgradeSheet.tsx
// Then copy back PaymentSheetContent + imports and swap WebUpgradeContent below.

// ── TEMPORARILY DISABLED: UpgradeSheet hidden for App Store review ────────────
// In-app purchase (Apple IAP via react-native-iap) will be re-enabled once
// CRA business registration + App Store tax forms are complete.
// To restore: git show 704057d:mobileAlt/src/components/UpgradeSheet.tsx
// ─────────────────────────────────────────────────────────────────────────────
export function UpgradeSheet({ visible: _visible, onClose: _onClose, onSuccess: _onSuccess }: Props) {
  // Upgrade flow is disabled — returns nothing so no payment UI appears in the app.
  return null;
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
    paddingBottom: 34,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 4,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
  },
  subtitle: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    marginTop: 2,
  },
  body: {
    padding: spacing.lg,
    gap: spacing.lg,
  },

  // Perks
  perksCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  perkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  perkIcon: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  perkText: {
    fontSize: fontSize.sm,
    color: colors.foreground,
    flex: 1,
  },

  // Payment sections
  paymentSection: {
    gap: spacing.sm,
  },
  paymentSectionLabel: {
    fontSize: 11,
    fontWeight: fontWeight.semibold,
    color: colors.mutedForeground,
    letterSpacing: 0.8,
  },
  appleSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  comingSoonBadge: {
    backgroundColor: colors.muted,
    borderRadius: radius.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  comingSoonText: {
    fontSize: 10,
    color: colors.mutedForeground,
    fontWeight: fontWeight.medium,
  },

  // Stripe button
  stripeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#635bff',
    borderRadius: radius.md,
    paddingVertical: 15,
  },
  stripeBtnText: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: '#fff',
  },
  stripeConfirmBox: {
    gap: spacing.sm,
  },
  stripeConfirmMsg: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    textAlign: 'center',
    lineHeight: 20,
  },
  reopenLink: {
    alignSelf: 'center',
    paddingVertical: 4,
  },
  reopenLinkText: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    textDecorationLine: 'underline',
  },

  // Apple button (secondary, muted when unavailable)
  appleBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: colors.card,
  },
  appleBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  appleBtnText: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.medium,
    color: colors.foreground,
  },

  // Shared
  btnDisabled: { opacity: 0.5 },

  // Errors
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fef2f2',
    borderRadius: radius.md,
    padding: spacing.md,
  },
  errorText: {
    fontSize: fontSize.sm,
    color: '#ef4444',
    flex: 1,
  },
  retryLink: { marginTop: 6 },
  retryLinkText: {
    fontSize: fontSize.sm,
    color: '#ef4444',
    fontWeight: fontWeight.semibold,
    textDecorationLine: 'underline',
  },

  // Web upgrade notice
  webNoticeCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
  webNoticeIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  webNoticeTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
    textAlign: 'center',
  },
  webNoticeBody: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    textAlign: 'center',
    lineHeight: 20,
  },
  webNoticeLink: {
    color: colors.foreground,
    fontWeight: fontWeight.semibold,
  },
  webBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.foreground,
    borderRadius: radius.lg,
    paddingVertical: 14,
    paddingHorizontal: spacing.xl,
    marginTop: 4,
  },
  webBtnText: {
    color: colors.primaryForeground,
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
  },
  webDismiss: { paddingVertical: 8 },
  webDismissText: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    textDecorationLine: 'underline',
  },

  // Legal
  legal: {
    fontSize: 11,
    color: colors.mutedForeground,
    textAlign: 'center',
    lineHeight: 16,
  },
  legalLink: {
    fontSize: 11,
    color: colors.foreground,
    textDecorationLine: 'underline',
  },
});
