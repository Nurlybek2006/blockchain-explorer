import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Erc20Client, EthereumRpcClient } from '@blockchain-explorer/blockchain-client';
import * as telemetry from '@blockchain-explorer/observability';
import { DatabaseService } from '../../database/database.service.js';
import { IndexerConfigService } from '../../config/indexer-config.service.js';
import { AdvancedExplorerRepository } from '../advanced/advanced-explorer.repository.js';
import { AddressIndexingService } from '../addresses/address-indexing.service.js';
import { TokenIndexingService } from '../tokens/token-indexing.service.js';
import { IndexerEventFactory } from '../messaging/indexer-event.factory.js';
import { rpcBlock, rpcReceipt, testConfig } from '../advanced/advanced.fixtures.js';
import { BlockProcessorService } from './block-processor.service.js';

vi.mock('@blockchain-explorer/observability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@blockchain-explorer/observability')>();
  return { ...actual, recordCounter: vi.fn(), recordHistogram: vi.fn(), withSpan: vi.fn(actual.withSpan) };
});

describe('canonical block business observations', () => {
  let database: DatabaseService;
  let rpc: EthereumRpcClient;
  let processor: BlockProcessorService;

  beforeEach(() => {
    vi.clearAllMocks();
    const config = testConfig();
    database = new DatabaseService(config);
    rpc = new EthereumRpcClient({ url: 'http://127.0.0.1:1/rpc', maxRetries: 0 });
    vi.spyOn(rpc, 'getTransactionReceipts').mockResolvedValue([rpcReceipt]);
    const tokens = new TokenIndexingService(database, new Erc20Client(rpc));
    vi.spyOn(tokens, 'prepare').mockResolvedValue({ tokens: [], transfers: [] });
    processor = new BlockProcessorService(database, rpc, new IndexerConfigService(config), tokens,
      new AddressIndexingService(), new IndexerEventFactory(), new AdvancedExplorerRepository(database), config);
  });
  afterEach(async () => { rpc.close(); await database.onModuleDestroy(); vi.restoreAllMocks(); });

  it('records successful counters only after the canonical database transaction resolves', async () => {
    let committed = false;
    vi.spyOn(database.db, 'transaction').mockImplementation(async () => { committed = true; });
    vi.mocked(telemetry.recordCounter).mockImplementation((name) => {
      if (name === 'indexer_blocks_processed_total') expect(committed).toBe(true);
    });
    await processor.process(11155111, 'ethereum-sepolia', rpcBlock, 1n);
    expect(telemetry.recordCounter).toHaveBeenCalledWith('indexer_blocks_processed_total');
    expect(telemetry.recordCounter).toHaveBeenCalledWith('indexer_transactions_processed_total', 1);
    expect(telemetry.recordCounter).toHaveBeenCalledWith('indexer_logs_processed_total', 0);
    expect(telemetry.recordCounter).toHaveBeenCalledWith('indexer_token_transfers_processed_total', 0);
    expect(vi.mocked(telemetry.withSpan).mock.calls.map(([name]) => name)).toEqual([
      'indexer.process_block', 'indexer.fetch_receipts', 'indexer.parse_erc20', 'indexer.persist_block',
    ]);
    expect(telemetry.recordHistogram).toHaveBeenCalledWith('indexer_block_processing_duration_seconds', expect.any(Number), { status: 'success' });
    // Dynamic block identities are useful span attributes, never metric labels.
    expect(vi.mocked(telemetry.recordCounter).mock.calls.every(([, , labels]) => labels === undefined)).toBe(true);
  });

  it('preserves rollback errors and emits no successful business counters', async () => {
    const failure = new Error('Canonical transaction rolled back');
    vi.spyOn(database.db, 'transaction').mockRejectedValue(failure);
    await expect(processor.process(11155111, 'ethereum-sepolia', rpcBlock, 1n)).rejects.toBe(failure);
    expect(telemetry.recordCounter).not.toHaveBeenCalled();
    expect(telemetry.recordHistogram).toHaveBeenCalledWith('indexer_block_processing_duration_seconds', expect.any(Number), { status: 'error' });
  });

  it('does not claim a pending block was processed or persist any canonical data', async () => {
    const persist = vi.spyOn(database.db, 'transaction');
    await expect(processor.process(11155111, 'ethereum-sepolia', { ...rpcBlock, number: null }, 1n)).rejects.toThrow('Cannot index pending block');
    expect(persist).not.toHaveBeenCalled();
    expect(telemetry.recordCounter).not.toHaveBeenCalled();
  });
});
