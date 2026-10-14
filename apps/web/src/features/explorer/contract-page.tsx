'use client';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { Badge, Card, CopyButton, EmptyState, PageHeading, Pagination, Tabs } from '@/components/ui';
import { useResource } from '@/hooks/use-resource';
import { advancedExplorerApi } from '@/lib/api/advanced-explorer.api';
import { explorerApi } from '@/lib/api/explorer.api';
import { formatBlockNumber, formatDateTime } from '@/lib/format';
import { useRealtimeRefresh } from '@/providers/realtime-provider';
import { verificationDisplay } from '@/features/realtime/status-display';
import { affectsAddress } from '@/features/realtime/resource-events';
import { affectsReorganizedData } from '@/features/realtime/resource-events';
import { CodePanel } from './code-panel';
import { CopyValue, DetailFields } from './detail-fields';
import { TransactionsTable, TransfersTable } from './data-tables';
import { ResourceView } from './resource-view';
import styles from './explorer.module.css';
import advanced from './advanced.module.css';
export function ContractPage({ address, page, limit }: { address: string; page: number; limit: number }) {
  const [tab, setTab] = useState('transactions');
  const load = useCallback((signal: AbortSignal) => advancedExplorerApi.contract(address, signal), [address]);
  const contract = useResource(load, { pollInterval: 30000 });
  const loadActivity = useCallback((signal: AbortSignal) => explorerApi.address(address, page, limit, signal), [address, page, limit]);
  const activity = useResource(loadActivity, { enabled: tab === 'transactions' || tab === 'transfers' });
  const relevant = useCallback((event: Parameters<typeof affectsAddress>[0]) => affectsAddress(event, address), [address]);
  useRealtimeRefresh(relevant, activity.reload);
  useRealtimeRefresh(affectsReorganizedData, contract.reload);
  return <div className={styles.stack}><PageHeading eyebrow="SMART CONTRACT" title="Contract details" description="Indexed contract identity, verification source, and activity." action={<Link className={styles.pillLink} href={`/address/${address}`}>Address activity →</Link>} /><CopyValue value={address} /><ResourceView {...contract} retry={contract.reload} name="Contract">{data => {
    const v = data.verification, display = verificationDisplay(v.status), abiText = v.abi === null ? null : JSON.stringify(v.abi, null, 2);
    return <><Card title={v.contractName ?? 'Contract overview'} action={<Badge tone={display.tone}>{display.label}</Badge>}><DetailFields fields={[
      { label: 'Contract address', value: <CopyValue value={data.address} /> },
      { label: 'Verification source', value: v.verificationSource },
      { label: 'Compiler', value: v.compilerVersion ?? 'Unavailable' },
      { label: 'Optimization', value: v.optimizationUsed === null ? 'Unavailable' : `${v.optimizationUsed ? 'Enabled' : 'Disabled'}${v.optimizationRuns === null ? '' : ` · ${v.optimizationRuns} runs`}` },
      { label: 'First seen block', value: data.firstSeenBlock === null ? 'Unavailable' : <Link href={`/blocks/${data.firstSeenBlock}`}>{formatBlockNumber(data.firstSeenBlock)}</Link> },
      { label: 'Last seen block', value: data.lastSeenBlock === null ? 'Unavailable' : <Link href={`/blocks/${data.lastSeenBlock}`}>{formatBlockNumber(data.lastSeenBlock)}</Link> },
      { label: 'Verified at', value: v.verifiedAt === null ? 'Unavailable' : formatDateTime(v.verifiedAt) },
    ]} /></Card><Card title="Contract explorer"><Tabs value={tab} onChange={setTab} items={[{ id: 'transactions', label: 'Transactions' }, { id: 'transfers', label: 'Token Transfers' }, { id: 'contract', label: 'Contract' }, { id: 'abi', label: 'ABI' }]} /><div role="tabpanel">
      {(tab === 'transactions' || tab === 'transfers') && <ResourceView {...activity} retry={activity.reload} name="Activity">{a => tab === 'transactions' ? <><TransactionsTable transactions={a.transactions} highlightAddress={address} /><Pagination page={a.pagination.page} totalPages={a.pagination.totalPages} href={p => `/contract/${address}?page=${p}&limit=${limit}`} /></> : <><TransfersTable transfers={a.tokenTransfers} highlightAddress={address} /><p className={styles.footerNote}>Recent indexed ERC-20 transfers in raw units.</p></>}</ResourceView>}
      {tab === 'contract' && <>{v.sourceCode === null ? <EmptyState title={display.label} description="Verified source code is not available. Block indexing continues independently of verification lookup." /> : <CodePanel title="Verified contract source" value={v.sourceCode} />}{v.constructorArguments ? <CodePanel title="Constructor Arguments" value={v.constructorArguments} /> : <><h3>Constructor Arguments</h3><p className={styles.muted}>Unavailable or empty.</p></>}</>}
      {tab === 'abi' && (abiText === null ? <EmptyState title="ABI unavailable" description="The contract has no stored verified ABI." /> : <details className={advanced.abi} open><summary>Formatted contract ABI</summary><div className={advanced.panelHeading}><span className={styles.muted}>JSON interface</span><CopyButton value={abiText} label="Copy ABI" /></div><pre className={advanced.code} tabIndex={0} aria-label="Verified contract ABI">{abiText}</pre></details>)}
    </div></Card></>;
  }}</ResourceView></div>;
}
