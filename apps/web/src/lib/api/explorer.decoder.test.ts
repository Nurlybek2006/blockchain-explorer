import { describe, expect, it } from 'vitest';
import { decodeExplorerAddressDetail, decodeExplorerBlockDetail, decodeExplorerBlocks, decodeExplorerStats, decodeExplorerTokenDetail, decodeExplorerTransactionDetail } from './explorer.decoder';

const hash = `0x${'a'.repeat(64)}`;
const address = `0x${'b'.repeat(40)}`;
const date = '2026-10-14T00:00:00.000Z';
const pagination = { page: 1, limit: 20, total: 1, totalPages: 1 };
const block = { number: '900719925474099312345', hash, parentHash: hash, miner: null, timestamp: date, gasLimit: '30000000', gasUsed: '123456789012345678901234567890', baseFeePerGas: null, size: null, transactionCount: 1, transactionsRoot: null, stateRoot: null, receiptsRoot: null, extraData: null, indexedAt: date };
const transaction = { hash, blockNumber: block.number, blockHash: hash, transactionIndex: 0, fromAddress: address, toAddress: null, nonce: '1', value: '123456789012345678901234567890', gas: '21000', gasPrice: null, maxFeePerGas: null, maxPriorityFeePerGas: null, type: 2, input: '0x', indexedAt: date };

describe('Explorer transport decoding', () => {
  it('preserves exact block and amount strings', () => {
    const decoded = decodeExplorerBlocks({ data: [block], pagination });
    expect(decoded.data[0]?.number).toBe(block.number);
    expect(decoded.data[0]?.gasUsed).toBe(block.gasUsed);
  });
  it('accepts empty explorer stats', () => {
    expect(decodeExplorerStats({ latestBlock: null, blocks: 0, transactions: 0, tokens: 0, tokenTransfers: 0 }).latestBlock).toBeNull();
  });
  it('accepts an indexed block and its nested transactions', () => {
    expect(decodeExplorerBlockDetail({ ...block, transactions: [transaction] }).transactions[0]?.toAddress).toBeNull();
  });
  it('accepts a missing receipt without fabricating transaction success', () => {
    expect(decodeExplorerTransactionDetail({ transaction, receipt: null, logs: [], tokenTransfers: [] }).receipt).toBeNull();
  });
  it('accepts the exact synthesized address response', () => {
    const decoded = decodeExplorerAddressDetail({ address: { address, isContract: false }, transactionCount: 1, tokenTransferCount: 0, transactions: [transaction], tokenTransfers: [], pagination });
    expect(decoded.address.nativeBalanceWei).toBeUndefined();
    expect(decoded.transactionCount).toBe(1);
  });
  it('keeps missing token metadata nullable', () => {
    const decoded = decodeExplorerTokenDetail({ token: { address, name: null, symbol: null, decimals: null, totalSupply: null, firstSeenBlock: null, lastUpdatedBlock: null, createdAt: date, updatedAt: date }, transfers: [], pagination: { ...pagination, total: 0, totalPages: 0 } });
    expect(decoded.token.decimals).toBeNull();
    expect(decoded.token.totalSupply).toBeNull();
  });
  it('rejects a float substituted for an exact amount', () => {
    expect(() => decodeExplorerBlocks({ data: [{ ...block, gasUsed: 123 }], pagination })).toThrow();
  });
  it('rejects the unrelated items-based pagination format', () => {
    expect(() => decodeExplorerBlocks({ items: [block], ...pagination })).toThrow();
  });
  it('rejects inconsistent pagination totals', () => {
    expect(() => decodeExplorerBlocks({ data: [], pagination: { ...pagination, totalPages: 20 } })).toThrow();
  });
  it('rejects malformed nested addresses', () => {
    expect(() => decodeExplorerTransactionDetail({ transaction: { ...transaction, fromAddress: 'not-address' }, receipt: null, logs: [], tokenTransfers: [] })).toThrow();
  });
  it('rejects invalid timestamps and numeric counters', () => {
    expect(() => decodeExplorerStats({ latestBlock: { number: '5', timestamp: 'bad' }, blocks: 1, transactions: 0, tokens: 0, tokenTransfers: 0 })).toThrow();
    expect(() => decodeExplorerStats({ latestBlock: null, blocks: -1, transactions: 0, tokens: 0, tokenTransfers: 0 })).toThrow();
  });
});
