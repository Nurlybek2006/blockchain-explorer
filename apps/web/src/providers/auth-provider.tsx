'use client';
import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import type { AuthLoginInput, AuthRegisterInput } from '@blockchain-explorer/contracts/browser';
import { browserSession, sessionStorageKey, sessionUserKey } from '@/lib/auth/browser-session';
import { initialSession, type SessionSnapshot } from '@/lib/auth/session';
interface AuthContextValue extends SessionSnapshot {
  login(input: AuthLoginInput): Promise<void>; register(input: AuthRegisterInput): Promise<void>;
  logout(): Promise<void>; logoutAll(): Promise<void>; refresh(): Promise<string | null>;
}
const AuthContext = createContext<AuthContextValue | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const session = useSyncExternalStore(browserSession.subscribe, browserSession.getSnapshot, () => initialSession);
  useEffect(() => {
    void browserSession.restore();
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || (event.key === sessionStorageKey && event.newValue === null)) browserSession.clear();
      else if (event.key === sessionUserKey && event.newValue && event.newValue !== browserSession.getUserId()) void browserSession.syncFromStorage();
    };
    window.addEventListener('storage', onStorage); return () => window.removeEventListener('storage', onStorage);
  }, []);
  return <AuthContext.Provider value={{ ...session, login: browserSession.login, register: browserSession.register,
    logout: browserSession.logout, logoutAll: browserSession.logoutAll, refresh: browserSession.refresh }}>{children}</AuthContext.Provider>;
}
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext); if (!value) throw new Error('AuthProvider is required'); return value;
}
