import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../src/context/AuthContext';
import { coachApi, authApi } from '../../src/lib/api';
import { getCached, setCached, invalidateCache } from '../../src/lib/cache';
import {
  coachInitCacheKey, COACH_INIT_TTL_MS, extractProgram, fetchCoachInit,
  type CoachInitCacheShape,
} from '../../src/lib/coachData';
import { useFocusEffect } from 'expo-router';
import { trackScreen, trackScreenTime, Analytics } from '../../src/lib/analytics';
import { colors, fontSize, fontWeight, spacing, radius } from '../../src/constants/theme';
import { LoadingSpinner } from '../../src/components/ui/LoadingSpinner';
import { CoachOnboarding, OnboardingProfile } from '../../src/components/coach/CoachOnboarding';
import { ProgramSetup } from '../../src/components/coach/ProgramSetup';
import { ProgramWalkthrough } from '../../src/components/coach/ProgramWalkthrough';
import { OverviewTab } from '../../src/components/coach/OverviewTab';
import { ProgramTab } from '../../src/components/coach/ProgramTab';
import { NutritionTab } from '../../src/components/coach/NutritionTab';
import { WellnessTab } from '../../src/components/coach/WellnessTab';
import { ChatTab } from '../../src/components/coach/ChatTab';
import { ErrorBoundary } from '../../src/components/ErrorBoundary';
import { CoachDashboardSkeleton } from '../../src/components/ui/Skeleton';
import { CoachMarkTooltip } from '../../src/components/CoachMarkTooltip';
import { TOURS } from '../../src/lib/coachMarks';
import { UpgradeSheet } from '../../src/components/UpgradeSheet';
import { maybeShowPostPlanPaywall } from '../../src/lib/paywallTriggers';

// ─── Types ────────────────────────────────────────────────────────────────────

type Stage = 'loading' | 'onboarding' | 'setup' | 'walkthrough' | 'dashboard';
type TabId = 'Overview' | 'Program' | 'Nutrition' | 'Wellness' | 'Chat';

const TABS: TabId[] = ['Overview', 'Program', 'Nutrition', 'Wellness', 'Chat'];

// ─── Coach Screen ─────────────────────────────────────────────────────────────

// Wrapper: catches render-time errors so a bug in any child component shows a
// recoverable fallback instead of taking the whole Coach tab down. The
// ErrorBoundary class also funnels the error to console.error which the
// PostHog global handler in app/_layout.tsx picks up as a $exception event.
export default function CoachScreen() {
  return (
    <ErrorBoundary
      label="coach-tab"
      message="Coach hit an unexpected error. Tap try again."
    >
      <CoachScreenInner />
    </ErrorBoundary>
  );
}

