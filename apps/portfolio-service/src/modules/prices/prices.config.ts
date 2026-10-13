import { ConfigService } from '@nestjs/config';

export interface PricesConfig {
  baseUrl: string;
  apiKey: string | undefined;
  apiKeyType: 'demo' | 'pro';
  timeoutMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  maxRetryDelayMs: number;
  concurrency: number;
  requestsPerSecond: number;
  cacheTtlSeconds: number;
  unavailableCacheTtlSeconds: number;
  staleAfterSeconds: number;
  cacheTimeoutMs: number;
}

export function loadPricesConfig(config: ConfigService): PricesConfig {
  const apiKeyType = config.get<string>('COINGECKO_API_KEY_TYPE') ?? 'demo';
  if (apiKeyType !== 'demo' && apiKeyType !== 'pro') {
    throw new Error('COINGECKO_API_KEY_TYPE must be demo or pro');
  }
  const baseUrl = config.get<string>('COINGECKO_BASE_URL') ??
    (apiKeyType === 'pro' ? 'https://pro-api.coingecko.com/api/v3' : 'https://api.coingecko.com/api/v3');
  const parsed = new URL(baseUrl);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('COINGECKO_BASE_URL must be an HTTP(S) URL without credentials, query or fragment');
  }
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiKey: config.get<string>('COINGECKO_API_KEY')?.trim() || undefined,
    apiKeyType,
    timeoutMs: bounded(config, 'COINGECKO_TIMEOUT_MS', 10_000, 100, 60_000),
    maxRetries: bounded(config, 'COINGECKO_MAX_RETRIES', 4, 0, 6),
    retryBaseDelayMs: bounded(config, 'COINGECKO_RETRY_BASE_DELAY_MS', 500, 1, 10_000),
    maxRetryDelayMs: bounded(config, 'COINGECKO_MAX_RETRY_DELAY_MS', 60_000, 1, 300_000),
    concurrency: bounded(config, 'COINGECKO_MAX_CONCURRENT_REQUESTS', 2, 1, 10),
    requestsPerSecond: bounded(config, 'COINGECKO_REQUESTS_PER_SECOND', 0.3, 0.01, 20, false),
    cacheTtlSeconds: bounded(config, 'PRICE_CACHE_TTL_SECONDS', 30, 1, 3_600),
    unavailableCacheTtlSeconds: bounded(config, 'PRICE_UNAVAILABLE_CACHE_TTL_SECONDS', 30, 1, 300),
    staleAfterSeconds: bounded(config, 'PRICE_STALE_AFTER_SECONDS', 300, 30, 86_400),
    cacheTimeoutMs: bounded(config, 'PRICE_CACHE_TIMEOUT_MS', 750, 10, 5_000),
  };
}

function bounded(config: ConfigService, name: string, fallback: number, min: number, max: number, integer = true): number {
  const value = Number(config.get(name) ?? fallback);
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new Error(`${name} must be ${integer ? 'an integer' : 'a number'} between ${min} and ${max}`);
  }
  return value;
}
