'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { AddressLink, Badge, Button, Card, CopyButton, EmptyState, ErrorState, Modal, PageHeading, Skeleton, StatCard, Table } from '@/components/ui';
import { useResource } from '@/hooks/use-resource';
import { portfolioApi } from '@/lib/api/portfolio.api';
import { formatPercentage, formatTokenAmount, formatUsd } from '@/lib/format';
import { useToast } from '@/providers/toast-provider';
import { PortfolioAnalytics, PortfolioHistory } from '../analytics/portfolio-analytics';
import { ConfirmDialog, NameForm } from './forms';
import { changeClass, valuationDisplay } from './portfolio-display';
import styles from './portfolio.module.css';

export function PortfolioDetail({ id }: { id: string }) {
  const resource = useResource(useCallback((signal: AbortSignal) => portfolioApi.valuation(id, signal), [id]), { pollInterval: 30000 });
  const allocations = useResource(useCallback((signal: AbortSignal) => portfolioApi.analytics(id, signal), [id]), { pollInterval: 60000 });
  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const router = useRouter();
  const { notify } = useToast();
  if (resource.error) return <ErrorState error={resource.error} retry={resource.reload} />;
  if (!resource.data || resource.data.portfolio.id !== id) return <div className="page-stack"><Skeleton /><Skeleton /><Skeleton /></div>;
  const { portfolio, summary, holdings } = resource.data;
  const display = valuationDisplay(summary);
  return <div className="page-stack">
    <Link href="/portfolio" className="muted">← All portfolios</Link>
    <PageHeading eyebrow="Portfolio" title={portfolio.name} description="Current holdings and observed market value." action={<div className="actions"><Button variant="secondary" onClick={() => setEditing(true)}>Rename</Button><Button variant="danger" onClick={() => setArchiving(true)}>Archive</Button></div>} />
    <div className="actions"><AddressLink address={portfolio.walletAddress} /><CopyButton value={portfolio.walletAddress} />{portfolio.isPrimary && <Badge>Primary wallet</Badge>}</div>
    <div className="stats-grid">
      <StatCard label="Total value" value={<span title={summary.totalValueUsd ?? 'Unavailable'}>{display.total}</span>} note={display.valueNote} />
      <StatCard label="24h market change" value={<span className={changeClass(summary.change24hPercent)}>{display.change}</span>} note={`${display.changeUsd} · ${display.changeNote}`} />
      <StatCard label="Assets" value={summary.assetCount} note="Observed wallet assets" />
      <StatCard label="Priced assets" value={summary.pricedAssetCount} note={display.stale ? `${summary.staleAssetCount} prices are stale` : 'Freshness checked on refresh'} />
      <StatCard label="Unpriced assets" value={summary.unpricedAssetCount} note="Excluded from priced subtotal" />
    </div>
    {display.stale && <p className="muted" role="status">Some prices are stale. The displayed valuation includes their last known values.</p>}
    {!summary.complete && <p className="muted" role="status">Total valuation is unavailable until wallet sync and pricing are complete. Priced subtotal: {display.subtotal}.</p>}
    <Card title="Holdings" action={<Button variant="ghost" onClick={resource.reload}>Refresh</Button>}>
      {!holdings.length ? <EmptyState title="Waiting for wallet sync" description="Holdings appear after the initial wallet sync completes." /> : <Table label="Portfolio holdings"><thead><tr><th>Asset</th><th>Balance</th><th>Price</th><th>Value</th><th>24h change</th><th>Allocation</th></tr></thead><tbody>{holdings.map(holding => {
        const allocation = allocations.data?.allocation.find(item => item.assetKey === holding.assetKey);
        return <tr key={holding.assetKey}><td><div className={styles.assetName}>{holding.tokenAddress ? <Link href={`/token/${holding.tokenAddress}`}>{holding.symbol}</Link> : <strong>{holding.symbol}</strong>}{holding.priceStale && <Badge>Stale</Badge>}</div><small className="muted">{holding.name ?? (holding.tokenAddress ? 'ERC-20 token' : 'Native asset')}</small></td>
          <td className="mono" title={`${holding.balanceFormatted} ${holding.symbol}; raw ${holding.balanceRaw}`}>{formatTokenAmount(holding.balanceRaw, holding.decimals)}</td>
          <td className="mono" title={holding.priceUsd ?? 'Price unavailable'}>{formatUsd(holding.priceUsd)}</td>
          <td className="mono" title={holding.valueUsd ?? 'Value unavailable'}>{formatUsd(holding.valueUsd)}</td>
          <td className={changeClass(holding.change24hPercent)}>{formatPercentage(holding.change24hPercent)}</td>
          <td title="Share of priced assets">{allocation ? `${allocation.percentage}%` : '—'}</td></tr>;
      })}</tbody></Table>}
      <p className="muted">Allocation uses priced assets only. Amount tooltips preserve full precision.</p>
    </Card>
    <PortfolioHistory key={id} id={id} />
    <PortfolioAnalytics data={allocations.data} error={allocations.error} retry={allocations.reload} />
    {editing && <Modal title="Rename portfolio" onClose={() => setEditing(false)}><NameForm initialName={portfolio.name} submitLabel="Save name" onSubmit={async name => { await portfolioApi.rename(id, { name }); setEditing(false); resource.reload(); notify('Portfolio renamed.', 'success'); }} /></Modal>}
    {archiving && <ConfirmDialog title="Archive portfolio?" description="This wallet will leave your portfolio list. Its on-chain assets are unaffected." confirmLabel="Archive portfolio" onClose={() => setArchiving(false)} onConfirm={async () => { await portfolioApi.archive(id); setArchiving(false); notify('Portfolio archived.', 'success'); router.replace('/portfolio'); }} />}
  </div>;
}
