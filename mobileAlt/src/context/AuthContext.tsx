import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Alert, Platform } from 'react-native';
import { authApi, getToken, setToken, clearToken, isVerifyPending, type AuthVerifyPending } from '../lib/api';

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
  trainingAge?: string | null;
  equipment?: string | null;
  constraintsText?: string | null;
  coachGoal?: string | null;
  coachBudget?: string | null;
  coachOnboardingDone?: boolean;
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

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  needsDobCheck: boolean;
  clearDobCheck: () => void;
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
  googleLogin: () => Promise<void>;
  appleLogin: () => Promise<void>;
  refreshUser: () => Promise<void>;
  /**
   * Finish an auth flow that arrived via deep link (e.g., the Android Google
   * sign-in path where Chrome Custom Tabs hands off the axiom:// redirect to
   * the OS rather than intercepting it in-browser). Persists the token,
   * verifies via /auth/me, and updates user + needsDobCheck state. Returns
   * true on success, false on any failure (caller decides where to route).
   */
  completeAuthCallback: (token: string, opts?: { needsDob?: boolean }) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsDobCheck, setNeedsDobCheck] = useState(false);

  function clearDobCheck() { setNeedsDobCheck(false); }

  async function refreshUser() {
    try {
      const data = await authApi.getMe();
      setUser(data.user);
    } catch (err: any) {
      // Only clear user on explicit auth rejection (401/403), not network errors
      if (err?.status === 401 || err?.status === 403) {
        await clearToken();
        setUser(null);
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
          setUser(data.user);
        } catch (err: any) {
          if (err?.status === 401 || err?.status === 403) {
            await clearToken();
            setUser(null);
          }
          // Network/server errors: still allow app to load (user stays null → redirect to login)
        }
      }
      setLoading(false);
    };
    init();
  }, []);

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
        // The tab may still be sitting open behind us after a handoff.
        try { WebBrowser.dismissBrowser(); } catch { /* nothing open */ }
        const ok = await completeAuthCallback(parsed.token, { needsDob: parsed.needsDob });
        if (!ok) Alert.alert('Sign In Failed', 'We could not verify your sign-in. Please try again.');
      } else if (parsed.error) {
        Alert.alert('Sign In Failed', 'Google sign-in failed. Please try again.');
      }
    };

    const sub = Linking.addEventListener('url', e => { void handle(e.url); });
    // Cold start: the link that launched the app is not delivered as an event.
    void Linking.getInitialURL().then(handle).catch(() => {});
    return () => sub.remove();
  }, []);

  async function login(email: string, password: string): Promise<AuthVerifyPending | null> {
    const data = await authApi.login(email, password);
    if (isVerifyPending(data)) return data;
    if (data.token) await setToken(data.token);
    setUser(data.user);
    return null;
  }

  async function register(name: string, email: string, password: string, dateOfBirth?: string): Promise<AuthVerifyPending | null> {
    const data = await authApi.register(name, email, password, dateOfBirth);
    if (isVerifyPending(data)) return data;
    if (data.token) await setToken(data.token);
    setUser(data.user);
    return null;
  }

  async function verifyEmail(email: string, code: string) {
    const data = await authApi.verifyEmail(email, code);
    if (data.token) await setToken(data.token);
    setUser(data.user);
  }

  async function resendVerification(email: string) {
    return authApi.resendVerification(email);
  }

  async function logout() {
    try { await authApi.logout(); } catch { /* ignore */ }
    await clearToken();
    setUser(null);
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

    await setToken(token);
    try {
      const res = await fetch('https://api.airthreads.ai/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        await clearToken();
        handledToken = null; // release the guard so a retry can run
        return false;
      }
      setUser(data.user);
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

  async function googleLogin() {
    try {
      const redirectUri = Linking.createURL('/auth/callback');
      console.log('[Auth] Google OAuth redirect URI:', redirectUri);
      const authUrl = `https://api.airthreads.ai/api/auth/google?redirect_uri=${encodeURIComponent(redirectUri)}`;
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);
      console.log('[Auth] OAuth result type:', result.type);

      if (result.type === 'success' && result.url) {
        const url = result.url;
        console.log('[Auth] OAuth success URL (first 100):', url.slice(0, 100));
        const tokenMatch = url.match(/[?&]token=([^&#]+)/);
        const authMatch = url.match(/[?&]auth=([^&#]+)/);
        const token = tokenMatch ? decodeURIComponent(tokenMatch[1]) : null;
        const authParam = authMatch ? authMatch[1] : null;
        console.log('[Auth] Token present:', !!token, 'authParam:', authParam);

        if (token) {
          await setToken(token);
          const dobRequired = /[?&]needsDob=1/.test(url);
          // Verify by calling /auth/me with the token directly (avoids SecureStore async race)
          try {
            const res = await fetch('https://api.airthreads.ai/api/auth/me', {
              headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json().catch(() => ({}));
            console.log('[Auth] /auth/me status:', res.status, 'user:', data?.user?.email);
            if (!res.ok) {
              await clearToken();
              Alert.alert('Sign In Failed', `Verification failed (${res.status}: ${data.error ?? 'unknown'}). Please try again.`);
            } else {
              setUser(data.user);
              if (dobRequired) setNeedsDobCheck(true);
            }
          } catch (err: any) {
            // Network error — still store token, let user proceed
            console.log('[Auth] /auth/me network error, attempting to continue:', err?.message);
            Alert.alert('Sign In Failed', `Network error during verification. Please check connection and try again.`);
            await clearToken();
          }
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
        console.log('[Auth] browser dismissed — waiting briefly for the deep link');
        await new Promise(r => setTimeout(r, 2500));
        if (!handledToken) {
          console.log('[Auth] no deep link arrived after dismiss — treating as cancelled');
        }
      } else {
        Alert.alert('Sign In Failed', `Unexpected result: ${result.type}. Please try again.`);
      }
    } catch (err: any) {
      console.log('[Auth] Google OAuth error:', err?.message);
      Alert.alert('Sign In Failed', err?.message || 'Could not complete Google sign-in.');
    }
  }

  async function appleLogin() {
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      const res = await fetch('https://api.airthreads.ai/api/auth/apple', {
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
        return;
      }

      if (data.token) await setToken(data.token);
      setUser(data.user);
      if (data.needsDobCheck) setNeedsDobCheck(true);
    } catch (err: any) {
      if (err?.code === 'ERR_REQUEST_CANCELED') return; // user dismissed sheet
      console.log('[Auth] Apple sign-in error:', err?.message);
      Alert.alert('Sign In Failed', err?.message || 'Could not complete Apple sign-in.');
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, needsDobCheck, clearDobCheck, login, register, verifyEmail, resendVerification, logout, googleLogin, appleLogin, refreshUser, completeAuthCallback }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
