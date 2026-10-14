'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { AddressLink, Badge, Card, PageHeading, StatusBadge, Tabs } from '@/components/ui';
import { useResource } from '@/hooks/use-resource';
import { explorerApi } from '@/lib/api/explorer.api';
import { advancedExplorerApi } from '@/lib/api/advanced-explorer.api';
import { formatBigInteger, formatBlockNumber, formatDateTime, formatGas, formatTokenAmount } from '@/lib/format';
import { CopyValue, DetailFields } from './detail-fields';
import { TransfersTable } from './data-tables';
import { ResourceView } from './resource-view';
import { TraceView } from './trace-view';
import { methodSelector } from './trace-tree';
import { useRealtimeRefresh } from '@/providers/realtime-provider';
import { affectsReorganizedData } from '@/features/realtime/resource-events';
import styles from './explorer.module.css';

export function TransactionPage({ hash }: { hash: string }) {
  const [tab, setTab] = useState('overview');
  const load = useCallback(async (signal: AbortSignal) => {
    const detail = await explorerApi.transaction(hash, signal);
    let blockTimestamp: string | null = null;
    try { blockTimestamp = (await explorerApi.block(detail.transaction.blockNumber, signal)).timestamp; }
    catch (error) { if (signal.aborted) throw error; }
    return { ...detail, blockTimestamp };
  }, [hash]);
  const resource = useResource(load);
  useRealtimeRefresh(affectsReorganizedData, resource.reload);
  const target = resource.data?.transaction.toAddress ?? resource.data?.receipt?.contractAddress ?? null;
  const loadRecipient = useCallback((signal: AbortSignal) => advancedExplorerApi.contract(target ?? '', signal), [target]);
  const recipient = useResource(loadRecipient, { enabled: target !== null });
  return <div className={styles.stack}><PageHeading eyebrow="EXPLORER" title="Transaction details" description="On-chain execution, gas usage, and emitted events." /><ResourceView {...resource} retry={resource.reload} name="Transaction">{({ transaction: tx, receipt, logs, tokenTransfers, blockTimestamp }) => {
    const effectiveGasPrice = receipt?.effectiveGasPrice ?? tx.gasPrice;
    const feeWei = receipt && effectiveGasPrice !== null ? (BigInt(receipt.gasUsed) * BigInt(effectiveGasPrice)).toString() : null;
    const selector = tx.toAddress === null ? null : methodSelector(tx.input);
    return <><Tabs value={tab} onChange={setTab} items={[{ id: 'overview', label: 'Overview' }, { id: 'transfers', label: 'Token Transfers' }, { id: 'logs', label: 'Logs' }, { id: 'trace', label: 'Internal Calls / Trace' }]} /><div role="tabpanel" className={styles.stack}>
      {tab === 'overview' && <>
      <Card title="Overview" action={receipt ? <StatusBadge status={receipt.status ? 'success' : 'failed'} /> : <Badge tone="warning">Receipt unavailable</Badge>}><DetailFields fields={[
        { label: 'Transaction hash', value: <CopyValue value={tx.hash} /> },
        { label: 'Block', value: <Link href={`/blocks/${tx.blockNumber}`}>{formatBlockNumber(tx.blockNumber)}</Link> },
        { label: 'Timestamp', value: blockTimestamp ? <time dateTime={blockTimestamp}>{formatDateTime(blockTimestamp)}</time> : 'Unavailable' },
        { label: 'From', value: <AddressLink address={tx.fromAddress} full /> },
        { label: 'To', value: tx.toAddress ? recipient.data ? <span className={styles.actions}><Badge tone="accent">Contract</Badge><Link href={`/contract/${tx.toAddress}`} className={styles.mono}>{tx.toAddress}</Link></span> : <AddressLink address={tx.toAddress} full /> : receipt?.contractAddress ? <span className={styles.actions}><Badge tone="accent">Contract created</Badge><Link href={`/contract/${receipt.contractAddress}`} className={styles.mono}>{receipt.contractAddress}</Link></span> : 'Contract creation' },
        { label: 'Value', value: <span title={`${tx.value} wei`}>{formatTokenAmount(tx.value, 18, 18)} ETH</span> },
        { label: 'Transaction fee', value: feeWei === null ? 'Unavailable' : <span title={`${feeWei} wei`}>{formatTokenAmount(feeWei, 18, 18)} ETH</span> },
        { label: 'Gas price', value: effectiveGasPrice === null ? 'Unavailable' : `${formatTokenAmount(effectiveGasPrice, 9, 9)} Gwei` },
        { label: 'Gas limit', value: formatGas(tx.gas) },
        { label: 'Gas used', value: receipt ? formatGas(receipt.gasUsed) : 'Receipt unavailable' },
        { label: 'Max fee per gas', value: tx.maxFeePerGas === null ? '—' : `${formatTokenAmount(tx.maxFeePerGas, 9, 9)} Gwei` },
        { label: 'Max priority fee', value: tx.maxPriorityFeePerGas === null ? '—' : `${formatTokenAmount(tx.maxPriorityFeePerGas, 9, 9)} Gwei` },
        { label: 'Nonce', value: formatBigInteger(tx.nonce) },
        { label: 'Transaction position', value: String(tx.transactionIndex) },
        { label: 'Transaction type', value: tx.type === null ? 'Unavailable' : String(tx.type) },
        { label: 'Method selector', value: selector ? <span className={styles.actions}><CopyValue value={selector} /><Badge>Unknown method</Badge></span> : 'No method selector' },
      ]} /></Card>
      <Card title="Input data"><pre className={styles.data}>{tx.input}</pre></Card>
      </>}
      {tab === 'transfers' && <Card title={`ERC-20 transfers (${tokenTransfers.length})`}><TransfersTable transfers={tokenTransfers} /><p className={styles.footerNote}>Amounts are raw token units. Open token details for the verified decimal scale.</p></Card>}
      {tab === 'logs' && <Card title={`Event logs (${logs.length})`}>{logs.length === 0 ? <p className={styles.muted}>No logs were emitted by this transaction.</p> : logs.map((log) => <details className={styles.log} key={log.id}><summary className={styles.logSummary}><span className={styles.actions}><Badge>Log {log.logIndex}</Badge>{log.removed && <Badge tone="warning">Removed</Badge>}<span className={styles.muted}>View topics and data</span></span></summary><div className={styles.logTitle}><AddressLink address={log.address} /></div><div className={styles.topics}>{[log.topic0, log.topic1, log.topic2, log.topic3].map((topic, index) => topic === null ? null : <div className={styles.topic} key={index}><span className={styles.topicLabel}>Topic {index}</span><CopyValue value={topic} /></div>)}</div><pre className={styles.data}>{log.data}</pre></details>)}</Card>}
      {tab === 'trace' && <Card title="Internal Calls / Trace"><TraceView hash={hash} /></Card>}
      </div>
    </>;
  }}</ResourceView></div>;
}
