import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../src/context/AuthContext';
import { useUnits } from '../../src/context/UnitsContext';
import { coachApi, authApi } from '../../src/lib/api';
import { getCached, setCached, invalidateCache } from '../../src/lib/cache';
import {
  coachInitCacheKey, COACH_INIT_TTL_MS, extractProgram, fetchCoachInit,
  type CoachInitCacheShape,
} from '../../src/lib/coachData';
import { useFocusEffect } from 'expo-router';
import { trackScreen, trackScreenTime, Analytics } from '../../src/lib/analytics';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, spacing, radius } from '../../src/constants/theme';
import { LoadingSpinner } from '../../src/components/ui/LoadingSpinner';
import { CoachOnboarding, OnboardingProfile } from '../../src/components/coach/CoachOnboarding';
import { ProgramSetup } from '../../src/components/coach/ProgramSetup';
import { ProgramReveal } from '../../src/components/coach/ProgramReveal';
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
import { peekNutritionPrefill, consumeNutritionTabRequest } from '../../src/lib/nutritionPrefill';

// ─── Types ────────────────────────────────────────────────────────────────────

type Stage = 'loading' | 'onboarding' | 'setup' | 'reveal' | 'walkthrough' | 'dashboard';
type TabId = 'Overview' | 'Program' | 'Nutrition' | 'Wellness' | 'Chat';

const TABS: TabId[] = ['Overview', 'Program', 'Nutrition', 'Wellness', 'Chat'];

