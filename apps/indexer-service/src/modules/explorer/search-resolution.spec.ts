import { describe, expect, it, vi } from 'vitest';
import { resolveIndexedSearch, type IndexedSearchLookup } from './search-resolution.js';
const hash = `0x${'a'.repeat(64)}`, address = `0x${'b'.repeat(40)}`;
function lookup(): IndexedSearchLookup { return { blockNumber: vi.fn(async value => value), transaction: vi.fn(async () => false), blockHash: vi.fn(async () => null), addressKind: vi.fn(async () => null) }; }
describe('indexed search', () => {
  it('normalizes a block number without floating point conversion', async () => { expect(await resolveIndexedSearch('09007199254740993', lookup())).toEqual({ type: 'block', value: '9007199254740993', destination: '/blocks/9007199254740993' }); });
  it('finds a block hash when it is not a transaction hash', async () => { const data = lookup(); data.blockHash = async () => '10000'; expect((await resolveIndexedSearch(hash.toUpperCase().replace('0X', '0x'), data))?.destination).toBe('/blocks/10000'); });
  it('prefers an indexed transaction over a matching block hash', async () => { const data = lookup(); data.transaction = async () => true; expect((await resolveIndexedSearch(hash, data))?.type).toBe('transaction'); expect(data.blockHash).not.toHaveBeenCalled(); });
  it.each(['token', 'contract', 'address'] as const)('uses indexed %s classification', async type => { const data = lookup(); data.addressKind = async () => type; expect((await resolveIndexedSearch(address, data))?.destination).toBe(`/${type}/${address}`); });
  it('does not invent a destination for an unknown address', async () => { expect(await resolveIndexedSearch(address, lookup())).toBeNull(); });
  it.each([undefined, ['1', '2'], '', '-1', '1e3', '//evil.example', '9'.repeat(100)])('rejects invalid query %j before database lookup', async value => { const data = lookup(); await expect(resolveIndexedSearch(value, data)).rejects.toThrow(); expect(data.blockNumber).not.toHaveBeenCalled(); });
});
