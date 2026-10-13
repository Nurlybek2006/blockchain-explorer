import { describe, expect, it } from 'vitest';
import { buildAnalytics, buildValuation } from './valuation.math.js';
import { holding, price, state } from './analytics.fixtures.js';

describe('exact portfolio valuation', () => {
  it('preserves integer magnitudes above Number.MAX_SAFE_INTEGER and 18-decimal dust together', () => {
    const valuation = buildValuation(state([
      holding('native:eth', '9007199254740993000000000000000000'), holding('dust', '1'),
    ]), new Map([['native:eth', price('native:eth', '0.1')], ['dust', price('dust', '1')]]));
    expect(valuation.holdings[0]?.balanceFormatted).toBe('9007199254740993');
    expect(valuation.holdings[0]?.valueUsd).toBe('900719925474099.3');
    expect(valuation.holdings[1]?.valueUsd).toBe('0.000000000000000001');
    expect(valuation.summary.totalValueUsd).toBe('900719925474099.300000000000000001');
    expect(valuation.holdings[0]?.lastUpdatedBlock).toBe('9007199254740993');
  });

  it('marks an unknown nonzero asset incomplete without replacing its price/value with zero', () => {
    const valuation = buildValuation(state([holding('native:eth', '2000000000000000000'), holding('unknown', '1')]),
      new Map([['native:eth', price('native:eth', '2000', '10', true)]]));
    expect(valuation.summary).toMatchObject({
      totalValueUsd: null, pricedValueUsd: '4000', complete: false, marketChangeComplete: false,
      change24hUsd: null, change24hPercent: null, pricedAssetCount: 1, unpricedAssetCount: 1, staleAssetCount: 1,
    });
    expect(valuation.holdings[1]).toMatchObject({ priceUsd: null, valueUsd: null, change24hPercent: null });
  });

  it('permits an actually zero portfolio while keeping an unavailable zero-balance price null', () => {
    const valuation = buildValuation(state([holding('unknown', '0')]), new Map());
    expect(valuation.summary).toMatchObject({ totalValueUsd: '0', complete: true, unpricedAssetCount: 1, marketChangeComplete: true });
    expect(valuation.holdings[0]).toMatchObject({ priceUsd: null, valueUsd: '0' });
    expect(buildAnalytics(valuation, '0')).toMatchObject({ historicalChange24hUsd: '0', historicalChange24hPercent: null });
  });

  it('derives market change from the prior price rather than multiplying current value by the percentage', () => {
    const valuation = buildValuation(state([holding('native:eth', '1000000000000000000')]),
      new Map([['native:eth', price('native:eth', '300', '50')]]));
    expect(valuation.summary).toMatchObject({ totalValueUsd: '300', change24hUsd: '100', change24hPercent: '50', marketChangeComplete: true });
  });

  it('keeps unknown change and nonpositive prior-price divisors unavailable', () => {
    for (const change of [null, '-100', '-101']) {
      const valuation = buildValuation(state([holding('native:eth', '1000000000000000000')]),
        new Map([['native:eth', price('native:eth', '100', change)]]));
      expect(valuation.summary).toMatchObject({ totalValueUsd: '100', complete: true, change24hUsd: null, change24hPercent: null, marketChangeComplete: false });
    }
  });
});

describe('portfolio analytics semantics', () => {
  it('allocates the known subtotal explicitly and excludes unknown/zero positions from best/worst performers', () => {
    const valuation = buildValuation(state([
      holding('a', '1', 0), holding('b', '1', 0), holding('unknown', '1', 0), holding('zero', '0', 0),
    ]), new Map([
      ['a', price('a', '60', '10')], ['b', price('b', '40', '-20')], ['zero', price('zero', '10', '99')],
    ]));
    const result = buildAnalytics(valuation, '50');
    expect(result.allocationBasis).toBe('priced_assets');
    expect(result.totalValueUsd).toBeNull();
    expect(result.pricedValueUsd).toBe('100');
    expect(result.allocation).toEqual([
      { assetKey: 'a', symbol: 'a', valueUsd: '60', percentage: '60' },
      { assetKey: 'b', symbol: 'b', valueUsd: '40', percentage: '40' },
      { assetKey: 'zero', symbol: 'zero', valueUsd: '0', percentage: '0' },
    ]);
    expect(result.bestAsset).toMatchObject({ assetKey: 'a', change24hPercent: '10' });
    expect(result.worstAsset).toMatchObject({ assetKey: 'b', change24hPercent: '-20' });
    expect(result.historicalChange24hUsd).toBeNull();
    expect(result.pnlAvailable).toBe(false);
    expect(result.pnlReason).toBe('cost_basis_unavailable');
  });

  it('keeps snapshot change distinct from 24h market-price change and cost-basis P&L', () => {
    const valuation = buildValuation(state([holding('native:eth', '1000000000000000000')]),
      new Map([['native:eth', price('native:eth', '300', '50')]]));
    expect(buildAnalytics(valuation, '250')).toMatchObject({
      change24hUsd: '100', change24hPercent: '50', historicalChange24hUsd: '50', historicalChange24hPercent: '20',
      pnlAvailable: false, pnlReason: 'cost_basis_unavailable',
    });
    expect(buildAnalytics(valuation, null).historicalChange24hUsd).toBeNull();
  });

  it('calculates allocations before monetary display rounding', () => {
    const valuation = buildValuation(state([holding('small', '1', 20), holding('large', '99', 20)]),
      new Map([['small', price('small', '1')], ['large', price('large', '1')]]));
    const allocation = buildAnalytics(valuation, null).allocation;
    expect(allocation.find((item) => item.assetKey === 'small')?.percentage).toBe('1');
    expect(allocation.find((item) => item.assetKey === 'large')?.percentage).toBe('99');
  });
});
