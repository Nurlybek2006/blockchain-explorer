'use client';

import { useCallback, useState } from 'react';
import type { PortfolioAnalyticsResponse, PortfolioHistoryRange } from '@blockchain-explorer/contracts';
import { Card, EmptyState, ErrorState, Skeleton, StatCard, Tabs } from '@/components/ui';
import { useResource } from '@/hooks/use-resource';
import { portfolioApi } from '@/lib/api/portfolio.api';
import { isHistoryRange } from '@/lib/api/intelligence.decoder';
import { formatPercentage, formatUsd } from '@/lib/format';
import { allocationWidth, changeClass } from '../portfolio/portfolio-display';
import { HistoryChart } from './history-chart';
import styles from './analytics.module.css';

export function PortfolioHistory({ id }: { id: string }) {
  const [range, setRange] = useState<PortfolioHistoryRange>('7d');
  const load = useCallback((signal: AbortSignal) => portfolioApi.history(id, range, signal), [id, range]);
  const resource = useResource(load, { pollInterval: 60000 });
  return <Card title="Portfolio history" action={<Tabs value={range} items={[{ id: '24h', label: '24H' }, { id: '7d', label: '7D' }, { id: '30d', label: '30D' }, { id: '90d', label: '90D' }]} onChange={value => { if (isHistoryRange(value)) setRange(value); }} />}>
    {resource.error ? <ErrorState error={resource.error} retry={resource.reload} /> : !resource.data || resource.data.range !== range ? <Skeleton /> : <HistoryChart key={`${id}-${range}`} points={resource.data.points} />}
  </Card>;
}
export function PortfolioAnalytics({ data, error, retry }: { data: PortfolioAnalyticsResponse | null; error: unknown; retry: () => void }) {
  if (error) return <Card title="Analytics"><ErrorState error={error} retry={retry} /></Card>;
  if (!data) return <Card title="Analytics"><Skeleton /></Card>;
  return <div className="page-stack">
    <div className="stats-grid">
      <StatCard label="24h market value change" value={<span className={changeClass(data.change24hUsd)}>{formatUsd(data.change24hUsd)}</span>} note={data.marketChangeComplete ? 'Current holdings at market prices' : 'Some asset change data is unavailable'} />
      <StatCard label="Best performing asset" value={data.bestAsset?.symbol ?? 'Unavailable'} note={data.bestAsset ? formatPercentage(data.bestAsset.change24hPercent) : '24h price data is required'} />
      <StatCard label="Worst performing asset" value={data.worstAsset?.symbol ?? 'Unavailable'} note={data.worstAsset ? formatPercentage(data.worstAsset.change24hPercent) : '24h price data is required'} />
    </div>
    <Card title="Asset allocation">
      <p className={`muted ${styles.intro}`}>Percentages use the priced subtotal of {formatUsd(data.pricedValueUsd)}. {data.unpricedAssetCount > 0 && `${data.unpricedAssetCount} unpriced assets are excluded.`}</p>
      {!data.allocation.length ? <EmptyState title="No allocation yet" description="Allocation appears when assets have a known value." /> : <div className={styles.allocation}>{data.allocation.map(item => <div key={item.assetKey}>
        <div className={styles.allocationLabel}><strong>{item.symbol}</strong><span title={`${item.valueUsd} USD`}>{formatUsd(item.valueUsd)} · {item.percentage}%</span></div>
        <div className={styles.barTrack} role="img" aria-label={`${item.symbol}: ${item.percentage}% of priced assets`}><div className={styles.bar} style={{ width: `${allocationWidth(item.percentage)}%` }} /></div>
      </div>)}</div>}
    </Card>
    <Card title="Performance basis"><div className="page-stack"><p>Market change compares the prices of your current holdings over 24 hours. Snapshot value change also reflects balance changes.</p><p className="muted">Investment P&amp;L is unavailable because cost basis is not recorded. These figures are not investment returns.</p><div className="stats-grid"><StatCard label="24h snapshot value change" value={formatUsd(data.historicalChange24hUsd)} note={formatPercentage(data.historicalChange24hPercent)} /><StatCard label="Pricing coverage" value={`${data.pricedAssetCount} priced / ${data.unpricedAssetCount} unpriced`} note={data.complete ? 'Complete valuation' : 'Incomplete valuation'} /></div></div></Card>
  </div>;
}
