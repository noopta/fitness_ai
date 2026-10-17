import React, { createContext, useContext, useEffect, useState, useRef, useCallback, ReactNode } from 'react';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Alert, AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE, authApi, getToken, setToken, clearToken, isVerifyPending, type AuthVerifyPending } from '../lib/api';
import { log } from '../lib/log';
import { clearLocalOnboardingState } from '../onboarding/testAccountReset';
import { setTrainerMode } from '../features/personal-training/mode';
import { resetEntitlementSync, syncStoreEntitlement } from '../lib/entitlementSync';
import { invalidateCache } from '../lib/cache';

WebBrowser.maybeCompleteAuthSession();

/**
 * The last OAuth token we finished processing.
 *
 * Module-level rather than a ref because the same token can reach us from
 * three independent places — the openAuthSessionAsync promise, the global
 * deep-link listener, and the /auth/callback route on a cold start — and those
 * can span component remounts.
 */
let handledToken: string | null = null;

// ── OAuth "login in flight" gate ─────────────────────────────────────────────
// `axiom://auth/callback?token=…` is a public URL scheme: any web page or app
// can open it. Without a gate, a crafted link could silently sign the phone
// into an attacker's account (login CSRF — everything the victim then logs,
// incl. injuries and form video, lands in the attacker's account). A token
// from a deep link is therefore only accepted while a Google sign-in that THIS
// device started is in flight (≤10 min), and never over a signed-in user.
// Persisted as well as in memory: on Android the OS can kill the app while
// Google's 2FA prompt is foregrounded, and the token then arrives on a cold
// start.
const OAUTH_FLIGHT_KEY = 'axiom_oauth_inflight_at';
const OAUTH_FLIGHT_MS = 10 * 60 * 1000;
let oauthStartedAt: number | null = null;

async function markOAuthStart(): Promise<void> {
  oauthStartedAt = Date.now();
  try { await AsyncStorage.setItem(OAUTH_FLIGHT_KEY, String(oauthStartedAt)); } catch { /* memory flag still holds */ }
}

async function clearOAuthFlight(): Promise<void> {
  oauthStartedAt = null;
  try { await AsyncStorage.removeItem(OAUTH_FLIGHT_KEY); } catch { /* ignore */ }
}

async function oauthInFlight(): Promise<boolean> {
  let at = oauthStartedAt;
  if (at == null) {
    try { const v = await AsyncStorage.getItem(OAUTH_FLIGHT_KEY); at = v ? Number(v) : null; } catch { at = null; }
  }
  if (at == null || !Number.isFinite(at)) return false;
  if (Date.now() - at > OAUTH_FLIGHT_MS) { await clearOAuthFlight(); return false; }
  return true;
}

// Device-local data that belongs to the signed-in person and must not survive
// a sign-out on a shared phone: offline caches (incl. DMs), the in-flight
// diagnostic draft (injuries are in `axiom_constraints`) and logger drafts.
const USER_DATA_KEYS = [
  'axiom_session_id', 'axiom_selected_lift', 'axiom_target_weight', 'axiom_target_sets', 'axiom_target_reps',
  'axiom_height_ft', 'axiom_height_in', 'axiom_weight_lbs', 'axiom_training_age', 'axiom_equipment', 'axiom_constraints',
  'v2.loggerDraft.v1', 'v2.sessionDraft.v1', 'v2:feedsearch:recent', OAUTH_FLIGHT_KEY,
];
const USER_DATA_PREFIXES = ['mcache:v1:', 'chat-cache:v1:'];

async function purgeLocalUserData(): Promise<void> {
  invalidateCache('');
  try {
    const all = await AsyncStorage.getAllKeys();
    const swept = all.filter((k) => USER_DATA_PREFIXES.some((p) => k.startsWith(p)));
    await AsyncStorage.multiRemove([...USER_DATA_KEYS, ...swept]);
  } catch { /* best effort */ }
}

/** Consent timestamps from /auth/me (null = not given). */
export interface ConsentState {
  acceptedTermsAt: string | null;
  healthConsentAt: string | null;
  marketingConsentAt?: string | null;
}

/** `consent` from an /auth/me payload; undefined when the backend predates it. */
function readConsent(data: any): ConsentState | undefined {
  const c = data?.consent ?? data?.user?.consent;
  if (!c || typeof c !== 'object') return undefined;
  return {
    acceptedTermsAt: c.acceptedTermsAt ?? null,
    healthConsentAt: c.healthConsentAt ?? null,
    marketingConsentAt: c.marketingConsentAt ?? null,
  };
}

