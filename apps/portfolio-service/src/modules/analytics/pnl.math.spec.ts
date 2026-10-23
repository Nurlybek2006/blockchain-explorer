import { describe, expect, it } from 'vitest';
import { decodePortfolioPnl, tradeQuantityRaw, type PortfolioTradeSide } from '@blockchain-explorer/contracts';
import { buildPnl, replayTrades, TradeHistoryError, type OrderedTrade } from './pnl.math.js';
import { buildValuation } from './valuation.math.js';
import { holding, price, state, testDate } from './analytics.fixtures.js';

function trade(side: PortfolioTradeSide, quantity: string, unitPriceUsd: string | null, sequence = 1, feeUsd = '0', assetKey = 'native:eth'): OrderedTrade {
  const quantityRaw = tradeQuantityRaw(quantity, 18);
  if (quantityRaw === null) throw new Error('Invalid test quantity');
  return { clientId: '11111111-1111-4111-8111-111111111111', assetKey, symbol: assetKey === 'native:eth' ? 'ETH' : 'TOKEN', decimals: 18,
    side, quantityRaw, unitPriceUsd, feeUsd, occurredAt: testDate.toISOString(), transactionHash: null, activityId: null, sequence: BigInt(sequence) };
}
function value(balance: string, quote: string | null, stale = false) {
  const raw = balance === '0' ? '0' : tradeQuantityRaw(balance, 18);
  if (raw === null) throw new Error('Invalid test balance');
  return buildValuation(state([holding('native:eth', raw)]), new Map([['native:eth', price('native:eth', quote, '0', stale)]]));
}

