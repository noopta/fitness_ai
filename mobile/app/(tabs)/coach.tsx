import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { colors, fontSize, fontWeight, spacing, radius } from '@/constants/theme';

type Tab = 'program' | 'nutrition' | 'analytics';

export default function CoachScreen() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('program');
  const isPro = user?.tier === 'pro' || user?.tier === 'enterprise';

  const tabs: { id: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { id: 'program', label: 'Program', icon: 'barbell' },
    { id: 'nutrition', label: 'Nutrition', icon: 'nutrition' },
    { id: 'analytics', label: 'Analytics', icon: 'analytics' },
  ];

  if (!isPro) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.header}>
            <Text style={styles.title}>AI Coach</Text>
            <Text style={styles.subtitle}>Your personal training assistant</Text>
          </View>

          <Card style={styles.upgradeCard}>
            <View style={styles.upgradeIcon}>
              <Ionicons name="lock-closed" size={32} color={colors.primary} />
            </View>
            <Text style={styles.upgradeTitle}>Unlock AI Coach</Text>
            <Text style={styles.upgradeDescription}>
              Get personalized training programs, nutrition plans, and 24/7 AI coaching with Pro.
            </Text>

            <View style={styles.featureList}>
              {[
                'Multi-phase personalized training programs',
                'AI nutrition plan with macro targets',
                'Unlimited diagnostic analyses',
                'Full analytics dashboard',
              ].map((feature, idx) => (
                <View key={idx} style={styles.featureRow}>
                  <Ionicons name="checkmark-circle" size={16} color={colors.primary} />
                  <Text style={styles.featureText}>{feature}</Text>
                </View>
              ))}
            </View>

            <Button size="lg" style={{ marginTop: 20 }}>
              Upgrade to Pro - $12/month
            </Button>
          </Card>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>AI Coach</Text>
        <Badge variant="secondary">Pro</Badge>
      </View>

      <View style={styles.tabBar}>
        {tabs.map((tab) => (
          <TouchableOpacity
            key={tab.id}
            style={[styles.tab, activeTab === tab.id && styles.tabActive]}
            onPress={() => setActiveTab(tab.id)}
          >
            <Ionicons
              name={tab.icon}
              size={18}
              color={activeTab === tab.id ? colors.primary : colors.mutedForeground}
            />
            <Text
              style={[styles.tabLabel, activeTab === tab.id && styles.tabLabelActive]}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.tabContent}>
        {activeTab === 'program' && (
          <View style={styles.section}>
            <Card>
              <View style={styles.sectionHeader}>
                <Ionicons name="barbell" size={20} color={colors.primary} />
                <Text style={styles.sectionTitle}>Training Program</Text>
              </View>
              <Text style={styles.sectionDescription}>
                Your AI-generated training program based on your diagnostic data and goals.
                Complete a diagnostic analysis first to generate your personalized program.
              </Text>
              <Button
                variant="outline"
                style={{ marginTop: 16 }}
                onPress={() => Alert.alert('Coming Soon', 'Program generation will be available after completing a diagnosis.')}
              >
                Generate Program
              </Button>
            </Card>
          </View>
        )}

        {activeTab === 'nutrition' && (
          <View style={styles.section}>
            <Card>
              <View style={styles.sectionHeader}>
                <Ionicons name="nutrition" size={20} color={colors.green500} />
                <Text style={styles.sectionTitle}>Nutrition Plan</Text>
              </View>
              <Text style={styles.sectionDescription}>
                AI-generated macro recommendations and nutrition guidance based on your
                training goals and body composition.
              </Text>
              <Button
                variant="outline"
                style={{ marginTop: 16 }}
                onPress={() => Alert.alert('Coming Soon', 'Nutrition planning will be available with your next update.')}
              >
                Set Up Nutrition
              </Button>
            </Card>
          </View>
        )}

        {activeTab === 'analytics' && (
          <View style={styles.section}>
            <Card>
              <View style={styles.sectionHeader}>
                <Ionicons name="analytics" size={20} color={colors.amber500} />
                <Text style={styles.sectionTitle}>Progress Analytics</Text>
              </View>
              <Text style={styles.sectionDescription}>
                Track your strength progress, training volume, and diagnostic trends over time.
                Complete multiple analyses to see your progression.
              </Text>
            </Card>
          </View>
        )}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: {
    color: colors.foreground,
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
  },
  subtitle: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    marginTop: 4,
  },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    gap: 8,
    marginBottom: 8,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: colors.secondary,
  },
  tabActive: {
    backgroundColor: colors.primary + '15',
    borderWidth: 1,
    borderColor: colors.primary + '40',
  },
  tabLabel: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  tabLabelActive: {
    color: colors.primary,
  },
  tabContent: {
    padding: spacing.lg,
    paddingBottom: 40,
  },
  section: {
    gap: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  sectionTitle: {
    color: colors.foreground,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
  },
  sectionDescription: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
  upgradeCard: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  upgradeIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  upgradeTitle: {
    color: colors.foreground,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    marginBottom: 8,
  },
  upgradeDescription: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  featureList: {
    gap: 10,
    width: '100%',
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  featureText: {
    color: colors.foreground,
    fontSize: fontSize.sm,
    flex: 1,
  },
});
