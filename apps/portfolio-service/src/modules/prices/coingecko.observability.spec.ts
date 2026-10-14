import { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as telemetry from '@blockchain-explorer/observability';
import { CoinGeckoClient } from './coingecko.client.js';

vi.mock('@blockchain-explorer/observability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@blockchain-explorer/observability')>();
  return { ...actual, recordCounter: vi.fn(), recordHistogram: vi.fn(), withSpan: vi.fn(actual.withSpan) };
});

describe('CoinGecko actual request observations', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  function client(retries = 0): CoinGeckoClient {
    return new CoinGeckoClient(new ConfigService({
      COINGECKO_BASE_URL: 'https://api.coingecko.com/api/v3', COINGECKO_MAX_RETRIES: retries,
      COINGECKO_REQUESTS_PER_SECOND: 20, COINGECKO_RETRY_BASE_DELAY_MS: 1,
    }));
  }

  it('counts each real attempt, including one 429 and the successful retry', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '1' } }))
      .mockResolvedValueOnce(new Response('{"ethereum":{"usd":42}}'));
    vi.stubGlobal('fetch', fetchMock);
    const provider = client(1);
    try {
      const result = provider.fetchPrice('native:eth');
      await vi.advanceTimersByTimeAsync(1000);
      expect((await result)?.priceUsd).toBe('42');
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(vi.mocked(telemetry.recordCounter).mock.calls.filter(([name]) => name === 'coingecko_requests_total')).toHaveLength(2);
      expect(telemetry.recordCounter).toHaveBeenCalledWith('coingecko_errors_total', 1, { status: 'rate_limited' });
      expect(telemetry.recordHistogram).toHaveBeenCalledWith('coingecko_duration_seconds', expect.any(Number), { status: 'success' });
      expect(vi.mocked(telemetry.withSpan).mock.calls.map(([, attrs]) => attrs['retry.attempt'])).toEqual([0, 1]);
    } finally { provider.onModuleDestroy(); }
  });

  it('reports network failures with bounded categories, preserving the provider error', async () => {
    const failure = new TypeError('Provider offline');
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(failure));
    const provider = client();
    try {
      await expect(provider.fetchPrice('native:eth')).rejects.toBe(failure);
      expect(telemetry.recordCounter).toHaveBeenCalledWith('coingecko_errors_total', 1, { status: 'transport_error' });
      expect(telemetry.recordHistogram).toHaveBeenCalledWith('coingecko_duration_seconds', expect.any(Number), { status: 'transport_error' });
      expect(vi.mocked(telemetry.recordCounter).mock.calls).toEqual([
        ['coingecko_requests_total', 1, { method: 'GET' }], ['coingecko_errors_total', 1, { status: 'transport_error' }],
      ]);
    } finally { provider.onModuleDestroy(); }
  });

  it('does not fabricate a request metric for an unsupported asset', async () => {
    const provider = client();
    try {
      expect(await provider.fetchPrice('native:btc')).toBeNull();
      expect(telemetry.recordCounter).not.toHaveBeenCalled();
      expect(telemetry.recordHistogram).not.toHaveBeenCalled();
      expect(telemetry.withSpan).not.toHaveBeenCalled();
    } finally { provider.onModuleDestroy(); }
  });
});
