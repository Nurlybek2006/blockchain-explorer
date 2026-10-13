import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isAssetKey, type AssetPriceResponse } from '@blockchain-explorer/contracts';
import type { RedisCacheClient } from '@blockchain-explorer/messaging';
import { isStoredDecimal } from './price-decimal.js';
import { loadPricesConfig, type PricesConfig } from './prices.config.js';

export const PRICES_REDIS_CLIENT = Symbol('PRICES_REDIS_CLIENT');

@Injectable()
export class PricesCache implements OnModuleDestroy {
  private readonly options: PricesConfig;

  constructor(
    @Inject(PRICES_REDIS_CLIENT) private readonly client: Pick<RedisCacheClient, 'getJson' | 'setJson' | 'close'>,
    config: ConfigService,
  ) {
    this.options = loadPricesConfig(config);
  }

  async get(assetKey: string): Promise<AssetPriceResponse | null> {
    try {
      const value = await deadline(this.client.getJson<unknown>(`price:${assetKey}`), this.options.cacheTimeoutMs);
      const decoded = decodeCachedPrice(value, assetKey);
      if (!decoded) return null;
      return { ...decoded, stale: decoded.stale || isPriceStale(decoded.fetchedAt, this.options.staleAfterSeconds) };
    } catch {
      return null;
    }
  }

  async set(price: AssetPriceResponse): Promise<void> {
    try {
      const ttl = price.availability === 'unavailable' ? this.options.unavailableCacheTtlSeconds : this.options.cacheTtlSeconds;
      await deadline(this.client.setJson(`price:${price.assetKey}`, price, ttl), this.options.cacheTimeoutMs);
    } catch {
      // Database storage remains authoritative when Redis cannot be reached.
    }
  }

  async onModuleDestroy(): Promise<void> {
    try { await deadline(this.client.close(), this.options.cacheTimeoutMs); } catch { /* Cache is optional at shutdown. */ }
  }
}

export function isPriceStale(fetchedAt: string | null, staleAfterSeconds: number, now = Date.now()): boolean {
  return fetchedAt !== null && now - Date.parse(fetchedAt) > staleAfterSeconds * 1_000;
}

export function decodeCachedPrice(value: unknown, assetKey: string): AssetPriceResponse | null {
  if (typeof value !== 'object' || value === null ||
    !('assetKey' in value) || value.assetKey !== assetKey || !isAssetKey(value.assetKey) ||
    !('tokenAddress' in value) || !(typeof value.tokenAddress === 'string' || value.tokenAddress === null) ||
    !('coinGeckoId' in value) || !(typeof value.coinGeckoId === 'string' || value.coinGeckoId === null) ||
    !('symbol' in value) || !(typeof value.symbol === 'string' || value.symbol === null) ||
    !('priceUsd' in value) || !(isStoredDecimal(value.priceUsd, 38, 18) || value.priceUsd === null) ||
    !('change24hPercent' in value) || !(isStoredDecimal(value.change24hPercent, 20, 8, true) || value.change24hPercent === null) ||
    !('marketCapUsd' in value) || !(isStoredDecimal(value.marketCapUsd, 38, 2) || value.marketCapUsd === null) ||
    !('fetchedAt' in value) || !(typeof value.fetchedAt === 'string' || value.fetchedAt === null) ||
    !('availability' in value) || !(value.availability === 'available' || value.availability === 'unavailable') ||
    !('stale' in value) || typeof value.stale !== 'boolean') return null;
  if ((value.availability === 'available') !== (value.priceUsd !== null) ||
    (value.availability === 'available' && value.fetchedAt === null) ||
    (value.availability === 'unavailable' && (value.fetchedAt !== null || value.change24hPercent !== null || value.marketCapUsd !== null || value.stale)) ||
    (value.coinGeckoId !== null && value.coinGeckoId.length > 255) ||
    (value.symbol !== null && value.symbol.length > 64) ||
    (value.fetchedAt !== null && (!Number.isFinite(Date.parse(value.fetchedAt)) || Date.parse(value.fetchedAt) > Date.now() + 60_000)) ||
    value.tokenAddress !== (assetKey === 'native:eth' ? null : assetKey.slice(6))) return null;
  return {
    assetKey: value.assetKey, tokenAddress: value.tokenAddress, coinGeckoId: value.coinGeckoId,
    symbol: value.symbol, priceUsd: value.priceUsd, change24hPercent: value.change24hPercent,
    marketCapUsd: value.marketCapUsd, fetchedAt: value.fetchedAt, availability: value.availability, stale: value.stale,
  };
}

async function deadline<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Price cache timed out')), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}
