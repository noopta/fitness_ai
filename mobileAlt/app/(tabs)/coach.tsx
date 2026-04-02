import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../src/context/AuthContext';
import { coachApi, authApi } from '../../src/lib/api';
import { colors, fontSize, fontWeight, spacing, radius } from '../../src/constants/theme';
import { LoadingSpinner } from '../../src/components/ui/LoadingSpinner';
import { UpgradePrompt } from '../../src/components/UpgradePrompt';
import { CoachOnboarding, OnboardingProfile } from '../../src/components/coach/CoachOnboarding';
import { ProgramSetup } from '../../src/components/coach/ProgramSetup';
import { ProgramWalkthrough } from '../../src/components/coach/ProgramWalkthrough';
import { OverviewTab } from '../../src/components/coach/OverviewTab';
import { ProgramTab } from '../../src/components/coach/ProgramTab';
import { NutritionTab } from '../../src/components/coach/NutritionTab';
import { WellnessTab } from '../../src/components/coach/WellnessTab';
import { ChatTab } from '../../src/components/coach/ChatTab';

// ─── Types ────────────────────────────────────────────────────────────────────

type Stage = 'loading' | 'upgrade' | 'onboarding' | 'setup' | 'walkthrough' | 'dashboard';
type TabId = 'Overview' | 'Program' | 'Nutrition' | 'Wellness' | 'Chat';

const TABS: TabId[] = ['Overview', 'Program', 'Nutrition', 'Wellness', 'Chat'];

// ─── Coach Screen ─────────────────────────────────────────────────────────────

