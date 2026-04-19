import PostHog from 'posthog-react-native';

// ─── PostHog client (singleton) ───────────────────────────────────────────────

export const posthog = new PostHog(
  'phc_BWbwuvj6GpMqbzPFUkVYdJSji3BFwjX72qjBjUwiw8oh',
  {
    host: 'https://us.i.posthog.com',
    // Flush events every 30 s or when 20 events are queued
    flushAt: 20,
    flushInterval: 30000,
    // Don't capture device info automatically — we add context manually
    captureNativeAppLifecycleEvents: true,
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

  upgradeCompleted: () =>
    posthog.capture('upgrade_completed'),

  // ── Strength Profile ──────────────────────────────────────────────────────
  strengthProfileViewed: () =>
    posthog.capture('strength_profile_viewed'),

  // ── Settings ──────────────────────────────────────────────────────────────
  profileAvatarUpdated: () =>
    posthog.capture('profile_avatar_updated'),
};
