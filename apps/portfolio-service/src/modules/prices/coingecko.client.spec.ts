import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoinGeckoClient, decodeCoinGeckoPrice, parseRetryAfter } from './coingecko.client.js';

describe('CoinGecko response mapping', () => {
  it('preserves original numeric precision and matches existing DB numeric scales', () => {
    const response = decodeCoinGeckoPrice('{"ethereum":{"usd":12345678901234567890.123456789012345678,"usd_24h_change":-1.123456789,"usd_market_cap":12345678901234567890.129}}', 'ethereum');
    expect(response).toMatchObject({
      priceUsd: '12345678901234567890.123456789012345678',
      change24hPercent: '-1.12345679',
      marketCapUsd: '12345678901234567890.13',
    });
  });

  it('returns null for unknown/missing/negative/unrepresentably tiny prices, never fake zero', () => {
    for (const raw of ['{}', '{"ethereum":{"usd":null}}', '{"ethereum":{"usd":-1}}', '{"ethereum":{"usd":1e-30}}']) {
      expect(decodeCoinGeckoPrice(raw, 'ethereum')).toBeNull();
    }
    expect(decodeCoinGeckoPrice('{"ethereum":{"usd":0}}', 'ethereum')?.priceUsd).toBe('0');
  });

  it('uses provider source time and validates optional metadata', () => {
    expect(decodeCoinGeckoPrice('{"ethereum":{"usd":10,"last_updated_at":1767225600,"usd_24h_change":null}}', 'ethereum', new Date('2026-01-01T00:00:01Z')))
      .toMatchObject({ fetchedAt: new Date('2026-01-01T00:00:00Z'), change24hPercent: null, marketCapUsd: null });
  });

  it('parses Retry-After seconds and HTTP dates', () => {
    expect(parseRetryAfter('2.5', 0)).toBe(2_500);
    expect(parseRetryAfter('Thu, 01 Jan 1970 00:00:03 GMT', 1_000)).toBe(2_000);
    expect(parseRetryAfter('invalid')).toBeNull();
  });
});

describe('CoinGeckoClient HTTP resilience', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  function config(extra: Record<string, string | number> = {}) {
    return new ConfigService({
      COINGECKO_BASE_URL: 'https://api.coingecko.com/api/v3',
      COINGECKO_MAX_RETRIES: 0,
      COINGECKO_REQUESTS_PER_SECOND: 20,
      COINGECKO_TIMEOUT_MS: 100,
      ...extra,
    });
  }

  it('maps ETH ID and Ethereum token platform endpoints and sends key in a header', async () => {
    vi.useFakeTimers();
    const address = `0x${'a'.repeat(40)}`;
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"ethereum":{"usd":10}}'));
    vi.stubGlobal('fetch', fetchMock);
    const client = new CoinGeckoClient(config({ COINGECKO_API_KEY: 'test-key' }));
    expect((await client.fetchPrice('native:eth'))?.priceUsd).toBe('10');
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/simple/price?ids=ethereum');
    expect(String(url)).toContain('include_last_updated_at=true');
    expect(String(url)).toContain('precision=full');
    expect(String(url)).not.toContain('test-key');
    expect(options?.headers).toMatchObject({ 'x-cg-demo-api-key': 'test-key' });
    fetchMock.mockResolvedValueOnce(new Response(`{"${address}":{"usd":1.123456789012345678}}`));
    const token = client.fetchPrice(`erc20:${address}`);
    await vi.advanceTimersByTimeAsync(50);
    expect((await token)?.priceUsd).toBe('1.123456789012345678');
    expect(String(fetchMock.mock.calls[1][0])).toContain(`/simple/token_price/ethereum?contract_addresses=${address}`);
    client.onModuleDestroy();
  });

  it('respects Retry-After before retrying 429, with a process-wide cooldown', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '2' } }))
      .mockResolvedValueOnce(new Response('{"ethereum":{"usd":42}}'));
    vi.stubGlobal('fetch', fetchMock);
    const client = new CoinGeckoClient(config({ COINGECKO_MAX_RETRIES: 1, COINGECKO_RETRY_BASE_DELAY_MS: 1 }));
    const result = client.fetchPrice('native:eth');
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect((await result)?.priceUsd).toBe('42');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    client.onModuleDestroy();
  });

  it('aborts a hung request and does not retry authentication errors', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise<never>((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('request aborted')), { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new CoinGeckoClient(config());
    const result = expect(client.fetchPrice('native:eth')).rejects.toThrow('request aborted');
    await vi.advanceTimersByTimeAsync(100);
    await result;
    client.onModuleDestroy();

    fetchMock.mockResolvedValue(new Response('', { status: 401 }));
    const unauthorized = new CoinGeckoClient(config({ COINGECKO_MAX_RETRIES: 4 }));
    await expect(unauthorized.fetchPrice('native:eth')).rejects.toThrow('HTTP 401');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    unauthorized.onModuleDestroy();
  });

  it('does not send unsupported asset keys to the provider', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    const client = new CoinGeckoClient(config());
    expect(await client.fetchPrice('native:btc')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    client.onModuleDestroy();
  });
});
