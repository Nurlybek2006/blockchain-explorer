'use client';

import { useCallback, useState } from 'react';
import type { PortfolioAnalyticsResponse, PortfolioHistoryRange } from '@blockchain-explorer/contracts';
import { Card, EmptyState, ErrorState, Skeleton, StatCard, Tabs } from '@/components/ui';
import { useResource } from '@/hooks/use-resource';
import { portfolioApi } from '@/lib/api/portfolio.api';
import { isHistoryRange } from '@/lib/api/intelligence.decoder';
import { formatDecimal, formatPercentage, formatUsd } from '@/lib/format';
import { allocationWidth, changeClass } from '../portfolio/portfolio-display';
import { HistoryChart } from './history-chart';
import styles from './analytics.module.css';
import { useTranslation } from '@/hooks/use-translation';

export function PortfolioHistory({ id }: { id: string }) {
  const { t } = useTranslation();
  const [range, setRange] = useState<PortfolioHistoryRange>('7d');
  const load = useCallback((signal: AbortSignal) => portfolioApi.history(id, range, signal), [id, range]);
  const resource = useResource(load, { pollInterval: 60000 });
  return <Card title={t('portfolio.analytics.history')} action={<Tabs value={range} items={[{ id: '24h', label: t('portfolio.analytics.range24h') }, { id: '7d', label: t('portfolio.analytics.range7d') }, { id: '30d', label: t('portfolio.analytics.range30d') }, { id: '90d', label: t('portfolio.analytics.range90d') }]} onChange={value => { if (isHistoryRange(value)) setRange(value); }} />}>
    {resource.error ? <ErrorState error={resource.error} retry={resource.reload} /> : !resource.data || resource.data.range !== range ? <Skeleton /> : <HistoryChart key={`${id}-${range}`} points={resource.data.points} />}
  </Card>;
}
export function PortfolioAnalytics({ data, error, retry }: { data: PortfolioAnalyticsResponse | null; error: unknown; retry: () => void }) {
  const { t, locale } = useTranslation();
  if (error) return <Card title={t('portfolio.analytics.title')}><ErrorState error={error} retry={retry} /></Card>;
  if (!data) return <Card title={t('portfolio.analytics.title')}><Skeleton /></Card>;
  return <div className="page-stack">
    <div className="stats-grid">
      <StatCard label={t('portfolio.analytics.marketValueChange')} value={<span className={changeClass(data.change24hUsd)}>{formatUsd(data.change24hUsd, locale)}</span>} note={t(data.marketChangeComplete ? 'portfolio.analytics.currentHoldings' : 'portfolio.analytics.missingChange')} />
      <StatCard label={t('portfolio.analytics.bestAsset')} value={data.bestAsset?.symbol ?? t('portfolio.unavailable')} note={data.bestAsset ? formatPercentage(data.bestAsset.change24hPercent, locale) : t('portfolio.analytics.requiredPrices')} />
      <StatCard label={t('portfolio.analytics.worstAsset')} value={data.worstAsset?.symbol ?? t('portfolio.unavailable')} note={data.worstAsset ? formatPercentage(data.worstAsset.change24hPercent, locale) : t('portfolio.analytics.requiredPrices')} />
    </div>
    <Card title={t('portfolio.analytics.allocation')}>
      <p className={`muted ${styles.intro}`}>{t('portfolio.analytics.allocationSubtotal', { subtotal: formatUsd(data.pricedValueUsd, locale) })} {data.unpricedAssetCount > 0 && t(data.unpricedAssetCount === 1 ? 'portfolio.analytics.excludedAsset' : 'portfolio.analytics.excludedAssets', { count: data.unpricedAssetCount })}</p>
      {!data.allocation.length ? <EmptyState title={t('portfolio.analytics.noAllocation')} description={t('portfolio.analytics.allocationDescription')} /> : <div className={styles.allocation}>{data.allocation.map(item => <div key={item.assetKey}>
        <div className={styles.allocationLabel}><strong>{item.symbol}</strong><span title={`${item.valueUsd} USD`}>{formatUsd(item.valueUsd, locale)} · {formatDecimal(item.percentage, locale)}%</span></div>
        <div className={styles.barTrack} role="img" aria-label={t('portfolio.analytics.allocationLabel', { symbol: item.symbol, percentage: formatDecimal(item.percentage, locale) })}><div className={styles.bar} style={{ width: `${allocationWidth(item.percentage)}%` }} /></div>
      </div>)}</div>}
    </Card>
    <Card title={t('portfolio.analytics.performanceBasis')}><div className="page-stack"><p>{t('portfolio.analytics.performanceDescription')}</p><p className="muted">{t('pnl.analyticsNotice')}</p><div className="stats-grid"><StatCard label={t('portfolio.analytics.snapshotChange')} value={formatUsd(data.historicalChange24hUsd, locale)} note={formatPercentage(data.historicalChange24hPercent, locale)} /><StatCard label={t('portfolio.analytics.coverage')} value={t('portfolio.analytics.coverageCount', { priced: data.pricedAssetCount, unpriced: data.unpricedAssetCount })} note={t(data.complete ? 'portfolio.analytics.complete' : 'portfolio.analytics.incomplete')} /></div></div></Card>
  </div>;
}
