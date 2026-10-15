'use client';

import { useTranslation } from '@/hooks/use-translation';
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
  const { t, locale } = useTranslation();
  const load = useCallback((signal: AbortSignal) => explorerApi.token(address, page, limit, signal), [address, page, limit]);
  const loadPrice = useCallback((signal: AbortSignal) => intelligenceApi.tokenPrice(address, signal), [address]);
  const resource = useResource(load);
  const relevant = useCallback((event: Parameters<typeof affectsToken>[0]) => affectsToken(event, address), [address]);
  useRealtimeRefresh(relevant, resource.reload);
  const price = useResource(loadPrice, { pollInterval: 60_000 });
  return <div className={styles.stack}><PageHeading eyebrow={t("explorer.token.eyebrow")} title={t("explorer.token.title")} description={t("explorer.token.description")} action={<Link className={styles.pillLink} href={`/address/${address}`}>{t("explorer.token.addressActivity")}</Link>} /><ResourceView {...resource} retry={resource.reload} name={t("explorer.labels.token")}>{({ token, transfers, pagination }) => <>
    <div className={styles.stats}><StatCard label={t("explorer.labels.token")} value={token.name ?? t("explorer.table.unknownToken")} note={token.symbol ?? t("explorer.token.symbolUnavailable")} /><StatCard label={t("explorer.token.price")} value={!price.data && price.loading ? t("explorer.token.loadingPrice") : price.data?.priceUsd === null || !price.data ? t("explorer.token.priceUnavailable") : formatUsd(price.data.priceUsd, locale)} note={price.error && price.data?.priceUsd !== null && price.data ? t("explorer.token.previousPrice") : price.data?.stale ? <Badge tone="warning">{t("explorer.token.stalePrice")}</Badge> : price.data?.availability === 'available' ? t("explorer.token.currentPrice") : t("explorer.token.noPrice")} /><StatCard label={t("explorer.token.change")} value={price.data?.change24hPercent === null || !price.data ? t("explorer.labels.unavailable") : formatPercentage(price.data.change24hPercent, locale)} /><StatCard label={t("explorer.token.indexedTransfers")} value={formatBigInteger(String(pagination.total), locale)} /></div>
    {price.error && <div role="alert" className={styles.actions}><span className={styles.muted}>{t("explorer.token.refreshFailed")}</span><Button variant="secondary" onClick={price.reload}>{t("explorer.token.retryPrice")}</Button></div>}
    <Card title={token.name ?? t("explorer.token.metadata")} action={<div className={styles.actions}><Badge tone="accent">ERC-20</Badge><Link href={`/contract/${address}`}>{t("explorer.address.verification")}</Link></div>}><DetailFields fields={[
      { label: t("explorer.fields.contractAddress"), value: <CopyValue value={token.address} /> },
      { label: t("explorer.fields.symbol"), value: token.symbol ?? t("explorer.labels.unavailable") },
      { label: t("explorer.fields.decimals"), value: token.decimals ?? t("explorer.labels.unavailable") },
      { label: t("explorer.fields.totalSupply"), value: token.totalSupply === null ? t("explorer.labels.unavailable") : token.decimals === null ? t("explorer.labels.rawAmount", { amount: formatBigInteger(token.totalSupply, locale) }) : <span title={token.totalSupply}>{formatTokenAmount(token.totalSupply, token.decimals, 8, locale)} {token.symbol ?? ''}</span> },
      { label: t("explorer.fields.firstSeen"), value: token.firstSeenBlock === null ? t("explorer.labels.unavailable") : <Link href={`/blocks/${token.firstSeenBlock}`}>{formatBlockNumber(token.firstSeenBlock, locale)}</Link> },
      { label: t("explorer.fields.lastUpdated"), value: token.lastUpdatedBlock === null ? t("explorer.labels.unavailable") : <Link href={`/blocks/${token.lastUpdatedBlock}`}>{formatBlockNumber(token.lastUpdatedBlock, locale)}</Link> },
    ]} /><p className={styles.footerNote}>{t("explorer.token.priceNote")}</p></Card>
    <Card title={t("explorer.token.recentTransfers")}><TransfersTable transfers={transfers} decimals={token.decimals} symbol={token.symbol} /><Pagination page={pagination.page} totalPages={pagination.totalPages} href={(p) => `/token/${address}?page=${p}&limit=${limit}`} /></Card>
  </>}</ResourceView></div>;
}
