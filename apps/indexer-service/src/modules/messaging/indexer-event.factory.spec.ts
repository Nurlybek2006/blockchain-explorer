import { isTokenTransferIndexedEvent } from '@blockchain-explorer/contracts';
import { describe, expect, it } from 'vitest';
import type { PreparedToken, PreparedTokenTransfer } from '../tokens/token-indexing.service.js';
import { IndexerEventFactory } from './indexer-event.factory.js';

const tokenAddress = `0x${'a'.repeat(40)}`;
const transfer: PreparedTokenTransfer = {
  transactionHash: `0x${'b'.repeat(64)}`,
  blockNumber: 9007199254740993n,
  tokenAddress,
  fromAddress: `0x${'c'.repeat(40)}`,
  toAddress: `0x${'d'.repeat(40)}`,
  amount: '900719925474099312345678901234567890',
  transactionIndex: 0,
  logIndex: 1,
};

function event(metadata?: PreparedToken[]) {
  const [result] = new IndexerEventFactory().createTokenTransfers(11155111, 'sepolia', [transfer], metadata);
  if (!result) throw new Error('Expected one transfer event');
  return result;
}

describe('token.transfer.indexed.v1 additive metadata compatibility', () => {
  it('preserves the legacy producer shape when metadata is omitted', () => {
    const legacy = event();
    expect(legacy.version).toBe(1);
    expect(legacy.payload).not.toHaveProperty('tokenDecimals');
    expect(legacy.payload).not.toHaveProperty('tokenSymbol');
    expect(legacy.payload.blockNumber).toBe('9007199254740993');
    expect(legacy.payload.amountRaw).toBe(transfer.amount);
    expect(isTokenTransferIndexedEvent(legacy)).toBe(true);
  });

  it('enriches case-insensitive metadata including valid zero and uint8 bounds', () => {
    for (const decimals of [0, 18, 255]) {
      const enriched = event([{ address: `0x${'A'.repeat(40)}`, decimals, symbol: 'UNIT' }]);
      expect(enriched.payload).toMatchObject({ tokenDecimals: decimals, tokenSymbol: 'UNIT' });
      expect(enriched.version).toBe(1);
      expect(isTokenTransferIndexedEvent(enriched)).toBe(true);
    }
  });

  it('treats symbol and decimals as independently optional and omits unknown metadata', () => {
    const symbolOnly = event([{ address: tokenAddress, decimals: null, symbol: 'UNIT' }]);
    expect(symbolOnly.payload).not.toHaveProperty('tokenDecimals');
    expect(symbolOnly.payload.tokenSymbol).toBe('UNIT');
    expect(isTokenTransferIndexedEvent(symbolOnly)).toBe(true);
    const decimalsOnly = event([{ address: tokenAddress, decimals: 6, symbol: null }]);
    expect(decimalsOnly.payload.tokenDecimals).toBe(6);
    expect(decimalsOnly.payload).not.toHaveProperty('tokenSymbol');
    expect(isTokenTransferIndexedEvent(decimalsOnly)).toBe(true);
    expect(event([{ address: `0x${'e'.repeat(40)}`, decimals: 6, symbol: 'OTHER' }]).payload)
      .not.toHaveProperty('tokenDecimals');
  });

  it('rejects invalid optional decimals and symbol without weakening the legacy guard', () => {
    const legacy = event();
    for (const decimals of [-1, 256, 1.5, '18', null]) {
      expect(isTokenTransferIndexedEvent({ ...legacy, payload: { ...legacy.payload, tokenDecimals: decimals } })).toBe(false);
    }
    expect(isTokenTransferIndexedEvent({ ...legacy, payload: { ...legacy.payload, tokenSymbol: 'a'.repeat(65) } })).toBe(false);
    expect(isTokenTransferIndexedEvent({ ...legacy, payload: { ...legacy.payload, tokenSymbol: 42 } })).toBe(false);
    expect(isTokenTransferIndexedEvent({ ...legacy, payload: { ...legacy.payload, tokenDecimals: undefined, tokenSymbol: undefined } })).toBe(true);
  });

  it('does not emit malformed token metadata that would poison a valid v1 transfer', () => {
    for (const decimals of [-1, 256, 1.5, NaN]) {
      const produced = event([{ address: tokenAddress, decimals, symbol: 'a'.repeat(65) }]);
      expect(produced.payload).not.toHaveProperty('tokenDecimals');
      expect(produced.payload).not.toHaveProperty('tokenSymbol');
      expect(isTokenTransferIndexedEvent(produced)).toBe(true);
    }
  });
});
