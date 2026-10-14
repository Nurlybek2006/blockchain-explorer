import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IndexerExplorerClient } from './indexer-explorer.client.js';
const hash = `0x${'a'.repeat(64)}`;
const client = () => new IndexerExplorerClient(new ConfigService({ INDEXER_INTERNAL_URL: 'http://indexer:3001', INTERNAL_SERVICE_TOKEN: 'test-internal-secret' }));
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => vi.unstubAllGlobals());
describe('Indexer advanced Explorer HTTP boundary', () => {
  it('uses internal HTTP with redirects forbidden and forwards only decoded public fields', async () => {
    const data = { type: 'transaction', value: hash, destination: `/tx/${hash}` };
    fetchMock.mockResolvedValue(Response.json({ ...data, internalServiceToken: 'private' }));
    expect(await client().search(hash)).toEqual(data);
    const call = fetchMock.mock.calls[0];
    expect(String(call?.[0])).toBe(`http://indexer:3001/internal/explorer/search?q=${hash}`);
    expect(call?.[1]).toMatchObject({ redirect: 'error', headers: { 'x-internal-service-token': 'test-internal-secret' } });
  });
  it('rejects successful upstream responses with unsafe search destinations', async () => {
    fetchMock.mockResolvedValue(Response.json({ type: 'transaction', value: hash, destination: 'https://evil.test' }));
    await expect(client().search(hash)).rejects.toThrow('invalid response');
  });
  it.each([400, 404, 500, 503])('sanitizes upstream HTTP %i error bodies', async (status) => {
    fetchMock.mockResolvedValue(Response.json({ message: 'postgres://private-secret sql passwordHash' }, { status }));
    try { await client().getContract(`0x${'b'.repeat(40)}`); throw new Error('Expected request rejection'); }
    catch (error) { expect(String(error)).not.toContain('private-secret'); expect(String(error)).not.toContain('passwordHash'); }
  });
  it('sanitizes network errors and URL/credential disclosure', async () => {
    fetchMock.mockRejectedValue(new Error('http://user:private-secret@indexer')); await expect(client().getNetworkStatus()).rejects.toThrow('Indexer service unavailable');
  });
  it('rejects oversized upstream responses before reading or forwarding their body', async () => {
    fetchMock.mockResolvedValue(new Response('private', { headers: { 'content-length': String(17 * 1024 * 1024) } }));
    await expect(client().getNetworkStatus()).rejects.toThrow('response exceeds the supported size');
  });
});
