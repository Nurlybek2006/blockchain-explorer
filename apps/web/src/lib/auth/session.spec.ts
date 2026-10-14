import { describe, expect, it, vi } from 'vitest';
import type { AuthResponse } from '@blockchain-explorer/contracts/browser';
import { SessionController, type SessionStorage, type SessionTransport } from './session';
function response(index = 1): AuthResponse { return { user: { id: 'user-1', email: 'alice@example.com', role: 'user', displayName: null,
  createdAt: '2026-10-14T00:00:00Z', lastLoginAt: null }, accessToken: `access-${index}`, refreshToken: `refresh-${index}`, accessTokenExpiresIn: 900 }; }
function fixture() {
  let token: string | null = 'previous';
  const storage: SessionStorage = { get: () => token, set: value => { token = value; }, remove: () => { token = null; } };
  const transport: SessionTransport = { login: vi.fn(async () => response()), register: vi.fn(async () => response()),
    refresh: vi.fn(async () => response()), logout: vi.fn(async () => {}), logoutAll: vi.fn(async () => {}) };
  return { controller: new SessionController(transport, storage), storage, transport };
}
describe('session rotation', () => {
  it('coalesces simultaneous refreshes and persists only the rotated refresh token', async () => {
    const { controller, storage, transport } = fixture();
    const values = await Promise.all([controller.refresh(), controller.refresh(), controller.refresh()]);
    expect(values).toEqual(['access-1', 'access-1', 'access-1']); expect(transport.refresh).toHaveBeenCalledTimes(1);
    expect(storage.get()).toBe('refresh-1'); expect(controller.getSnapshot().status).toBe('authenticated');
  });
  it('clears all local credentials after rejected restore', async () => {
    const { controller, storage, transport } = fixture(); vi.mocked(transport.refresh).mockRejectedValue(new Error('revoked'));
    await controller.restore(); expect(storage.get()).toBeNull(); expect(controller.getAccessToken()).toBeNull(); expect(controller.getSnapshot().user).toBeNull();
  });
  it('does not resurrect a logged out session from a delayed refresh', async () => {
    const { controller, storage, transport } = fixture(); let finish: (value: AuthResponse) => void = () => {};
    vi.mocked(transport.refresh).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = controller.refresh(); controller.clear(); finish(response());
    expect(await pending).toBeNull(); expect(storage.get()).toBeNull(); expect(controller.getSnapshot().status).toBe('anonymous');
  });
  it('restores without making a refresh request when no token is stored', async () => {
    const { controller, storage, transport } = fixture(); storage.remove(); await controller.restore();
    expect(transport.refresh).not.toHaveBeenCalled(); expect(controller.getSnapshot().status).toBe('anonymous');
  });
  it('keeps an in-memory session usable when browser storage is denied', async () => {
    const { transport } = fixture(); const denied: SessionStorage = { get: () => { throw new Error('denied'); }, set: () => { throw new Error('denied'); }, remove: () => { throw new Error('denied'); } };
    const controller = new SessionController(transport, denied); await controller.login({ email: 'alice@example.com', password: 'password1' });
    expect(await controller.refresh()).toBe('access-1'); expect(controller.getSnapshot().status).toBe('authenticated');
  });
  it('clears local state even when the server logout request fails', async () => {
    const { controller, storage, transport } = fixture(); await controller.restore(); vi.mocked(transport.logout).mockRejectedValue(new Error('offline'));
    await expect(controller.logout()).rejects.toThrow('offline'); expect(storage.get()).toBeNull(); expect(controller.getAccessToken()).toBeNull();
  });
  it('serializes two tabs and reads the latest stored refresh token inside the lock', async () => {
    const { storage, transport } = fixture(); let tail = Promise.resolve(); let index = 0;
    const lock = <T>(run: () => Promise<T>): Promise<T> => { const result = tail.then(run); tail = result.then(() => {}, () => {}); return result; };
    vi.mocked(transport.refresh).mockImplementation(async () => response(++index));
    const first = new SessionController(transport, storage, lock), second = new SessionController(transport, storage, lock);
    await Promise.all([first.refresh(), second.refresh()]);
    expect(transport.refresh).toHaveBeenNthCalledWith(1, 'previous'); expect(transport.refresh).toHaveBeenNthCalledWith(2, 'refresh-1'); expect(storage.get()).toBe('refresh-2');
  });
  it('clears the previous identity immediately when another tab signs into a different account', async () => {
    const { controller, storage, transport } = fixture(); await controller.restore(); storage.set('different-account');
    let finish: (value: AuthResponse) => void = () => {};
    vi.mocked(transport.refresh).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = controller.syncFromStorage(); expect(controller.getSnapshot()).toEqual({ user: null, status: 'loading' }); expect(controller.getAccessToken()).toBeNull();
    const different = response(2); different.user.id = 'user-2'; finish(different); await pending;
    expect(controller.getUserId()).toBe('user-2'); expect(transport.refresh).toHaveBeenLastCalledWith('different-account');
  });
});
