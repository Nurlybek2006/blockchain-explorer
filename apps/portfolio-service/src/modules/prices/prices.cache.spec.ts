import { ConfigService } from '@nestjs/config';
import { RedisCacheClient } from '@blockchain-explorer/messaging';
import type { AssetPriceResponse } from '@blockchain-explorer/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeCachedPrice, PricesCache } from './prices.cache.js';

function price(): AssetPriceResponse {
  return {
    assetKey: 'native:eth', tokenAddress: null, coinGeckoId: 'ethereum', symbol: 'ETH',
    priceUsd: '1234.123456789012345678', change24hPercent: '-1.2', marketCapUsd: '10000000000.12',
    fetchedAt: new Date().toISOString(), availability: 'available', stale: false,
  };
}

describe('price cache validation and resilience', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('rejects cached numbers, other asset keys and inconsistent availability', () => {
    const expected = price();
    expect(decodeCachedPrice(expected, 'native:eth')).toEqual(expected);
    expect(decodeCachedPrice({ ...price(), priceUsd: 1234 }, 'native:eth')).toBeNull();
    expect(decodeCachedPrice({ ...price(), priceUsd: '9'.repeat(21) }, 'native:eth')).toBeNull();
    expect(decodeCachedPrice({ ...price(), priceUsd: '0.1234567890123456789' }, 'native:eth')).toBeNull();
    expect(decodeCachedPrice({ ...price(), availability: 'unavailable' }, 'native:eth')).toBeNull();
    expect(decodeCachedPrice(price(), `erc20:0x${'a'.repeat(40)}`)).toBeNull();
    expect(decodeCachedPrice({ ...price(), fetchedAt: 'invalid' }, 'native:eth')).toBeNull();
    expect(decodeCachedPrice({ ...price(), tokenAddress: `0x${'a'.repeat(40)}` }, 'native:eth')).toBeNull();
  });

  it('treats Redis failure as a cache miss and tolerates writes failing', async () => {
    const client = new RedisCacheClient({ url: 'redis://localhost:6379' });
    vi.spyOn(client, 'getJson').mockRejectedValue(new Error('Redis unavailable'));
    vi.spyOn(client, 'setJson').mockRejectedValue(new Error('Redis unavailable'));
    const cache = new PricesCache(client, new ConfigService());
    expect(await cache.get('native:eth')).toBeNull();
    await expect(cache.set(price())).resolves.toBeUndefined();
  });

  it('uses bounded TTL and recomputes stale status as source data ages', async () => {
    const client = new RedisCacheClient({ url: 'redis://localhost:6379' });
    const old = { ...price(), fetchedAt: new Date(Date.now() - 301_000).toISOString() };
    vi.spyOn(client, 'getJson').mockResolvedValue(old);
    const set = vi.spyOn(client, 'setJson').mockResolvedValue();
    const cache = new PricesCache(client, new ConfigService());
    expect((await cache.get('native:eth'))?.stale).toBe(true);
    const fresh = price();
    await cache.set(fresh);
    expect(set).toHaveBeenCalledWith('price:native:eth', fresh, 30);
  });

  it('bounds a Redis request that is waiting to reconnect', async () => {
    vi.useFakeTimers();
    const client = new RedisCacheClient({ url: 'redis://localhost:6379' });
    vi.spyOn(client, 'getJson').mockImplementation(() => new Promise<never>(() => {}));
    const cache = new PricesCache(client, new ConfigService({ PRICE_CACHE_TIMEOUT_MS: 10 }));
    const result = cache.get('native:eth');
    await vi.advanceTimersByTimeAsync(10);
    expect(await result).toBeNull();
  });
});
