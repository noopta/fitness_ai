import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { colors, fontSize, fontWeight, spacing, radius } from '@/constants/theme';

type Tab = 'program' | 'nutrition' | 'analytics';

interface NutritionPlan {
  calories?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  goal?: string;
}

interface ProgramPhase {
  name?: string;
  weeks?: number;
  daysPerWeek?: number;
  days?: any[];
}

interface SavedProgram {
  goal?: string;
  durationWeeks?: number;
  daysPerWeek?: number;
  phases?: ProgramPhase[];
  nutritionPlan?: NutritionPlan;
}

const PHASE_COLORS = ['#6366f1', '#8b5cf6', '#a78bfa', '#c4b5fd'];

function MacroBar({ label, value, unit, color, max }: {
  label: string; value: number; unit: string; color: string; max: number;
}) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <View style={styles.macroBarRow}>
      <View style={styles.macroBarLabelRow}>
        <Text style={styles.macroBarLabel}>{label}</Text>
        <Text style={[styles.macroBarValue, { color }]}>{value}{unit}</Text>
      </View>
      <View style={styles.macroBarTrack}>
        <View style={[styles.macroBarFill, { width: `${pct}%` as any, backgroundColor: color }]} />
      </View>
    </View>
  );
}

// ─── Program Tab ─────────────────────────────────────────────────────────────

function ProgramTab({ program }: { program: SavedProgram | null }) {
  if (!program) {
    return (
      <Card style={styles.emptyCard}>
        <View style={styles.emptyIcon}>
          <Ionicons name="barbell" size={28} color={colors.primary} />
        </View>
        <Text style={styles.emptyTitle}>No program yet</Text>
        <Text style={styles.emptyDescription}>
          Complete the coach onboarding on the web app to generate your personalized training program.
        </Text>
      </Card>
    );
  }

  const phases = program.phases || [];

  return (
    <View style={styles.section}>
      <Card style={styles.overviewBanner}>
        <View style={styles.overviewGrid}>
          {program.goal && (
            <View style={styles.overviewStat}>
              <Text style={styles.overviewStatLabel}>GOAL</Text>
              <Text style={styles.overviewStatValue}>{program.goal}</Text>
            </View>
          )}
          {program.durationWeeks != null && (
            <View style={styles.overviewStat}>
              <Text style={styles.overviewStatLabel}>DURATION</Text>
              <Text style={styles.overviewStatValue}>{program.durationWeeks} wks</Text>
            </View>
          )}
          {program.daysPerWeek != null && (
            <View style={styles.overviewStat}>
              <Text style={styles.overviewStatLabel}>DAYS/WK</Text>
              <Text style={styles.overviewStatValue}>{program.daysPerWeek}</Text>
            </View>
          )}
          {phases.length > 0 && (
            <View style={styles.overviewStat}>
              <Text style={styles.overviewStatLabel}>PHASES</Text>
              <Text style={styles.overviewStatValue}>{phases.length}</Text>
            </View>
          )}
        </View>
      </Card>

      {phases.map((phase, idx) => (
        <Card key={idx} style={styles.phaseCard}>
          <View style={styles.phaseHeader}>
            <View style={[styles.phaseDot, { backgroundColor: PHASE_COLORS[idx % PHASE_COLORS.length] }]} />
            <Text style={styles.phaseTitle}>{phase.name || `Phase ${idx + 1}`}</Text>
            {phase.weeks != null && (
              <Badge variant="secondary">{`${phase.weeks} wk${phase.weeks > 1 ? 's' : ''}`}</Badge>
            )}
          </View>
          {(phase.daysPerWeek != null || (phase.days?.length ?? 0) > 0) && (
            <Text style={styles.phaseSubtitle}>
              {phase.daysPerWeek ?? phase.days?.length} training days/week
            </Text>
          )}
          {phase.days && phase.days.length > 0 && (
            <View style={styles.dayList}>
              {phase.days.slice(0, 3).map((day: any, dIdx: number) => (
                <View key={dIdx} style={styles.dayRow}>
                  <View style={[styles.dayDot, { backgroundColor: PHASE_COLORS[idx % PHASE_COLORS.length] + '70' }]} />
                  <Text style={styles.dayName} numberOfLines={1}>
                    {day.name || day.focus || `Day ${dIdx + 1}`}
                  </Text>
                  {day.exercises?.length > 0 && (
                    <Text style={styles.dayExCount}>{day.exercises.length} ex</Text>
                  )}
                </View>
              ))}
              {phase.days.length > 3 && (
                <Text style={styles.moreText}>+{phase.days.length - 3} more days</Text>
              )}
            </View>
          )}
        </Card>
      ))}

      {phases.length === 0 && (
        <Card>
          <Text style={styles.emptyDescription}>
            Your program is saved. View the full schedule and exercises on the web app.
          </Text>
        </Card>
      )}
    </View>
  );
}

// ─── Nutrition Tab ────────────────────────────────────────────────────────────

