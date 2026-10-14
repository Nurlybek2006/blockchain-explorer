import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import type { RealtimeExplorerEvent } from '@blockchain-explorer/contracts';
const redis = vi.hoisted(() => ({ connect: vi.fn(), ping: vi.fn(), close: vi.fn(), getJson: vi.fn(), setJson: vi.fn(), delete: vi.fn(), deletePrefix: vi.fn() }));
vi.mock('@blockchain-explorer/messaging', () => ({ RedisCacheClient: class { connect = redis.connect; ping = redis.ping; close = redis.close; getJson = redis.getJson; setJson = redis.setJson; delete = redis.delete; deletePrefix = redis.deletePrefix; }, checkDependency: async (fn: () => Promise<unknown>) => { try { await fn(); return true; } catch { return false; } } }));
import { CacheService } from './cache.service.js';

const blockEvent: RealtimeExplorerEvent = { id: 'block', type: 'block.indexed', occurredAt: '2026-10-14T00:00:00.000Z', payload: { chainId: 11155111, networkName: 'sepolia', blockNumber: '42', blockHash: `0x${'a'.repeat(64)}`, parentHash: `0x${'b'.repeat(64)}`, timestamp: '2026-10-14T00:00:00.000Z', transactionCount: 1, logCount: 0, tokenTransferCount: 0 } };
function service() { return new CacheService(new ConfigService({ REDIS_URL: 'redis://test' })); }
beforeEach(() => { vi.clearAllMocks(); redis.connect.mockResolvedValue(undefined); redis.ping.mockResolvedValue('PONG'); redis.getJson.mockResolvedValue(null); redis.setJson.mockResolvedValue(undefined); redis.delete.mockResolvedValue(undefined); redis.deletePrefix.mockResolvedValue(undefined); });
afterEach(() => { vi.useRealTimers(); });

describe('Explorer event cache invalidation', () => {
  it('invalidates stats/status and all first-page limit variants while preserving historical pagination', async () => {
    const cache = service(); await cache.onModuleInit(); await cache.invalidateExplorer(blockEvent);
    expect(redis.delete.mock.calls).toEqual([['explorer:stats'], ['explorer:network-status']]);
    expect(redis.deletePrefix.mock.calls).toEqual([['explorer:blocks:1:']]);
  });
  it('targets only transfer-related token/address resources', async () => {
    const cache = service(); await cache.onModuleInit();
    const event: RealtimeExplorerEvent = { id: 'transfer', type: 'token.transfer.indexed', occurredAt: blockEvent.occurredAt, payload: { chainId: 11155111, networkName: 'sepolia', blockNumber: '42', transactionHash: `0x${'a'.repeat(64)}`, transactionIndex: 0, logIndex: 0, tokenAddress: 'token', fromAddress: 'from', toAddress: 'to', amountRaw: '1' } };
    await cache.invalidateExplorer(event);
    expect(redis.deletePrefix.mock.calls).toEqual([['explorer:token:token:'], ['explorer:address:from:'], ['explorer:address:to:']]);
  });
  it('invalidates the complete Explorer namespace on reorg', async () => {
    const cache = service(); await cache.onModuleInit();
    await cache.invalidateExplorer({ id: 'reorg', type: 'chain.reorganized', occurredAt: blockEvent.occurredAt, payload: { chainId: 11155111, networkName: 'sepolia', detectedAtBlock: '42', commonAncestorBlock: '40', commonAncestorHash: null } });
    expect(redis.deletePrefix).toHaveBeenCalledWith('explorer:');
  });
  it('does not repopulate stale data from an in-flight read after invalidation', async () => {
    const cache = service(); await cache.onModuleInit();
    let finish: ((value: string) => void) | undefined;
    const result = cache.remember('explorer:block:42', 60, () => new Promise<string>((resolve) => { finish = resolve; }));
    await vi.waitFor(() => expect(finish).toBeDefined());
    await cache.invalidateExplorer(blockEvent);
    if (!finish) throw new Error('Expected in-flight factory'); finish('old-block');
    expect(await result).toBe('old-block'); expect(redis.setJson).not.toHaveBeenCalled();
  });
  it('fails open after invalidation failure and clears stale keys before recovery', async () => {
    const cache = service(); await cache.onModuleInit(); redis.deletePrefix.mockRejectedValueOnce(new Error('Redis unavailable'));
    await cache.invalidateExplorer(blockEvent); redis.getJson.mockResolvedValue('stale');
    expect(await cache.remember('explorer:block:42', 60, async () => 'fresh')).toBe('fresh');
    expect(redis.getJson).not.toHaveBeenCalled();
    await cache.ping(); expect(redis.deletePrefix).toHaveBeenLastCalledWith('explorer:');
  });
  it('validates new typed responses when reading cached JSON', async () => {
    const cache = service(); await cache.onModuleInit(); redis.getJson.mockResolvedValue({ privateKey: 'secret' });
    const decode = (value: unknown) => { if (typeof value !== 'string') throw new Error('Invalid cached response'); return value; };
    expect(await cache.remember('explorer:contract:x', 10, async () => 'validated', decode)).toBe('validated');
  });
});
