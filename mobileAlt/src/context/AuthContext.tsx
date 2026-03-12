import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { Alert } from 'react-native';
import { authApi, getToken, setToken, clearToken } from '../lib/api';

WebBrowser.maybeCompleteAuthSession();

export interface AuthUser {
  id: string;
  name: string | null;
  email: string | null;
  tier: string;
  heightCm?: number | null;
  weightKg?: number | null;
  trainingAge?: string | null;
  equipment?: string | null;
  constraintsText?: string | null;
  coachGoal?: string | null;
  coachBudget?: string | null;
  coachOnboardingDone?: boolean;
  coachProfile?: string | null;
  savedProgram?: string | null;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string, dateOfBirth?: string) => Promise<void>;
  logout: () => Promise<void>;
  googleLogin: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

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

  async function login(email: string, password: string) {
    const data = await authApi.login(email, password);
    if (data.token) await setToken(data.token);
    setUser(data.user);
  }

  async function register(name: string, email: string, password: string, dateOfBirth?: string) {
    const data = await authApi.register(name, email, password, dateOfBirth);
    if (data.token) await setToken(data.token);
    setUser(data.user);
  }

  async function logout() {
    try { await authApi.logout(); } catch { /* ignore */ }
    await clearToken();
    setUser(null);
  }

  async function googleLogin() {
    try {
      const redirectUri = Linking.createURL('/auth/callback');
      console.log('[Auth] Google OAuth redirect URI:', redirectUri);
      const authUrl = `https://api.airthreads.ai:4009/api/auth/google?redirect_uri=${encodeURIComponent(redirectUri)}`;
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);
      console.log('[Auth] OAuth result type:', result.type);

      if (result.type === 'success' && result.url) {
        const url = result.url;
        console.log('[Auth] OAuth success URL (first 100):', url.slice(0, 100));
        const tokenMatch = url.match(/[?&]token=([^&]+)/);
        const authMatch = url.match(/[?&]auth=([^&]+)/);
        const token = tokenMatch ? decodeURIComponent(tokenMatch[1]) : null;
        const authParam = authMatch ? authMatch[1] : null;
        console.log('[Auth] Token present:', !!token, 'authParam:', authParam);

        if (token) {
          await setToken(token);
          // Verify by calling /auth/me with the token directly (avoids SecureStore async race)
          try {
            const res = await fetch('https://api.airthreads.ai:4009/api/auth/me', {
              headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json().catch(() => ({}));
            console.log('[Auth] /auth/me status:', res.status, 'user:', data?.user?.email);
            if (!res.ok) {
              await clearToken();
              Alert.alert('Sign In Failed', `Verification failed (${res.status}: ${data.error ?? 'unknown'}). Please try again.`);
            } else {
              setUser(data.user);
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
        // User cancelled — no alert needed
      } else {
        Alert.alert('Sign In Failed', `Unexpected result: ${result.type}. Please try again.`);
      }
    } catch (err: any) {
      console.log('[Auth] Google OAuth error:', err?.message);
      Alert.alert('Sign In Failed', err?.message || 'Could not complete Google sign-in.');
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, googleLogin, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
