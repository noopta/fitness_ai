import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';
const AUTH_BASE = API_BASE.replace(/\/api$/, '');

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
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string, dateOfBirth?: string) => Promise<void>;
  logout: () => Promise<void>;
  googleLogin: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options?.headers }
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || `API error: ${res.status}`);
  }
  return res.json();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  async function refreshUser() {
    try {
      const data = await apiFetch('/auth/me');
      setUser(data.user);
    } catch {
      setUser(null);
    }
  }

  useEffect(() => {
    refreshUser().finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    setUser(data.user);
  }

  async function register(name: string, email: string, password: string, dateOfBirth?: string) {
    const data = await apiFetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password, dateOfBirth })
    });
    setUser(data.user);
  }

  async function logout() {
    await apiFetch('/auth/logout', { method: 'POST' });
    setUser(null);
  }

  function googleLogin() {
    window.location.href = `${AUTH_BASE}/api/auth/google`;
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
