import type { ConfigService } from '@nestjs/config';

export interface HttpSecurityConfig {
  webOrigin: string;
  bodyLimitBytes: number;
  hsts: boolean;
  trustProxy: false | string[];
  rateLimitEnabled: boolean;
  rateLimitWindowMs: number;
  rateLimitAuthMax: number;
  rateLimitSearchMax: number;
  rateLimitExpensiveMax: number;
  redisTimeoutMs: number;
}

function integer(config: ConfigService, name: string, fallback: number, maximum: number, minimum = 1): number {
  const value = config.get<unknown>(name) ?? fallback;
  if ((typeof value !== 'number' && typeof value !== 'string') || !/^\d+$/.test(String(value))) {
    throw new Error(`${name} must be an integer`);
  }
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return result;
}

function boolean(config: ConfigService, name: string, fallback: boolean): boolean {
  const value = config.get<unknown>(name);
  if (value === undefined) return fallback;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

export function readHttpSecurityConfig(config: ConfigService): HttpSecurityConfig {
  const production = config.get<string>('NODE_ENV') === 'production';
  const rawOrigin = config.get<unknown>('WEB_ORIGIN') ?? (production ? undefined : 'http://localhost:3003');
  if (typeof rawOrigin !== 'string') throw new Error('WEB_ORIGIN is required');
  let origin: URL;
  try { origin = new URL(rawOrigin); } catch { throw new Error('WEB_ORIGIN must be an exact HTTP or HTTPS origin'); }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== rawOrigin || origin.username || origin.password) {
    throw new Error('WEB_ORIGIN must be an exact HTTP or HTTPS origin');
  }
  const rawTrust = config.get<unknown>('TRUST_PROXY') ?? 'false';
  let trustProxy: false | string[] = false;
  if (rawTrust !== false && rawTrust !== 'false') {
    if (typeof rawTrust !== 'string') throw new Error('TRUST_PROXY must be false or explicit trusted network names');
    const networks = rawTrust.split(',').map((value) => value.trim());
    if (networks.length === 0 || networks.some((network) => !['loopback', 'linklocal', 'uniquelocal'].includes(network))) {
      throw new Error('TRUST_PROXY must be false or a list of loopback, linklocal, uniquelocal');
    }
    trustProxy = [...new Set(networks)];
  }
  return {
    webOrigin: rawOrigin, trustProxy,
    bodyLimitBytes: integer(config, 'API_BODY_LIMIT_BYTES', 65_536, 1_048_576, 1_024),
    hsts: production && boolean(config, 'SECURITY_HSTS_ENABLED', false),
    rateLimitEnabled: boolean(config, 'API_RATE_LIMIT_ENABLED', true),
    rateLimitWindowMs: integer(config, 'RATE_LIMIT_WINDOW_MS', 60_000, 3_600_000, 1_000),
    rateLimitAuthMax: integer(config, 'RATE_LIMIT_AUTH_MAX', production ? 20 : 60, 10_000),
    rateLimitSearchMax: integer(config, 'RATE_LIMIT_SEARCH_MAX', 120, 10_000),
    rateLimitExpensiveMax: integer(config, 'RATE_LIMIT_EXPENSIVE_MAX', 60, 10_000),
    redisTimeoutMs: integer(config, 'RATE_LIMIT_REDIS_TIMEOUT_MS', 250, 2_000, 10),
  };
}
