'use client';

import Link from 'next/link';
import { useCallback } from 'react';
import { Badge, Button, Card, PageHeading, Pagination, StatCard } from '@/components/ui';
import { useResource } from '@/hooks/use-resource';
import { explorerApi } from '@/lib/api/explorer.api';
import { intelligenceApi } from '@/lib/api/intelligence.api';
import { formatBigInteger, formatBlockNumber, formatPercentage, formatTokenAmount, formatUsd } from '@/lib/format';
import { CopyValue, DetailFields } from './detail-fields';
import { TransfersTable } from './data-tables';
import { ResourceView } from './resource-view';
import { useRealtimeRefresh } from '@/providers/realtime-provider';
import { affectsToken } from '@/features/realtime/resource-events';
import styles from './explorer.module.css';

export function TokenPage({ address, page, limit }: { address: string; page: number; limit: number }) {
  const load = useCallback((signal: AbortSignal) => explorerApi.token(address, page, limit, signal), [address, page, limit]);
  const loadPrice = useCallback((signal: AbortSignal) => intelligenceApi.tokenPrice(address, signal), [address]);
  const resource = useResource(load);
  const relevant = useCallback((event: Parameters<typeof affectsToken>[0]) => affectsToken(event, address), [address]);
  useRealtimeRefresh(relevant, resource.reload);
  const price = useResource(loadPrice, { pollInterval: 60_000 });
  return <div className={styles.stack}><PageHeading eyebrow="ERC-20 TOKEN" title="Token details" description="Contract metadata and indexed transfer activity." action={<Link className={styles.pillLink} href={`/address/${address}`}>View address activity →</Link>} /><ResourceView {...resource} retry={resource.reload} name="Token">{({ token, transfers, pagination }) => <>
    <div className={styles.stats}><StatCard label="Token" value={token.name ?? 'Unknown token'} note={token.symbol ?? 'Symbol unavailable'} /><StatCard label="USD Price" value={!price.data && price.loading ? 'Loading quote…' : price.data?.priceUsd === null || !price.data ? 'Price unavailable' : formatUsd(price.data.priceUsd)} note={price.error && price.data?.priceUsd !== null && price.data ? 'Last received quote · refresh failed' : price.data?.stale ? <Badge tone="warning">Stale price</Badge> : price.data?.availability === 'available' ? 'Current reference price' : 'No price quote'} /><StatCard label="24h Market Change" value={price.data?.change24hPercent === null || !price.data ? 'Unavailable' : formatPercentage(price.data.change24hPercent)} /><StatCard label="Indexed Transfers" value={formatBigInteger(String(pagination.total))} /></div>
    {price.error && <div role="alert" className={styles.actions}><span className={styles.muted}>The price quote could not be refreshed.</span><Button variant="secondary" onClick={price.reload}>Retry price</Button></div>}
    <Card title={token.name ?? 'Token metadata'} action={<div className={styles.actions}><Badge tone="accent">ERC-20</Badge><Link href={`/contract/${address}`}>Contract verification →</Link></div>}><DetailFields fields={[
      { label: 'Contract address', value: <CopyValue value={token.address} /> },
      { label: 'Symbol', value: token.symbol ?? 'Unavailable' },
      { label: 'Decimals', value: token.decimals ?? 'Unavailable' },
      { label: 'Total supply', value: token.totalSupply === null ? 'Unavailable' : token.decimals === null ? `${formatBigInteger(token.totalSupply)} raw units` : <span title={token.totalSupply}>{formatTokenAmount(token.totalSupply, token.decimals, 8)} {token.symbol ?? ''}</span> },
      { label: 'First seen block', value: token.firstSeenBlock === null ? 'Unavailable' : <Link href={`/blocks/${token.firstSeenBlock}`}>{formatBlockNumber(token.firstSeenBlock)}</Link> },
      { label: 'Last updated block', value: token.lastUpdatedBlock === null ? 'Unavailable' : <Link href={`/blocks/${token.lastUpdatedBlock}`}>{formatBlockNumber(token.lastUpdatedBlock)}</Link> },
    ]} /><p className={styles.footerNote}>USD prices come from the configured pricing provider. Sepolia tokens may not have a price quote.</p></Card>
    <Card title="Recent transfers"><TransfersTable transfers={transfers} decimals={token.decimals} symbol={token.symbol} /><Pagination page={pagination.page} totalPages={pagination.totalPages} href={(p) => `/token/${address}?page=${p}&limit=${limit}`} /></Card>
  </>}</ResourceView></div>;
}
