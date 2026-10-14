import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AdvancedExplorerService,
  sortTracePaths,
} from './advanced-explorer.service.js';
import {
  ADDRESS,
  HASH,
  registry,
  testConfig,
  testRepository,
  traceRequest,
  transaction,
  verification,
} from './advanced.fixtures.js';
import type { transactionTraces } from '../../database/schema/index.js';

afterEach(() => vi.restoreAllMocks());
describe('advanced explorer persisted public states', () => {
  it('returns null for absent addresses and known EOAs', async () => {
    const repo = testRepository();
    const get = vi.spyOn(repo, 'getAddress').mockResolvedValue(null);
    const service = new AdvancedExplorerService(repo, testConfig());
    expect(await service.getContract(ADDRESS)).toBeNull();
    get.mockResolvedValue(registry({ isContract: false }));
    expect(await service.getContract(ADDRESS)).toBeNull();
  });
  it.each([
    'verified',
    'unverified',
    'pending',
    'unsupported',
    'failed',
  ] as const)(
    'exposes stored %s state with exact block strings',
    async (status) => {
      const repo = testRepository();
      vi.spyOn(repo, 'getAddress').mockResolvedValue(
        registry({ firstSeenBlock: 9007199254740993n }),
      );
      vi.spyOn(repo, 'getVerification').mockResolvedValue(
        verification({
          status,
          ...(status === 'verified'
            ? { sourceCode: 'contract A{}', abi: [], verifiedAt: new Date(0) }
            : {}),
        }),
      );
      const detail = await new AdvancedExplorerService(
        repo,
        testConfig(),
      ).getContract(ADDRESS);
      expect(detail).toMatchObject({
        firstSeenBlock: '9007199254740993',
        verification: { status, verified: status === 'verified' },
      });
    },
  );
  it('does not report an empty source as verified even for malformed legacy storage', async () => {
    const repo = testRepository();
    vi.spyOn(repo, 'getAddress').mockResolvedValue(registry());
    vi.spyOn(repo, 'getVerification').mockResolvedValue(
      verification({ status: 'verified', abi: [] }),
    );
    expect(
      (
        await new AdvancedExplorerService(repo, testConfig()).getContract(
          ADDRESS,
        )
      )?.verification,
    ).toMatchObject({ verified: false, status: 'unverified' });
  });
  it('reports missing transactions without creating trace requests', async () => {
    const repo = testRepository();
    vi.spyOn(repo, 'getTransaction').mockResolvedValue(null);
    const request = vi.spyOn(repo, 'requestTrace');
    expect(
      await new AdvancedExplorerService(repo, testConfig()).getTraces(HASH),
    ).toMatchObject({ available: false, reason: 'not-indexed', traces: [] });
    expect(request).not.toHaveBeenCalled();
  });
  it.each([
    ['queued', 'pending'],
    ['processing', 'pending'],
    ['unsupported', 'not-supported'],
    ['failed', 'failed'],
    ['not_requested', 'not-requested'],
  ] as const)(
    'maps trace state %s into reason %s without HTTP errors',
    async (status, reason) => {
      const repo = testRepository();
      vi.spyOn(repo, 'getTransaction').mockResolvedValue(transaction());
      vi.spyOn(repo, 'getTraceRequest').mockResolvedValue(
        traceRequest({ status }),
      );
      expect(
        await new AdvancedExplorerService(repo, testConfig()).getTraces(HASH),
      ).toMatchObject({ available: false, status, reason });
    },
  );
  it('sorts numeric pre-order paths, excluding transfers within reverted parents', async () => {
    const repo = testRepository();
    vi.spyOn(repo, 'getTransaction').mockResolvedValue(transaction());
    vi.spyOn(repo, 'getTraceRequest').mockResolvedValue(
      traceRequest({ status: 'completed' }),
    );
    const make = (
      traceAddress: string,
      error: string | null = null,
    ): typeof transactionTraces.$inferSelect => ({
      id: 'unused',
      transactionHash: HASH,
      blockNumber: 9007199254740993n,
      traceAddress,
      type: 'CALL',
      callType: 'CALL',
      fromAddress: ADDRESS,
      toAddress: ADDRESS,
      value: '1',
      gas: '1000',
      gasUsed: '100',
      input: '0x',
      output: '0x',
      error,
    });
    vi.spyOn(repo, 'getTraces').mockResolvedValue([
      make('10'),
      make('2.0'),
      make('root'),
      make('2', 'reverted'),
      make('1'),
    ]);
    const result = await new AdvancedExplorerService(
      repo,
      testConfig(),
    ).getTraces(HASH);
    expect(result.traces.map((row) => row.traceAddress)).toEqual([
      'root',
      '1',
      '2',
      '2.0',
      '10',
    ]);
    expect(result.internalCalls.map((row) => row.traceAddress)).toEqual([
      '1',
      '10',
    ]);
  });
  it('uses numeric trace path comparison rather than lexical ordering', () => {
    expect(['1.10', 'root', '1.2', '0', '1'].sort(sortTracePaths)).toEqual([
      'root',
      '0',
      '1',
      '1.2',
      '1.10',
    ]);
  });
});
