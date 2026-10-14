import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EthereumRpcClient,
  RpcRateLimiter,
} from '@blockchain-explorer/blockchain-client';
import { AdvancedJobsService } from './advanced-jobs.service.js';
import { ContractDetectionService } from './contract-detection.service.js';
import { EtherscanClient } from './etherscan.client.js';
import {
  ADDRESS,
  BLOCK_HASH,
  HASH,
  rpcBlock,
  testConfig,
  testRepository,
  traceRequest,
  transaction,
  verification,
  verifiedPayload,
} from './advanced.fixtures.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function fixture() {
  vi.spyOn(EthereumRpcClient.prototype, 'getBlockByNumber').mockResolvedValue({
    ...rpcBlock,
    transactions: [],
  });
  const config = testConfig({ ETHERSCAN_API_KEY: 'fixture-key' });
  const repo = testRepository();
  const etherscan = new EtherscanClient(config);
  const detection = new ContractDetectionService(repo, config);
  return {
    repo,
    etherscan,
    service: new AdvancedJobsService(repo, detection, etherscan, config),
  };
}
describe('background verification and trace processing', () => {
  it('atomically claims a verification generation and saves verified evidence', async () => {
    const { repo, service } = fixture();
    vi.spyOn(repo, 'claimVerification').mockResolvedValue(
      verification({ attempts: 1 }),
    );
    const complete = vi.spyOn(repo, 'completeVerification').mockResolvedValue();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(verifiedPayload))),
    );
    await service.processVerification({
      contractAddress: ADDRESS,
      blockNumber: '1',
      blockHash: BLOCK_HASH,
      attempt: 0,
    });
    expect(complete).toHaveBeenCalledWith(
      ADDRESS,
      expect.objectContaining({ status: 'verified', verified: true }),
      1,
      expect.any(Object),
      BLOCK_HASH,
    );
    await service.onApplicationShutdown();
  });
  it('does no HTTP work for duplicate or orphaned verification generations', async () => {
    const { repo, service } = fixture();
    vi.spyOn(repo, 'claimVerification').mockResolvedValue(null);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await service.processVerification({
      contractAddress: ADDRESS,
      blockNumber: '1',
      attempt: 0,
    });
    expect(fetch).not.toHaveBeenCalled();
    await service.onApplicationShutdown();
  });
  it('isolates verification HTTP errors into persisted failed state', async () => {
    const { repo, service } = fixture();
    vi.spyOn(repo, 'claimVerification').mockResolvedValue(
      verification({ attempts: 1 }),
    );
    const fail = vi.spyOn(repo, 'failVerification').mockResolvedValue();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('', { status: 403 })),
    );
    await expect(
      service.processVerification({
        contractAddress: ADDRESS,
        blockNumber: '1',
        blockHash: BLOCK_HASH,
        attempt: 0,
      }),
    ).resolves.toBeUndefined();
    expect(fail).toHaveBeenCalledWith(
      ADDRESS,
      1,
      'http',
      expect.any(Object),
      BLOCK_HASH,
    );
    await service.onApplicationShutdown();
  });
  it('runs callTracer outside ingestion and preserves canonical transaction block', async () => {
    const { repo, service } = fixture();
    vi.spyOn(repo, 'claimTrace').mockResolvedValue(
      traceRequest({ status: 'processing', attempts: 1 }),
    );
    vi.spyOn(repo, 'getTransaction').mockResolvedValue(transaction());
    const complete = vi.spyOn(repo, 'completeTrace').mockResolvedValue();
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: {
              type: 'CALL',
              from: ADDRESS,
              to: ADDRESS,
              value: '0x1',
              calls: [
                { type: 'CALL', from: ADDRESS, to: ADDRESS, value: '0x2' },
              ],
            },
          }),
        ),
      );
    vi.stubGlobal('fetch', fetch);
    await service.processTrace({
      transactionHash: HASH,
      blockNumber: '9007199254740993',
      blockHash: BLOCK_HASH,
    });
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ blockHash: BLOCK_HASH }),
      expect.arrayContaining([
        expect.objectContaining({
          traceAddress: '0',
          value: '2',
          valueBearing: true,
        }),
      ]),
    );
    const options: unknown = fetch.mock.calls[0]?.[1];
    if (
      typeof options !== 'object' ||
      options === null ||
      !('body' in options) ||
      typeof options.body !== 'string'
    )
      throw new Error('Expected RPC body');
    expect(JSON.parse(options.body)).toMatchObject({
      method: 'debug_traceTransaction',
      params: [HASH, { tracer: 'callTracer', timeout: '15s' }],
    });
    await service.onApplicationShutdown();
  });
  it('detects unsupported providers once and persists safe unavailable results', async () => {
    const { repo, service } = fixture();
    vi.spyOn(repo, 'claimTrace').mockResolvedValue(
      traceRequest({ status: 'processing', attempts: 1 }),
    );
    const fail = vi.spyOn(repo, 'failTrace').mockResolvedValue();
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            error: { code: -32601, message: 'Method not found' },
          }),
        ),
      );
    vi.stubGlobal('fetch', fetch);
    const data = {
      transactionHash: HASH,
      blockNumber: '1',
      blockHash: BLOCK_HASH,
    };
    await service.processTrace(data);
    await service.processTrace(data);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fail).toHaveBeenCalledTimes(2);
    expect(fail).toHaveBeenCalledWith(expect.any(Object), true, 4);
    await service.onApplicationShutdown();
  });
  it('discards traces when canonical block identity changed during provider work', async () => {
    const { repo, service } = fixture();
    vi.spyOn(repo, 'claimTrace').mockResolvedValue(
      traceRequest({ status: 'processing', attempts: 1 }),
    );
    vi.spyOn(repo, 'getTransaction').mockResolvedValue(
      transaction({ blockHash: `0x${'f'.repeat(64)}` }),
    );
    const complete = vi.spyOn(repo, 'completeTrace');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ jsonrpc: '2.0', id: 1, result: { type: 'CALL' } }),
          ),
        ),
    );
    await service.processTrace({
      transactionHash: HASH,
      blockNumber: '1',
      blockHash: BLOCK_HASH,
    });
    expect(complete).not.toHaveBeenCalled();
    await service.onApplicationShutdown();
  });
  it('rejects provider traces from another branch before attempting callTracer', async () => {
    const { repo, service } = fixture();
    vi.spyOn(repo, 'claimTrace').mockResolvedValue(
      traceRequest({ status: 'processing', attempts: 1 }),
    );
    const fail = vi.spyOn(repo, 'failTrace').mockResolvedValue();
    vi.spyOn(EthereumRpcClient.prototype, 'getBlockByNumber').mockResolvedValue(
      { ...rpcBlock, hash: `0x${'f'.repeat(64)}`, transactions: [] },
    );
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(
      service.processTrace({
        transactionHash: HASH,
        blockNumber: '1',
        blockHash: BLOCK_HASH,
      }),
    ).rejects.toThrow('Trace request failed');
    expect(fetch).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledWith(expect.any(Object), false, 4);
    await service.onApplicationShutdown();
  });
  it('retries transient trace errors with bounded persisted attempts', async () => {
    const { repo, service } = fixture();
    vi.spyOn(repo, 'claimTrace').mockResolvedValue(
      traceRequest({ status: 'processing', attempts: 1 }),
    );
    const fail = vi.spyOn(repo, 'failTrace').mockResolvedValue();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('network offline')),
    );
    await expect(
      service.processTrace({
        transactionHash: HASH,
        blockNumber: '1',
        blockHash: BLOCK_HASH,
      }),
    ).rejects.toThrow('Trace request failed');
    expect(fail).toHaveBeenCalledWith(expect.any(Object), false, 4);
    await service.onApplicationShutdown();
  });
});
describe('isolated RPC graceful shutdown', () => {
  it('cancels queued limiter work and rejects future scheduling', async () => {
    const limiter = new RpcRateLimiter({
      requestsPerSecond: 1,
      maxConcurrentRequests: 1,
    });
    limiter.coolDown(10000);
    const pending = limiter.schedule(async () => 1);
    const assertion = expect(pending).rejects.toThrow('closed');
    limiter.close();
    await assertion;
    await expect(limiter.schedule(async () => 2)).rejects.toThrow('closed');
  });
  it('aborts active trace fetch and prevents retries on shutdown', async () => {
    const fetch = vi.fn().mockImplementation(
      async (_url: unknown, options: { signal: AbortSignal }) =>
        new Promise<Response>((_, reject) => {
          options.signal.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    vi.stubGlobal('fetch', fetch);
    const rpc = new EthereumRpcClient({
      url: 'http://127.0.0.1:1/rpc',
      maxRetries: 4,
    });
    const pending = rpc.traceTransaction(HASH);
    const assertion = expect(pending).rejects.toThrow();
    await Promise.resolve();
    rpc.close();
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(rpc.getBlockNumber()).rejects.toThrow('closed');
  });
});
