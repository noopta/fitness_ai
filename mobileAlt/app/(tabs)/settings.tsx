import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/context/AuthContext';
import { useUnits } from '../../src/context/UnitsContext';
import { coachApi } from '../../src/lib/api';
import { Badge } from '../../src/components/ui/Badge';
import { colors, fontSize, fontWeight, radius, spacing } from '../../src/constants/theme';

export default function SettingsScreen() {
  const router = useRouter();
  const auth = useAuth();
  const { user } = auth;
  const [portalLoading, setPortalLoading] = useState(false);
  const isPro = user?.tier === 'pro' || user?.tier === 'enterprise';
  const { unit, toggleUnit } = useUnits();

  async function handleManageSubscription() {
    setPortalLoading(true);
    try {
      const data = await coachApi.getPaymentsPortal();
      console.log('[Settings] Portal response:', JSON.stringify(data));
      const url = data?.url ?? data?.portalUrl ?? data?.portal_url ?? data?.sessionUrl;
      if (url) {
        await Linking.openURL(url);
      } else {
        Alert.alert(
          'Portal Unavailable',
          'The subscription portal could not be loaded. This may be a server configuration issue. Please contact support if this persists.',
        );
      }
    } catch (err: any) {
      console.error('[Settings] Portal error:', err?.message, err);
      const msg = err?.message ?? 'Failed to open subscription portal.';
      if (msg.includes('Stripe') || msg.includes('customer')) {
        Alert.alert('Subscription Error', 'Your account does not have an active Stripe subscription linked. Please contact support.');
      } else {
        Alert.alert('Error', msg);
      }
    } finally {
      setPortalLoading(false);
    }
  }

  function handleUpgrade() {
    Linking.openURL(`https://buy.stripe.com/28E9AU15CaIJgYQ5zD0Ba00?client_reference_id=${user?.id ?? ''}`).catch(() => {
      Alert.alert('Error', 'Could not open upgrade page.');
    });
  }

  function handleSignOut() {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          try { await auth.logout(); } catch {}
          router.replace('/(auth)/welcome');
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <Text style={styles.screenTitle}>Settings</Text>

        {/* Profile row */}
        <View style={styles.profileCard}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarInitial}>
              {(user?.name ?? 'A').charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.profileName} numberOfLines={1}>{user?.name ?? 'Athlete'}</Text>
            {user?.email ? <Text style={styles.profileEmail} numberOfLines={1}>{user.email}</Text> : null}
          </View>
          <Badge variant={isPro ? 'pro' : 'secondary'}>{isPro ? 'Pro' : 'Free'}</Badge>
        </View>

        {/* Subscription section */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Subscription</Text>
          <View style={styles.card}>
            <View style={styles.cardRow}>
              <View style={styles.cardIconBox}>
                <Ionicons name={isPro ? 'star' : 'star-outline'} size={18} color={colors.foreground} />
              </View>
              <View style={styles.cardRowText}>
                <Text style={styles.cardRowTitle}>{isPro ? 'Pro Plan' : 'Free Plan'}</Text>
                <Text style={styles.cardRowSub}>
                  {isPro ? 'Full access to all features.' : '2 analyses per day. Upgrade for unlimited.'}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={isPro ? styles.outlineButton : styles.blackButton}
              activeOpacity={0.82}
              onPress={isPro ? handleManageSubscription : handleUpgrade}
              disabled={portalLoading}
            >
              <Text style={isPro ? styles.outlineButtonText : styles.blackButtonText}>
                {portalLoading ? 'Loading…' : isPro ? 'Manage Subscription' : 'Upgrade to Pro'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Preferences section */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Preferences</Text>
          <View style={styles.card}>
            <View style={styles.cardRow}>
              <View style={styles.cardIconBox}>
                <Ionicons name="barbell-outline" size={18} color={colors.foreground} />
              </View>
              <View style={styles.cardRowText}>
                <Text style={styles.cardRowTitle}>Weight Unit</Text>
                <Text style={styles.cardRowSub}>Used across workouts, logs, and strength profile</Text>
              </View>
              <TouchableOpacity onPress={toggleUnit} style={styles.unitToggle} activeOpacity={0.8}>
                <Text style={[styles.unitOption, unit === 'lbs' && styles.unitOptionActive]}>lbs</Text>
                <Text style={styles.unitSep}>·</Text>
                <Text style={[styles.unitOption, unit === 'kg' && styles.unitOptionActive]}>kg</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Account section */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Account</Text>
          <View style={styles.card}>
            <TouchableOpacity
              onPress={handleSignOut}
              activeOpacity={0.7}
              style={styles.accountRow}
            >
              <Ionicons name="log-out-outline" size={20} color={colors.destructive} />
              <Text style={styles.signOutText}>Sign Out</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.versionText}>Axiom v1.0.0 · AI-powered strength training</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },

  screenTitle: {
    fontSize: 28,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
    letterSpacing: -0.5,
  },

  // Profile
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.muted,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  avatarCircle: {
    width: 52,
    height: 52,
    borderRadius: radius.full,
    backgroundColor: colors.foreground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 22,
    fontWeight: fontWeight.bold,
    color: colors.primaryForeground,
  },
  profileInfo: { flex: 1 },
  profileName: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.foreground },
  profileEmail: { fontSize: fontSize.sm, color: colors.mutedForeground, marginTop: 2 },

  // Sections
  section: { gap: 8 },
  sectionLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.mutedForeground,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.background,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: spacing.md,
    paddingBottom: spacing.sm,
  },
  cardIconBox: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardRowText: { flex: 1 },
  cardRowTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  cardRowSub: { fontSize: fontSize.xs, color: colors.mutedForeground, marginTop: 2, lineHeight: 17 },

  blackButton: {
    margin: spacing.md,
    marginTop: 4,
    backgroundColor: colors.foreground,
    borderRadius: radius.md,
    paddingVertical: 13,
    alignItems: 'center',
  },
  blackButtonText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.primaryForeground },
  outlineButton: {
    margin: spacing.md,
    marginTop: 4,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 13,
    alignItems: 'center',
  },
  outlineButtonText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },

  // Account row
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: 12,
  },
  signOutText: { flex: 1, fontSize: fontSize.base, fontWeight: fontWeight.medium, color: colors.destructive },

  versionText: { fontSize: fontSize.xs, color: colors.mutedForeground, textAlign: 'center', marginTop: spacing.sm },

  unitToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.muted,
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 4,
  },
  unitOption: { fontSize: fontSize.sm, color: colors.mutedForeground, fontWeight: fontWeight.medium },
  unitOptionActive: { color: colors.foreground, fontWeight: fontWeight.bold },
  unitSep: { fontSize: fontSize.xs, color: colors.mutedForeground },
});
