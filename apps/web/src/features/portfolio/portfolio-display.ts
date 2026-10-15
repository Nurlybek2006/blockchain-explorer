import type { PortfolioValuationSummary } from '@blockchain-explorer/contracts';
import { formatPercentage, formatUsd } from '@/lib/format';
import { createTranslator } from '@/i18n/translator';
import type { Locale } from '@/i18n/types';

export function valuationDisplay(summary: PortfolioValuationSummary, locale: Locale = 'en') {
  const t = createTranslator(locale);
  return {
    total: formatUsd(summary.totalValueUsd, locale),
    subtotal: formatUsd(summary.pricedValueUsd, locale),
    change: formatPercentage(summary.change24hPercent, locale),
    changeUsd: formatUsd(summary.change24hUsd, locale),
    valueNote: summary.complete ? t('portfolio.allPriced') : t(summary.unpricedAssetCount === 1 ? 'portfolio.unpricedSubtotalOne' : 'portfolio.unpricedSubtotal', { count: summary.unpricedAssetCount, subtotal: formatUsd(summary.pricedValueUsd, locale) }),
    changeNote: t(summary.marketChangeComplete ? 'portfolio.currentHoldingsChange' : 'portfolio.incompleteChange'),
    stale: summary.staleAssetCount > 0,
  };
}
export function changeClass(value: string | null): string { return value === null ? 'muted' : value.startsWith('-') ? 'negative' : /[1-9]/.test(value) ? 'positive' : 'muted'; }
export function allocationWidth(value: string): number {
  const percent = Number(value);
  return Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
}