describe('transaction-based moving average P&L', () => {
  it('matches 2.5 ETH bought at $2500 and valued at $3200 exactly', () => {
    const result = buildPnl(value('2.5', '3200'), [trade('buy', '2.5', '2500')], testDate);
    expect(result.summary).toEqual({ investedUsd: '6250', capitalBasisUsd: '6250', currentValueUsd: '8000', realizedPnlUsd: '0', unrealizedPnlUsd: '1750', totalPnlUsd: '1750', roiPercent: '28', complete: true });
    expect(result.assets[0]).toMatchObject({ averageEntryPriceUsd: '2500', costBasisUsd: '6250', unrealizedRoiPercent: '28', reasons: [] });
    expect(decodePortfolioPnl(result)).toEqual(result);
  });
  it('matches invested $4000, current $5300, profit $1300 and ROI 32.5%', () => {
    expect(buildPnl(value('1', '5300'), [trade('buy', '1', '4000')]).summary).toMatchObject({ investedUsd: '4000', currentValueUsd: '5300', totalPnlUsd: '1300', roiPercent: '32.5' });
  });
  it('uses moving average rather than FIFO after multiple buys and a partial sale', () => {
    const result = buildPnl(value('1', '3000'), [trade('buy', '1', '1000'), trade('buy', '1', '3000', 2), trade('sell', '1', '2500', 3, '20')]);
    expect(result.assets[0]).toMatchObject({ averageEntryPriceUsd: '2000', costBasisUsd: '2000', disposedCostBasisUsd: '2000', realizedPnlUsd: '480', unrealizedPnlUsd: '1000', totalPnlUsd: '1480', roiPercent: '37' });
  });
  it('capitalizes buy fees, deducts sell fees and leaves no cost dust after a full close', () => {
    const result = buildPnl(value('0', null), [trade('buy', '1', '1000', 1, '10'), trade('sell', '1', '1500', 2, '5')]);
    expect(result.summary).toMatchObject({ investedUsd: '0', capitalBasisUsd: '1010', currentValueUsd: '0', realizedPnlUsd: '485', unrealizedPnlUsd: '0', totalPnlUsd: '485', complete: true });
    expect(result.assets[0]?.averageEntryPriceUsd).toBeNull();
  });
  it('does not average a new position with already fully disposed acquisition costs', () => {
    const result = buildPnl(value('1', '4000'), [trade('buy', '1', '1000'), trade('sell', '1', '1500', 2), trade('buy', '1', '3000', 3)]);
    expect(result.assets[0]).toMatchObject({ averageEntryPriceUsd: '3000', costBasisUsd: '3000', realizedPnlUsd: '500', unrealizedPnlUsd: '1000', totalPnlUsd: '1500', roiPercent: '37.5' });
  });
  it('carries transfer-in cost and transfer-out average basis without realizing a fictitious sale', () => {
    const result = buildPnl(value('0.5', '1000'), [trade('transfer_in', '1', '500'), trade('transfer_out', '0.5', null, 2)]);
    expect(result.summary).toMatchObject({ investedUsd: '250', capitalBasisUsd: '250', realizedPnlUsd: '0', unrealizedPnlUsd: '250', totalPnlUsd: '250', roiPercent: '100' });
  });
  it('reports losses with their sign and leaves ROI undefined for an explicit zero-cost acquisition', () => {
    expect(buildPnl(value('1', '500'), [trade('buy', '1', '1000')]).summary).toMatchObject({ totalPnlUsd: '-500', roiPercent: '-50' });
    expect(buildPnl(value('1', '500'), [trade('transfer_in', '1', '0')]).summary).toMatchObject({ investedUsd: '0', totalPnlUsd: '500', roiPercent: null });
  });
  it('reconciles gas paid in ETH as a cost disposal, without hiding it as a wallet transfer', () => {
    const result = buildPnl(value('0.99', '2000'), [trade('buy', '1', '1000'), trade('fee', '0.01', null, 2)]);
    expect(result.summary).toMatchObject({ investedUsd: '990', capitalBasisUsd: '1000', currentValueUsd: '1980', realizedPnlUsd: '-10', unrealizedPnlUsd: '990', totalPnlUsd: '980', roiPercent: '98', complete: true });
  });
  it('refuses to fabricate acquisition prices for an empty or incomplete journal', () => {
    const missing = buildPnl(value('2', '3000'), []);
    expect(missing.summary).toMatchObject({ investedUsd: null, currentValueUsd: '6000', realizedPnlUsd: null, unrealizedPnlUsd: null, totalPnlUsd: null, roiPercent: null, complete: false });
    expect(missing.assets[0]?.reasons).toContain('history_missing');
    const mismatch = buildPnl(value('2', '3000'), [trade('buy', '1', '1000')]);
    expect(mismatch.assets[0]?.reasons).toEqual(['balance_mismatch']);
    expect(mismatch.summary.totalPnlUsd).toBeNull();
  });
  it('preserves known basis and realized results when a current quote is missing or stale', () => {
    for (const valuation of [value('1', null), value('1', '3000', true)]) {
      const result = buildPnl(valuation, [trade('buy', '1', '1000')]);
      expect(result.summary).toMatchObject({ investedUsd: '1000', realizedPnlUsd: '0', currentValueUsd: null, unrealizedPnlUsd: null, complete: false });
      expect(result.assets[0]?.reasons).toContain(valuation.holdings[0]?.priceStale ? 'stale_price' : 'price_unavailable');
    }
  });
  it('requires observed balances, including native ETH, instead of assuming absent rows are zero', () => {
    const result = buildPnl(buildValuation(state([]), new Map()), [trade('buy', '1', '1000')]);
    expect(result.assets[0]).toMatchObject({ balanceRaw: null, ledgerBalanceRaw: '1000000000000000000', reasons: ['balance_unobserved'] });
    expect(result.summary.complete).toBe(false);
    const unobserved = value('1', '1000'); unobserved.holdings[0]!.lastUpdatedBlock = null;
    expect(buildPnl(unobserved, [trade('buy', '1', '1000')]).summary.totalPnlUsd).toBeNull();
  });
  it('keeps uint256-sized integers and 18-decimal fractional costs out of floating-point arithmetic', () => {
    const result = buildPnl(value('9007199254740993.000000000000000001', '0.2'), [trade('buy', '9007199254740993.000000000000000001', '0.1')]);
    expect(result.summary).toMatchObject({ investedUsd: '900719925474099.3', currentValueUsd: '1801439850948198.6', totalPnlUsd: '900719925474099.3', roiPercent: '100', complete: true });
    const dust = buildPnl(value('0.000000000000000001', '2'), [trade('buy', '0.000000000000000001', '1')]);
    expect(dust.summary.unrealizedPnlUsd).toBe('0.000000000000000001');
  });
  it('orders by execution time, then stable insertion sequence for equal timestamps', () => {
    const buy = trade('buy', '1', '1000', 1), sell = trade('sell', '1', '1500', 2);
    expect(replayTrades([sell, buy]).get('native:eth')?.realized.toString()).toBe('500');
    expect(() => replayTrades([{ ...sell, sequence: 1n }, { ...buy, sequence: 2n }])).toThrow(TradeHistoryError);
    expect(replayTrades([{ ...sell, sequence: 1n, occurredAt: '2026-10-15T00:00:00Z' }, { ...buy, sequence: 2n }]).get('native:eth')?.quantityRaw).toBe(0n);
  });
  it('rejects negative inventory and inconsistent decimals, including retroactive invalidation', () => {
    expect(() => replayTrades([trade('sell', '1', '1000')])).toThrow(TradeHistoryError);
    expect(() => replayTrades([trade('buy', '1', '1000'), trade('sell', '2', '1500', 2)])).toThrow(TradeHistoryError);
    expect(() => replayTrades([trade('buy', '1', '1000'), { ...trade('buy', '1', '1000', 2), decimals: 6 }])).toThrow(TradeHistoryError);
  });
});
