import { BadRequestException, Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleDestroy } from '@nestjs/common';
import { recordCounter, withSpan, recordSpanError, type Span } from '@blockchain-explorer/observability';
import { ConfigService } from '@nestjs/config';
import { normalizeAssetKey, type AssetPriceResponse } from '@blockchain-explorer/contracts';
import { CoinGeckoClient } from './coingecko.client.js';
import { PricesCache, isPriceStale } from './prices.cache.js';
import { loadPricesConfig, type PricesConfig } from './prices.config.js';
import { PricesRepository, type PriceRecord } from './prices.repository.js';

type PriceListener = (price: AssetPriceResponse) => Promise<void>;
type PriceStore = Pick<PricesRepository, 'find' | 'findMany' | 'findSymbol' | 'save' | 'markUnavailable' | 'getActiveAssetKeys'>;

@Injectable()
export class PricesService implements OnModuleDestroy, OnApplicationShutdown {
  private readonly logger = new Logger(PricesService.name);
  private readonly options: PricesConfig;
  private readonly pending = new Map<string, Promise<AssetPriceResponse>>();
  private readonly listeners = new Set<PriceListener>();
  private readonly refreshRequests = new Map<string, Promise<void>>();
  private readonly requestedUntil = new Map<string, number>();
  private refreshScheduler: ((assetKey: string) => Promise<void>) | undefined;
  private stopping = false;

  constructor(
    @Inject(PricesRepository) private readonly repository: PriceStore,
    @Inject(CoinGeckoClient) private readonly provider: Pick<CoinGeckoClient, 'fetchPrice'>,
    @Inject(PricesCache) private readonly cache: Pick<PricesCache, 'get' | 'set'>,
    config: ConfigService,
  ) {
    this.options = loadPricesConfig(config);
  }

  async getPrice(rawAssetKey: string): Promise<AssetPriceResponse> {
    const assetKey = validatedAssetKey(rawAssetKey);
    const cached = await this.cache.get(assetKey);
    if (cached) {
      if (cached.stale) this.requestRefresh(assetKey);
      return cached;
    }
    const stored = await this.repository.find(assetKey);
    if (stored) {
      const response = serializePrice(stored, this.options.staleAfterSeconds);
      await this.cache.set(response);
      if (response.stale) this.requestRefresh(assetKey);
      return response;
    }
    // Valuation endpoints stay responsive during provider outages. A successful
    // BullMQ fetch becomes visible on the next read and periodic jobs warm it.
    this.requestRefresh(assetKey);
    return unavailablePrice(assetKey);
  }

  async getPrices(assetKeys: readonly string[]): Promise<AssetPriceResponse[]> {
    const normalized = assetKeys.map(validatedAssetKey);
    const keys = [...new Set(normalized)];
    const cached = await Promise.all(keys.map(async (assetKey) => ({ assetKey, price: await this.cache.get(assetKey) })));
    const misses = cached.filter(({ price }) => price === null).map(({ assetKey }) => assetKey);
    // One indexed SQL read for the whole cold portfolio, rather than one per holding.
    const stored = new Map((await this.repository.findMany(misses)).map((price) => [price.assetKey, price]));
    const responses = await Promise.all(cached.map(async ({ assetKey, price }) => {
      if (price) {
        if (price.stale) this.requestRefresh(assetKey);
        return price;
      }
      const record = stored.get(assetKey);
      if (!record) { this.requestRefresh(assetKey); return unavailablePrice(assetKey); }
      const response = serializePrice(record, this.options.staleAfterSeconds);
      await this.cache.set(response);
      if (response.stale) this.requestRefresh(assetKey);
      return response;
    }));
    const byKey = new Map(responses.map((response) => [response.assetKey, response]));
    return normalized.map((key) => {
      const response = byKey.get(key);
      if (!response) throw new Error('Price result is missing');
      return response;
    });
  }

  refreshAsset(rawAssetKey: string): Promise<AssetPriceResponse> {
    const assetKey = validatedAssetKey(rawAssetKey);
    if (this.stopping) return Promise.reject(new Error('Price service is closing'));
    const existing = this.pending.get(assetKey);
    if (existing) return existing;
    if (this.pending.size >= 1_000) return Promise.reject(new Error('Too many pending price refreshes'));
    const refresh = this.refresh(assetKey).finally(() => { this.pending.delete(assetKey); });
    this.pending.set(assetKey, refresh);
    return refresh;
  }

  getActiveAssetKeys(): Promise<string[]> {
    return this.repository.getActiveAssetKeys();
  }

  async refreshActivePrices(): Promise<void> {
    const keys = await this.getActiveAssetKeys();
    const failures: unknown[] = [];
    for (let index = 0; index < keys.length; index += this.options.concurrency) {
      const results = await Promise.allSettled(keys.slice(index, index + this.options.concurrency).map((key) => this.refreshAsset(key)));
      for (const result of results) if (result.status === 'rejected') failures.push(result.reason);
    }
    if (failures.length > 0) throw new AggregateError(failures, 'One or more asset price refreshes failed');
  }

