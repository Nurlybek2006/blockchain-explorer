'use client';

import { useTranslation } from '@/hooks/use-translation';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { Badge, Card, PageHeading, Pagination, StatCard, Tabs } from '@/components/ui';
import { useResource } from '@/hooks/use-resource';
import { explorerApi } from '@/lib/api/explorer.api';
import { formatBigInteger, formatBlockNumber } from '@/lib/format';
import { CopyValue, DetailFields } from './detail-fields';
import { TransactionsTable, TransfersTable } from './data-tables';
import { ResourceView } from './resource-view';
import { useRealtimeRefresh } from '@/providers/realtime-provider';
import { affectsAddress } from '@/features/realtime/resource-events';
import styles from './explorer.module.css';

export function AddressPage({ address, page, limit }: { address: string; page: number; limit: number }) {
  const { t, locale } = useTranslation();
  const [tab, setTab] = useState('transactions');
  const load = useCallback((signal: AbortSignal) => explorerApi.address(address, page, limit, signal), [address, page, limit]);
  const resource = useResource(load);
  const relevant = useCallback((event: Parameters<typeof affectsAddress>[0]) => affectsAddress(event, address), [address]);
  useRealtimeRefresh(relevant, resource.reload);
  return <div className={styles.stack}><PageHeading eyebrow={t("explorer.labels.explorer")} title={t("explorer.address.title")} description={t("explorer.address.description")} action={<Link className={styles.pillLink} href={`/token/${address}`}>{t("explorer.address.tokenDetails")}</Link>} /><CopyValue value={address} /><ResourceView {...resource} retry={resource.reload} name={t("explorer.labels.address")}>{(data) => <>
    <div className={styles.stats}><StatCard label={t("explorer.address.balance")} value={t("explorer.labels.unavailable")} note={t("explorer.address.balanceNote")} /><StatCard label={t("explorer.labels.transactions")} value={formatBigInteger(String(data.transactionCount), locale)} /><StatCard label={t("explorer.address.transfers")} value={formatBigInteger(String(data.tokenTransferCount), locale)} /><StatCard label={t("explorer.address.type")} value={<Badge tone={data.address.isContract ? 'accent' : 'neutral'}>{data.address.isContract ? t("explorer.labels.contract") : t("explorer.address.walletUnknown")}</Badge>} /></div>
    <Card title={t("explorer.address.history")} action={data.address.isContract ? <Link href={`/contract/${address}`}>{t("explorer.address.verification")}</Link> : undefined}><DetailFields fields={[
      { label: t("explorer.fields.firstSeen"), value: data.address.firstSeenBlock == null ? t("explorer.labels.unavailable") : <Link href={`/blocks/${data.address.firstSeenBlock}`}>{formatBlockNumber(data.address.firstSeenBlock, locale)}</Link> },
      { label: t("explorer.fields.lastSeen"), value: data.address.lastSeenBlock == null ? t("explorer.labels.unavailable") : <Link href={`/blocks/${data.address.lastSeenBlock}`}>{formatBlockNumber(data.address.lastSeenBlock, locale)}</Link> },
    ]} /></Card>
    <Card title={t("explorer.labels.activity")}><Tabs items={[{ id: 'transactions', label: t("explorer.labels.transactions") }, { id: 'transfers', label: t("explorer.table.transfers") }]} value={tab} onChange={setTab} />{tab === 'transactions' ? <><TransactionsTable transactions={data.transactions} highlightAddress={address} /><Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} href={(p) => `/address/${address}?page=${p}&limit=${limit}`} /></> : <><TransfersTable transfers={data.tokenTransfers} highlightAddress={address} /><p className={styles.footerNote}>{t("explorer.address.transfersNote", { count: formatBigInteger(limit, locale) })}</p></>}</Card>
  </>}</ResourceView></div>;
}