export default function CoachScreen() {
  const { user, refreshUser } = useAuth();

  const [loading, setLoading] = useState(true);
  const [coachData, setCoachData] = useState<any>(null);
  const [stage, setStage] = useState<Stage>('loading');
  const [activeTab, setActiveTab] = useState<TabId>('Overview');
  const [generatedProgram, setGeneratedProgram] = useState<any>(null);
  const [refreshingTier, setRefreshingTier] = useState(false);

  useEffect(() => {
    initCoach();
  }, [user?.id]);

  // When the tab comes back into focus (e.g. user returns from Stripe), refresh
  // the user object so a new pro subscription is detected immediately.
  useFocusEffect(useCallback(() => {
    if (user && (user.tier !== 'pro' && user.tier !== 'enterprise')) {
      refreshUser().catch(() => {});
    }
  }, [user?.tier]));

  async function initCoach() {
    if (!user) {
      setStage('loading');
      return;
    }

    // Non-pro users see upgrade prompt
    if (user.tier !== 'pro' && user.tier !== 'enterprise') {
      setLoading(false);
      setStage('upgrade');
      return;
    }

    // Pro user: fetch coach data + program in parallel
    try {
      const [data, programResult] = await Promise.all([
        coachApi.getMessages().catch(() => ({})),
        coachApi.getProgram().catch(() => null),
      ]);

      let resolvedProgram: any = null;

      if (programResult) {
        let prog = programResult?.program ?? programResult?.savedProgram ?? programResult;
        if (typeof prog === 'string') {
          try { prog = JSON.parse(prog); } catch { prog = null; }
        }
        if (prog && typeof prog === 'object' && Object.keys(prog).length > 0) {
          resolvedProgram = prog;
        }
      }

      if (!resolvedProgram && user.savedProgram) {
        let parsed = user.savedProgram;
        if (typeof parsed === 'string') {
          try { parsed = JSON.parse(parsed); } catch { parsed = null; }
        }
        if (parsed && typeof parsed === 'object') {
          resolvedProgram = parsed;
        }
      }

      if (!resolvedProgram && data?.savedProgram) {
        let parsed = data.savedProgram;
        if (typeof parsed === 'string') {
          try { parsed = JSON.parse(parsed); } catch { parsed = null; }
        }
        if (parsed && typeof parsed === 'object') {
          resolvedProgram = parsed;
        }
      }

      setCoachData({ ...data, savedProgram: resolvedProgram });

      const hasOnboarding = user.coachOnboardingDone;
      const hasProgram = !!(resolvedProgram);

      if (!hasOnboarding) {
        setStage('onboarding');
      } else if (!hasProgram) {
        setStage('setup');
      } else {
        setStage('dashboard');
      }
    } catch {
      setStage('onboarding');
    } finally {
      setLoading(false);
    }
  }

  async function handleOnboardingComplete(profile: OnboardingProfile) {
    try {
      const heightFt = parseFloat(profile.heightFt) || 0;
      const heightIn = parseFloat(profile.heightIn) || 0;
      const heightCm = heightFt > 0 ? (heightFt * 12 + heightIn) * 2.54 : undefined;
      const weightKg = profile.weightLbs ? parseFloat(profile.weightLbs) * 0.453592 : undefined;

      await authApi.updateProfile({
        coachOnboardingDone: true,
        coachGoal: profile.primaryGoal || undefined,
        trainingAge: profile.trainingAge || undefined,
        equipment: profile.equipment || undefined,
        heightCm: heightCm || undefined,
        weightKg: weightKg || undefined,
        constraintsText: profile.injuries || undefined,
        coachBudget: profile.weeklyBudget || undefined,
        coachProfile: JSON.stringify({
          ...profile,
          trainingPreference: profile.trainingStyle,
          frequency: profile.daysPerWeek,
          experience: profile.trainingAge,
        }),
      });
      await refreshUser();
    } catch {
      // Continue even if save fails
    }
    setStage('setup');
  }

  async function handleProgramSave() {
    try {
      const [data, programResult] = await Promise.all([
        coachApi.getMessages(),
        coachApi.getProgram(),
      ]);

      let resolvedProgram: any = null;
      if (programResult) {
        let prog = programResult?.program ?? programResult?.savedProgram ?? programResult;
        if (typeof prog === 'string') {
          try { prog = JSON.parse(prog); } catch { prog = null; }
        }
        if (prog && typeof prog === 'object' && Object.keys(prog).length > 0) {
          resolvedProgram = prog;
        }
      }

      setCoachData({ ...data, savedProgram: resolvedProgram });
      await refreshUser();
    } catch {
      // Continue
    }
    setStage('dashboard');
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading || stage === 'loading') {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <LoadingSpinner message="Loading your coach..." />
      </SafeAreaView>
    );
  }

  if (stage === 'upgrade') {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.upgradeContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.upgradeHeader}>
            <Text style={styles.upgradeTitle}>AI Coach</Text>
            <Text style={styles.upgradeSub}>Powered by Anakin</Text>
          </View>
          <UpgradePrompt
            userId={user?.id}
            reason="AI Coach requires a Pro subscription. Get personalized programming, nutrition, and 1-on-1 coaching from Anakin."
          />
          <TouchableOpacity
            style={styles.alreadyUpgradedBtn}
            activeOpacity={0.7}
            disabled={refreshingTier}
            onPress={async () => {
              setRefreshingTier(true);
              try { await refreshUser(); } catch {}
              setRefreshingTier(false);
            }}
          >
            {refreshingTier
              ? <ActivityIndicator size="small" color={colors.mutedForeground} />
              : <Text style={styles.alreadyUpgradedText}>Already upgraded? Tap to refresh</Text>
            }
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (stage === 'onboarding') {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.stageHeader}>
          <Text style={styles.stageHeaderTitle}>Welcome to Anakin</Text>
          <Text style={styles.stageHeaderSub}>Let's set up your profile</Text>
        </View>
        <CoachOnboarding onComplete={handleOnboardingComplete} />
      </SafeAreaView>
    );
  }

  if (stage === 'setup') {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.stageHeader}>
          <Text style={styles.stageHeaderTitle}>Build Your Program</Text>
          <Text style={styles.stageHeaderSub}>Configure your training plan</Text>
        </View>
        <ProgramSetup
          onGenerate={(prog) => {
            setGeneratedProgram(prog);
            setStage('walkthrough');
          }}
          onBack={() => setStage('onboarding')}
        />
      </SafeAreaView>
    );
  }

  if (stage === 'walkthrough') {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.stageHeader}>
          <Text style={styles.stageHeaderTitle}>Review Your Program</Text>
          <Text style={styles.stageHeaderSub}>Confirm and save your plan</Text>
        </View>
        <ProgramWalkthrough
          program={generatedProgram}
          onSave={handleProgramSave}
          onBack={() => setStage('setup')}
        />
      </SafeAreaView>
    );
  }

  // ── Dashboard ──────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerAvatar}>
          <Text style={styles.headerAvatarText}>A</Text>
        </View>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>Anakin</Text>
          <Text style={styles.headerSubtitle}>AI Strength Coach</Text>
        </View>
        <View style={styles.onlineDot} />
      </View>

      {/* Tab bar */}
      <View style={styles.tabBarWrapper}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabBar}
        >
          {TABS.map((tab) => {
            const isActive = activeTab === tab;
            return (
              <Pressable
                key={tab}
                onPress={() => setActiveTab(tab)}
                style={styles.tabItem}
              >
                <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
                  {tab}
                </Text>
                {isActive && <View style={styles.tabUnderline} />}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Tab content */}
      <View style={styles.tabContent}>
        {activeTab === 'Overview' && (
          <OverviewTab
            coachData={coachData}
            onGoToProgram={() => setActiveTab('Program')}
            onRefresh={initCoach}
          />
        )}
        {activeTab === 'Program' && (
          <ProgramTab coachData={coachData} />
        )}
        {activeTab === 'Nutrition' && (
          <NutritionTab
            coachData={coachData}
            coachGoal={user?.coachGoal ?? null}
            coachBudget={user?.coachBudget ?? null}
            onRefresh={initCoach}
          />
        )}
        {activeTab === 'Wellness' && (
          <WellnessTab coachData={coachData} />
        )}
        {activeTab === 'Chat' && (
          <ChatTab coachData={coachData} />
        )}
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
  },

  // Loading / upgrade
  upgradeContent: {
    padding: spacing.md,
    gap: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  upgradeHeader: {
    alignItems: 'center',
    paddingTop: spacing.lg,
    gap: spacing.xs,
  },
  upgradeTitle: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
  },
  upgradeSub: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
  },
  alreadyUpgradedBtn: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  alreadyUpgradedText: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    textDecorationLine: 'underline',
  },

  // Stage header (onboarding / setup / walkthrough)
  stageHeader: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  stageHeaderTitle: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
  },
  stageHeaderSub: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    marginTop: 2,
  },

  // Dashboard header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.card,
  },
  headerAvatar: {
    width: 38,
    height: 38,
    borderRadius: radius.full,
    backgroundColor: colors.foreground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatarText: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
    color: colors.primaryForeground,
  },
  headerText: {
    flex: 1,
  },
  headerTitle: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
  },
  headerSubtitle: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
  },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.success,
  },

  // Tab bar
  tabBarWrapper: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.card,
  },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
  },
  tabItem: {
    paddingHorizontal: spacing.md,
    paddingTop: 10,
    paddingBottom: 0,
    alignItems: 'center',
    position: 'relative',
  },
  tabText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.mutedForeground,
    paddingBottom: 10,
  },
  tabTextActive: {
    color: colors.primary,
    fontWeight: fontWeight.semibold,
  },
  tabUnderline: {
    position: 'absolute',
    bottom: 0,
    left: spacing.sm,
    right: spacing.sm,
    height: 2,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
  },

  // Tab content
  tabContent: {
    flex: 1,
  },
});
