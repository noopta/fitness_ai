import PostHog from 'posthog-react-native';

// ─── PostHog client (singleton) ───────────────────────────────────────────────

export const posthog = new PostHog(
  'phc_BWbwuvj6GpMqbzPFUkVYdJSji3BFwjX72qjBjUwiw8oh',
  {
    host: 'https://us.i.posthog.com',
    // Flush events every 30 s or when 20 events are queued
    flushAt: 20,
    flushInterval: 30000,
    // Capture native lifecycle events (Application Opened / Became Active / etc.)
    captureAppLifecycleEvents: true,
    // Record native in-app sessions. Project-side "Record user sessions" must
    // also be enabled in PostHog → Project Settings → Session replay for these
    // to actually persist. The session-replay native module is auto-detected
    // when posthog-react-native-session-replay is installed.
    enableSessionReplay: true,
    sessionReplayConfig: {
      // Text inputs (emails, search, message composers) are masked by default
      // and we want that. Images stay visible so PRs, profile photos, and
      // workout screenshots are inspectable in replays.
      maskAllTextInputs: true,
      maskAllImages: false,
    },
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
}

export function resetUser() {
  posthog.reset();
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
export const Analytics = {
  // ── Auth ──────────────────────────────────────────────────────────────────
  login: (method: 'email' | 'google' | 'apple') =>
    posthog.capture('login', { method }),

  register: (method: 'email' | 'google' | 'apple') =>
    posthog.capture('register', { method }),

  // ── Navigation ────────────────────────────────────────────────────────────
  coachDashboardOpened: (source: 'home_cta' | 'tab' | 'upsell') =>
    posthog.capture('coach_dashboard_opened', { source }),

  // ── Diagnostics ───────────────────────────────────────────────────────────
  diagnosticStarted: (lift: string) =>
    posthog.capture('diagnostic_started', { lift }),

  diagnosticCompleted: (lift: string) =>
    posthog.capture('diagnostic_completed', { lift }),

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
