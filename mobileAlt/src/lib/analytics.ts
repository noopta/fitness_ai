import PostHog from 'posthog-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── PostHog client (singleton) ───────────────────────────────────────────────

export const posthog = new PostHog(
  'phc_BWbwuvj6GpMqbzPFUkVYdJSji3BFwjX72qjBjUwiw8oh',
  {
    host: 'https://us.i.posthog.com',
    // In-memory persistence — no disk writes at all. posthog-react-native's
    // storage paths have been a startup-crash source under Expo SDK 55: the
    // default tries expo-file-system's new File.write() (throws, builds 127-131),
    // and AsyncStorage's native manifest write also showed up in the startup
    // crash. 'memory' sidesteps every storage backend. Trade-off: distinct_id /
    // queued events don't survive a cold start — acceptable while we stabilize
    // launch; revisit (back to customStorage:AsyncStorage) once startup is clean.
    persistence: 'memory',
    customStorage: AsyncStorage,
    // Flush events every 30 s or when 20 events are queued
    flushAt: 20,
    flushInterval: 30000,
    // Capture native lifecycle events (Application Opened / Became Active / etc.)
    captureAppLifecycleEvents: true,
    // Session replay DISABLED + its native pod stripped (scripts/strip-posthog-
    // session-replay-ios.js): the Swift layer crashes every Xcode 26 build on
    // launch (NSClassFromString -> swift_getTypeByMangledNode Data Abort). The
    // module ships in 2.2.1 and is fine under Xcode 16, but Apple now mandates
    // Xcode 26. Product analytics (events/identify) are unaffected.
    enableSessionReplay: false,
  }
);

// ─── Identity ─────────────────────────────────────────────────────────────────

export function identifyUser(userId: string, props?: {
  name?: string | null;
  email?: string | null;
  username?: string | null;
  tier?: string | null;
}) {
  posthog.identify(userId, {
    name: props?.name ?? undefined,
    email: props?.email ?? undefined,
    username: props?.username ?? undefined,
    tier: props?.tier ?? 'free',
  });
  // Firebase: ties the device's analytics events to our user id so
  // Google Ads can attribute installs → in-app conversions per user. Also
  // sets the user_tier property so we can split conversion reports by
  // free vs pro in Firebase + Google Ads.
  setFirebaseUserId(userId);
  if (props?.tier) setFirebaseUserProperty('user_tier', props.tier);
}

export function resetUser() {
  posthog.reset();
  // Clear Firebase's user id on logout — important for shared-device
  // accuracy so events after logout don't get attributed to the prior user.
  setFirebaseUserId(null);
}

// ─── Screen tracking ──────────────────────────────────────────────────────────

export function trackScreen(screenName: string, properties?: Record<string, unknown>) {
  posthog.screen(screenName, properties);
}

// ─── Page time tracking ───────────────────────────────────────────────────────

/**
 * Call at the top of each screen with useFocusEffect / useEffect.
 * Returns a cleanup function that fires `screen_time_spent` on unmount/blur.
 *
 * Usage:
 *   useEffect(() => trackScreenTime('Home'), []);
 */
export function trackScreenTime(screenName: string): () => void {
  const start = Date.now();
  return () => {
    const seconds = Math.round((Date.now() - start) / 1000);
    if (seconds < 1) return;
    posthog.capture('screen_time_spent', {
      screen: screenName,
      seconds,
    });
  };
}

// ─── Feature events ───────────────────────────────────────────────────────────

// Auth
// Firebase Analytics mirror — for Google Ads conversion tracking. Product
// analytics + funnels remain on PostHog; Firebase only sees the events
// Google's conversion bidding needs to optimize against. See
// firebaseAnalytics.ts for the lazy-loaded module pattern.
import { logFirebaseEvent, setFirebaseUserId, setFirebaseUserProperty } from './firebaseAnalytics';

