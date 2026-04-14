import posthog from 'posthog-js';

// ─── Init ─────────────────────────────────────────────────────────────────────

posthog.init('phc_BWbwuvj6GpMqbzPFUkVYdJSji3BFwjX72qjBjUwiw8oh', {
  api_host: 'https://us.i.posthog.com',
  // Auto-capture clicks, page views, form submissions
  autocapture: true,
  // Capture page views on route change (we also do this manually for Wouter)
  capture_pageview: false,
  // Persist identity across sessions
  persistence: 'localStorage',
  // Don't capture sensitive inputs
  capture_performance: true,
});

export { posthog };

// ─── Identity ─────────────────────────────────────────────────────────────────

export function identifyUser(userId: string, props?: {
  name?: string | null;
  email?: string | null;
  tier?: string | null;
}) {
  posthog.identify(userId, {
    name: props?.name ?? undefined,
    email: props?.email ?? undefined,
    tier: props?.tier ?? 'free',
  });
}

export function resetUser() {
  posthog.reset();
}

// ─── Page tracking ────────────────────────────────────────────────────────────

export function trackPageView(path: string) {
  posthog.capture('$pageview', { $current_url: window.location.origin + path });
}

// ─── Time on page ─────────────────────────────────────────────────────────────

/**
 * Call at mount, returns cleanup that fires `page_time_spent` on unmount.
 */
export function trackPageTime(pageName: string): () => void {
  const start = Date.now();
  return () => {
    const seconds = Math.round((Date.now() - start) / 1000);
    if (seconds < 1) return;
    posthog.capture('page_time_spent', { page: pageName, seconds });
  };
}

// ─── Feature events ───────────────────────────────────────────────────────────

export const WebAnalytics = {
  // ── Auth ──────────────────────────────────────────────────────────────────
  login: (method: 'email' | 'google') =>
    posthog.capture('login', { method }),

  register: (method: 'email' | 'google') =>
    posthog.capture('register', { method }),

  // ── Landing / Features page ───────────────────────────────────────────────
  ctaClicked: (label: string, location: string) =>
    posthog.capture('cta_clicked', { label, location }),

  featuresTabViewed: (tab: string) =>
    posthog.capture('features_tab_viewed', { tab }),

  pricingViewed: () =>
    posthog.capture('pricing_viewed'),

  // ── Diagnostics ───────────────────────────────────────────────────────────
  diagnosticStarted: (lift: string) =>
    posthog.capture('diagnostic_started', { lift }),

  diagnosticCompleted: (lift: string) =>
    posthog.capture('diagnostic_completed', { lift }),

  // ── Coach dashboard ───────────────────────────────────────────────────────
  coachTabSwitched: (tab: string) =>
    posthog.capture('coach_tab_switched', { tab }),

  coachMessageSent: (messageLength: number) =>
    posthog.capture('coach_chat_message_sent', { message_length: messageLength }),

  lifeHappenedSubmitted: () =>
    posthog.capture('life_happened_submitted'),

  workoutLogged: (exerciseCount: number) =>
    posthog.capture('workout_logged', { exercise_count: exerciseCount }),

  // ── Nutrition ─────────────────────────────────────────────────────────────
  foodTypedLogged: (calories: number) =>
    posthog.capture('food_typed_logged', { calories }),

  foodScannedLogged: (calories: number) =>
    posthog.capture('food_scanned_logged', { calories }),

  // ── Upgrade ───────────────────────────────────────────────────────────────
  upgradeTapped: (source: string) =>
    posthog.capture('upgrade_tapped', { source }),
};
