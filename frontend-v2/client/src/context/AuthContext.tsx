import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';
const AUTH_BASE = API_BASE.replace(/\/api$/, '');

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
  coachProfile?: string | null; // JSON blob of full onboarding answers
  savedProgram?: string | null; // Saved AI-generated training program JSON
  programStartDate?: string | null;
  institutions?: InstitutionMembership[];
}

// Server-owned feature flags from /auth/me. Defaults are all-false so a failed
// fetch leaves gated features dark rather than flickering them on.
export interface AuthFeatures {
  onboardingFormHook: boolean;
  diagnosticFirstOnboarding: boolean;
}

export const DEFAULT_FEATURES: AuthFeatures = {
  onboardingFormHook: false,
  diagnosticFirstOnboarding: false,
};

function normalizeFeatures(raw: any): AuthFeatures {
  return {
    onboardingFormHook: raw?.onboardingFormHook === true,
    diagnosticFirstOnboarding: raw?.diagnosticFirstOnboarding === true,
  };
}

/**
 * Where a just-authenticated user should land. Users who haven't finished the
 * coach intake cold-start in the legacy diagnostic flow when the server's
 * diagnostic-first flag is on; everyone else lands on the coach dashboard.
 */
export function postAuthDestination(
  user: Pick<AuthUser, 'coachOnboardingDone'> | null | undefined,
  features: AuthFeatures
): '/onboarding' | '/coach' {
  return !user?.coachOnboardingDone && features.diagnosticFirstOnboarding
    ? '/onboarding'
    : '/coach';
}

// Returned by register() when EMAIL_VERIFICATION_ENABLED is on server-side:
// the account exists but is unverified, and the caller must route to the
// verify-email screen instead of into the app. `codeSent: false` means the
// mail provider refused the send — the UI should point at Resend.
export interface PendingVerification {
  requiresVerification: true;
  email: string;
  codeSent?: boolean;
}

interface AuthContextType {
  user: AuthUser | null;
  features: AuthFeatures;
  loading: boolean;
  login: (email: string, password: string) => Promise<PendingVerification | null>;
  register: (name: string, email: string, password: string, dateOfBirth?: string, referralCode?: string) => Promise<PendingVerification | null>;
  verifyEmail: (email: string, code: string) => Promise<void>;
  resendVerification: (email: string) => Promise<{ sent: boolean; reason?: string; cooldownRemainingSec?: number }>;
  logout: () => Promise<void>;
  googleLogin: () => void;
  // Resolves with what /auth/me returned so callers can route on fresh data
  // instead of waiting for the async state update to land.
  refreshUser: () => Promise<{ user: AuthUser | null; features: AuthFeatures }>;
}

const AuthContext = createContext<AuthContextType | null>(null);

async function apiFetch(path: string, options?: RequestInit) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>)
  };
  // Use stored Bearer token as fallback when cross-domain cookie is blocked
  const bearerToken = sessionStorage.getItem('liftoff_bearer_token');
  if (bearerToken) {
    headers['Authorization'] = `Bearer ${bearerToken}`;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || `API error: ${res.status}`);
  }
  return res.json();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [features, setFeatures] = useState<AuthFeatures>(DEFAULT_FEATURES);
  const [loading, setLoading] = useState(true);

  async function refreshUser() {
    try {
      const data = await apiFetch('/auth/me');
      const nextFeatures = normalizeFeatures(data.features);
      setUser(data.user);
      setFeatures(nextFeatures);
      return { user: (data.user ?? null) as AuthUser | null, features: nextFeatures };
    } catch {
      setUser(null);
      setFeatures(DEFAULT_FEATURES);
      return { user: null, features: DEFAULT_FEATURES };
    }
  }

  useEffect(() => {
    refreshUser().finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string): Promise<PendingVerification | null> {
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    // Unverified account: the server re-sends a code (cooldown-respecting)
    // and issues no session. Route to /verify-email instead of setting a
    // bogus user.
    if (data?.requiresVerification) {
      return { requiresVerification: true, email: data.email ?? email };
    }
    setUser(data.user);
    return null;
  }

  async function register(name: string, email: string, password: string, dateOfBirth?: string, referralCode?: string): Promise<PendingVerification | null> {
    const data = await apiFetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password, dateOfBirth, ...(referralCode ? { referralCode } : {}) })
    });
    // Server has email verification on: the account exists but there is no
    // session yet — hand the pending state back so the page can route to
    // /verify-email. (Covers both the fresh 202 and the "existing unverified
    // email re-registered" 200, which share this response shape.)
    if (data?.requiresVerification) {
      return { requiresVerification: true, email: data.email ?? email, codeSent: data.codeSent };
    }
    setUser(data.user);
    return null;
  }

  async function verifyEmail(email: string, code: string) {
    const data = await apiFetch('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ email, code })
    });
    // Same Bearer fallback the OAuth callback uses — Safari ITP / Firefox ETP
    // can block the cross-domain cookie, and this session was just minted.
    if (data.token) sessionStorage.setItem('liftoff_bearer_token', data.token);
    setUser(data.user);
  }

  async function resendVerification(email: string) {
    return apiFetch('/auth/resend-verification', {
      method: 'POST',
      body: JSON.stringify({ email })
    });
  }

  async function logout() {
    await apiFetch('/auth/logout', { method: 'POST' });
    sessionStorage.removeItem('liftoff_bearer_token');
    setUser(null);
    setFeatures(DEFAULT_FEATURES);
  }

  function googleLogin() {
    window.location.href = `${AUTH_BASE}/api/auth/google`;
  }

  return (
    <AuthContext.Provider value={{ user, features, loading, login, register, verifyEmail, resendVerification, logout, googleLogin, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