function CoachScreenInner() {
  const { user, refreshUser } = useAuth();

  // Hydrate from in-memory cache synchronously so a tab switch with a hot
  // cache renders the dashboard on the first frame — no LoadingSpinner flash.
  // initCoach below still runs and may overwrite with fresh data when stale.
  const cacheKey = user?.id ? coachInitCacheKey(user.id) : null;
  const cachedInit = cacheKey
    ? getCached<CoachInitCacheShape>(cacheKey, COACH_INIT_TTL_MS)
    : null;

  const [loading, setLoading] = useState(cachedInit === null);
  const [coachData, setCoachData] = useState<any>(cachedInit?.coachData ?? null);
  const [stage, setStage] = useState<Stage>(
    cachedInit ? (cachedInit.hasProgram ? 'dashboard' : 'onboarding') : 'loading'
  );
  const [activeTab, setActiveTab] = useState<TabId>('Overview');
  // Suggested-prompt routing: a chip tap on Overview stashes the prompt here
  // and switches to Chat; ChatTab reads it as initialPrompt and clears it.
  const [pendingChatPrompt, setPendingChatPrompt] = useState<string | null>(null);
  const [generatedProgram, setGeneratedProgram] = useState<any>(null);
  const [setupReturnStage, setSetupReturnStage] = useState<Stage>('onboarding');
  const [onboardingKey, setOnboardingKey] = useState(0);
  const [upgradeVisible, setUpgradeVisible] = useState(false);

  // Free users complete onboarding + generate one plan, then the dashboard is
  // a paywall tease: the plan is visible but every interaction opens the
  // upgrade sheet. Onboarding/setup/walkthrough stages stay fully usable.
  const isPro = user?.tier === 'pro' || user?.tier === 'enterprise';
  useEffect(() => {
    trackScreen('Coach');
    return trackScreenTime('Coach');
  }, []);

  // Track time spent on each coach sub-tab
  useEffect(() => {
    const start = Date.now();
    return () => {
      const seconds = Math.round((Date.now() - start) / 1000);
      if (seconds >= 1) {
        Analytics.coachDashboardOpened('tab');
      }
    };
  }, [activeTab]);

  useEffect(() => {
    initCoach();
  }, [user?.id]);

  // (extractProgram + fetchCoachInit live in src/lib/coachData.ts so the
  // boot-time prefetcher can warm the same cache shape this screen reads.)

  async function initCoach() {
    if (!user) {
      setStage('loading');
      return;
    }

    const key = coachInitCacheKey(user.id);

    // Cache-first. The program structure changes only when the user generates
    // a new program (handleProgramSave invalidates 'coach:') or after 30 min
    // of staleness defense. No background network call on a hot hit.
    const cached = getCached<CoachInitCacheShape>(key, COACH_INIT_TTL_MS);
    if (cached) {
      setCoachData(cached.coachData);
      setStage(cached.hasProgram ? 'dashboard' : 'onboarding');
      if (!cached.hasProgram) setOnboardingKey(k => k + 1);
      setLoading(false);
      return;
    }

    try {
      const fresh = await fetchCoachInit(user?.savedProgram);
      setCached(key, fresh);
      setCoachData(fresh.coachData);
      if (!fresh.hasProgram) {
        setOnboardingKey(k => k + 1);
        setStage('onboarding');
      } else {
        setStage('dashboard');
      }
    } catch {
      setStage('onboarding');
    } finally {
      setLoading(false);
    }
  }

  // Focus-based silent refresh. When the user returns to the Coach tab after
  // being away (e.g., they were on Social, Strength, or had the app in the
  // background), refresh in the background if the cached data is older than
  // 5 min. The cached data still paints first — this fetch runs concurrently
  // and swaps in only if it differs. Avoids the "data feels stale" foot-gun
  // without ever showing a spinner.
  const lastBgRefreshAt = useRef<number>(0);
  useFocusEffect(
    useCallback(() => {
      if (!user?.id) return;
      const key = coachInitCacheKey(user.id);
      const cached = getCached<CoachInitCacheShape>(key, COACH_INIT_TTL_MS);
      if (!cached) return; // initCoach handles cold paths
      // Throttle: avoid double-refreshing on rapid tab toggles
      if (Date.now() - lastBgRefreshAt.current < 60_000) return;
      // Stale threshold: 5 min. Anything fresher is fine to leave alone.
      // (No timestamp on the cache entry from this screen's perspective, but
      // the cache module enforces TTL internally; here we just throttle the
      // refresh attempts. Worst case we hit the network once a minute when
      // a user is hopping tabs — fine.)
      lastBgRefreshAt.current = Date.now();
      void fetchCoachInit(user.savedProgram)
        .then((fresh) => {
          // Only update if the program shape changed. Don't re-render on
          // identical data — that would flash the dashboard for no reason.
          const sameProgram = JSON.stringify(extractProgram(cached.coachData?.savedProgram))
                            === JSON.stringify(extractProgram(fresh.coachData?.savedProgram));
          setCached(key, fresh);
          if (!sameProgram) {
            setCoachData(fresh.coachData);
            setStage(fresh.hasProgram ? 'dashboard' : 'onboarding');
          } else {
            // Same program shape — still refresh chat-message data silently.
            setCoachData(fresh.coachData);
          }
        })
        .catch(() => { /* silent */ });
    }, [user?.id, user?.savedProgram]),
  );

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
    setSetupReturnStage('onboarding');
    setStage('setup');
  }

  function handleStartFromScratch() {
    Alert.alert(
      'Start from scratch?',
      "You'll redo the full onboarding (training profile, equipment, injuries, etc.) before building a new program. Your saved program won't be deleted until you save the new one.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start over', style: 'destructive', onPress: () => {
            // Stay local — bump the onboarding key so it remounts with fresh
            // state, then enter onboarding. handleOnboardingComplete will
            // overwrite coachProfile on submit; handleProgramSave replaces
            // savedProgram on save. Until then, the user can still abort and
            // keep their current program.
            setOnboardingKey(k => k + 1);
            setSetupReturnStage('onboarding');
            setStage('onboarding');
          },
        },
      ],
    );
  }

  async function handleProgramSave() {
    // Saving / regenerating a program changes today's session, schedule, and
    // the program tab. Drop the whole coach cache so the fresh fetch below
    // (and the next tab visit) sees the new program rather than the prior
    // snapshot.
    invalidateCache('coach:');
    try {
      const [data, programResult] = await Promise.all([
        coachApi.getMessages(),
        coachApi.getProgram(),
      ]);

      const resolvedProgram = extractProgram(programResult) ?? null;
      const next = { coachData: { ...data, savedProgram: resolvedProgram }, hasProgram: !!resolvedProgram };
      if (user?.id) setCached(`coach:init:${user.id}`, next);

      setCoachData(next.coachData);
      await refreshUser();
    } catch {
      // Continue
    }
    setStage('dashboard');
    // Value-moment paywall: just generated their first plan = peak excitement.
    // One-shot per user; fires only for free tier and only the first time.
    void maybeShowPostPlanPaywall({ tier: user?.tier }).then((shouldShow) => {
      if (shouldShow) setUpgradeVisible(true);
    });
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading || stage === 'loading') {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <CoachDashboardSkeleton />
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
        <CoachOnboarding key={onboardingKey} onComplete={handleOnboardingComplete} />
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
          onBack={() => {
            if (setupReturnStage === 'onboarding') setOnboardingKey(k => k + 1);
            setStage(setupReturnStage);
          }}
          onStartFromScratch={handleStartFromScratch}
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
      {/* First-visit coach mark for the new Swap-workout feature in 2.0.2.
          Renders once per user, then never again (AsyncStorage-gated). Add
          more tours by importing TOURS.* + dropping another CoachMarkTooltip. */}
      <CoachMarkTooltip
        tourId={TOURS.SWAP_WORKOUT}
        title="New: swap today's workout"
        body="Not feeling today's session? On the Program tab, tap Swap to pull another day's workout into today. Anakin re-sequences the rest of your week to keep recovery between hard sessions."
        icon="swap-horizontal"
        iconColor="#6366f1"
      />
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerAvatar}>
          <Text style={styles.headerAvatarText}>A</Text>
        </View>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>Anakin</Text>
          <Text style={styles.headerSubtitle}>AI Strength Coach</Text>
        </View>
        <TouchableOpacity
          onPress={() => {
            if (!isPro) { setUpgradeVisible(true); return; }
            setSetupReturnStage('dashboard'); setStage('setup');
          }}
          style={styles.newProgramBtn}
          activeOpacity={0.7}
        >
          <Text style={styles.newProgramBtnText}>New Program</Text>
        </TouchableOpacity>
        <View style={styles.onlineDot} />
      </View>

      {/* Program-complete CTA — only shows once daysSinceStart has carried
          the user past their final week. Routes to ProgramSetup (the
          existing new-program flow, NOT from-scratch). */}
      {coachData?.programComplete ? (
        <TouchableOpacity
          style={styles.completionBanner}
          activeOpacity={0.85}
          onPress={() => {
            if (!isPro) { setUpgradeVisible(true); return; }
            setSetupReturnStage('dashboard'); setStage('setup');
          }}
        >
          <View style={styles.completionIcon}>
            <Text style={styles.completionIconText}>🎉</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.completionTitle}>You finished your program</Text>
            <Text style={styles.completionSub}>
              {coachData?.totalWeeks ? `${coachData.totalWeeks} weeks done. ` : ''}Tap to build your next one — Anakin will pick up where you left off.
            </Text>
          </View>
          <Text style={styles.completionArrow}>›</Text>
        </TouchableOpacity>
      ) : null}

      {/* Tab bar + content. For free users the plan stays visible but inert
          (pointerEvents none); a tap-anywhere scrim on top opens the upgrade
          sheet — the "your plan is ready, upgrade to use it" paywall. */}
      <View style={styles.dashboardBody}>
        <View style={styles.flex} pointerEvents={isPro ? 'auto' : 'none'}>
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
                onAskAnakin={(prompt) => {
                  setPendingChatPrompt(prompt);
                  setActiveTab('Chat');
                }}
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
                userId={user?.id}
              />
            )}
            {activeTab === 'Wellness' && (
              <WellnessTab coachData={coachData} />
            )}
            {activeTab === 'Chat' && (
              <ChatTab
                coachData={coachData}
                initialPrompt={pendingChatPrompt ?? undefined}
                onInitialPromptConsumed={() => setPendingChatPrompt(null)}
              />
            )}
          </View>
        </View>

        {!isPro && (
          <Pressable style={styles.upgradeScrim} onPress={() => setUpgradeVisible(true)}>
            <View style={styles.upgradeCard}>
              <Text style={styles.upgradeLockIcon}>🔒</Text>
              <Text style={styles.upgradeCardTitle}>Your plan is ready</Text>
              <Text style={styles.upgradeCardSub}>
                Upgrade to Pro to unlock your full program, AI coaching, nutrition tracking, and more.
              </Text>
              <View style={styles.upgradeCardBtn}>
                <Text style={styles.upgradeCardBtnText}>Upgrade to Pro</Text>
              </View>
            </View>
          </Pressable>
        )}
      </View>

      <UpgradeSheet
        visible={upgradeVisible}
        onClose={() => setUpgradeVisible(false)}
        onSuccess={() => { setUpgradeVisible(false); refreshUser(); }}
      />
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
  newProgramBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.muted,
  },
  newProgramBtnText: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    fontWeight: fontWeight.medium,
  },

  // Completion banner
  completionBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginHorizontal: spacing.md, marginTop: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.primary, backgroundColor: `${colors.primary}15`,
  },
  completionIcon: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center', backgroundColor: `${colors.primary}30`,
  },
  completionIconText: { fontSize: 18 },
  completionTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.foreground },
  completionSub: { fontSize: fontSize.xs, color: colors.mutedForeground, marginTop: 2, lineHeight: 16 },
  completionArrow: { fontSize: fontSize.lg, color: colors.primary, fontWeight: fontWeight.bold },

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

  // Free-tier dashboard paywall
  flex: { flex: 1 },
  dashboardBody: { flex: 1 },
  upgradeScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  upgradeCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
  upgradeLockIcon: { fontSize: 32 },
  upgradeCardTitle: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
    textAlign: 'center',
  },
  upgradeCardSub: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    textAlign: 'center',
    lineHeight: 20,
  },
  upgradeCardBtn: {
    marginTop: spacing.sm,
    backgroundColor: colors.primary,
    paddingVertical: 12,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.full,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  upgradeCardBtnText: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.primaryForeground,
  },
});
