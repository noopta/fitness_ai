import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { authApi, loadToken, setToken, AuthUser } from '@/lib/api';

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string, dateOfBirth?: string) => Promise<void>;
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

  async function logout() {
    await authApi.logout();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
