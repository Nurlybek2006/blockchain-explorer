import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parse } from 'lossless-json';
import { isEthereumAddress } from '@blockchain-explorer/contracts';
import { loadPricesConfig, type PricesConfig } from './prices.config.js';
import { normalizePriceDecimal } from './price-decimal.js';
import { PriceRequestLimiter } from './price-request-limiter.js';
import { recordCounter, recordHistogram, withSpan, type Span } from '@blockchain-explorer/observability';

export interface CoinGeckoPrice {
  priceUsd: string;
  change24hPercent: string | null;
  marketCapUsd: string | null;
  fetchedAt: Date;
}

export class CoinGeckoHttpError extends Error {
  constructor(readonly status: number, readonly retryAfterMs: number | null) {
    super(`CoinGecko HTTP ${status}`);
    this.name = 'CoinGeckoHttpError';
  }
}

@Injectable()
export class CoinGeckoClient implements OnModuleDestroy {
  private readonly logger = new Logger(CoinGeckoClient.name);
  private readonly options: PricesConfig;
  private readonly limiter: PriceRequestLimiter;
  private readonly controllers = new Set<AbortController>();
  private closing = false;

  constructor(config: ConfigService) {
    this.options = loadPricesConfig(config);
    this.limiter = new PriceRequestLimiter(this.options.concurrency, this.options.requestsPerSecond);
  }

  async fetchPrice(assetKey: string): Promise<CoinGeckoPrice | null> {
    const address = assetKey.startsWith('erc20:') ? assetKey.slice(6) : null;
    if (assetKey !== 'native:eth' && !isEthereumAddress(address)) return null;
    const url = new URL(`${this.options.baseUrl}/${address ? 'simple/token_price/ethereum' : 'simple/price'}`);
    url.searchParams.set(address ? 'contract_addresses' : 'ids', address?.toLowerCase() ?? 'ethereum');
    url.searchParams.set('vs_currencies', 'usd');
    url.searchParams.set('include_market_cap', 'true');
    url.searchParams.set('include_24hr_change', 'true');
    url.searchParams.set('include_last_updated_at', 'true');
    url.searchParams.set('precision', 'full');
    const raw = await this.request(url);
    return decodeCoinGeckoPrice(raw, address?.toLowerCase() ?? 'ethereum');
  }

  onModuleDestroy(): void {
    this.closing = true;
    this.limiter.close();
    for (const controller of this.controllers) controller.abort();
  }

  private async request(url: URL): Promise<string> {
    for (let attempt = 0; ; attempt += 1) {
      if (this.closing) throw new Error('Price client is closing');
      try {
        return await this.limiter.schedule(() => this.fetchOnce(url, attempt));
      } catch (error) {
        const retryable = !(error instanceof CoinGeckoHttpError) || error.status === 429 || error.status >= 500;
        if (!retryable || this.closing || attempt >= this.options.maxRetries) throw error;
        const backoff = Math.min(this.options.retryBaseDelayMs * 2 ** attempt, this.options.maxRetryDelayMs);
        const jitter = Math.floor(Math.random() * Math.max(1, Math.ceil(backoff / 4)));
        const retryAfter = error instanceof CoinGeckoHttpError ? error.retryAfterMs ?? 0 : 0;
        const delay = Math.max(Math.min(backoff + jitter, this.options.maxRetryDelayMs), retryAfter);
        this.limiter.coolDown(delay);
        // Respect long provider cooldowns instead of retrying early indefinitely.
        if (delay > this.options.maxRetryDelayMs) throw error;
        this.logger.warn(`CoinGecko retry ${attempt + 1}/${this.options.maxRetries}: ${error instanceof CoinGeckoHttpError ? `HTTP ${error.status}` : 'request failed'}, cooldown ${delay} ms`);
      }
    }
  }

  private async fetchOnce(url: URL, attempt: number): Promise<string> {
    return withSpan('coingecko.request', {
      'http.request.method': 'GET',
      'retry.attempt': attempt,
      'coingecko.operation': url.pathname.endsWith('/simple/price') ? 'native_price' : 'token_price',
    }, (span) => this.fetchRequest(url, span));
  }

  private async fetchRequest(url: URL, span: Span): Promise<string> {
    const started = performance.now();
    let status = 'transport_error';
    recordCounter('coingecko_requests_total', 1, { method: 'GET' });
    const controller = new AbortController();
    this.controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.options.apiKey) headers[`x-cg-${this.options.apiKeyType}-api-key`] = this.options.apiKey;
    try {
      const response = await fetch(url, { headers, signal: controller.signal });
      span.setAttribute('http.response.status_code', response.status);
      if (!response.ok) {
        status = response.status === 429 ? 'rate_limited' : response.status >= 500 ? 'server_error' : 'client_error';
        const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
        if (response.status === 429) this.limiter.coolDown(retryAfterMs ?? this.options.retryBaseDelayMs);
        await response.body?.cancel();
        throw new CoinGeckoHttpError(response.status, retryAfterMs);
      }
      const raw = await response.text();
      if (raw.length > 1_048_576) throw new Error('CoinGecko response is too large');
      status = 'success';
      return raw;
    } catch (error) {
      recordCounter('coingecko_errors_total', 1, { status });
      throw error;
    } finally {
      recordHistogram('coingecko_duration_seconds', (performance.now() - started) / 1000, { status });
      clearTimeout(timer);
      this.controllers.delete(controller);
    }
  }
}

export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  if (/^\d+(?:\.\d+)?$/.test(value.trim())) {
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds <= 86_400 ? Math.ceil(seconds * 1_000) : null;
  }
  const date = Date.parse(value);
  return Number.isFinite(date) && date - now <= 86_400_000 ? Math.max(0, date - now) : null;
}

export function decodeCoinGeckoPrice(raw: string, key: string, now = new Date()): CoinGeckoPrice | null {
  // lossless-json passes every JSON number's original lexeme to this parser.
  const payload: unknown = parse(raw, undefined, (numberText: string) => numberText);
  if (typeof payload !== 'object' || payload === null || !(key in payload)) return null;
  const entry: unknown = Reflect.get(payload, key);
  if (typeof entry !== 'object' || entry === null || !('usd' in entry) || entry.usd === null) return null;
  const priceUsd = normalizePriceDecimal(entry.usd, 38, 18);
  if (priceUsd === null) return null;
  const change24hPercent = 'usd_24h_change' in entry ? normalizePriceDecimal(entry.usd_24h_change, 20, 8, true) : null;
  const marketCapUsd = 'usd_market_cap' in entry ? normalizePriceDecimal(entry.usd_market_cap, 38, 2) : null;
  let fetchedAt = now;
  if ('last_updated_at' in entry && typeof entry.last_updated_at === 'string' && /^\d+$/.test(entry.last_updated_at)) {
    const milliseconds = Number(entry.last_updated_at) * 1_000;
    if (Number.isSafeInteger(milliseconds) && milliseconds > 0 && milliseconds <= now.getTime() + 60_000) {
      fetchedAt = new Date(milliseconds);
    }
  }
  return { priceUsd, change24hPercent, marketCapUsd, fetchedAt };
}
