import { authApi } from '@/lib/api/auth.api';
import { setAuthAdapter } from '@/lib/api/client';
import { SessionController } from './session';
export const sessionStorageKey = 'blockchain-explorer.refresh-token';
export const sessionUserKey = 'blockchain-explorer.session-user';
const storage = {
  get: () => localStorage.getItem(sessionStorageKey), set: (token: string, userId?: string) => { localStorage.setItem(sessionStorageKey, token); if (userId) localStorage.setItem(sessionUserKey, userId); },
  remove: () => { localStorage.removeItem(sessionStorageKey); localStorage.removeItem(sessionUserKey); },
};
async function withSessionLock<T>(run: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request('blockchain-explorer.session', run);
  return run();
}
export const browserSession = new SessionController(authApi, storage, withSessionLock);
setAuthAdapter(browserSession);