// What Pro actually buys, stated as things the coach DOES rather than features
// you get. This card is shown at the highest-intent moment in the funnel — the
// user has just finished the intake and watched a program get built — so the
// job here is to reframe: the plan is the artifact, Pro is the coach that runs
// it with you. Every line below maps to a shipped surface (Chat/agent tools,
// NutritionProfileV2, strength profile, form-analysis) — no vapour.
const PRO_CAPABILITIES = [
  {
    icon: 'chatbubble-ellipses-outline',
    title: 'A coach that acts, not just answers',
    body: 'Tell Anakin what happened and it logs the meal, adjusts your macros, or swaps an exercise — then updates the plan.',
  },
  {
    icon: 'nutrition-outline',
    title: 'Nutrition profiling',
    body: 'Micronutrient targets, gut-health scoring, and photo or barcode logging that understands your food.',
  },
  {
    icon: 'stats-chart-outline',
    title: 'Strength profiling',
    body: 'Estimated 1RMs, PR detection and weak-point diagnosis tracked across every session.',
  },
  {
    icon: 'videocam-outline',
    title: 'Video form analysis',
    body: 'Upload a working set and get specific coaching cues on what to fix.',
  },
];


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
  const { user, loading: authLoading, refreshUser } = useAuth();
  const { toKg } = useUnits();

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
  // True only when the user just finished the intake this session — setup then
  // starts generation immediately instead of waiting for a Generate tap.
  const [autoStartSetup, setAutoStartSetup] = useState(false);
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
  }, [user?.id, authLoading]);

  // Watchdog: this screen must never sit on the skeleton indefinitely. The
  // 2026-08-16 stall was invisible precisely because the failure was silent —
  // no crash, no error, just a skeleton that never resolved. Whatever future
  // path fails to settle `stage`, this bounds it: after 12s, fall through to
  // the intake, which is safe for anyone without a program.
  useEffect(() => {
    if (stage !== 'loading') return;
    const t = setTimeout(() => {
      console.warn('[coach] stage stuck on loading for 12s — falling through to intake');
      Analytics.coachStageStuck('loading');
      setStage(resumeStageForNoProgram());
      setLoading(false);
    }, 12_000);
    return () => clearTimeout(t);
  }, [stage]);

  // (extractProgram + fetchCoachInit live in src/lib/coachData.ts so the
  // boot-time prefetcher can warm the same cache shape this screen reads.)

  // A user with a finished intake but no program resumes at Build Your
  // Program — NOT at question 1 of the intake. Re-showing the (blank) intake
  // to returning users was the biggest conversion leak in the funnel: they
  // completed it once, left before tapping Generate, and every return greeted
  // them with the full quiz again.
  function resumeStageForNoProgram(): Stage {
    return user?.coachOnboardingDone ? 'setup' : 'onboarding';
  }

  async function initCoach() {
    if (!user) {
      // Auth is still bootstrapping — the skeleton is correct here, and the
      // effect below re-runs when the user lands (or when authLoading flips).
      if (authLoading) {
        setStage('loading');
        return;
      }
      // Auth has SETTLED and there is still no user. This is the state that
      // stranded every signup from 2026-08-16 onward: AuthContext swallows
      // network/server failures from getMe() (user stays null, loading goes
      // false) on the assumption that something redirects to login. Nothing
      // does — this screen just sat on CoachDashboardSkeleton forever. No
      // throw, so nothing in Sentry; users rage-tapped a skeleton and left.
      //
      // Resolve to the intake instead: it is the right screen for anyone
      // without a program, and it re-reads auth on submit, so a genuinely
      // signed-out user is bounced there rather than staring at a fake screen.
      setStage('onboarding');
      setLoading(false);
      return;
    }

    const key = coachInitCacheKey(user.id);

    // Cache-first. The program structure changes only when the user generates
    // a new program (handleProgramSave invalidates 'coach:') or after 30 min
    // of staleness defense. No background network call on a hot hit.
    const cached = getCached<CoachInitCacheShape>(key, COACH_INIT_TTL_MS);
    if (cached) {
      setCoachData(cached.coachData);
      setStage(cached.hasProgram ? 'dashboard' : resumeStageForNoProgram());
      if (!cached.hasProgram && !user.coachOnboardingDone) setOnboardingKey(k => k + 1);
      setLoading(false);
      return;
    }

    try {
      const fresh = await fetchCoachInit(user?.savedProgram);
      setCached(key, fresh);
      setCoachData(fresh.coachData);
      if (!fresh.hasProgram) {
        if (!user.coachOnboardingDone) setOnboardingKey(k => k + 1);
        setStage(resumeStageForNoProgram());
      } else {
        setStage('dashboard');
      }
    } catch {
      setStage(resumeStageForNoProgram());
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
      // Land on the Nutrition sub-tab when the Nutrition Profile sent us here:
      // either a queued recommendation (its surface then opens Describe
      // prefilled) or a plain "go to Coach → Nutrition" link.
      if (peekNutritionPrefill() || consumeNutritionTabRequest()) setActiveTab('Nutrition');
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
      // The body-comp weight field holds the value in the user's display unit;
      // toKg converts based on their current preference (kg passes through).
      const weightKg = profile.weightLbs ? toKg(parseFloat(profile.weightLbs)) : undefined;

      await authApi.updateProfile({
        coachOnboardingDone: true,
        coachGoal: profile.primaryGoal || undefined,
        trainingAge: profile.trainingAge || undefined,
        equipment: profile.equipment || undefined,
        heightCm: heightCm || undefined,
        weightKg: weightKg || undefined,
        constraintsText: profile.injuries || undefined,
        coachBudget: profile.weeklyBudget || undefined,
        // Promoted to a first-class column (not just coachProfile JSON) because
        // the meal-parsing routes read it on every log.
        foodRegion: (profile.foodRegion as 'global' | 'ng' | 'gm' | 'wa') || undefined,
        coachProfile: JSON.stringify({
          ...profile,
          trainingPreference: profile.trainingStyle,
          frequency: profile.daysPerWeek,
          experience: profile.trainingAge,
        }),
      });
      await refreshUser();
    } catch (err: any) {
      // Do NOT silently continue. This used to swallow every failure and march
      // the user into Build Your Program with nothing saved — no goal, no
      // injuries, no region — so they got a generic plan and we got no signal.
      // The intake depth IS the product; discarding a completed one is the
      // worst outcome available here.
      Analytics.intakeSaveFailed(err?.status ?? 0);
      const signedOut = err?.status === 401 || err?.status === 403;
      Alert.alert(
        signedOut ? 'Please sign in again' : "Couldn't save your answers",
        signedOut
          ? 'Your session expired while you were filling this in. Sign in and your answers will be here.'
          : "We couldn't reach the server. Your answers are still on screen — tap Retry.",
        [{ text: 'OK' }],
      );
      return; // stay on the intake so the answers aren't lost
    }
    setSetupReturnStage('onboarding');
    setAutoStartSetup(true);
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
      if (shouldShow) {
        Analytics.paywallViewed('post_plan');
        setUpgradeVisible(true);
      }
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
          autoStart={autoStartSetup}
          onGenerate={(prog) => {
            setAutoStartSetup(false);
            setGeneratedProgram(prog);
            Analytics.programRevealViewed();
            setStage('reveal');
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

  if (stage === 'reveal') {
    // The conviction screen: the plan is built, framed on real science, right
    // before the paywall. It owns its own header (Block A) and pinned CTA, so
    // it renders full-bleed without the shared stageHeader.
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ProgramReveal
          program={generatedProgram}
          stepLabel="Step 4 of 4"
          onNext={() => setStage('walkthrough')}
          onBack={() => setStage('setup')}
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

          {/* Tab content — wrapped in a per-tab boundary so a crash reports
              boundary_label="coach:Chat" (etc.) to PostHog instead of the
              undifferentiated "coach-tab", localizing trips to one sub-tab. The
              key remounts (clears the error) when the user switches tabs. */}
          <View style={styles.tabContent}>
            <ErrorBoundary
              key={activeTab}
              label={`coach:${activeTab}`}
              message="This tab hit an unexpected error. Tap try again."
            >
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
            </ErrorBoundary>
          </View>
        </View>

        {!isPro && (
          <Pressable style={styles.upgradeScrim} onPress={() => setUpgradeVisible(true)}>
            <View style={styles.upgradeCard}>
              <Text style={styles.upgradeEyebrow}>YOUR PROGRAM IS BUILT</Text>
              <Text style={styles.upgradeCardTitle}>Now put a coach behind it</Text>
              <Text style={styles.upgradeCardSub}>
                The plan is the starting point. Pro is the part that adapts it to you, week after week.
              </Text>

              <View style={styles.capList}>
                {PRO_CAPABILITIES.map((c) => (
                  <View key={c.title} style={styles.capRow}>
                    <View style={styles.capIcon}>
                      <Ionicons name={c.icon as any} size={16} color={colors.primary} />
                    </View>
                    <View style={styles.capText}>
                      <Text style={styles.capTitle}>{c.title}</Text>
                      <Text style={styles.capBody}>{c.body}</Text>
                    </View>
                  </View>
                ))}
              </View>

              <View style={styles.upgradeCardBtn}>
                <Text style={styles.upgradeCardBtnText}>Unlock the full coach</Text>
              </View>
              <Text style={styles.upgradeFinePrint}>1 month free · cancel anytime</Text>
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
  upgradeEyebrow: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    letterSpacing: 1.2,
    color: colors.primary,
    textAlign: 'center',
  },
  capList: {
    alignSelf: 'stretch',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  capRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  capIcon: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.muted,
    marginTop: 1,
  },
  capText: {
    flex: 1,
    gap: 2,
  },
  capTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
  },
  capBody: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    lineHeight: 17,
  },
  upgradeFinePrint: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    textAlign: 'center',
  },
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
