import { createElement, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PortfolioAnalyticsResponse } from '@blockchain-explorer/contracts';
import { LocaleProvider } from '@/providers/locale-provider';
import type { Locale } from '@/i18n/types';
import { formatDateTime, formatDecimal } from '@/lib/format';
import { HistoryChart } from './history-chart';
import { PortfolioAnalytics } from './portfolio-analytics';

function render(locale: Locale, child: ReactNode): string { return renderToString(createElement(LocaleProvider, { initialLocale: locale }, child)); }
const points = [{ timestamp: '2026-10-14T12:00:00Z', valueUsd: '9007199254740993.123456789012345678' }, { timestamp: '2026-10-14T13:00:00Z', valueUsd: '9007199254740993.123456789012345679' }];
const data: PortfolioAnalyticsResponse = {
  totalValueUsd: null, pricedValueUsd: '12.34567890123456789', change24hUsd: '1.2345', change24hPercent: '10', historicalChange24hUsd: null, historicalChange24hPercent: null,
  bestAsset: { assetKey: 'native:ETH', symbol: 'ETH', change24hPercent: '10' }, worstAsset: null,
  allocation: [{ assetKey: 'native:ETH', symbol: 'ETH', valueUsd: '12.34567890123456789', percentage: '100.000000000000000001' }],
  pricedAssetCount: 1, unpricedAssetCount: 1, complete: false, marketChangeComplete: false, allocationBasis: 'priced_assets', pnlAvailable: false, pnlReason: 'cost_basis_unavailable',
};
describe('analytics and history localization', () => {
  it.each(['kk', 'en'] as const)('renders an accessible empty-history state in %s', locale => {
    const html = render(locale, createElement(HistoryChart, { points: [] }));
    expect(html).toContain(locale === 'kk' ? 'Сақталған құн мәліметі әзірге жоқ' : 'No snapshots yet');
  });
  it('localizes chart instructions, extrema, table and UTC dates while preserving exact amounts', () => {
    const before = JSON.stringify(points);
    const html = render('kk', createElement(HistoryChart, { points }));
    for (const label of ['Портфельдің USD бойынша құны', 'Ең төменгі құн', 'Ең жоғарғы құн', '2 сақталған мәліметті кестеде көру', 'Құн (USD)', 'Уақыт белгісі']) expect(html).toContain(label);
    expect(html).toContain(formatDecimal(points[0].valueUsd, 'kk'));
    expect(html).toContain(`title="${points[0].valueUsd}"`);
    expect(html).toContain(formatDateTime(points[0].timestamp, 'kk'));
    expect(html).toContain('tabindex="0"');
    expect(html).not.toContain('arrow keys');
    expect(JSON.stringify(points)).toBe(before);
  });
  it('retains English chart labels and handles a single snapshot naturally', () => {
    const html = render('en', createElement(HistoryChart, { points: points.slice(0, 1) }));
    expect(html).toContain('Use left and right arrow keys');
    expect(html).toContain('View 1 snapshot as a table');
    expect(html).toContain('Portfolio valuation snapshots');
  });
  it('localizes pricing coverage and allocation accessibility without claiming investment returns', () => {
    const before = JSON.stringify(data);
    const html = render('kk', createElement(PortfolioAnalytics, { data, error: null, retry: () => undefined }));
    for (const label of ['24 сағаттағы нарықтық құн өзгерісі', 'Ең көп өскен актив', 'Ең көп төмендеген актив', 'Активтердің үлесі', 'Бағасы белгілі: 1 / белгісіз: 1', 'Бағалау толық емес', 'Инвестиция кірістілігі мәмілелер журналы негізінде']) expect(html).toContain(label);
    expect(html).toContain(`ETH: бағасы белгілі активтердің ${formatDecimal(data.allocation[0].percentage, 'kk')}%-ы`);
    expect(html).not.toContain('Best performing asset');
    expect(JSON.stringify(data)).toBe(before);
  });
  it('keeps empty analytics and loading-state headings translated', () => {
    const loading = render('kk', createElement(PortfolioAnalytics, { data: null, error: null, retry: () => undefined }));
    expect(loading).toContain('Талдау');
    const empty = render('kk', createElement(PortfolioAnalytics, { data: { ...data, allocation: [] }, error: null, retry: () => undefined }));
    expect(empty).toContain('Үлес әзірге есептелмеген');
    expect(empty).toContain('Активтердің құны анықталған кезде үлес көрсетіледі.');
  });
});