export const Analytics = {
  // ── Auth ──────────────────────────────────────────────────────────────────
  login: (method: 'email' | 'google' | 'apple') => {
    posthog.capture('login', { method });
    // Firebase's recommended login event — feeds Google Ads "Login" conversion.
    logFirebaseEvent('login', { method });
  },

  register: (method: 'email' | 'google' | 'apple') => {
    posthog.capture('register', { method });
    // Firebase's recommended sign_up event — primary Google Ads install
    // conversion goal. Google's bidding optimizes for this when the campaign
    // is set to "Install volume".
    logFirebaseEvent('sign_up', { method });
  },

  // ── Conversion funnel ─────────────────────────────────────────────────────
  // Fired at every screen between "Application Opened" and "register" so we
  // can finally see the 95% drop-off broken down by step. Each step is its
  // own event so PostHog funnel viz works.
  authScreenShown: (screen: 'login' | 'register' | 'age-check') =>
    posthog.capture('auth_screen_shown', { screen }),

  authProviderTapped: (provider: 'apple' | 'google' | 'email_toggle', screen: 'login' | 'register') =>
    posthog.capture('auth_provider_tapped', { provider, screen }),

  signupFieldFilled: (field: 'email' | 'password' | 'dob' | 'name', screen: 'login' | 'register') =>
    posthog.capture('signup_field_filled', { field, screen }),

  signupSubmitAttempted: (screen: 'login' | 'register') =>
    posthog.capture('signup_submit_attempted', { screen }),

  signupSubmitFailed: (screen: 'login' | 'register', reason: string) =>
    posthog.capture('signup_submit_failed', { screen, reason }),

  firstScreenAfterAuth: (screen: string) =>
    posthog.capture('first_screen_after_auth', { screen }),

  // ── First-run form-analysis hook ─────────────────────────────────────────
  // The signup → intake funnel now has a step between the two. These four
  // events are what make the "does the aha moment actually earn the intake"
  // question answerable: shown → submitted → result → finished(reason), with
  // `reason` separating users who completed it from those who skipped (no
  // gym, no barbell) and those whose clip failed to read.
  formHookShown: () => posthog.capture('onboarding_form_hook_shown'),

  formHookSubmitted: () => posthog.capture('onboarding_form_hook_submitted'),

  formHookResult: (exercise: string, formScore: number) =>
    posthog.capture('onboarding_form_hook_result', { exercise, form_score: formScore }),

  formHookFinished: (reason: 'completed' | 'skipped' | 'failed') =>
    posthog.capture('onboarding_form_hook_finished', { reason }),

  socialProofShown: (count: number) =>
    posthog.capture('signup_social_proof_shown', { user_count: count }),

  // ── Diagnostic teaser (pre-auth value preview) ───────────────────────────
  diagnosticPreviewStarted: () =>
    posthog.capture('diagnostic_preview_started'),
  diagnosticPreviewCompleted: (props: { tier: string; weakest?: string }) =>
    posthog.capture('diagnostic_preview_completed', props),
  diagnosticPreviewToSignup: (props: { tier: string }) =>
    posthog.capture('diagnostic_preview_to_signup', props),

  // ── Navigation ────────────────────────────────────────────────────────────
  coachDashboardOpened: (source: 'home_cta' | 'tab' | 'upsell') =>
    posthog.capture('coach_dashboard_opened', { source }),

  // ── Coach intake → program funnel ────────────────────────────────────────
  // The July funnel had zero events between auth and the dashboard, which
  // made the intake→program leak invisible. These map its every step.
  intakeStarted: () => posthog.capture('intake_started'),

  intakeStepViewed: (step: number, total: number) =>
    posthog.capture('intake_step_viewed', { step, total }),

  intakeCompleted: () => posthog.capture('intake_completed'),

  // Fires when a COMPLETED intake fails to persist. Previously this path was
  // swallowed silently and the user was pushed on to Build Your Program with
  // nothing saved, so a lost intake looked identical to a completed one in the
  // funnel. status 0 = network/unreachable.
  intakeSaveFailed: (status: number) =>
    posthog.capture('intake_save_failed', { status }),

  // Fires when the Coach screen sits on the loading skeleton long enough that
  // the watchdog has to force it forward. Any occurrence means a user saw an
  // unresponsive screen — the 2026-08-16 stall produced no event at all.
  coachStageStuck: (stage: string) =>
    posthog.capture('coach_stage_stuck', { stage }),

  programGenerateStarted: (auto: boolean) =>
    posthog.capture('program_generate_started', { auto }),

  programGenerationSucceeded: (durationMs: number, auto: boolean) =>
    posthog.capture('program_generation_succeeded', { duration_ms: durationMs, auto }),

  programGenerationFailed: (durationMs: number, auto: boolean, reason?: string) =>
    posthog.capture('program_generation_failed', { duration_ms: durationMs, auto, reason: (reason || '').slice(0, 120) }),

  programRevealViewed: () => posthog.capture('program_reveal_viewed'),

  paywallViewed: (source: string) => posthog.capture('paywall_viewed', { source }),

  // ── Diagnostics ───────────────────────────────────────────────────────────
  diagnosticStarted: (lift: string) =>
    posthog.capture('diagnostic_started', { lift }),

  diagnosticCompleted: (lift: string) => {
    posthog.capture('diagnostic_completed', { lift });
    // Firebase tutorial_complete — the standard "user finished onboarding"
    // event Google Ads recognizes. Marks the moment the user got real
    // value from the app for the first time.
    logFirebaseEvent('tutorial_complete', { lift });
  },

  // ── Coach — Life Happened ─────────────────────────────────────────────────
  lifeHappenedSubmitted: (disruptionType?: string) =>
    posthog.capture('life_happened_submitted', { disruption_type: disruptionType }),

  // ── Coach — Workouts ──────────────────────────────────────────────────────
  workoutLogged: (props: {
    exerciseCount: number;
    totalSets: number;
    workoutTitle?: string;
  }) => posthog.capture('workout_logged', props),

  // ── Coach — Chat ──────────────────────────────────────────────────────────
  coachMessageSent: (messageLength: number) =>
    posthog.capture('coach_chat_message_sent', { message_length: messageLength }),

  // ── Coach — Nutrition ─────────────────────────────────────────────────────
  foodTypedLogged: (props: { calories: number; confidence?: string }) =>
    posthog.capture('food_typed_logged', props),

  foodScannedLogged: (props: { calories: number; confidence?: string }) =>
    posthog.capture('food_scanned_logged', props),

  foodLoggedViaMealModal: () =>
    posthog.capture('food_logged_via_modal'),

  // Barcode-scan flow (1.1). Distinct events from food_scanned_logged so we
  // can compare adoption vs the photo-parse path.
  barcodeScanOpened: () => posthog.capture('barcode_scan_opened'),
  foodBarcodeLogged: (props: { code: string; name: string; servingsLogged?: number }) =>
    posthog.capture('food_barcode_logged', props),
  foodBarcodeLookupFailed: (props: { code: string; reason: 'not_found' | 'error' }) =>
    posthog.capture('food_barcode_lookup_failed', props),

  // Recipe library (MFP-style saved dishes). Created-via distinguishes the
  // AI paste-parse path from hand-built recipes.
  recipeCreated: (props: { ingredient_count: number; servings: number; via: 'ai_parse' | 'manual' }) =>
    posthog.capture('recipe_created', props),
  recipeLogged: (props: { servings: number; calories: number }) =>
    posthog.capture('recipe_logged', props),

  // Nutrition Profile (effects-first) — recommendation "Add" deep-link into
  // the Coach log.
  nutritionRecommendationAdded: (props: { food: string; nutrient: string }) =>
    posthog.capture('nutrition_recommendation_added', props),

  bodyWeightLogged: () =>
    posthog.capture('body_weight_logged'),

  // ── Social ────────────────────────────────────────────────────────────────
  textPostMade: () =>
    posthog.capture('text_post_made'),

  imagePostMade: () =>
    posthog.capture('image_post_made'),

  videoPostMade: () =>
    posthog.capture('video_post_made'),

  messageSentToFriend: () =>
    posthog.capture('message_sent_to_friend'),

  friendRequestSent: () =>
    posthog.capture('friend_request_sent'),

  leaderboardViewed: (lift: string) =>
    posthog.capture('leaderboard_viewed', { lift }),

  // ── Upgrade ───────────────────────────────────────────────────────────────
  upgradeTapped: (source: string) =>
    posthog.capture('upgrade_tapped', { source }),

  /**
   * Pro purchase succeeded. `source` is the same vocabulary as upgradeTapped
   * ('apple_iap' | 'google_play' | 'stripe' | …) so the PostHog funnel can
   * tie the tap to the conversion regardless of platform. Without the source
   * the mobile IAP path is invisible — the cross-platform server-side
   * subscription_checkout_completed event only fires for Stripe.
   */
  upgradeCompleted: (source?: string) => {
    posthog.capture('upgrade_completed', source ? { source } : {});
    // Mirror under the funnel-canonical name so the existing
    // pricing_viewed → subscription_checkout_completed funnel can also see
    // mobile IAP conversions without rebuilding it.
    posthog.capture('subscription_checkout_completed', source ? { source } : {});
    // Firebase purchase event — feeds Google Ads "Pro upgrade" conversion.
    // Google's bidding uses this as the highest-value conversion. We
    // approximate value (in CAD); the actual price is set on the IAP/Stripe
    // side. Currency is required by Firebase's purchase schema.
    const valueCAD = 12.99; // Stripe and Apple monthly are both $12.99 now
    logFirebaseEvent('purchase', {
      currency: 'CAD',
      value: valueCAD,
      transaction_id: `${source ?? 'unknown'}-${Date.now()}`,
      items: [{ item_id: 'pro_monthly', item_name: 'Axiom Pro Monthly' }],
      source,
    });
  },

  // ── Research articles (social feed) ───────────────────────────────────────
  /** A research article card appeared on the feed and was tapped open. */
  articleOpened: (props: { articleId: string; source?: 'feed' | 'saved' | 'shared' }) =>
    posthog.capture('article_opened', props),

  /** Bookmarked an article for later. */
  articleSaved: (articleId: string) =>
    posthog.capture('article_saved', { articleId }),

  /** Removed an article from Saved. */
  articleUnsaved: (articleId: string) =>
    posthog.capture('article_unsaved', { articleId }),

  /** Forwarded an article to a friend via DM. */
  articleShared: (articleId: string) =>
    posthog.capture('article_shared', { articleId }),

  /** User pulled to refresh the social feed (forces a fresh fetch of research). */
  feedRefreshed: (source: 'pull_to_refresh' | 'refresh_button') =>
    posthog.capture('feed_refreshed', { source }),

  // ── Workouts (forwarding + planned-vs-logged) ─────────────────────────────
  /** Sent a workout (planned or logged) to a friend from the Coach tab. */
  workoutSharedToFriend: (kind: 'planned' | 'logged') =>
    posthog.capture('workout_shared_to_friend', { kind }),

  // ── Coach ────────────────────────────────────────────────────────────────
  /** User tapped one of the suggested-prompt chips on the Coach screen. */
  coachSuggestedPromptTapped: (prompt: string) =>
    posthog.capture('coach_suggested_prompt_tapped', { prompt }),

  // ── Account churn ─────────────────────────────────────────────────────────
  /** User submitted the delete-account exit survey. */
  deleteAccountSurveySubmitted: (reason: string, freeText?: string) =>
    posthog.capture(
      'delete_account_survey_submitted',
      freeText ? { reason, freeText } : { reason },
    ),

  // ── Strength Profile ──────────────────────────────────────────────────────
  strengthProfileViewed: () =>
    posthog.capture('strength_profile_viewed'),

  // ── Settings ──────────────────────────────────────────────────────────────
  profileAvatarUpdated: () =>
    posthog.capture('profile_avatar_updated'),
};