function NutritionTab({ nutrition, coachGoal }: { nutrition: NutritionPlan | null; coachGoal: string | null }) {
  if (!nutrition || !nutrition.calories) {
    return (
      <Card style={styles.emptyCard}>
        <View style={[styles.emptyIcon, { backgroundColor: colors.green500 + '15' }]}>
          <Ionicons name="nutrition" size={28} color={colors.green500} />
        </View>
        <Text style={styles.emptyTitle}>No nutrition plan yet</Text>
        <Text style={styles.emptyDescription}>
          Generate a training program on the web app to get your personalized nutrition targets.
        </Text>
      </Card>
    );
  }

  const { calories = 0, proteinG = 0, carbsG = 0, fatG = 0 } = nutrition;
  const totalG = proteinG + carbsG + fatG;

  return (
    <View style={styles.section}>
      {coachGoal && (
        <Card style={styles.goalCard}>
          <Text style={styles.goalLabel}>YOUR GOAL</Text>
          <Text style={styles.goalText}>{coachGoal}</Text>
        </Card>
      )}

      <Card style={styles.calorieCard}>
        <View style={styles.calorieRow}>
          <View style={styles.calorieIcon}>
            <Ionicons name="flame" size={24} color={colors.orange500} />
          </View>
          <View>
            <Text style={styles.calorieValue}>{calories.toLocaleString()}</Text>
            <Text style={styles.calorieLabel}>kcal / day target</Text>
          </View>
        </View>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Daily Macro Targets</Text>
        <View style={styles.macroGrid}>
          <View style={[styles.macroTile, { borderColor: colors.blue600 + '40', backgroundColor: colors.blue600 + '08' }]}>
            <Text style={[styles.macroTileValue, { color: colors.blue600 }]}>{proteinG}g</Text>
            <Text style={styles.macroTileLabel}>Protein</Text>
          </View>
          <View style={[styles.macroTile, { borderColor: colors.amber500 + '40', backgroundColor: colors.amber500 + '08' }]}>
            <Text style={[styles.macroTileValue, { color: colors.amber500 }]}>{carbsG}g</Text>
            <Text style={styles.macroTileLabel}>Carbs</Text>
          </View>
          <View style={[styles.macroTile, { borderColor: colors.purple500 + '40', backgroundColor: colors.purple500 + '08' }]}>
            <Text style={[styles.macroTileValue, { color: colors.purple500 }]}>{fatG}g</Text>
            <Text style={styles.macroTileLabel}>Fat</Text>
          </View>
        </View>

        <View style={{ marginTop: 16, gap: 12 }}>
          <MacroBar label="Protein" value={proteinG} unit="g" color={colors.blue600} max={totalG} />
          <MacroBar label="Carbs" value={carbsG} unit="g" color={colors.amber500} max={totalG} />
          <MacroBar label="Fat" value={fatG} unit="g" color={colors.purple500} max={totalG} />
        </View>
      </Card>
    </View>
  );
}

// ─── Analytics Tab ────────────────────────────────────────────────────────────

