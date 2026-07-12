import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { clearAuthToken, readAuthToken, writeAuthToken } from "../api/auth-storage.ts";
import { api, setUnauthorizedHandler } from "../api/client.ts";
import type { User } from "../types.ts";

type AuthResponse = {
  user: User;
  token: string;
};

type AuthContextValue = {
  user: User | null;
  bootstrapping: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (displayName: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: User | null) => void;
  clearSession: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);

  const clearSession = useCallback(() => {
    clearAuthToken();
    setUser(null);
  }, []);

  const bootstrap = useCallback(async () => {
    try {
      if (!readAuthToken()) {
        setUser(null);
        return;
      }
      const { user: me } = await api<{ user: User }>("/v1/me");
      setUser(me);
    } catch {
      clearSession();
    } finally {
      setBootstrapping(false);
    }
  }, [clearSession]);

  useEffect(() => {
    setUnauthorizedHandler(() => clearSession());
    void bootstrap();
    return () => setUnauthorizedHandler(null);
  }, [bootstrap, clearSession]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api<AuthResponse>("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    writeAuthToken(result.token);
    setUser(result.user);
  }, []);

  const register = useCallback(
    async (displayName: string, email: string, password: string) => {
      const result = await api<AuthResponse>("/v1/auth/register", {
        method: "POST",
        body: JSON.stringify({ displayName, email, password }),
      });
      writeAuthToken(result.token);
      setUser(result.user);
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await api<void>("/v1/auth/logout", { method: "POST" });
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const value = useMemo(
    () => ({ user, bootstrapping, login, register, logout, setUser, clearSession }),
    [user, bootstrapping, login, register, logout, clearSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
