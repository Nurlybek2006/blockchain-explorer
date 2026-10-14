import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import type { AssetPriceResponse } from '@blockchain-explorer/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoinGeckoClient, CoinGeckoPrice } from './coingecko.client.js';
import type { PricesCache } from './prices.cache.js';
import type { PriceRecord, PricesRepository } from './prices.repository.js';
import { PricesService, unavailablePrice } from './prices.service.js';

type Store = Pick<PricesRepository, 'find' | 'findMany' | 'findSymbol' | 'save' | 'markUnavailable' | 'getActiveAssetKeys'>;
const assetKey = 'native:eth';

function record(): PriceRecord {
  return {
    assetKey, tokenAddress: null, coinGeckoId: 'ethereum', symbol: 'ETH',
    usdPrice: '1234.123456789012345678', change24hPercent: '-1.2', marketCapUsd: '10000000000.12', fetchedAt: new Date(),
  };
}

describe('PricesService cache, storage and downstream refresh', () => {
  let repository: Store;
  let provider: Pick<CoinGeckoClient, 'fetchPrice'>;
  let cache: Pick<PricesCache, 'get' | 'set'>;
  let service: PricesService;
  let fetched: CoinGeckoPrice;

  beforeEach(() => {
    const price = record();
    fetched = { priceUsd: price.usdPrice, change24hPercent: price.change24hPercent, marketCapUsd: price.marketCapUsd, fetchedAt: price.fetchedAt };
    repository = {
      find: vi.fn<Store['find']>().mockResolvedValue(null),
      findMany: vi.fn<Store['findMany']>().mockResolvedValue([]),
      findSymbol: vi.fn<Store['findSymbol']>().mockResolvedValue('ETH'),
      save: vi.fn<Store['save']>().mockResolvedValue(price),
      markUnavailable: vi.fn<Store['markUnavailable']>().mockResolvedValue(null),
      getActiveAssetKeys: vi.fn<Store['getActiveAssetKeys']>().mockResolvedValue([assetKey]),
    };
    provider = { fetchPrice: vi.fn<CoinGeckoClient['fetchPrice']>().mockResolvedValue(fetched) };
    cache = { get: vi.fn<PricesCache['get']>().mockResolvedValue(null), set: vi.fn<PricesCache['set']>().mockResolvedValue() };
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    service = new PricesService(repository, provider, cache, new ConfigService());
  });

  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('batches unique cold assets into one DB lookup while preserving input order and exact decimals', async () => {
    const tokenKey = `erc20:0x${'a'.repeat(40)}`;
    const native = record(); const token = { ...native, assetKey: tokenKey, tokenAddress: `0x${'a'.repeat(40)}`, symbol: 'TC' };
    vi.mocked(repository.findMany).mockResolvedValue([native, token]);
    const prices = await service.getPrices([tokenKey, assetKey, tokenKey]);
    expect(prices.map((price) => price.assetKey)).toEqual([tokenKey, assetKey, tokenKey]);
    expect(prices.every((price) => price.priceUsd === native.usdPrice)).toBe(true);
    expect(repository.findMany).toHaveBeenCalledExactlyOnceWith([tokenKey, assetKey]);
    expect(repository.find).not.toHaveBeenCalled(); expect(provider.fetchPrice).not.toHaveBeenCalled();
    expect(cache.get).toHaveBeenCalledTimes(2); expect(cache.set).toHaveBeenCalledTimes(2);
  });

  it('keeps cached values and schedules stale or missing keys without blocking on providers', async () => {
    const missing = `erc20:0x${'b'.repeat(40)}`;
    const cached = { ...unavailablePrice(assetKey), availability: 'available' as const, priceUsd: '42', fetchedAt: new Date().toISOString(), stale: true };
    vi.mocked(cache.get).mockImplementation(async (key) => key === assetKey ? cached : null);
    const schedule = vi.fn<(key: string) => Promise<void>>().mockResolvedValue(); service.setRefreshScheduler(schedule);
    expect(await service.getPrices([assetKey, missing, assetKey])).toEqual([cached, unavailablePrice(missing), cached]);
    expect(repository.findMany).toHaveBeenCalledExactlyOnceWith([missing]);
    await Promise.resolve(); expect(schedule).toHaveBeenCalledTimes(2); expect(provider.fetchPrice).not.toHaveBeenCalled();
  });

  it('validates every bulk asset before accessing cache or storage', async () => {
    await expect(service.getPrices([assetKey, 'invalid'])).rejects.toThrow('Invalid asset key');
    expect(cache.get).not.toHaveBeenCalled(); expect(repository.findMany).not.toHaveBeenCalled();
    expect(await service.getPrices([])).toEqual([]);
  });

  it('serves a valid Redis value without querying DB or provider', async () => {
    const cached: AssetPriceResponse = { ...unavailablePrice(assetKey), priceUsd: '42.123456789012345678', fetchedAt: new Date().toISOString(), availability: 'available' };
    vi.mocked(cache.get).mockResolvedValue(cached);
    expect(await service.getPrice(assetKey)).toEqual(cached);
    expect(repository.find).not.toHaveBeenCalled();
    expect(provider.fetchPrice).not.toHaveBeenCalled();
  });

  it('uses DB when Redis misses/fails and caches exact stored strings', async () => {
    const stored = record();
    vi.mocked(repository.find).mockResolvedValue(stored);
    const price = await service.getPrice(assetKey);
    expect(price.priceUsd).toBe(stored.usdPrice);
    expect(price.availability).toBe('available');
    expect(cache.set).toHaveBeenCalledWith(price);
    expect(provider.fetchPrice).not.toHaveBeenCalled();
  });

  it('returns unavailable immediately and requests deduplicated BullMQ refreshes after TTL', async () => {
    vi.useFakeTimers();
    const schedule = vi.fn<(key: string) => Promise<void>>().mockResolvedValue();
    service.setRefreshScheduler(schedule);
    expect(await service.getPrice(assetKey)).toMatchObject({ priceUsd: null, fetchedAt: null, availability: 'unavailable' });
    expect(await service.getPrice(assetKey)).toMatchObject({ priceUsd: null, availability: 'unavailable' });
    expect(schedule).toHaveBeenCalledExactlyOnceWith(assetKey);
    expect(provider.fetchPrice).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    await service.getPrice(assetKey);
    expect(schedule).toHaveBeenCalledTimes(2);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('serves stale DB data while scheduling refresh, without calling provider inside HTTP reads', async () => {
    const stored = { ...record(), fetchedAt: new Date(Date.now() - 301_000) };
    vi.mocked(repository.find).mockResolvedValue(stored);
    const schedule = vi.fn<(key: string) => Promise<void>>().mockResolvedValue();
    service.setRefreshScheduler(schedule);
    expect(await service.getPrice(assetKey)).toMatchObject({ priceUsd: stored.usdPrice, stale: true });
    expect(schedule).toHaveBeenCalledWith(assetKey);
    expect(provider.fetchPrice).not.toHaveBeenCalled();
  });

  it('never starts direct provider work if bootstrap has not bound the scheduler', async () => {
    expect((await service.getPrice(assetKey)).priceUsd).toBeNull();
    expect(provider.fetchPrice).not.toHaveBeenCalled();
  });

  it('contains a transient enqueue failure and retries on a later read', async () => {
    const schedule = vi.fn<(key: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('Redis unavailable')).mockResolvedValue();
    service.setRefreshScheduler(schedule);
    expect((await service.getPrice(assetKey)).availability).toBe('unavailable');
    await Promise.resolve();
    await Promise.resolve();
    expect((await service.getPrice(assetKey)).availability).toBe('unavailable');
    expect(schedule).toHaveBeenCalledTimes(2);
    expect(provider.fetchPrice).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent forced refreshes and notifies after durable storage', async () => {
    const events: string[] = [];
    vi.mocked(repository.save).mockImplementation(async () => { events.push('stored'); return record(); });
    service.subscribe(async () => { events.push('listener'); });
    const first = service.refreshAsset(assetKey);
    expect(service.refreshAsset(assetKey)).toBe(first);
    const response = await first;
    expect(events).toEqual(['stored', 'listener']);
    expect(repository.save).toHaveBeenCalledWith({ ...fetched, assetKey, tokenAddress: null, coinGeckoId: 'ethereum', symbol: 'ETH' });
    expect(response.priceUsd).toBe(fetched.priceUsd);
    expect(provider.fetchPrice).toHaveBeenCalledOnce();
  });

  it('preserves the stored row as explicitly stale on an external failure', async () => {
    const stored = record();
    vi.mocked(repository.find).mockResolvedValue(stored);
    vi.mocked(provider.fetchPrice).mockRejectedValue(new Error('HTTP 429'));
    const listener = vi.fn<(price: AssetPriceResponse) => Promise<void>>().mockResolvedValue();
    service.subscribe(listener);
    expect(await service.refreshAsset(assetKey)).toMatchObject({ priceUsd: stored.usdPrice, availability: 'available', stale: true });
    expect(repository.save).not.toHaveBeenCalled();
    expect(repository.markUnavailable).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it('clears authoritative missing current prices, keeps null and never inserts zero', async () => {
    const stored = record();
    vi.mocked(repository.find).mockResolvedValue(stored);
    vi.mocked(provider.fetchPrice).mockResolvedValue(null);
    expect(await service.refreshAsset(assetKey)).toMatchObject({ priceUsd: null, availability: 'unavailable' });
    expect(repository.markUnavailable).toHaveBeenCalledWith(assetKey, expect.any(Date), stored);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('propagates persistence and postcommit listener failures without fabricating unavailability', async () => {
    vi.mocked(repository.save).mockRejectedValueOnce(new Error('Database transaction failed'));
    await expect(service.refreshAsset(assetKey)).rejects.toThrow('Database transaction failed');
    expect(cache.set).not.toHaveBeenCalled();

    const otherListener = vi.fn<(price: AssetPriceResponse) => Promise<void>>().mockResolvedValue();
    service.subscribe(async () => { throw new Error('Alert DB transaction failed'); });
    service.subscribe(otherListener);
    await expect(service.refreshAsset(assetKey)).rejects.toBeInstanceOf(AggregateError);
    expect(otherListener).toHaveBeenCalledOnce();
    expect(cache.set).toHaveBeenCalledWith(expect.objectContaining({ availability: 'available', priceUsd: fetched.priceUsd }));
    vi.mocked(repository.find).mockResolvedValue(record());
    expect((await service.getPrice(assetKey)).availability).toBe('available');
  });

  it('replays unchanged prices for alert retry and unsubscribe removes listeners', async () => {
    const listener = vi.fn<(price: AssetPriceResponse) => Promise<void>>().mockResolvedValue();
    const unsubscribe = service.subscribe(listener);
    await service.refreshAsset(assetKey);
    await service.refreshAsset(assetKey);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    await service.refreshAsset(assetKey);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('adopts a later holding symbol after a token was first priced through a watchlist', async () => {
    const tokenAddress = `0x${'a'.repeat(40)}`;
    const tokenKey = `erc20:${tokenAddress}`;
    let stored: PriceRecord | null = null;
    let discoveredSymbol: string | null = null;
    vi.mocked(repository.find).mockImplementation(async () => stored);
    vi.mocked(repository.findSymbol).mockImplementation(async () => discoveredSymbol);
    vi.mocked(repository.save).mockImplementation(async (input) => {
      stored = {
        assetKey: input.assetKey, tokenAddress: input.tokenAddress, coinGeckoId: input.coinGeckoId,
        symbol: input.symbol ?? stored?.symbol ?? 'UNKNOWN', usdPrice: input.priceUsd,
        change24hPercent: input.change24hPercent, marketCapUsd: input.marketCapUsd, fetchedAt: input.fetchedAt,
      };
      return stored;
    });
    expect((await service.refreshAsset(tokenKey)).symbol).toBeNull();
    discoveredSymbol = 'UNIT';
    expect((await service.refreshAsset(tokenKey)).symbol).toBe('UNIT');
    discoveredSymbol = 'OTHER';
    const final = await service.refreshAsset(tokenKey);
    expect(final.symbol).toBe('UNIT');
    expect(final.priceUsd).toBe(fetched.priceUsd);
    expect(repository.findSymbol).toHaveBeenCalledTimes(2);
  });
});
