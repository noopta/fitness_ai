import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Platform, Alert } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { authApi, loadToken, setToken, AuthUser } from '@/lib/api';

const API_BASE_URL = 'https://api.airthreads.ai:4009/api';

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string, dateOfBirth?: string) => Promise<void>;
  googleLogin: () => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  async function refreshUser() {
    try {
      const data = await authApi.me();
      setUser(data.user);
    } catch {
      setUser(null);
    }
  }

  useEffect(() => {
    loadToken()
      .then(() => refreshUser())
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const data = await authApi.login(email, password);
    setUser(data.user);
  }

  async function register(name: string, email: string, password: string, dateOfBirth?: string) {
    const data = await authApi.register(name, email, password, dateOfBirth);
    setUser(data.user);
  }

  async function googleLogin() {
    try {
      const redirectUri = Linking.createURL('/auth/callback');
      const authUrl = `${API_BASE_URL}/auth/google?redirect_uri=${encodeURIComponent(redirectUri)}`;
      if (Platform.OS === 'web') {
        window.location.href = `${API_BASE_URL}/auth/google`;
      } else {
        const result = await WebBrowser.openAuthSessionAsync(
          authUrl,
          redirectUri
        );
        if (result.type === 'success' && result.url) {
          const url = new URL(result.url);
          const token = url.searchParams.get('token');
          if (token) {
            await setToken(token);
            await refreshUser();
          } else {
            const authError = url.searchParams.get('auth');
            if (authError === 'error') {
              Alert.alert('Sign In Failed', 'Google sign-in failed. Please try again.');
            }
          }
        } else if (result.type === 'cancel') {
          // User cancelled — no error needed
        }
      }
    } catch (err: any) {
      Alert.alert('Sign In Failed', err?.message || 'Could not complete Google sign-in.');
    }
  }

  async function logout() {
    await authApi.logout();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, googleLogin, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
