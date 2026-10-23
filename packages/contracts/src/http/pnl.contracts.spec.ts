import { describe, expect, it } from 'vitest';
import { decodePortfolioPnl, decodePortfolioTrade, decodePortfolioTrades, isPortfolioTradeInput, tradeQuantityRaw, type PortfolioTradeInput } from './pnl.contracts.js';

const input: PortfolioTradeInput = { clientId: '11111111-1111-4111-8111-111111111111', assetKey: 'native:eth', symbol: 'ETH', decimals: 18,
  side: 'buy', quantityRaw: '2500000000000000000', unitPriceUsd: '2500', feeUsd: '0', occurredAt: '2026-01-01T12:00:00.000Z', transactionHash: null, activityId: null };
describe('bounded exact trade contracts', () => {
  it('converts human quantities to exact uint256 units, including very small tokens', () => {
    expect(tradeQuantityRaw('2.5', 18)).toBe('2500000000000000000');
    expect(tradeQuantityRaw('9007199254740993.000000000000000001', 18)).toBe('9007199254740993000000000000000001');
    expect(tradeQuantityRaw(`0.${'0'.repeat(254)}1`, 255)).toBe('1');
    for (const value of ['0', '-1', '1e18', 'NaN', '1,000', '1.0000000000000000001']) expect(tradeQuantityRaw(value, 18)).toBeNull();
    expect(tradeQuantityRaw(((1n << 256n)).toString(), 0)).toBeNull();
  });
  it('requires known cost/price and rejects malformed quantities, dates, asset metadata and arbitrary sides', () => {
    expect(isPortfolioTradeInput(input)).toBe(true);
    for (const change of [{ quantityRaw: 1 }, { quantityRaw: '0' }, { quantityRaw: '1e18' }, { feeUsd: '-1' }, { feeUsd: '1e10' }, { unitPriceUsd: null },
      { side: 'receive' }, { assetKey: 'eth' }, { decimals: 6 }, { symbol: 'BTC' }, { occurredAt: '2026-02-30T12:00:00Z' }, { transactionHash: 'secret' }, { activityId: 'event' }]) {
      expect(isPortfolioTradeInput({ ...input, ...change }), JSON.stringify(change)).toBe(false);
    }
    expect(isPortfolioTradeInput({ ...input, side: 'transfer_out', unitPriceUsd: null })).toBe(true);
    expect(isPortfolioTradeInput({ ...input, side: 'transfer_out', unitPriceUsd: null, feeUsd: '1' })).toBe(false);
    expect(isPortfolioTradeInput({ ...input, side: 'transfer_in', unitPriceUsd: '0' })).toBe(true);
    expect(isPortfolioTradeInput({ ...input, side: 'fee', unitPriceUsd: null })).toBe(true);
  });
  it('validates trade IDs, stable ordering and pagination without leaking extra response properties', () => {
    const item = { ...input, id: '22222222-2222-4222-8222-222222222222', sequence: '9007199254740993', private: 'hidden' };
    expect(decodePortfolioTrade(item)).not.toHaveProperty('private');
    expect(decodePortfolioTrades({ items: [item], total: 1, page: 1, limit: 20, totalPages: 1 }).items[0]?.quantityRaw).toBe(input.quantityRaw);
    expect(() => decodePortfolioTrades({ items: [item], total: 1, page: 1, limit: 20, totalPages: 0 })).toThrow();
    expect(() => decodePortfolioTrade({ ...item, sequence: 1 })).toThrow();
    expect(() => decodePortfolioPnl({ method: 'fifo' })).toThrow();
  });
});