  subscribe(listener: PriceListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  setRefreshScheduler(scheduler: (assetKey: string) => Promise<void>): void {
    this.refreshScheduler = scheduler;
  }

  onModuleDestroy(): void {
    this.stopping = true;
    this.listeners.clear();
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([...this.pending.values(), ...this.refreshRequests.values()]);
  }

  private requestRefresh(assetKey: string): void {
    const scheduler = this.refreshScheduler;
    if (this.stopping || !scheduler) return;
    const now = Date.now();
    for (const [key, until] of this.requestedUntil) if (until <= now) this.requestedUntil.delete(key);
    if (this.refreshRequests.has(assetKey) || (this.requestedUntil.get(assetKey) ?? 0) > now || this.requestedUntil.size >= 1_000) return;
    this.requestedUntil.set(assetKey, now + this.options.cacheTtlSeconds * 1_000);
    const request = Promise.resolve().then(() => scheduler(assetKey)).catch((error: unknown) => {
      this.requestedUntil.delete(assetKey);
      this.logger.warn(`Price refresh scheduling failed for ${assetKey}: ${error instanceof Error ? error.name : 'queue error'}`);
    }).finally(() => { this.refreshRequests.delete(assetKey); });
    this.refreshRequests.set(assetKey, request);
  }

  private async refresh(assetKey: string): Promise<AssetPriceResponse> {
    return withSpan('portfolio.price_refresh', {}, (span) => this.refreshPrice(assetKey, span));
  }

  private async refreshPrice(assetKey: string, span: Span): Promise<AssetPriceResponse> {
    const stored = await this.repository.find(assetKey);
    const observedAt = new Date();
    let fetched;
    try {
      fetched = await this.provider.fetchPrice(assetKey);
    } catch (error) {
      recordSpanError(span, error);
      recordCounter('portfolio_price_refresh_errors_total');
      if (this.stopping) throw error;
      this.logger.warn(`Price provider is unavailable for ${assetKey}: ${error instanceof Error ? error.name : 'provider error'}`);
      const fallback = stored ? { ...serializePrice(stored, this.options.staleAfterSeconds), stale: true } : unavailablePrice(assetKey);
      await this.cache.set(fallback);
      return fallback;
    }
    if (this.stopping) throw new Error('Price service is closing');
    if (!fetched) {
      const remaining = await this.repository.markUnavailable(assetKey, observedAt, stored);
      recordCounter('portfolio_price_refresh_total', 1, { status: 'unavailable' });
      const unavailable = remaining ? serializePrice(remaining, this.options.staleAfterSeconds) : unavailablePrice(assetKey);
      await this.cache.set(unavailable);
      return unavailable;
    }

    const symbol = stored?.symbol && stored.symbol !== 'UNKNOWN'
      ? stored.symbol : await this.repository.findSymbol(assetKey);
    // Provider fallback and post-commit subscriber errors are separate: a failed
    // alert transaction must retry without mislabelling this stored price.
    const saved = await this.repository.save({
      ...fetched,
      assetKey,
      tokenAddress: assetKey === 'native:eth' ? null : assetKey.slice(6),
      coinGeckoId: assetKey === 'native:eth' ? 'ethereum' : stored?.coinGeckoId ?? null,
      symbol,
    });
    // Count the committed price even if a later alert subscriber retries its own transaction.
    recordCounter('portfolio_price_refresh_total', 1, { status: 'success' });
    const response = serializePrice(saved, this.options.staleAfterSeconds);
    await this.cache.set(response);
    if (!response.stale) {
      const results = await Promise.allSettled([...this.listeners].map((listener) => Promise.resolve().then(() => listener(response))));
      const failures: unknown[] = [];
      for (const result of results) if (result.status === 'rejected') failures.push(result.reason);
      if (failures.length > 0) throw new AggregateError(failures, 'Committed price subscribers failed');
    }
    return response;
  }
}

export function serializePrice(price: PriceRecord, staleAfterSeconds: number): AssetPriceResponse {
  const fetchedAt = price.fetchedAt.toISOString();
  return {
    assetKey: price.assetKey, tokenAddress: price.tokenAddress, coinGeckoId: price.coinGeckoId,
    symbol: price.symbol === 'UNKNOWN' ? null : price.symbol,
    priceUsd: price.usdPrice, change24hPercent: price.change24hPercent, marketCapUsd: price.marketCapUsd,
    fetchedAt, availability: 'available', stale: isPriceStale(fetchedAt, staleAfterSeconds),
  };
}

export function unavailablePrice(assetKey: string): AssetPriceResponse {
  return {
    assetKey, tokenAddress: assetKey === 'native:eth' ? null : assetKey.slice(6),
    coinGeckoId: assetKey === 'native:eth' ? 'ethereum' : null,
    symbol: assetKey === 'native:eth' ? 'ETH' : null,
    priceUsd: null, change24hPercent: null, marketCapUsd: null, fetchedAt: null,
    availability: 'unavailable', stale: false,
  };
}

function validatedAssetKey(value: string): string {
  try { return normalizeAssetKey(value); } catch { throw new BadRequestException('Invalid asset key'); }
}
