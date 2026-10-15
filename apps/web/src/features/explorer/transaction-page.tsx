'use client';

import { useTranslation } from '@/hooks/use-translation';
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
  const { t, locale } = useTranslation();
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
  return <div className={styles.stack}><PageHeading eyebrow={t("explorer.labels.explorer")} title={t("explorer.transaction.title")} description={t("explorer.transaction.description")} /><ResourceView {...resource} retry={resource.reload} name={t("explorer.labels.transaction")}>{({ transaction: tx, receipt, logs, tokenTransfers, blockTimestamp }) => {
    const effectiveGasPrice = receipt?.effectiveGasPrice ?? tx.gasPrice;
    const feeWei = receipt && effectiveGasPrice !== null ? (BigInt(receipt.gasUsed) * BigInt(effectiveGasPrice)).toString() : null;
    const selector = tx.toAddress === null ? null : methodSelector(tx.input);
    return <><Tabs value={tab} onChange={setTab} items={[{ id: 'overview', label: t("explorer.labels.overview") }, { id: 'transfers', label: t("explorer.overview.tokenTransfers") }, { id: 'logs', label: t("explorer.transaction.logs") }, { id: 'trace', label: t("explorer.transaction.internalCalls") }]} /><div role="tabpanel" className={styles.stack}>
      {tab === 'overview' && <>
      <Card title={t("explorer.labels.overview")} action={receipt ? <StatusBadge status={receipt.status ? 'success' : 'failed'} /> : <Badge tone="warning">{t("explorer.transaction.receiptUnavailable")}</Badge>}><DetailFields fields={[
        { label: t("explorer.fields.transactionHash"), value: <CopyValue value={tx.hash} /> },
        { label: t("explorer.labels.block"), value: <Link href={`/blocks/${tx.blockNumber}`}>{formatBlockNumber(tx.blockNumber, locale)}</Link> },
        { label: t("explorer.fields.timestamp"), value: blockTimestamp ? <time dateTime={blockTimestamp}>{formatDateTime(blockTimestamp, locale)}</time> : t("explorer.labels.unavailable") },
        { label: t("explorer.fields.from"), value: <AddressLink address={tx.fromAddress} full /> },
        { label: t("explorer.fields.to"), value: tx.toAddress ? recipient.data ? <span className={styles.actions}><Badge tone="accent">{t("explorer.labels.contract")}</Badge><Link href={`/contract/${tx.toAddress}`} className={styles.mono}>{tx.toAddress}</Link></span> : <AddressLink address={tx.toAddress} full /> : receipt?.contractAddress ? <span className={styles.actions}><Badge tone="accent">{t("explorer.transaction.created")}</Badge><Link href={`/contract/${receipt.contractAddress}`} className={styles.mono}>{receipt.contractAddress}</Link></span> : t("explorer.table.contractCreation") },
        { label: t("explorer.fields.value"), value: <span title={`${tx.value} wei`}>{formatTokenAmount(tx.value, 18, 18, locale)} ETH</span> },
        { label: t("explorer.fields.transactionFee"), value: feeWei === null ? t("explorer.labels.unavailable") : <span title={`${feeWei} wei`}>{formatTokenAmount(feeWei, 18, 18, locale)} ETH</span> },
        { label: t("explorer.fields.gasPrice"), value: effectiveGasPrice === null ? t("explorer.labels.unavailable") : `${formatTokenAmount(effectiveGasPrice, 9, 9, locale)} Gwei` },
        { label: t("explorer.fields.gasLimit"), value: formatGas(tx.gas, locale) },
        { label: t("explorer.fields.gasUsed"), value: receipt ? formatGas(receipt.gasUsed, locale) : t("explorer.transaction.receiptUnavailable") },
        { label: t("explorer.fields.maxFee"), value: tx.maxFeePerGas === null ? '—' : `${formatTokenAmount(tx.maxFeePerGas, 9, 9, locale)} Gwei` },
        { label: t("explorer.fields.priorityFee"), value: tx.maxPriorityFeePerGas === null ? '—' : `${formatTokenAmount(tx.maxPriorityFeePerGas, 9, 9, locale)} Gwei` },
        { label: t("explorer.fields.nonce"), value: formatBigInteger(tx.nonce, locale) },
        { label: t("explorer.fields.position"), value: formatBigInteger(tx.transactionIndex, locale) },
        { label: t("explorer.fields.transactionType"), value: tx.type === null ? t("explorer.labels.unavailable") : formatBigInteger(tx.type, locale) },
        { label: t("explorer.fields.methodSelector"), value: selector ? <span className={styles.actions}><CopyValue value={selector} /><Badge>{t("explorer.transaction.unknownMethod")}</Badge></span> : t("explorer.transaction.noSelector") },
      ]} /></Card>
      <Card title={t("explorer.fields.inputData")}><pre className={styles.data}>{tx.input}</pre></Card>
      </>}
      {tab === 'transfers' && <Card title={t("explorer.transaction.transfersCount", { count: formatBigInteger(tokenTransfers.length, locale) })}><TransfersTable transfers={tokenTransfers} /><p className={styles.footerNote}>{t("explorer.transaction.rawNote")}</p></Card>}
      {tab === 'logs' && <Card title={t("explorer.transaction.logsCount", { count: formatBigInteger(logs.length, locale) })}>{logs.length === 0 ? <p className={styles.muted}>{t("explorer.transaction.noLogs")}</p> : logs.map((log) => <details className={styles.log} key={log.id}><summary className={styles.logSummary}><span className={styles.actions}><Badge>{t("explorer.transaction.log", { index: formatBigInteger(log.logIndex, locale) })}</Badge>{log.removed && <Badge tone="warning">{t("explorer.transaction.removed")}</Badge>}<span className={styles.muted}>{t("explorer.transaction.logDetails")}</span></span></summary><div className={styles.logTitle}><AddressLink address={log.address} /></div><div className={styles.topics}>{[log.topic0, log.topic1, log.topic2, log.topic3].map((topic, index) => topic === null ? null : <div className={styles.topic} key={index}><span className={styles.topicLabel}>{t("explorer.transaction.topic", { index: formatBigInteger(index, locale) })}</span><CopyValue value={topic} /></div>)}</div><pre className={styles.data}>{log.data}</pre></details>)}</Card>}
      {tab === 'trace' && <Card title={t("explorer.transaction.internalCalls")}><TraceView hash={hash} /></Card>}
      </div>
    </>;
  }}</ResourceView></div>;
}
