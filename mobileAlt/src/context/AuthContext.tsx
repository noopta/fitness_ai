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
      const authUrl = `https://api.airthreads.ai:4009/api/auth/google?redirect_uri=${encodeURIComponent(redirectUri)}`;
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);

      if (result.type === 'success' && result.url) {
        // Manually extract token from URL to handle Expo Go exp:// and axiom:// schemes
        const url = result.url;
        const tokenMatch = url.match(/[?&]token=([^&]+)/);
        const authMatch = url.match(/[?&]auth=([^&]+)/);
        const token = tokenMatch ? decodeURIComponent(tokenMatch[1]) : null;
        const authParam = authMatch ? authMatch[1] : null;

        if (token) {
          await setToken(token);
          await refreshUser();
        } else if (authParam === 'error') {
          Alert.alert('Sign In Failed', 'Google sign-in failed. Please try again.');
        }
      }
    } catch (err: any) {
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
