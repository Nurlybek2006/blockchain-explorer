import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  isEthereumAddress,
  type ContractVerificationResponse,
} from '@blockchain-explorer/contracts';
import { loadAdvancedConfig, type AdvancedConfig } from './advanced.config.js';
import { RequestLimiter } from './request-limiter.js';

export type VerificationLookup = Omit<
  ContractVerificationResponse,
  'verifiedAt' | 'lastCheckedAt'
>;
export class VerificationProviderError extends Error {
  constructor(
    readonly code:
      | 'http'
      | 'rate-limit'
      | 'timeout'
      | 'invalid-response'
      | 'configuration'
      | 'unsupported'
      | 'network',
    readonly retryable: boolean,
    readonly retryAfterMs = 0,
    readonly httpStatus: number | null = null,
  ) {
    super(`Contract verification provider ${code}`);
    this.name = 'VerificationProviderError';
  }
}

export function retryAfterMilliseconds(
  value: string | null,
  now = Date.now(),
): number {
  if (value === null) return 0;
  if (/^\d+(?:\.\d+)?$/.test(value.trim())) {
    const milliseconds = Number(value) * 1000;
    return Number.isFinite(milliseconds) && milliseconds <= 86400000
      ? Math.ceil(milliseconds)
      : 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed - now <= 86400000
    ? Math.max(0, parsed - now)
    : 0;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function text(value: unknown, maximum: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > maximum)
    throw new VerificationProviderError('invalid-response', false);
  return value;
}
function validateAbiTree(abi: unknown[]): void {
  const stack: Array<{ value: unknown; depth: number }> = [
    { value: abi, depth: 0 },
  ];
  let count = 0;
  while (stack.length) {
    const current = stack.pop();
    if (!current) break;
    if (++count > 30000 || current.depth > 32)
      throw new VerificationProviderError('invalid-response', false);
    if (Array.isArray(current.value)) {
      for (const value of current.value)
        stack.push({ value, depth: current.depth + 1 });
    } else if (record(current.value)) {
      for (const value of Object.values(current.value))
        stack.push({ value, depth: current.depth + 1 });
    } else if (
      (current.value !== null &&
        !['string', 'boolean', 'number'].includes(typeof current.value)) ||
      (typeof current.value === 'number' && !Number.isFinite(current.value))
    )
      throw new VerificationProviderError('invalid-response', false);
  }
}
export function unavailableVerification(
  status: 'unverified' | 'unsupported',
): VerificationLookup {
  return {
    status,
    verified: false,
    contractName: null,
    compilerVersion: null,
    optimizationUsed: null,
    optimizationRuns: null,
    sourceCode: null,
    abi: null,
    constructorArguments: null,
    verificationSource: 'etherscan-v2',
  };
}

/** Keep multi-file Standard JSON source intact; it is source evidence, never executed. */
export function decodeEtherscanVerification(
  payload: unknown,
): VerificationLookup {
  if (
    !record(payload) ||
    typeof payload.status !== 'string' ||
    !['0', '1'].includes(payload.status)
  )
    throw new VerificationProviderError('invalid-response', false);
  if (payload.status === '0') {
    const message =
      typeof payload.result === 'string' ? payload.result.toLowerCase() : '';
    if (message.includes('not verified') || message.includes('no records'))
      return unavailableVerification('unverified');
    if (message.includes('rate limit') || message.includes('max calls'))
      throw new VerificationProviderError('rate-limit', true, 1000);
    if (
      message.includes('unsupported') ||
      message.includes('chainid') ||
      message.includes('not supported')
    )
      return unavailableVerification('unsupported');
    if (message.includes('api key') || message.includes('apikey'))
      throw new VerificationProviderError('configuration', false);
    throw new VerificationProviderError('invalid-response', false);
  }
  if (
    !Array.isArray(payload.result) ||
    payload.result.length !== 1 ||
    !record(payload.result[0])
  )
    throw new VerificationProviderError('invalid-response', false);
  const row = payload.result[0];
  const sourceCode = text(row.SourceCode, 4 * 1024 * 1024);
  const rawAbi = text(row.ABI, 1024 * 1024);
  if (!sourceCode?.trim() || rawAbi?.toLowerCase().includes('not verified'))
    return unavailableVerification('unverified');
  if (rawAbi === null)
    throw new VerificationProviderError('invalid-response', false);
  let abi: unknown;
  try {
    abi = JSON.parse(rawAbi);
  } catch {
    throw new VerificationProviderError('invalid-response', false);
  }
  if (
    !Array.isArray(abi) ||
    abi.length > 10000 ||
    !abi.every(
      (entry: unknown) => record(entry) && typeof entry.type === 'string',
    )
  )
    throw new VerificationProviderError('invalid-response', false);
  validateAbiTree(abi);
  const runsText = text(row.Runs, 16);
  const optimizationRuns =
    runsText === null ? null : /^\d+$/.test(runsText) ? Number(runsText) : NaN;
  if (
    optimizationRuns !== null &&
    (!Number.isSafeInteger(optimizationRuns) || optimizationRuns > 2147483647)
  )
    throw new VerificationProviderError('invalid-response', false);
  if (row.OptimizationUsed !== '0' && row.OptimizationUsed !== '1')
    throw new VerificationProviderError('invalid-response', false);
  const constructorArguments = text(row.ConstructorArguments, 1024 * 1024);
  if (
    constructorArguments !== null &&
    !/^(?:0x)?[a-fA-F0-9]*$/.test(constructorArguments)
  )
    throw new VerificationProviderError('invalid-response', false);
  return {
    status: 'verified',
    verified: true,
    contractName: text(row.ContractName, 255),
    compilerVersion: text(row.CompilerVersion, 100),
    optimizationUsed: row.OptimizationUsed === '1',
    optimizationRuns,
    sourceCode,
    abi,
    constructorArguments,
    verificationSource: 'etherscan-v2',
  };
}

@Injectable()
export class EtherscanClient implements OnModuleDestroy {
  private readonly options: AdvancedConfig;
  private readonly limiter: RequestLimiter;
  private readonly controllers = new Set<AbortController>();
  private closing = false;
  constructor(config: ConfigService) {
    this.options = loadAdvancedConfig(config);
    this.limiter = new RequestLimiter(this.options.requestsPerSecond);
  }
  async lookup(address: string): Promise<VerificationLookup> {
    if (!isEthereumAddress(address))
      throw new VerificationProviderError('invalid-response', false);
    if (!this.options.verificationEnabled || !this.options.apiKey)
      return unavailableVerification('unsupported');
    const url = new URL(this.options.baseUrl);
    url.searchParams.set('chainid', String(this.options.chainId));
    url.searchParams.set('module', 'contract');
    url.searchParams.set('action', 'getsourcecode');
    url.searchParams.set('address', address.toLowerCase());
    url.searchParams.set('apikey', this.options.apiKey);
    for (let attempt = 0; ; attempt += 1) {
      if (this.closing) throw new VerificationProviderError('network', false);
      try {
        return await this.limiter.schedule(async () =>
          decodeEtherscanVerification(await this.fetchOnce(url)),
        );
      } catch (error) {
        if (
          !(error instanceof VerificationProviderError) ||
          !error.retryable ||
          attempt >= this.options.maxRetries ||
          this.closing
        )
          throw error;
        const backoff = Math.min(500 * 2 ** attempt, 60000);
        const delay = Math.max(
          backoff + Math.floor(Math.random() * (backoff / 4)),
          error.retryAfterMs,
        );
        this.limiter.coolDown(delay);
        // Preserve provider cooldown, but do not keep a worker waiting for unbounded Retry-After.
        if (delay > 60000) throw error;
      }
    }
  }
  onModuleDestroy(): void {
    this.closing = true;
    this.limiter.close();
    for (const controller of this.controllers) controller.abort();
  }
  private async fetchOnce(url: URL): Promise<unknown> {
    const controller = new AbortController();
    this.controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await fetch(url, {
        redirect: 'error',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        const retryAfter = retryAfterMilliseconds(
          response.headers.get('retry-after'),
        );
        if (response.status === 429) this.limiter.coolDown(retryAfter || 1000);
        await response.body?.cancel();
        throw new VerificationProviderError(
          'http',
          response.status === 429 ||
            response.status >= 500 ||
            response.status === 408,
          retryAfter,
          response.status,
        );
      }
      const raw = await response.text();
      if (raw.length > 6 * 1024 * 1024)
        throw new VerificationProviderError('invalid-response', false);
      try {
        return JSON.parse(raw);
      } catch {
        throw new VerificationProviderError('invalid-response', false);
      }
    } catch (error) {
      if (error instanceof VerificationProviderError) throw error;
      throw new VerificationProviderError(
        controller.signal.aborted ? 'timeout' : 'network',
        !this.closing,
      );
    } finally {
      clearTimeout(timer);
      this.controllers.delete(controller);
    }
  }
}
