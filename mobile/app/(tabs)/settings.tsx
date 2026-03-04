import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { colors, fontSize, fontWeight, spacing, radius } from '@/constants/theme';

export default function SettingsScreen() {
  const { user, logout } = useAuth();
  const router = useRouter();

  const tierLabel = user?.tier === 'pro' ? 'Pro' : user?.tier === 'enterprise' ? 'Enterprise' : 'Free';
  const isPro = user?.tier === 'pro' || user?.tier === 'enterprise';

  async function handleLogout() {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await logout();
          router.replace('/(auth)/login');
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.pageTitle}>Account Settings</Text>
        <Text style={styles.pageSubtitle}>Manage your account and preferences.</Text>

        <Card style={styles.card}>
          <View style={styles.sectionHeader}>
            <View style={[styles.sectionIcon, { backgroundColor: colors.primary + '15' }]}>
              <Ionicons name="person" size={16} color={colors.primary} />
            </View>
            <Text style={styles.sectionTitle}>Profile</Text>
          </View>

          <View style={styles.fieldGrid}>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>NAME</Text>
              <Text style={styles.fieldValue}>{user?.name || '-'}</Text>
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>EMAIL</Text>
              <Text style={styles.fieldValue}>{user?.email || '-'}</Text>
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>PLAN</Text>
              <View style={styles.planRow}>
                <Ionicons
                  name={isPro ? 'diamond' : 'flash'}
                  size={14}
                  color={isPro ? colors.primary : colors.mutedForeground}
                />
                <Text style={[styles.fieldValue, isPro && { color: colors.primary }]}>
                  {tierLabel}
                </Text>
              </View>
            </View>
          </View>
        </Card>

        <Card style={styles.card}>
          <View style={styles.sectionHeader}>
            <View style={[styles.sectionIcon, { backgroundColor: colors.primary + '15' }]}>
              <Ionicons name="card" size={16} color={colors.primary} />
            </View>
            <Text style={styles.sectionTitle}>Subscription</Text>
          </View>

          {isPro ? (
            <View>
              <View style={styles.proStatus}>
                <View style={styles.proStatusLeft}>
                  <Ionicons name="diamond" size={16} color={colors.primary} />
                  <Text style={styles.proLabel}>Pro Plan - Active</Text>
                </View>
                <View style={styles.activeBadge}>
                  <Ionicons name="checkmark" size={12} color={colors.green500} />
                  <Text style={styles.activeBadgeText}>Active</Text>
                </View>
              </View>
              <Text style={styles.proPrice}>$12 / month</Text>
            </View>
          ) : (
            <View>
              <View style={styles.freeStatus}>
                <Text style={styles.freeTitle}>Free Plan</Text>
                <Text style={styles.freeSubtitle}>2 analyses per day</Text>
              </View>

              <View style={styles.upgradeBox}>
                <Text style={styles.upgradeTitle}>Upgrade to Pro - $12/month</Text>
                {[
                  'Unlimited diagnostics + full AI Coach',
                  'Personalized training programs',
                  'Nutrition plan with macro targets',
                ].map((f, i) => (
                  <View key={i} style={styles.upgradeFeatureRow}>
                    <Ionicons name="checkmark-circle" size={14} color={colors.primary} />
                    <Text style={styles.upgradeFeatureText}>{f}</Text>
                  </View>
                ))}
                <Button size="lg" style={{ marginTop: 16 }}>
                  Upgrade to Pro
                </Button>
              </View>
            </View>
          )}
        </Card>

        <Card style={styles.card}>
          <View style={styles.sectionHeader}>
            <View style={[styles.sectionIcon, { backgroundColor: colors.muted }]}>
              <Ionicons name="shield" size={16} color={colors.mutedForeground} />
            </View>
            <Text style={styles.sectionTitle}>Account</Text>
          </View>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => router.push('/(tabs)/history')}
          >
            <Text style={styles.menuItemText}>Analysis History</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItemDanger} onPress={handleLogout}>
            <Text style={styles.menuItemDangerText}>Sign Out</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: 40,
  },
  pageTitle: {
    color: colors.foreground,
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.semibold,
  },
  pageSubtitle: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    marginTop: 4,
    marginBottom: 24,
  },
  card: {
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  sectionIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    color: colors.foreground,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  fieldGrid: {
    gap: 12,
  },
  field: {
    backgroundColor: colors.muted + '50',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  fieldLabel: {
    color: colors.mutedForeground,
    fontSize: 10,
    fontWeight: fontWeight.bold,
    letterSpacing: 1,
    marginBottom: 4,
  },
  fieldValue: {
    color: colors.foreground,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  proStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.primary + '10',
    borderWidth: 1,
    borderColor: colors.primary + '30',
    borderRadius: radius.md,
    padding: 14,
  },
  proStatusLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  proLabel: {
    color: colors.primary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
  },
  activeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.green500 + '15',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.full,
  },
  activeBadgeText: {
    color: colors.green500,
    fontSize: 10,
    fontWeight: fontWeight.bold,
    textTransform: 'uppercase',
  },
  proPrice: {
    color: colors.mutedForeground,
    fontSize: fontSize.xs,
    marginTop: 8,
  },
  freeStatus: {
    backgroundColor: colors.muted + '50',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 14,
    marginBottom: 12,
  },
  freeTitle: {
    color: colors.foreground,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  freeSubtitle: {
    color: colors.mutedForeground,
    fontSize: fontSize.xs,
    marginTop: 2,
  },
  upgradeBox: {
    backgroundColor: colors.primary + '08',
    borderWidth: 1,
    borderColor: colors.primary + '30',
    borderRadius: radius.md,
    padding: 16,
  },
  upgradeTitle: {
    color: colors.foreground,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    marginBottom: 12,
  },
  upgradeFeatureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  upgradeFeatureText: {
    color: colors.foreground,
    fontSize: fontSize.xs,
    flex: 1,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  menuItemText: {
    color: colors.foreground,
    fontSize: fontSize.sm,
  },
  menuItemDanger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  menuItemDangerText: {
    color: colors.red500,
    fontSize: fontSize.sm,
  },
});
