import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/context/AuthContext';
import { coachApi } from '../../src/lib/api';
import { Card } from '../../src/components/ui/Card';
import { Button } from '../../src/components/ui/Button';
import { Badge } from '../../src/components/ui/Badge';
import { colors, fontSize, fontWeight, radius, spacing } from '../../src/constants/theme';

export default function SettingsScreen() {
  const router = useRouter();
  const auth = useAuth();
  const { user } = auth;
  const [portalLoading, setPortalLoading] = useState(false);

  const isPro = user?.tier === 'pro' || user?.tier === 'enterprise';

  // ── Manage subscription / upgrade ─────────────────────────────────────────

  async function handleManageSubscription() {
    setPortalLoading(true);
    try {
      const data = await coachApi.getPaymentsPortal();
      const url = data?.url ?? data?.portalUrl;
      if (url) {
        await Linking.openURL(url);
      } else {
        Alert.alert('Error', 'Could not retrieve subscription portal link.');
      }
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to open subscription portal.');
    } finally {
      setPortalLoading(false);
    }
  }

  function handleUpgrade() {
    const stripeUrl = `https://buy.stripe.com/28E9AU15CaIJgYQ5zD0Ba00?client_reference_id=${user?.id ?? ''}`;
    Linking.openURL(stripeUrl).catch(() => {
      Alert.alert('Error', 'Could not open upgrade page.');
    });
  }

  // ── Sign out ───────────────────────────────────────────────────────────────

  function handleSignOut() {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            try {
              await auth.logout();
              router.replace('/(auth)/welcome');
            } catch {
              // logout clears local token regardless — just navigate
              router.replace('/(auth)/welcome');
            }
          },
        },
      ],
    );
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ── */}
        <Text style={styles.screenTitle}>Settings</Text>

        {/* ── Profile Card ── */}
        <Card style={styles.card}>
          <View style={styles.profileInner}>
            {/* Avatar placeholder */}
            <View style={styles.avatarCircle}>
              <Ionicons name="person" size={28} color={colors.primary} />
            </View>

            <View style={styles.profileInfo}>
              <Text style={styles.profileName} numberOfLines={1}>
                {user?.name ?? 'Athlete'}
              </Text>
              {user?.email ? (
                <Text style={styles.profileEmail} numberOfLines={1}>
                  {user.email}
                </Text>
              ) : null}
            </View>

            <Badge variant={isPro ? 'pro' : 'secondary'}>
              {isPro ? 'Pro' : 'Free'}
            </Badge>
          </View>
        </Card>

        {/* ── Subscription Card ── */}
        <Card style={styles.card}>
          <View style={styles.cardInner}>
            <View style={styles.cardTitleRow}>
              <Ionicons
                name={isPro ? 'star' : 'star-outline'}
                size={18}
                color={isPro ? colors.warning : colors.mutedForeground}
              />
              <Text style={styles.cardTitle}>
                {isPro ? 'Pro Subscription' : 'Free Plan'}
              </Text>
            </View>

            <Text style={styles.cardBody}>
              {isPro
                ? 'You have full access to all features.'
                : '2 analyses per day. Upgrade for unlimited access.'}
            </Text>

            {isPro ? (
              <Button
                variant="outline"
                onPress={handleManageSubscription}
                loading={portalLoading}
                style={styles.cardButton}
              >
                Manage Subscription
              </Button>
            ) : (
              <Button
                onPress={handleUpgrade}
                style={styles.cardButton}
              >
                Upgrade to Pro
              </Button>
            )}
          </View>
        </Card>

        {/* ── Account Card ── */}
        <Card style={styles.card}>
          <View style={styles.cardInner}>
            <Text style={styles.cardTitle}>Account</Text>

            {/* Sign Out row */}
            <TouchableOpacity
              onPress={handleSignOut}
              activeOpacity={0.7}
              style={styles.accountRow}
            >
              <Ionicons
                name="log-out-outline"
                size={20}
                color={colors.destructive}
              />
              <Text style={styles.signOutText}>Sign Out</Text>
              <Ionicons
                name="chevron-forward"
                size={16}
                color={colors.mutedForeground}
                style={styles.chevron}
              />
            </TouchableOpacity>
          </View>
        </Card>

        {/* ── Version ── */}
        <Text style={styles.versionText}>
          Axiom v1.0.0 · AI-powered strength training
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: { flex: 1 },
  scrollContent: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
    gap: 14,
  },

  // Header
  screenTitle: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
    marginBottom: 4,
  },

  // Cards
  card: {
    padding: 0,
  },

  // Profile
  profileInner: {
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatarCircle: {
    width: 52,
    height: 52,
    borderRadius: radius.full,
    backgroundColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
  },
  profileEmail: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    marginTop: 2,
  },

  // Generic card inner
  cardInner: {
    padding: spacing.md,
    gap: 10,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardTitle: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
  },
  cardBody: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    lineHeight: 20,
  },
  cardButton: {
    marginTop: 2,
  },

  // Account row
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 10,
  },
  signOutText: {
    flex: 1,
    fontSize: fontSize.base,
    fontWeight: fontWeight.medium,
    color: colors.destructive,
  },
  chevron: {
    marginLeft: 'auto',
  },

  // Version
  versionText: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    textAlign: 'center',
    marginTop: 8,
  },
});