function AnalyticsTab() {
  return (
    <Card style={styles.emptyCard}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.amber500 + '15' }]}>
        <Ionicons name="analytics" size={28} color={colors.amber500} />
      </View>
      <Text style={styles.emptyTitle}>Analytics</Text>
      <Text style={styles.emptyDescription}>
        Track your body weight, nutrition logs, and strength progress. Log your data on the web app to see trends here.
      </Text>
    </Card>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function CoachScreen() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('program');
  const [savedProgram, setSavedProgram] = useState<SavedProgram | null>(null);
  const isPro = user?.tier === 'pro' || user?.tier === 'enterprise';

  useEffect(() => {
    if (user?.savedProgram) {
      try {
        setSavedProgram(JSON.parse(user.savedProgram));
      } catch { /* ignore */ }
    } else {
      setSavedProgram(null);
    }
  }, [user?.savedProgram]);

  const tabs: { id: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { id: 'program', label: 'Program', icon: 'barbell' },
    { id: 'nutrition', label: 'Nutrition', icon: 'nutrition' },
    { id: 'analytics', label: 'Analytics', icon: 'analytics' },
  ];

  if (!isPro) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.pageHeader}>
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
        <View>
          <Text style={styles.title}>AI Coach</Text>
          <Text style={styles.subtitle}>Anakin</Text>
        </View>
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
            <Text style={[styles.tabLabel, activeTab === tab.id && styles.tabLabelActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.tabContent}>
        {activeTab === 'program' && <ProgramTab program={savedProgram} />}
        {activeTab === 'nutrition' && (
          <NutritionTab
            nutrition={savedProgram?.nutritionPlan || null}
            coachGoal={user?.coachGoal || null}
          />
        )}
        {activeTab === 'analytics' && <AnalyticsTab />}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContent: { padding: spacing.lg, paddingBottom: 40 },
  pageHeader: { marginBottom: 24 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: { color: colors.foreground, fontSize: fontSize['2xl'], fontWeight: fontWeight.bold },
  subtitle: { color: colors.mutedForeground, fontSize: fontSize.sm, marginTop: 2 },
  tabBar: { flexDirection: 'row', paddingHorizontal: spacing.lg, gap: 8, marginBottom: 8 },
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
  tabLabel: { color: colors.mutedForeground, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  tabLabelActive: { color: colors.primary },
  tabContent: { padding: spacing.lg, paddingBottom: 40 },
  section: { gap: 16 },
  // upgrade wall
  upgradeCard: { alignItems: 'center', paddingVertical: 32 },
  upgradeIcon: {
    width: 64, height: 64, borderRadius: radius.lg,
    backgroundColor: colors.primary + '15', alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  upgradeTitle: { color: colors.foreground, fontSize: fontSize.xl, fontWeight: fontWeight.bold, marginBottom: 8 },
  upgradeDescription: {
    color: colors.mutedForeground, fontSize: fontSize.sm, textAlign: 'center',
    lineHeight: 20, paddingHorizontal: 16, marginBottom: 16,
  },
  featureList: { gap: 10, width: '100%' },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  featureText: { color: colors.foreground, fontSize: fontSize.sm, flex: 1 },
  // empty states
  emptyCard: { alignItems: 'center', paddingVertical: 40 },
  emptyIcon: {
    width: 56, height: 56, borderRadius: radius.lg,
    backgroundColor: colors.primary + '15', alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  emptyTitle: { color: colors.foreground, fontSize: fontSize.base, fontWeight: fontWeight.semibold, marginBottom: 8 },
  emptyDescription: {
    color: colors.mutedForeground, fontSize: fontSize.sm, textAlign: 'center', lineHeight: 20, paddingHorizontal: 8,
  },
  // program overview
  overviewBanner: { backgroundColor: colors.primary + '08', borderColor: colors.primary + '25' },
  overviewGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  overviewStat: { minWidth: 64 },
  overviewStatLabel: { color: colors.mutedForeground, fontSize: 10, fontWeight: fontWeight.bold, letterSpacing: 0.8, marginBottom: 4 },
  overviewStatValue: { color: colors.foreground, fontSize: fontSize.base, fontWeight: fontWeight.bold },
  phaseCard: { gap: 8 },
  phaseHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  phaseDot: { width: 10, height: 10, borderRadius: 5 },
  phaseTitle: { color: colors.foreground, fontSize: fontSize.base, fontWeight: fontWeight.semibold, flex: 1 },
  phaseSubtitle: { color: colors.mutedForeground, fontSize: fontSize.sm, marginLeft: 18 },
  dayList: { marginTop: 8, gap: 6, marginLeft: 18 },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dayDot: { width: 6, height: 6, borderRadius: 3 },
  dayName: { color: colors.foreground, fontSize: fontSize.sm, flex: 1 },
  dayExCount: { color: colors.mutedForeground, fontSize: fontSize.xs },
  moreText: { color: colors.mutedForeground, fontSize: fontSize.xs, marginLeft: 14 },
  // nutrition
  goalCard: { backgroundColor: colors.primary + '08', borderColor: colors.primary + '25' },
  goalLabel: { color: colors.primary, fontSize: 10, fontWeight: fontWeight.bold, letterSpacing: 0.8, marginBottom: 4 },
  goalText: { color: colors.foreground, fontSize: fontSize.sm, lineHeight: 20 },
  calorieCard: { backgroundColor: colors.orange500 + '08', borderColor: colors.orange500 + '25' },
  calorieRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  calorieIcon: {
    width: 48, height: 48, borderRadius: radius.md,
    backgroundColor: colors.orange500 + '15', alignItems: 'center', justifyContent: 'center',
  },
  calorieValue: { color: colors.foreground, fontSize: fontSize['2xl'], fontWeight: fontWeight.bold },
  calorieLabel: { color: colors.mutedForeground, fontSize: fontSize.xs, marginTop: 2 },
  sectionTitle: { color: colors.foreground, fontSize: fontSize.base, fontWeight: fontWeight.semibold, marginBottom: 16 },
  macroGrid: { flexDirection: 'row', gap: 8 },
  macroTile: { flex: 1, borderWidth: 1, borderRadius: radius.md, padding: 12, alignItems: 'center' },
  macroTileValue: { fontSize: fontSize.xl, fontWeight: fontWeight.bold },
  macroTileLabel: { color: colors.mutedForeground, fontSize: fontSize.xs, marginTop: 2 },
  macroBarRow: { gap: 4 },
  macroBarLabelRow: { flexDirection: 'row', justifyContent: 'space-between' },
  macroBarLabel: { color: colors.mutedForeground, fontSize: fontSize.xs },
  macroBarValue: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  macroBarTrack: { height: 6, backgroundColor: colors.secondary, borderRadius: 3, overflow: 'hidden' },
  macroBarFill: { height: '100%', borderRadius: 3 },
});
