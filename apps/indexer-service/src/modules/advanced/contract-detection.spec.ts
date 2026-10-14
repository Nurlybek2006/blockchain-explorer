import { afterEach, describe, expect, it, vi } from 'vitest';
import { AddressIndexingService } from '../addresses/address-indexing.service.js';
import {
  ContractDetectionService,
  codeHasContract,
} from './contract-detection.service.js';
import {
  ADDRESS,
  OTHER_ADDRESS,
  rpcBlock,
  rpcReceipt,
  registry,
  testConfig,
  testRepository,
} from './advanced.fixtures.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('contract discovery', () => {
  it('uses receipt contractAddress for creation, independent of the transaction recipient', () => {
    const rows = new AddressIndexingService().prepare(
      {
        ...rpcBlock,
        transactions: [
          {
            ...rpcBlock.transactions[0],
            ...rpcBlock.transactions[0],
            to: null,
            hash: `0x${'c'.repeat(64)}`,
            blockHash: `0x${'d'.repeat(64)}`,
            blockNumber: '0x1',
            transactionIndex: '0x0',
            from: OTHER_ADDRESS,
            nonce: '0x1',
            value: '0x0',
            gas: '0x5208',
            input: '0x',
          },
        ],
      },
      [{ ...rpcReceipt, to: null, contractAddress: ADDRESS }],
      [],
      1n,
    );
    expect(rows.find((row) => row.address === ADDRESS)?.isContract).toBe(true);
    expect(rows.find((row) => row.address === OTHER_ADDRESS)?.isContract).toBe(
      false,
    );
  });
  it('marks ERC20 event emitters as contracts, without marking sender/recipient wallets', () => {
    const rows = new AddressIndexingService().prepare(
      rpcBlock,
      [rpcReceipt],
      [
        {
          transactionHash: rpcReceipt.transactionHash,
          blockNumber: 1n,
          tokenAddress: ADDRESS,
          fromAddress: OTHER_ADDRESS,
          toAddress: OTHER_ADDRESS,
          amount: '1',
          transactionIndex: 0,
          logIndex: 0,
        },
      ],
      1n,
    );
    expect(rows.find((row) => row.address === ADDRESS)?.isContract).toBe(true);
  });
  it('distinguishes empty account code from valid all-zero STOP bytecode', () => {
    expect(codeHasContract('0x')).toBe(false);
    expect(codeHasContract('0x00')).toBe(true);
    expect(codeHasContract('0x6000')).toBe(true);
    for (const value of [null, '0x0', 'garbage', 1])
      expect(() => codeHasContract(value)).toThrow();
  });
  it('skips already-known or previously checked contracts without RPC calls', async () => {
    const repo = testRepository();
    vi.spyOn(repo, 'pendingDetections').mockResolvedValue([
      registry(),
      registry({ isContract: false, codeCheckedBlock: 1n }),
    ]);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const service = new ContractDetectionService(repo, testConfig());
    await service.processBatch();
    service.stop();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('checks unknown addresses at an explicit indexed block and persists the result', async () => {
    const repo = testRepository();
    vi.spyOn(repo, 'pendingDetections').mockResolvedValue([
      registry({ isContract: false, codeCheckedBlock: null }),
    ]);
    const complete = vi.spyOn(repo, 'completeDetection').mockResolvedValue();
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x6000' }),
        ),
      );
    vi.stubGlobal('fetch', fetch);
    const service = new ContractDetectionService(repo, testConfig());
    await service.processBatch();
    service.stop();
    expect(complete).toHaveBeenCalledWith(
      ADDRESS,
      2n,
      true,
      expect.objectContaining({ traceEnabled: true }),
    );
    const options: unknown = fetch.mock.calls[0]?.[1];
    if (
      typeof options !== 'object' ||
      options === null ||
      !('body' in options) ||
      typeof options.body !== 'string'
    )
      throw new Error('Expected RPC request');
    expect(JSON.parse(options.body)).toMatchObject({
      method: 'eth_getCode',
      params: [ADDRESS, '0x2'],
    });
  });
  it('isolates provider errors into bounded persistent retry state', async () => {
    const repo = testRepository();
    vi.spyOn(repo, 'pendingDetections').mockResolvedValue([
      registry({ isContract: false, codeCheckedBlock: null }),
    ]);
    const fail = vi.spyOn(repo, 'failDetection').mockResolvedValue();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    const service = new ContractDetectionService(repo, testConfig());
    await expect(service.processBatch()).resolves.toBeUndefined();
    service.stop();
    expect(fail).toHaveBeenCalledWith(ADDRESS);
  });
});
