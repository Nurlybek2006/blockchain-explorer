import { ConfigService } from '@nestjs/config';

export interface AdvancedConfig {
  verificationEnabled: boolean;
  traceEnabled: boolean;
  traceOnlyContracts: boolean;
  chainId: number;
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  maxRetries: number;
  requestsPerSecond: number;
  verificationCooldownMs: number;
  verificationMaxLookups: number;
  traceTimeoutMs: number;
  traceMaxRetries: number;
  traceConcurrency: number;
  redisUrl: string;
  queuePrefix: string;
  dispatcherEnabled: boolean;
}

function numberSetting(
  config: ConfigService,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = Number(config.get(name) ?? fallback);
  if (!Number.isFinite(value) || value < minimum || value > maximum)
    throw new Error(`Invalid ${name}`);
  return value;
}

function flag(config: ConfigService, name: string, fallback: boolean): boolean {
  const value: unknown = config.get(name);
  if (value === undefined) return fallback;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error(`Invalid ${name}`);
}

export function loadAdvancedConfig(config: ConfigService): AdvancedConfig {
  const baseUrl =
    config.get<string>('ETHERSCAN_BASE_URL') ??
    'https://api.etherscan.io/v2/api';
  const url = new URL(baseUrl);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('Invalid ETHERSCAN_BASE_URL');
  const chainId = numberSetting(
    config,
    'ETHERSCAN_CHAIN_ID',
    Number(config.get('ETHEREUM_CHAIN_ID') ?? 11155111),
    1,
    Number.MAX_SAFE_INTEGER,
  );
  if (
    !Number.isSafeInteger(chainId) ||
    chainId !== Number(config.get('ETHEREUM_CHAIN_ID') ?? 11155111)
  )
    throw new Error('ETHERSCAN_CHAIN_ID must match the indexed chain');
  const traceConcurrency = numberSetting(
    config,
    'TRACE_WORKER_CONCURRENCY',
    1,
    1,
    4,
  );
  const maxRetries = numberSetting(config, 'ETHERSCAN_MAX_RETRIES', 4, 0, 8);
  const traceMaxRetries = numberSetting(config, 'TRACE_MAX_RETRIES', 3, 0, 8);
  const verificationMaxLookups = numberSetting(
    config,
    'CONTRACT_VERIFICATION_MAX_LOOKUPS',
    3,
    1,
    20,
  );
  for (const value of [
    traceConcurrency,
    maxRetries,
    traceMaxRetries,
    verificationMaxLookups,
  ])
    if (!Number.isInteger(value))
      throw new Error('Advanced job counts must be integers');
  return {
    verificationEnabled: flag(config, 'CONTRACT_VERIFICATION_ENABLED', true),
    traceEnabled: flag(config, 'TRACE_ENABLED', true),
    traceOnlyContracts: flag(config, 'TRACE_ONLY_CONTRACT_INTERACTIONS', true),
    dispatcherEnabled: flag(config, 'EXPLORER_ENRICHMENT_ENABLED', true),
    chainId,
    baseUrl,
    apiKey: config.get<string>('ETHERSCAN_API_KEY')?.trim() ?? '',
    timeoutMs: numberSetting(config, 'ETHERSCAN_TIMEOUT_MS', 10000, 100, 60000),
    maxRetries,
    requestsPerSecond: numberSetting(
      config,
      'ETHERSCAN_REQUESTS_PER_SECOND',
      2,
      0.1,
      10,
    ),
    verificationCooldownMs: numberSetting(
      config,
      'CONTRACT_VERIFICATION_COOLDOWN_MS',
      86400000,
      1000,
      604800000,
    ),
    verificationMaxLookups,
    traceTimeoutMs: numberSetting(
      config,
      'TRACE_TIMEOUT_MS',
      15000,
      100,
      60000,
    ),
    traceMaxRetries,
    traceConcurrency,
    redisUrl: config.get<string>('REDIS_URL') ?? 'redis://localhost:6379',
    queuePrefix: config.get<string>('EXPLORER_JOBS_QUEUE_PREFIX') ?? 'explorer',
  };
}
