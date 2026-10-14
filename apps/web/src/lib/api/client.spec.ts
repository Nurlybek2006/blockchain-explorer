import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { apiRequest, ApiError, decodeEmpty, errorMessage, mapHttpError, setAuthAdapter, withQuery } from './client';
import { readString } from './fields';
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); setAuthAdapter({ getAccessToken: () => null, refresh: async () => null, clear: () => {} }); });
describe('API boundary', () => {
  it('encodes query values and omits undefined fields', () => { expect(withQuery('/blocks', { page: 2, q: 'a & b', unset: undefined })).toBe('/blocks?page=2&q=a+%26+b'); });
  it('hides server error bodies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('postgresql://secret sql stack trace', { status: 503 })));
    await expect(apiRequest('/stats', { decode: readString })).rejects.toMatchObject({ status: 503, message: 'The service is temporarily unavailable. Please try again.' });
  });
  it('maps malformed JSON to a safe contract error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{broken')));
    await expect(apiRequest('/stats', { decode: readString })).rejects.toMatchObject({ status: 502, code: 'invalid_json' });
  });
  it('rejects a structurally incorrect successful response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ internal: 'private' })));
    await expect(apiRequest('/stats', { decode: readString })).rejects.toMatchObject({ status: 502, code: 'contract' });
  });
  it('handles a no-content mutation', async () => { vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 }))); expect(await apiRequest('/portfolio/id', { method: 'DELETE', decode: decodeEmpty })).toBeUndefined(); });
  it('retries a 401 once with the rotated token', async () => {
    let token = 'old'; const refresh = vi.fn(async () => { token = 'new'; return token; }); const clear = vi.fn();
    setAuthAdapter({ getAccessToken: () => token, refresh, clear });
    const send = vi.fn(async () => send.mock.calls.length === 1 ? new Response(null, { status: 401 }) : Response.json('ok'));
    vi.stubGlobal('fetch', send); expect(await apiRequest('/users/me', { decode: readString, authenticated: true })).toBe('ok');
    expect(refresh).toHaveBeenCalledTimes(1); expect(send).toHaveBeenCalledTimes(2);
  });
  it('clears the session after the retry also receives 401', async () => {
    const clear = vi.fn(); setAuthAdapter({ getAccessToken: () => 'old', refresh: async () => 'new', clear });
    const send = vi.fn(async () => new Response(null, { status: 401 })); vi.stubGlobal('fetch', send);
    await expect(apiRequest('/users/me', { decode: readString, authenticated: true })).rejects.toMatchObject({ status: 401 }); expect(clear).toHaveBeenCalledTimes(1); expect(send).toHaveBeenCalledTimes(2);
  });
  it('does not retry a mutation under a different account after refresh', async () => {
    let user = 'user-1'; const clear = vi.fn();
    setAuthAdapter({ getAccessToken: () => 'old', getUserId: () => user, refresh: async () => { user = 'user-2'; return 'new'; }, clear });
    const send = vi.fn(async () => new Response(null, { status: 401 })); vi.stubGlobal('fetch', send);
    await expect(apiRequest('/portfolio', { method: 'POST', body: { name: 'Personal' }, decode: readString, authenticated: true })).rejects.toMatchObject({ code: 'account_changed' });
    expect(send).toHaveBeenCalledTimes(1); expect(clear).not.toHaveBeenCalled();
  });
  it('does not send protected requests without a restored session', async () => {
    const send = vi.fn(); vi.stubGlobal('fetch', send); await expect(apiRequest('/users/me', { decode: readString, authenticated: true })).rejects.toMatchObject({ status: 401 }); expect(send).not.toHaveBeenCalled();
  });
  it('does not expose arbitrary Error messages', () => { expect(errorMessage(new Error('SQL password'))).not.toContain('SQL'); expect(mapHttpError(409)).toBeInstanceOf(ApiError); });
  it('rejects external request paths before transmitting credentials', async () => { await expect(apiRequest('//evil.example', { decode: readString })).rejects.toMatchObject({ code: 'invalid_path' }); });
  it('keeps the deadline active while an actual HTTP response body stalls', async () => {
    const server = createServer((_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.flushHeaders(); response.write('"'); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Invalid test listener');
    vi.stubEnv('NEXT_PUBLIC_API_URL', `http://127.0.0.1:${address.port}`);
    try { await expect(apiRequest('/slow', { decode: readString, timeoutMs: 100 })).rejects.toMatchObject({ code: 'timeout' }); }
    finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
});
