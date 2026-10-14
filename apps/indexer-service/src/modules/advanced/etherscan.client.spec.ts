import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EtherscanClient,
  decodeEtherscanVerification,
  retryAfterMilliseconds,
  VerificationProviderError,
} from './etherscan.client.js';
import { ADDRESS, testConfig, verifiedPayload } from './advanced.fixtures.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe('Etherscan V2 validation and verification states', () => {
  it('maps verified Solidity metadata, ABI and optimizer runs', () => {
    expect(decodeEtherscanVerification(verifiedPayload)).toMatchObject({
      status: 'verified',
      verified: true,
      contractName: 'Example',
      compilerVersion: 'v0.8.20',
      optimizationUsed: true,
      optimizationRuns: 200,
      abi: [{ type: 'function', name: 'transfer', inputs: [] }],
      verificationSource: 'etherscan-v2',
    });
  });
  it('preserves exact multi-file standard JSON source evidence', () => {
    const source =
      '{{"language":"Solidity","sources":{"Contract.sol":{"content":"contract Example{}"}}}}';
    const row = { ...verifiedPayload.result[0], SourceCode: source };
    expect(
      decodeEtherscanVerification({ ...verifiedPayload, result: [row] })
        .sourceCode,
    ).toBe(source);
  });
  it('accepts an unverified contract as a normal state', () => {
    expect(
      decodeEtherscanVerification({
        ...verifiedPayload,
        result: [{ SourceCode: '', ABI: 'Contract source code not verified' }],
      }),
    ).toMatchObject({
      status: 'unverified',
      verified: false,
      sourceCode: null,
      abi: null,
    });
    expect(
      decodeEtherscanVerification({
        status: '0',
        message: 'NOTOK',
        result: 'Contract source code not verified',
      }).status,
    ).toBe('unverified');
  });
  it('separates unsupported chains, invalid credentials and application rate limits', () => {
    expect(
      decodeEtherscanVerification({
        status: '0',
        result: 'Unsupported chainid',
      }).status,
    ).toBe('unsupported');
    expect(() =>
      decodeEtherscanVerification({ status: '0', result: 'Invalid API Key' }),
    ).toThrow(VerificationProviderError);
    try {
      decodeEtherscanVerification({
        status: '0',
        result: 'Max calls per sec rate limit reached',
      });
    } catch (error) {
      expect(error).toMatchObject({ code: 'rate-limit', retryable: true });
    }
  });
  it.each([
    null,
    {},
    { status: 'x', result: [] },
    { status: '1', result: [] },
    { status: '1', result: [1] },
  ])('rejects malformed provider envelopes %j', (payload) => {
    expect(() => decodeEtherscanVerification(payload)).toThrow(
      VerificationProviderError,
    );
  });
  it.each(['broken', '{}', '[1]', '[{"name":"missing type"}]'])(
    'rejects invalid ABI %s',
    (abi) => {
      expect(() =>
        decodeEtherscanVerification({
          ...verifiedPayload,
          result: [{ ...verifiedPayload.result[0], ABI: abi }],
        }),
      ).toThrow(VerificationProviderError);
    },
  );
  it('rejects unsafe optimizer runs and malformed constructor arguments', () => {
    for (const patch of [
      { Runs: '999999999999' },
      { Runs: '-1' },
      { OptimizationUsed: '2' },
      { ConstructorArguments: 'nothex' },
    ])
      expect(() =>
        decodeEtherscanVerification({
          ...verifiedPayload,
          result: [{ ...verifiedPayload.result[0], ...patch }],
        }),
      ).toThrow(VerificationProviderError);
  });
  it('parses Retry-After seconds, dates and rejects invalid limits', () => {
    expect(retryAfterMilliseconds('1.5')).toBe(1500);
    expect(retryAfterMilliseconds('Thu, 01 Jan 1970 00:00:02 GMT', 1000)).toBe(
      1000,
    );
    expect(retryAfterMilliseconds('-1')).toBe(0);
    expect(retryAfterMilliseconds('99999999999')).toBe(0);
  });
});
describe('Etherscan HTTP boundary', () => {
  it('rejects numeric status envelopes and excessively nested ABI evidence', () => {
    expect(() =>
      decodeEtherscanVerification({ ...verifiedPayload, status: 1 }),
    ).toThrow(VerificationProviderError);
    let nested: unknown = { type: 'tuple' };
    for (let index = 0; index < 40; index += 1)
      nested = { type: 'tuple', components: [nested] };
    expect(() =>
      decodeEtherscanVerification({
        ...verifiedPayload,
        result: [
          { ...verifiedPayload.result[0], ABI: JSON.stringify([nested]) },
        ],
      }),
    ).toThrow(VerificationProviderError);
  });
  it('times out a stalled HTTP provider with a typed bounded failure', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        async (_url: unknown, options: { signal: AbortSignal }) =>
          new Promise<Response>((_, reject) => {
            options.signal.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          }),
      ),
    );
    const client = new EtherscanClient(
      testConfig({
        ETHERSCAN_API_KEY: 'fixture-key',
        ETHERSCAN_TIMEOUT_MS: 100,
      }),
    );
    const pending = client.lookup(ADDRESS);
    const assertion = expect(pending).rejects.toMatchObject({
      code: 'timeout',
      retryable: true,
    });
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    client.onModuleDestroy();
  });
  it('does not spin on provider cooldown longer than a worker retry window', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response('', { status: 429, headers: { 'Retry-After': '90' } }),
      );
    vi.stubGlobal('fetch', fetch);
    const client = new EtherscanClient(
      testConfig({
        ETHERSCAN_API_KEY: 'fixture-key',
        ETHERSCAN_MAX_RETRIES: 4,
      }),
    );
    await expect(client.lookup(ADDRESS)).rejects.toMatchObject({
      code: 'http',
      retryAfterMs: 90000,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    client.onModuleDestroy();
  });
  it('uses chainid/module/action/address and API key only at configured provider', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(verifiedPayload)));
    vi.stubGlobal('fetch', fetch);
    const client = new EtherscanClient(
      testConfig({ ETHERSCAN_API_KEY: 'fixture-key' }),
    );
    expect((await client.lookup(ADDRESS)).status).toBe('verified');
    const url: unknown = fetch.mock.calls[0]?.[0];
    expect(url).toBeInstanceOf(URL);
    if (!(url instanceof URL)) throw new Error('Expected URL');
    expect(url.origin + url.pathname).toBe('https://api.etherscan.io/v2/api');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      chainid: '11155111',
      module: 'contract',
      action: 'getsourcecode',
      address: ADDRESS,
      apikey: 'fixture-key',
    });
    client.onModuleDestroy();
  });
  it('makes no network request when disabled or missing an API key', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    for (const config of [
      testConfig(),
      testConfig({
        CONTRACT_VERIFICATION_ENABLED: false,
        ETHERSCAN_API_KEY: 'fixture-key',
      }),
    ]) {
      const client = new EtherscanClient(config);
      expect((await client.lookup(ADDRESS)).status).toBe('unsupported');
      client.onModuleDestroy();
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it('bounds 429 retry and respects Retry-After cooldown', async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('', { status: 429, headers: { 'Retry-After': '2' } }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(verifiedPayload)));
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const client = new EtherscanClient(
      testConfig({
        ETHERSCAN_API_KEY: 'fixture-key',
        ETHERSCAN_MAX_RETRIES: 1,
      }),
    );
    const result = client.lookup(ADDRESS);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await result).status).toBe('verified');
    expect(fetch).toHaveBeenCalledTimes(2);
    client.onModuleDestroy();
  });
  it('fails malformed JSON safely without retrying or exposing provider content', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('secret invalid content')),
    );
    const client = new EtherscanClient(
      testConfig({ ETHERSCAN_API_KEY: 'fixture-key' }),
    );
    await expect(client.lookup(ADDRESS)).rejects.toMatchObject({
      code: 'invalid-response',
      retryable: false,
    });
    client.onModuleDestroy();
  });
});
