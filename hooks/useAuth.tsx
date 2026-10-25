'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import type { AuthUser } from '@/types';

const TOKEN_STORAGE_KEY = 'zzcs_auth_token_v1';

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (
    username: string,
    password: string
  ) => Promise<{ ok: boolean; message: string }>;
  register: (
    username: string,
    password: string,
    nickname?: string
  ) => Promise<{ ok: boolean; message: string }>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
  authFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function setStoredToken(token: string | null) {
  if (typeof window === 'undefined') return;
  try {
    if (token) {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const authFetch = useCallback(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const currentToken = token || getStoredToken();
      const headers = new Headers(init.headers || {});
      if (currentToken && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${currentToken}`);
      }
      return fetch(input, {
        ...init,
        headers,
        credentials: 'include',
      });
    },
    [token]
  );

  const refreshSession = useCallback(async () => {
    try {
      const savedToken = getStoredToken();
      if (savedToken) setToken(savedToken);

      const headers: Record<string, string> = {};
      if (savedToken) {
        headers.Authorization = `Bearer ${savedToken}`;
      }

      const res = await fetch('/api/auth/session', {
        headers,
        credentials: 'include',
        cache: 'no-store',
      });
      const json = await res.json();
      if (json?.data?.user) {
        setUser(json.data.user);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  const login = useCallback(async (username: string, password: string) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password }),
      });
      const json = await res.json();
      if (json.code === 200 && json.data?.user) {
        const newToken = json.data.token || null;
        setToken(newToken);
        setStoredToken(newToken);
        setUser(json.data.user);
        return { ok: true, message: '登录成功' };
      }
      return { ok: false, message: json.message || '账号或密码错误' };
    } catch {
      return { ok: false, message: '网络异常，请重试' };
    }
  }, []);

  const register = useCallback(
    async (username: string, password: string, nickname?: string) => {
      try {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            username,
            password,
            nickname: nickname || undefined,
          }),
        });
        const json = await res.json();
        if (json.code === 200 && json.data?.user) {
          const newToken = json.data.token || null;
          setToken(newToken);
          setStoredToken(newToken);
          setUser(json.data.user);
          return { ok: true, message: '注册成功' };
        }
        return { ok: false, message: json.message || '注册失败' };
      } catch {
        return { ok: false, message: '网络异常，请重试' };
      }
    },
    []
  );

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // ignore
    }
    setStoredToken(null);
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        login,
        register,
        logout,
        refreshSession,
        authFetch,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
