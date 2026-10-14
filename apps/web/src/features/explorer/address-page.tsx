'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { Badge, Card, PageHeading, Pagination, StatCard, Tabs } from '@/components/ui';
import { useResource } from '@/hooks/use-resource';
import { explorerApi } from '@/lib/api/explorer.api';
import { formatBigInteger, formatBlockNumber } from '@/lib/format';
import { CopyValue, DetailFields } from './detail-fields';
import { TransactionsTable, TransfersTable } from './data-tables';
import { ResourceView } from './resource-view';
import styles from './explorer.module.css';

export function AddressPage({ address, page, limit }: { address: string; page: number; limit: number }) {
  const [tab, setTab] = useState('transactions');
  const load = useCallback((signal: AbortSignal) => explorerApi.address(address, page, limit, signal), [address, page, limit]);
  const resource = useResource(load);
  return <div className={styles.stack}><PageHeading eyebrow="EXPLORER" title="Address details" description="Indexed activity for this Ethereum address." action={<Link className={styles.pillLink} href={`/token/${address}`}>View token details →</Link>} /><CopyValue value={address} /><ResourceView {...resource} retry={resource.reload} name="Address">{(data) => <>
    <div className={styles.stats}><StatCard label="ETH Balance" value="Unavailable" note="Wallet balances are not indexed here" /><StatCard label="Transactions" value={formatBigInteger(String(data.transactionCount))} /><StatCard label="ERC-20 Transfers" value={formatBigInteger(String(data.tokenTransferCount))} /><StatCard label="Address Type" value={<Badge tone={data.address.isContract ? 'accent' : 'neutral'}>{data.address.isContract ? 'Contract' : 'Wallet / unknown'}</Badge>} /></div>
    <Card title="Indexed address history"><DetailFields fields={[
      { label: 'First seen block', value: data.address.firstSeenBlock == null ? 'Unavailable' : <Link href={`/blocks/${data.address.firstSeenBlock}`}>{formatBlockNumber(data.address.firstSeenBlock)}</Link> },
      { label: 'Last seen block', value: data.address.lastSeenBlock == null ? 'Unavailable' : <Link href={`/blocks/${data.address.lastSeenBlock}`}>{formatBlockNumber(data.address.lastSeenBlock)}</Link> },
    ]} /></Card>
    <Card title="Activity"><Tabs items={[{ id: 'transactions', label: 'Transactions' }, { id: 'transfers', label: 'ERC-20 transfers' }]} value={tab} onChange={setTab} />{tab === 'transactions' ? <><TransactionsTable transactions={data.transactions} highlightAddress={address} /><Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} href={(p) => `/address/${address}?page=${p}&limit=${limit}`} /></> : <><TransfersTable transfers={data.tokenTransfers} highlightAddress={address} /><p className={styles.footerNote}>The {limit} most recent indexed transfers. Amounts use raw token units; token details provide the decimal scale.</p></>}</Card>
  </>}</ResourceView></div>;
}
