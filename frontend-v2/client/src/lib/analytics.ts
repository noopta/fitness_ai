import posthog from 'posthog-js';
import type { CaptureResult } from 'posthog-js';
// Session-replay recorder, bundled locally: the CSP is `script-src 'self'`, so
// PostHog must not lazy-load it from its asset CDN.
import 'posthog-js/dist/recorder';
import { scrubOAuthTokenFromUrl } from './oauthReturn';

// Must run before posthog.init: PostHog records the landing URL at init time
// ($initial_current_url), and an OAuth return carries the bearer token.
scrubOAuthTokenFromUrl();

// ─── Consent ──────────────────────────────────────────────────────────────────
// Analytics is OFF until the visitor accepts it in the consent banner.
// 'granted' | 'denied' lives in localStorage; absent = not yet asked.

export const ANALYTICS_CONSENT_KEY = 'axiom_analytics_consent';
export type AnalyticsConsent = 'granted' | 'denied';

export function getAnalyticsConsent(): AnalyticsConsent | null {
  try {
    const v = localStorage.getItem(ANALYTICS_CONSENT_KEY);
    return v === 'granted' || v === 'denied' ? v : null;
  } catch {
    return null;
  }
}

export function setAnalyticsConsent(value: AnalyticsConsent) {
  try {
    localStorage.setItem(ANALYTICS_CONSENT_KEY, value);
  } catch {
    /* storage blocked — choice applies to this page view only */
  }
  applyConsent(value);
}

function applyConsent(value: AnalyticsConsent | null) {
  try {
    if (value === 'granted') {
      if (!posthog.has_opted_in_capturing()) posthog.opt_in_capturing();
    } else if (!posthog.has_opted_out_capturing()) {
      posthog.opt_out_capturing();
    }
  } catch {
    /* posthog not initialised (tests) */
  }
}

// ─── URL redaction ────────────────────────────────────────────────────────────
// Defence in depth: strip credential-bearing params from any URL property
// before an event leaves the browser.

const SECRET_PARAM = /([?#&](?:token|access_token|id_token|code|jwt)=)[^&#]*/gi;

export function redactUrl(value: unknown): unknown {
  return typeof value === 'string' ? value.replace(SECRET_PARAM, '$1[redacted]') : value;
}

const URL_PROPS = ['$current_url', '$referrer', '$initial_current_url', '$initial_referrer', '$pathname'];

function redactEvent(event: CaptureResult | null): CaptureResult | null {
  if (!event) return event;
  for (const bag of [event.properties, (event as any).$set, (event as any).$set_once]) {
    if (!bag || typeof bag !== 'object') continue;
    for (const k of URL_PROPS) if (k in bag) bag[k] = redactUrl(bag[k]);
  }
  return event;
}

// ─── Init ─────────────────────────────────────────────────────────────────────

posthog.init('phc_BWbwuvj6GpMqbzPFUkVYdJSji3BFwjX72qjBjUwiw8oh', {
  api_host: 'https://us.i.posthog.com',
  // Nothing is captured until the visitor opts in via the consent banner.
  opt_out_capturing_by_default: true,
  // Auto-capture clicks, page views, form submissions
  autocapture: true,
  // Capture page views on route change (we also do this manually for Wouter)
  capture_pageview: false,
  // Persist identity across sessions
  persistence: 'localStorage',
  capture_performance: true,
  // Session replay: mask every input and all rendered text (health data).
  session_recording: {
    maskAllInputs: true,
    maskTextSelector: '*',
  },
  // CSP is script-src 'self': never inject scripts from PostHog's CDN.
  disable_external_dependency_loading: true,
  before_send: redactEvent,
});

applyConsent(getAnalyticsConsent());

export { posthog };

// ─── Identity ─────────────────────────────────────────────────────────────────

/** Identify by opaque user id only — no email, name or username leaves the app. */
export function identifyUser(userId: string, props?: { tier?: string | null }) {
  posthog.identify(userId, {
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

  // Fired once per plan render on the diagnostic results page. `locked` marks
  // the diagnostic-first funnel where the prescription is withheld.
  diagnosticVerdictViewed: (locked: boolean) =>
    posthog.capture('diagnostic_verdict_viewed', { locked }),

  paywallViewed: (source: string) =>
    posthog.capture('paywall_viewed', { source }),

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

  // ── Research articles (web social feed) ───────────────────────────────────
  // Event names mirror the mobile Analytics module so PostHog dashboards can
  // group cross-platform article behaviour.
  articleOpened: (props: { articleId: string; source?: 'feed' | 'saved' | 'shared' }) =>
    posthog.capture('article_opened', props),

  articleSaved: (articleId: string) =>
    posthog.capture('article_saved', { articleId }),

  articleUnsaved: (articleId: string) =>
    posthog.capture('article_unsaved', { articleId }),

  articleShared: (articleId: string) =>
    posthog.capture('article_shared', { articleId }),

  feedRefreshed: (source: 'pull_to_refresh' | 'refresh_button') =>
    posthog.capture('feed_refreshed', { source }),
};
