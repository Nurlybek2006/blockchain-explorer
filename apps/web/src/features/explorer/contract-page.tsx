'use client';
import { useTranslation } from '@/hooks/use-translation';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { Badge, Card, CopyButton, EmptyState, PageHeading, Pagination, Tabs } from '@/components/ui';
import { useResource } from '@/hooks/use-resource';
import { advancedExplorerApi } from '@/lib/api/advanced-explorer.api';
import { explorerApi } from '@/lib/api/explorer.api';
import { formatBigInteger, formatBlockNumber, formatDateTime } from '@/lib/format';
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
  const { t, locale } = useTranslation();
  const [tab, setTab] = useState('transactions');
  const load = useCallback((signal: AbortSignal) => advancedExplorerApi.contract(address, signal), [address]);
  const contract = useResource(load, { pollInterval: 30000 });
  const loadActivity = useCallback((signal: AbortSignal) => explorerApi.address(address, page, limit, signal), [address, page, limit]);
  const activity = useResource(loadActivity, { enabled: tab === 'transactions' || tab === 'transfers' });
  const relevant = useCallback((event: Parameters<typeof affectsAddress>[0]) => affectsAddress(event, address), [address]);
  useRealtimeRefresh(relevant, activity.reload);
  useRealtimeRefresh(affectsReorganizedData, contract.reload);
  return <div className={styles.stack}><PageHeading eyebrow={t("explorer.contract.eyebrow")} title={t("explorer.contract.title")} description={t("explorer.contract.description")} action={<Link className={styles.pillLink} href={`/address/${address}`}>{t("explorer.contract.addressActivity")}</Link>} /><CopyValue value={address} /><ResourceView {...contract} retry={contract.reload} name={t("explorer.labels.contract")}>{data => {
    const v = data.verification, display = verificationDisplay(v.status, locale), abiText = v.abi === null ? null : JSON.stringify(v.abi, null, 2);
    return <><Card title={v.contractName ?? t("explorer.contract.overview")} action={<Badge tone={display.tone}>{display.label}</Badge>}><DetailFields fields={[
      { label: t("explorer.fields.contractAddress"), value: <CopyValue value={data.address} /> },
      { label: t("explorer.contract.verificationSource"), value: v.verificationSource === 'none' ? t("explorer.contract.noVerificationSource") : v.verificationSource },
      { label: t("explorer.contract.compiler"), value: v.compilerVersion ?? t("explorer.labels.unavailable") },
      { label: t("explorer.contract.optimization"), value: v.optimizationUsed === null ? t("explorer.labels.unavailable") : `${v.optimizationUsed ? t("explorer.labels.enabled") : t("explorer.labels.disabled")}${v.optimizationRuns === null ? '' : " · " + t("explorer.contract.runs", { count: formatBigInteger(v.optimizationRuns, locale) })}` },
      { label: t("explorer.fields.firstSeen"), value: data.firstSeenBlock === null ? t("explorer.labels.unavailable") : <Link href={`/blocks/${data.firstSeenBlock}`}>{formatBlockNumber(data.firstSeenBlock, locale)}</Link> },
      { label: t("explorer.fields.lastSeen"), value: data.lastSeenBlock === null ? t("explorer.labels.unavailable") : <Link href={`/blocks/${data.lastSeenBlock}`}>{formatBlockNumber(data.lastSeenBlock, locale)}</Link> },
      { label: t("explorer.contract.verifiedAt"), value: v.verifiedAt === null ? t("explorer.labels.unavailable") : formatDateTime(v.verifiedAt, locale) },
    ]} /></Card><Card title={t("explorer.contract.explorer")}><Tabs value={tab} onChange={setTab} items={[{ id: 'transactions', label: t("explorer.labels.transactions") }, { id: 'transfers', label: t("explorer.overview.tokenTransfers") }, { id: 'contract', label: t("explorer.labels.contract") }, { id: 'abi', label: 'ABI' }]} /><div role="tabpanel">
      {(tab === 'transactions' || tab === 'transfers') && <ResourceView {...activity} retry={activity.reload} name={t("explorer.labels.activity")}>{a => tab === 'transactions' ? <><TransactionsTable transactions={a.transactions} highlightAddress={address} /><Pagination page={a.pagination.page} totalPages={a.pagination.totalPages} href={p => `/contract/${address}?page=${p}&limit=${limit}`} /></> : <><TransfersTable transfers={a.tokenTransfers} highlightAddress={address} /><p className={styles.footerNote}>{t("explorer.contract.rawTransfers")}</p></>}</ResourceView>}
      {tab === 'contract' && <>{v.sourceCode === null ? <EmptyState title={display.label} description={t("explorer.contract.sourceUnavailable")} /> : <CodePanel title={t("explorer.contract.source")} value={v.sourceCode} />}{v.constructorArguments ? <CodePanel title={t("explorer.contract.constructor")} value={v.constructorArguments} /> : <><h3>{t("explorer.contract.constructor")}</h3><p className={styles.muted}>{t("explorer.contract.emptyConstructor")}</p></>}</>}
      {tab === 'abi' && (abiText === null ? <EmptyState title={t("explorer.contract.abiUnavailable")} description={t("explorer.contract.abiUnavailableDescription")} /> : <details className={advanced.abi} open><summary>{t("explorer.contract.formattedAbi")}</summary><div className={advanced.panelHeading}><span className={styles.muted}>{t("explorer.contract.jsonInterface")}</span><CopyButton value={abiText} label={t("explorer.contract.copyAbi")} /></div><pre className={advanced.code} tabIndex={0} aria-label={t("explorer.contract.verifiedAbi")}>{abiText}</pre></details>)}
    </div></Card></>;
  }}</ResourceView></div>;
}
