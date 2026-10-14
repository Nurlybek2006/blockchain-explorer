import type { PortfolioValuationSummary } from '@blockchain-explorer/contracts';
import { formatPercentage, formatUsd } from '@/lib/format';

export function valuationDisplay(summary: PortfolioValuationSummary) {
  return {
    total: formatUsd(summary.totalValueUsd),
    subtotal: formatUsd(summary.pricedValueUsd),
    change: formatPercentage(summary.change24hPercent),
    changeUsd: formatUsd(summary.change24hUsd),
    valueNote: summary.complete ? 'All observed assets priced' : `${summary.unpricedAssetCount} unpriced assets; priced subtotal ${formatUsd(summary.pricedValueUsd)}`,
    changeNote: summary.marketChangeComplete ? '24h market change of current holdings' : 'Market change is incomplete',
    stale: summary.staleAssetCount > 0,
  };
}
export function changeClass(value: string | null): string { return value === null ? 'muted' : value.startsWith('-') ? 'negative' : /[1-9]/.test(value) ? 'positive' : 'muted'; }
export function allocationWidth(value: string): number {
  const percent = Number(value);
  return Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
}
