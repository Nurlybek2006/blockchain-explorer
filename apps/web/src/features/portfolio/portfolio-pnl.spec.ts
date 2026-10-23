import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PortfolioPnlResponse } from '@blockchain-explorer/contracts/browser';
import { LocaleProvider } from '@/providers/locale-provider';
import { formatUsd } from '@/lib/format';
import { ApiError, errorMessage } from '@/lib/api/client';
import { PnlSummary } from './portfolio-pnl';
import { rawQuantityText, tradeInputFromForm } from './trade-form';

const data: PortfolioPnlResponse = { method: 'moving_average', asOf: '2026-01-01T00:00:00.000Z', entryCount: 1,
  summary: { investedUsd: '6250', capitalBasisUsd: '6250', currentValueUsd: '8000', realizedPnlUsd: '0', unrealizedPnlUsd: '1750', totalPnlUsd: '1750', roiPercent: '28', complete: true },
  assets: [{ assetKey: 'native:eth', symbol: 'ETH', decimals: 18, balanceRaw: '2500000000000000000', ledgerBalanceRaw: '2500000000000000000', averageEntryPriceUsd: '2500', costBasisUsd: '6250', disposedCostBasisUsd: '0', priceUsd: '3200', currentValueUsd: '8000', realizedPnlUsd: '0', unrealizedPnlUsd: '1750', totalPnlUsd: '1750', roiPercent: '28', unrealizedRoiPercent: '28', complete: true, reasons: [] }] };
describe('localized true P&L interface', () => {
  it('renders the ETH example as realized/unrealized returns, separately from market changes', () => {
    const html = renderToString(createElement(LocaleProvider, { initialLocale: 'en' }, createElement(PnlSummary, { data })));
    for (const text of ['Invested', '$6,250.00', '$8,000.00', '+$1,750.00', '+28.00%', 'Average entry price', 'Realized P&amp;L', 'Unrealized P&amp;L', 'Reconciled']) expect(html).toContain(text);
  });
  it('localizes the whole financial panel while preserving exact API data', () => {
    const before = JSON.stringify(data);
    const html = renderToString(createElement(LocaleProvider, { initialLocale: 'kk' }, createElement(PnlSummary, { data })));
    for (const text of ['Орташа сатып алу бағасы', 'Өзіндік құн', 'Іске асқан пайда', 'Іске аспаған пайда', formatUsd('6250', 'kk'), formatUsd('1750', 'kk')]) expect(html).toContain(text);
    expect(html).not.toContain('Average entry price'); expect(JSON.stringify(data)).toBe(before);
  });
  it('shows missing history and unavailable profit as unknown, never as a fabricated zero-cost gain', () => {
    const incomplete: PortfolioPnlResponse = { ...data, entryCount: 0, summary: { ...data.summary, investedUsd: null, capitalBasisUsd: null, realizedPnlUsd: null, unrealizedPnlUsd: null, totalPnlUsd: null, roiPercent: null, complete: false },
      assets: data.assets.map(asset => ({ ...asset, averageEntryPriceUsd: null, costBasisUsd: null, disposedCostBasisUsd: null, realizedPnlUsd: null, unrealizedPnlUsd: null, totalPnlUsd: null, roiPercent: null, unrealizedRoiPercent: null, complete: false, reasons: ['history_missing'] })) };
    const html = renderToString(createElement(LocaleProvider, { initialLocale: 'kk' }, createElement(PnlSummary, { data: incomplete })));
    expect(html).toContain('Сатып алу тарихы жоқ'); expect(html).toContain('Тарих толық емес'); expect(html).not.toContain('+28'); expect(html).not.toContain(`>${formatUsd('0', 'kk')}<`);
  });
  it('maps journal validation and duplicate failures without exposing backend details', () => {
    for (const status of [400, 409]) {
      expect(errorMessage(new ApiError(status, `http_${status}`, 'SQL secret'), 'kk', 'trade')).not.toContain('SQL');
      expect(errorMessage(new ApiError(status, `http_${status}`, 'secret'), 'en', 'trade')).not.toContain('secret');
    }
  });
});

function form(): FormData {
  const result = new FormData();
  for (const [key, value] of Object.entries({ assetKey: 'native:eth', symbol: 'ETH', decimals: '18', side: 'buy', quantity: '2,5', unitPriceUsd: '2500,125', feeUsd: '10', occurredAt: '2026-01-01T12:00:00', transactionHash: '' })) result.set(key, value);
  return result;
}
describe('exact journal form input', () => {
  const clientId = '11111111-1111-4111-8111-111111111111';
  it('converts decimal comma quantities and USD values while interpreting the timestamp as UTC', () => {
    expect(tradeInputFromForm(form(), clientId, null)).toMatchObject({ clientId, quantityRaw: '2500000000000000000', unitPriceUsd: '2500.125', feeUsd: '10', occurredAt: '2026-01-01T12:00:00.000Z' });
  });
  it('preserves large raw quantities and dust through edit-prefill round trips', () => {
    const raw = '9007199254740993000000000000000001', input = form(); input.set('quantity', rawQuantityText(raw, 18));
    expect(tradeInputFromForm(input, clientId, null)?.quantityRaw).toBe(raw);
    expect(rawQuantityText('1', 18)).toBe('0.000000000000000001'); expect(rawQuantityText('100000000000000000000', 18)).toBe('100');
  });
  it('requires an actual execution price and rejects precision overflow, invalid dates and exponent notation', () => {
    for (const [key, value] of [['unitPriceUsd', ''], ['quantity', '1e18'], ['quantity', '0.0000000000000000001'], ['occurredAt', '2026-02-30T00:00:00']]) {
      const input = form(); input.set(key, value); expect(tradeInputFromForm(input, clientId, null)).toBeNull();
    }
  });
  it('never substitutes a market price for transfers out or fees paid in crypto', () => {
    for (const side of ['transfer_out', 'fee']) { const input = form(); input.set('side', side); input.delete('unitPriceUsd'); input.delete('feeUsd');
      expect(tradeInputFromForm(input, clientId, null)).toMatchObject({ side, unitPriceUsd: null, feeUsd: '0' }); }
  });
});