/**
 * Whether the age gate must show, derived from the /auth/me payload on EVERY
 * load — so force-quitting on the age-check screen can't skip it. Missing DOB
 * only counts when the field is actually present in the payload (an older
 * server that omits it must not lock everyone out).
 */
function deriveNeedsDob(data: any): boolean {
  if (data?.needsDob === true || data?.user?.needsDob === true) return true;
  const u = data?.user;
  return !!u && Object.prototype.hasOwnProperty.call(u, 'dateOfBirth') && !u.dateOfBirth;
}

/** Pull the OAuth result out of an `axiom://auth/callback?...` deep link. */
export function parseAuthCallbackUrl(url: string): { token?: string; needsDob: boolean; error: boolean } | null {
  if (!url || !url.includes('auth/callback')) return null;
  const token = url.match(/[?&]token=([^&#]+)/)?.[1];
  return {
    token: token ? decodeURIComponent(token) : undefined,
    needsDob: /[?&]needsDob=1/.test(url),
    error: /[?&]auth=error/.test(url),
  };
}

export interface InstitutionMembership {
  role: 'coach' | 'athlete';
  joinedAt: string;
  institution: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
  };
}

export interface AuthUser {
  id: string;
  name: string | null;
  email: string | null;
  tier: string;
  heightCm?: number | null;
  weightKg?: number | null;
  unitPreference?: 'metric' | 'imperial' | null;
  // Which food-composition data and prompt vocabulary meal logging uses.
  // USDA has almost no West African coverage, so this is what makes egusi soup
  // or benachin resolve to real numbers instead of model guesswork.
  foodRegion?: 'global' | 'ng' | 'gm' | 'wa' | null;
  trainingAge?: string | null;
  equipment?: string | null;
  constraintsText?: string | null;
  coachGoal?: string | null;
  coachBudget?: string | null;
  coachOnboardingDone?: boolean;
  /**
   * ISO date string, or null for accounts created before the age-check screen
   * existed. /auth/me returns it; it gates age-restricted features (18+ for
   * form-analysis reference stills). Existing accounts are deliberately NOT
   * prompted at launch — the form-analysis screen asks for it in context, only
   * when the user reaches for something that needs it.
   */
  dateOfBirth?: string | null;
  coachProfile?: string | null;
  savedProgram?: string | null;
  institutions?: InstitutionMembership[];
  username?: string | null;
  avatarBase64?: string | null;
  /**
   * Whether the daily calorie target should be adjusted down by today's
   * estimated workout calorie burn. Default true. Off when the user's
   * nutrition plan already assumes a high activity multiplier (otherwise
   * we'd double-count training).
   */
  subtractWorkoutBurnFromCalories?: boolean;
  referredByCode?: string | null;
}

/** Outcome of a token that arrived on a deep link. */
export type OAuthCallbackResult = 'ok' | 'ignored' | 'failed';

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  needsDobCheck: boolean;
  clearDobCheck: () => void;
  /** Consent timestamps; undefined when /auth/me doesn't send them (older backend). */
  consent: ConsentState | undefined;
  // login + register may resolve to a "verification pending" sentinel when
  // the user signed up with email+password and hasn't entered their 6-digit
  // OTP yet — the caller routes to /(auth)/verify-email in that case.
  login: (email: string, password: string) => Promise<AuthVerifyPending | null>;
  register: (name: string, email: string, password: string, dateOfBirth?: string) => Promise<AuthVerifyPending | null>;
  // Submit the OTP, persist the token + user on success. Throws on
  // mismatch/expired/etc. so the caller can show an error message.
  verifyEmail: (email: string, code: string) => Promise<void>;
  resendVerification: (email: string) => Promise<{ sent: boolean; cooldownRemainingSec?: number; reason?: string }>;
  logout: () => Promise<void>;
  // Resolve true only when a session was actually established. A cancelled /
  // dismissed provider sheet resolves false — callers must NOT fire success
  // analytics or navigate on false (doing so used to silently dump users on
  // the Coach tab with no session).
  googleLogin: () => Promise<boolean>;
  appleLogin: () => Promise<boolean>;
  refreshUser: () => Promise<void>;
  /**
   * The current user, readable synchronously — including immediately after an
   * `await login()/register()`, when the caller's `user` is still stale.
   * Post-auth routing depends on this; see postAuthRoute.
   */
  getLatestUser: () => AuthUser | null;
  /** Server-owned feature flags, readable synchronously. Defaults to all-off. */
  getFeatures: () => { onboardingFormHook: boolean; diagnosticFirstOnboarding: boolean; liftDiagnosticConversation: boolean; onboardingTestAccount: boolean; uiV2: boolean; directEntryPaywall: boolean; personalTraining: boolean; freestyle: boolean; logAdaptation: boolean; phaseInference: boolean; mealPhotoV2: boolean; webFoodSearch: boolean };
  /**
   * Finish an auth flow that arrived via deep link (e.g., the Android Google
   * sign-in path where Chrome Custom Tabs hands off the axiom:// redirect to
   * the OS rather than intercepting it in-browser). Persists the token,
   * verifies via /auth/me, and updates user + needsDobCheck state. Returns
   * true on success, false on any failure (caller decides where to route).
   */
  completeAuthCallback: (token: string, opts?: { needsDob?: boolean }) => Promise<boolean>;
  /**
   * The gated entry for a token that arrived on an `axiom://auth/callback`
   * deep link: 'ignored' unless a Google sign-in started on this device is in
   * flight and nobody is signed in; otherwise verified like completeAuthCallback.
   */
  acceptOAuthCallback: (token: string, opts?: { needsDob?: boolean }) => Promise<OAuthCallbackResult>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);

  // A synchronously-readable mirror of `user`.
  //
  // Post-auth routing needs the user the instant `await login()` returns, and
  // React state is not available to the caller's closure at that point — the
  // screen still sees the stale value it rendered with. Reading a ref avoids
  // both a duplicate /auth/me round-trip on the critical path and the class
  // of bug where a screen routes on a user it hasn't been told about yet.
  const userRef = useRef<AuthUser | null>(null);
  const commitUser = useCallback((u: AuthUser | null) => {
    userRef.current = u;
    setUser(u);
  }, []);
  const getLatestUser = useCallback(() => userRef.current, []);

  // Server-owned feature flags from /auth/me. Kept in a ref for the same
  // reason as the user: post-auth routing reads them synchronously, before
  // any re-render has happened. Defaults to everything off, so a server that
  // does not send the block (or a request that failed) leaves gated features
  // dark rather than showing a flow the backend will refuse.
  const featuresRef = useRef<{ onboardingFormHook: boolean; diagnosticFirstOnboarding: boolean; liftDiagnosticConversation: boolean; onboardingTestAccount: boolean; uiV2: boolean; directEntryPaywall: boolean; personalTraining: boolean; freestyle: boolean; logAdaptation: boolean; phaseInference: boolean; mealPhotoV2: boolean; webFoodSearch: boolean }>({
    onboardingFormHook: false,
    diagnosticFirstOnboarding: false,
    directEntryPaywall: false,
    liftDiagnosticConversation: false,
    onboardingTestAccount: false,
    uiV2: false,
    personalTraining: false,
    // Freestyle release (Oct 2026) — all default off; off = today's behavior.
    freestyle: false,
    logAdaptation: false,
    phaseInference: false,
    mealPhotoV2: false,
    webFoodSearch: false,
  });
  const commitFeatures = useCallback((f: any) => {
    featuresRef.current = {
      onboardingFormHook: f?.onboardingFormHook === true,
      diagnosticFirstOnboarding: f?.diagnosticFirstOnboarding === true,
      // Classic paywall: new users go straight into the app; the coach tab is Pro.
      directEntryPaywall: f?.directEntryPaywall === true,
      liftDiagnosticConversation: f?.liftDiagnosticConversation === true,
      onboardingTestAccount: f?.onboardingTestAccount === true,
      uiV2: f?.uiV2 === true,
      personalTraining: f?.personalTraining === true,
      freestyle: f?.freestyle === true,
      logAdaptation: f?.logAdaptation === true,
      phaseInference: f?.phaseInference === true,
      mealPhotoV2: f?.mealPhotoV2 === true,
      webFoodSearch: f?.webFoodSearch === true,
    };
  }, []);
  const getFeatures = useCallback(() => featuresRef.current, []);

  // Device-side half of the onboarding-test-account reset. The server has
  // already blanked the account by the time these features land; without this
  // the phone's own first-run keys would still be set and the second sign-in
  // would skip the very flow the account exists to exercise.
  //
  // Called from the sign-in paths ONLY, never from refreshUser(): a mid-session
  // refresh clearing `axiom_session_id` would drop an in-flight diagnostic.
  const applyTestAccountReset = useCallback(async () => {
    if (featuresRef.current.onboardingTestAccount) await clearLocalOnboardingState();
  }, []);
  const [loading, setLoading] = useState(true);
  const [needsDobCheck, setNeedsDobCheck] = useState(false);
  const [consent, setConsent] = useState<ConsentState | undefined>(undefined);

  function clearDobCheck() { setNeedsDobCheck(false); }

  /** Commit everything an /auth/me payload carries. */
  function applyMe(data: any) {
    commitUser(data?.user ?? null);
    commitFeatures(data?.features);
    setConsent(readConsent(data));
    if (data?.user) setNeedsDobCheck(deriveNeedsDob(data));
  }

  // Resolves once the cold-start session restore has finished, so the deep-link
  // gate sees whether someone is already signed in.
  const initDone = useRef<{ promise: Promise<void>; resolve: () => void } | null>(null);
  if (!initDone.current) {
    let resolve: () => void = () => {};
    const promise = new Promise<void>((r) => { resolve = r; });
    initDone.current = { promise, resolve };
  }

  async function refreshUser() {
    try {
      const data = await authApi.getMe();
      applyMe(data);
    } catch (err: any) {
      // Only clear user on explicit auth rejection (401/403), not network errors
      if (err?.status === 401 || err?.status === 403) {
        await clearToken();
        commitUser(null);
      }
      // On network errors, keep the current user state intact
    }
  }

  useEffect(() => {
    const init = async () => {
      const token = await getToken();
      if (token) {
        try {
          const data = await authApi.getMe();
          applyMe(data);
        } catch (err: any) {
          if (err?.status === 401 || err?.status === 403) {
            await clearToken();
            commitUser(null);
          }
          // Network/server errors: still allow app to load (user stays null → redirect to login)
        }
      }
      setLoading(false);
      initDone.current?.resolve();
    };
    init();
  }, []);

  // ── Pro follows the user back into the app (lib/entitlementSync.ts) ──
  // On every return to the foreground (at most every 30 s) the account is
  // re-read, so a payment finished elsewhere — Stripe in a browser tab, or a
  // store purchase completed after the upgrade sheet closed — shows at once.
  // A user still on free also has the store asked for an unverified Pro
  // purchase. Once at launch too, for a purchase left unfinished last time.
  const lastReturnSync = useRef(0);
  const syncEntitlement = useCallback(async () => {
    if (!userRef.current) return;
    lastReturnSync.current = Date.now();
    const before = userRef.current.tier;
    await refreshUser();
    if (userRef.current && userRef.current.tier === 'free' && (await syncStoreEntitlement())) await refreshUser();
    // Anything cached while free (gated answers, upgrade prompts) is stale once Pro.
    if (userRef.current && userRef.current.tier !== before) invalidateCache('');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && Date.now() - lastReturnSync.current > 30_000) void syncEntitlement();
    });
    return () => sub.remove();
  }, [syncEntitlement]);
  useEffect(() => {
    if (loading || !user) return;
    const t = setTimeout(() => { if (Date.now() - lastReturnSync.current > 30_000) void syncEntitlement(); }, 5000);
    return () => clearTimeout(t);
  }, [loading, !!user]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Catch the OAuth deep link wherever it comes from.
   *
   * Until now the ONLY thing watching for `axiom://auth/callback?token=…` was
   * the promise returned by openAuthSessionAsync. That promise is fragile: on
   * Android, anything that foregrounds another app tears the Custom Tab down
   * and resolves it as `dismiss`, throwing the token away even though the
   * sign-in actually succeeded.
   *
   * That is not an edge case — Google's "Yes, it's me" 2FA does exactly this,
   * because the Gmail prompt appears ON THE SAME PHONE and pulls focus. The
   * user taps yes, comes back, and is still sitting on the login screen.
   *
   * So the deep link is now the source of truth and the browser promise is
   * only an optimisation. completeAuthCallback is idempotent, so it does not
   * matter which one wins.
   */
  useEffect(() => {
    const handle = async (url: string | null) => {
      if (!url) return;
      const parsed = parseAuthCallbackUrl(url);
      if (!parsed) return;

      if (parsed.token) {
        const result = await acceptOAuthCallback(parsed.token, { needsDob: parsed.needsDob });
        if (result === 'ignored') return; // not ours — logged, nothing shown
        // The tab may still be sitting open behind us after a handoff.
        try { WebBrowser.dismissBrowser(); } catch { /* nothing open */ }
        if (result === 'failed') Alert.alert('Sign In Failed', 'We could not verify your sign-in. Please try again.');
      } else if (parsed.error) {
        Alert.alert('Sign In Failed', 'Google sign-in failed. Please try again.');
      }
    };

    const sub = Linking.addEventListener('url', e => { void handle(e.url); });
    // Cold start: the link that launched the app is not delivered as an event.
    void Linking.getInitialURL().then(handle).catch(() => {});
    return () => sub.remove();
  }, []);

  // Every sign-in path must end with a /auth/me pass BEFORE the caller
  // routes: the login/register/apple/google responses carry a minimal user
  // and NO `features` block, and postAuthDestination runs the moment these
  // functions return. Without this, server feature flags read as all-off on
  // every fresh sign-in — new users were routed into the intake with the
  // diagnostic-first flag on because getFeatures() still held the defaults.
  // refreshUser() commits both the full user and the features, and tolerates
  // a network blip by keeping the state we already committed.
  async function login(email: string, password: string): Promise<AuthVerifyPending | null> {
    const data = await authApi.login(email, password);
    if (isVerifyPending(data)) return data;
    if (data.token) await setToken(data.token);
    commitUser(data.user);
    await refreshUser();
    await applyTestAccountReset();
    return null;
  }

  async function register(name: string, email: string, password: string, dateOfBirth?: string): Promise<AuthVerifyPending | null> {
    const data = await authApi.register(name, email, password, dateOfBirth);
    if (isVerifyPending(data)) return data;
    if (data.token) await setToken(data.token);
    commitUser(data.user);
    await refreshUser();
    await applyTestAccountReset();
    return null;
  }

  async function verifyEmail(email: string, code: string) {
    const data = await authApi.verifyEmail(email, code);
    if (data.token) await setToken(data.token);
    commitUser(data.user);
    await refreshUser();
    await applyTestAccountReset();
  }

  async function resendVerification(email: string) {
    return authApi.resendVerification(email);
  }

  async function logout() {
    // Revoke every session server-side (a stolen copy of this token dies too),
    // falling back to the single-session logout on an older backend.
    try { await authApi.logoutAll(); } catch {
      try { await authApi.logout(); } catch { /* ignore */ }
    }
    resetEntitlementSync();
    // The next person on this phone must not inherit cached data or drafts.
    await purgeLocalUserData();
    await clearToken();
    await clearOAuthFlight();
    handledToken = null;
    setConsent(undefined);
    setNeedsDobCheck(false);
    // The next person to sign in on this device is not assumed to be a trainer.
    await setTrainerMode(false);
    commitUser(null);
  }

  /**
   * Used by the /auth/callback deep-link route. Same logic the googleLogin
   * success branch runs inline, but reachable from any screen that lands
   * with an `?token=...` parameter — needed on Android where Chrome Custom
   * Tabs sometimes hands off the redirect to the OS rather than intercepting
   * it inside openAuthSessionAsync.
   */
  async function completeAuthCallback(
    token: string,
    opts?: { needsDob?: boolean },
  ): Promise<boolean> {
    // The same token can legitimately arrive twice — once from the WebBrowser
    // promise and once from the global deep-link listener below, or from the
    // /auth/callback route on a cold start. Verifying it twice would fire two
    // /auth/me calls and race setUser, so the first success wins.
    if (token === handledToken) return true;
    handledToken = token;

    try {
      // Verify BEFORE persisting: a token that /auth/me rejects never touches storage.
      const res = await fetch(`${API_BASE}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.user) {
        await clearToken();
        handledToken = null; // release the guard so a retry can run
        return false;
      }
      await setToken(token);
      await clearOAuthFlight();
      // This IS the /auth/me payload — commit the features it carries, or
      // post-auth routing runs on the all-off defaults.
      applyMe(data);
      await applyTestAccountReset();
      if (opts?.needsDob) setNeedsDobCheck(true);
      return true;
    } catch {
      // Network error — token is stored, but we couldn't verify. Roll back so
      // the user lands on the welcome screen and can retry rather than being
      // stuck in a half-authenticated state.
      await clearToken();
      handledToken = null;
      return false;
    }
  }

  async function acceptOAuthCallback(token: string, opts?: { needsDob?: boolean }): Promise<OAuthCallbackResult> {
    if (token === handledToken) return 'ok'; // the same sign-in, delivered twice
    // Wait for the cold-start session restore, so "already signed in" is known.
    await initDone.current?.promise;
    if (userRef.current) {
      log.warn('[Auth] ignored OAuth callback: a user is already signed in');
      return 'ignored';
    }
    if (!(await oauthInFlight())) {
      log.warn('[Auth] ignored OAuth callback: no Google sign-in in flight on this device');
      return 'ignored';
    }
    return (await completeAuthCallback(token, opts)) ? 'ok' : 'failed';
  }

  async function googleLogin(): Promise<boolean> {
    try {
      const redirectUri = Linking.createURL('/auth/callback');
      const authUrl = `${API_BASE}/auth/google?redirect_uri=${encodeURIComponent(redirectUri)}`;
      // Opens the deep-link gate (see oauthInFlight) for this sign-in only.
      await markOAuthStart();
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);
      log.debug('[Auth] OAuth result type:', result.type);

      if (result.type === 'success' && result.url) {
        const url = result.url;
        const tokenMatch = url.match(/[?&#]token=([^&#]+)/);
        const authMatch = url.match(/[?&]auth=([^&#]+)/);
        const token = tokenMatch ? decodeURIComponent(tokenMatch[1]) : null;
        const authParam = authMatch ? authMatch[1] : null;
        log.debug('[Auth] Token present:', !!token, 'authParam:', authParam);

        if (token) {
          // This browser session was opened by us a moment ago, so it is our
          // own sign-in — no gate needed. Verified via /auth/me before it is stored.
          const ok = await completeAuthCallback(token, { needsDob: /[?&]needsDob=1/.test(url) });
          if (ok) return true;
          Alert.alert('Sign In Failed', 'We could not verify your sign-in. Please check your connection and try again.');
        } else if (authParam === 'error') {
          Alert.alert('Sign In Failed', 'Google sign-in failed. Please try again.');
        } else {
          Alert.alert('Sign In Failed', `No token in redirect URL. Please try again.`);
        }
      } else if (result.type === 'cancel' || result.type === 'dismiss') {
        // NOT necessarily a cancellation. On Android the Custom Tab resolves
        // as `dismiss` whenever another app steals focus — which is exactly
        // what Google's "Yes, it's me" 2FA does, since the Gmail prompt opens
        // on the same phone. The sign-in may well have completed, with the
        // token arriving via the deep-link listener a moment later.
        //
        // So: give the deep link a chance to land, and only report failure if
        // nothing showed up. Silence here is what left users staring at the
        // login screen with no idea anything had gone wrong.
        log.debug('[Auth] browser dismissed — waiting briefly for the deep link');
        await new Promise(r => setTimeout(r, 2500));
        if (!handledToken) {
          log.debug('[Auth] no deep link arrived after dismiss — treating as cancelled');
          return false;
        }
        // The deep link landed while we waited — completeAuthCallback owns the
        // session; report success so the caller's analytics reflect reality.
        return true;
      } else {
        Alert.alert('Sign In Failed', `Unexpected result: ${result.type}. Please try again.`);
      }
    } catch (err: any) {
      log.warn('[Auth] Google OAuth error:', err?.message);
      Alert.alert('Sign In Failed', err?.message || 'Could not complete Google sign-in.');
    }
    return false;
  }

  async function appleLogin(): Promise<boolean> {
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      const res = await fetch(`${API_BASE}/auth/apple`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identityToken: credential.identityToken,
          fullName: credential.fullName,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        Alert.alert('Sign In Failed', data.error ?? 'Apple sign-in failed. Please try again.');
        return false;
      }

      if (data.token) await setToken(data.token);
      commitUser(data.user);
      // The /auth/apple response has no `features` block — refresh from
      // /auth/me so feature-gated routing (diagnostic-first, form hook)
      // sees real flags instead of the all-off defaults.
      await refreshUser();
      if (data.needsDobCheck) setNeedsDobCheck(true);
      return true;
    } catch (err: any) {
      if (err?.code === 'ERR_REQUEST_CANCELED') return false; // user dismissed sheet
      log.warn('[Auth] Apple sign-in error:', err?.message);
      Alert.alert('Sign In Failed', err?.message || 'Could not complete Apple sign-in.');
      return false;
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, needsDobCheck, clearDobCheck, consent, acceptOAuthCallback, login, register, verifyEmail, resendVerification, logout, googleLogin, appleLogin, refreshUser, getLatestUser, getFeatures, completeAuthCallback }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
