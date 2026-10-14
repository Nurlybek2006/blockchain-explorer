import type { AuthLoginInput, AuthRegisterInput, AuthResponse, AuthUserProfileResponse } from '@blockchain-explorer/contracts/browser';

export interface SessionSnapshot { user: AuthUserProfileResponse | null; status: 'loading' | 'authenticated' | 'anonymous'; }
export interface SessionStorage { get(): string | null; set(token: string, userId?: string): void; remove(): void; }
export interface SessionTransport {
  login(input: AuthLoginInput): Promise<AuthResponse>; register(input: AuthRegisterInput): Promise<AuthResponse>;
  refresh(token: string): Promise<AuthResponse>; logout(token: string): Promise<void>; logoutAll(): Promise<void>;
}
export const initialSession: SessionSnapshot = { user: null, status: 'loading' };
export class SessionController {
  private snapshot: SessionSnapshot = initialSession;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private refreshPromise: Promise<string | null> | null = null;
  private generation = 0;
  private storageAvailable = true;
  private listeners = new Set<() => void>();
  constructor(private transport: SessionTransport, private storage: SessionStorage,
    private lock: <T>(run: () => Promise<T>) => Promise<T> = run => run()) {}
  getSnapshot = (): SessionSnapshot => this.snapshot;
  getAccessToken = (): string | null => this.accessToken;
  getUserId = (): string | null => this.snapshot.user?.id ?? null;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private emit(snapshot: SessionSnapshot): void { this.snapshot = snapshot; for (const listener of this.listeners) listener(); }
  private storedToken(): string | null {
    try { return this.storageAvailable ? this.storage.get() : this.refreshToken; }
    catch { this.storageAvailable = false; return this.refreshToken; }
  }
  private accept(response: AuthResponse): void {
    this.accessToken = response.accessToken; this.refreshToken = response.refreshToken;
    try { this.storage.set(response.refreshToken, response.user.id); } catch { this.storageAvailable = false; }
    this.emit({ user: response.user, status: 'authenticated' });
  }
  clear = (): void => {
    this.generation++; this.accessToken = null; this.refreshToken = null;
    try { this.storage.remove(); } catch { this.storageAvailable = false; }
    this.emit({ user: null, status: 'anonymous' });
  };
  refresh = (): Promise<string | null> => {
    if (this.refreshPromise) return this.refreshPromise;
    const generation = this.generation;
    this.refreshPromise = this.lock(async () => {
      const token = this.storedToken();
      if (!token || generation !== this.generation) { if (generation === this.generation) this.clear(); return null; }
      try {
        const response = await this.transport.refresh(token);
        if (generation !== this.generation) return null;
        this.accept(response); return response.accessToken;
      } catch { if (generation === this.generation) this.clear(); return null; }
    }).finally(() => { this.refreshPromise = null; });
    return this.refreshPromise;
  };
  restore = async (): Promise<void> => { await this.refresh(); };
  syncFromStorage = async (): Promise<void> => {
    const generation = ++this.generation; this.accessToken = null; this.refreshToken = null;
    this.emit({ user: null, status: 'loading' });
    // Let a superseded refresh settle before initiating the new account's restore.
    if (this.refreshPromise) await this.refreshPromise;
    if (generation === this.generation) await this.refresh();
  };
  login = async (input: AuthLoginInput): Promise<void> => {
    const generation = ++this.generation;
    await this.lock(async () => { const response = await this.transport.login(input); if (generation === this.generation) this.accept(response); });
  };
  register = async (input: AuthRegisterInput): Promise<void> => {
    const generation = ++this.generation;
    await this.lock(async () => { const response = await this.transport.register(input); if (generation === this.generation) this.accept(response); });
  };
  logout = async (): Promise<void> => {
    const token = this.storedToken(); this.clear();
    if (token) await this.lock(() => this.transport.logout(token));
  };
  logoutAll = async (): Promise<void> => { try { await this.transport.logoutAll(); } finally { this.clear(); } };
}
