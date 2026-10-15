import { describe, expect, it } from 'vitest';
import type { PortfolioValuationSummary } from '@blockchain-explorer/contracts';
import { allocationWidth, valuationDisplay } from './portfolio-display';

const summary: PortfolioValuationSummary = { totalValueUsd: null, pricedValueUsd: '12.34567890123456789', assetCount: 2, pricedAssetCount: 1, unpricedAssetCount: 1, complete: false, change24hUsd: null, change24hPercent: null, marketChangeComplete: false, staleAssetCount: 0 };
describe('valuation display semantics', () => {
  it('keeps unavailable totals distinct from priced subtotals', () => {
    const result = valuationDisplay(summary);
    expect(result.total).toBe('—'); expect(result.subtotal).toBe('$12.35'); expect(result.valueNote).toContain('1 unpriced'); expect(result.change).toBe('—');
  });
  it('shows actual zero when the wallet is fully valued', () => {
    const result = valuationDisplay({ ...summary, totalValueUsd: '0', pricedValueUsd: '0', complete: true, unpricedAssetCount: 0, change24hUsd: '0', change24hPercent: '0', marketChangeComplete: true });
    expect(result.total).toBe('$0.00'); expect(result.change).toBe('0.00%'); expect(result.changeUsd).toBe('$0.00');
  });
  it('labels stale and incomplete change separately', () => { const result = valuationDisplay({ ...summary, staleAssetCount: 1 }); expect(result.stale).toBe(true); expect(result.changeNote).toBe('Market change is incomplete'); });
  it('converts only bounded percentages for visual bar widths', () => { expect(allocationWidth('33.333333333333333333')).toBeCloseTo(33.333333); expect(allocationWidth('120')).toBe(100); expect(allocationWidth('-1')).toBe(0); expect(allocationWidth('invalid')).toBe(0); });
  it('localizes incomplete valuation without treating its subtotal as a total', () => {
    const result = valuationDisplay(summary, 'kk');
    expect(result.total).toBe('—');
    expect(result.valueNote).toContain('1 активтің бағасы белгісіз');
    expect(result.valueNote).toContain(result.subtotal);
    expect(result.changeNote).toBe('Нарықтық өзгеріс толық есептелмеген');
  });
});
