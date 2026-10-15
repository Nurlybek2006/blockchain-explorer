'use client';
import { useTranslation } from '@/hooks/use-translation';
import { useCallback, useMemo, useState } from 'react';
import { AddressLink, Badge, Button, Card, EmptyState, Table } from '@/components/ui';
import { useResource } from '@/hooks/use-resource';
import { advancedExplorerApi } from '@/lib/api/advanced-explorer.api';
import { formatBigInteger, formatGas, formatTokenAmount } from '@/lib/format';
import { traceMessage, traceStatusLabel } from '@/features/realtime/status-display';
import { affectsReorganizedData } from '@/features/realtime/resource-events';
import { useRealtimeRefresh } from '@/providers/realtime-provider';
import { CodePanel } from './code-panel';
import { ResourceView } from './resource-view';
import { prepareTraceRows } from './trace-tree';
import styles from './advanced.module.css';
export function TraceView({ hash }: { hash: string }) {
  const { t, locale } = useTranslation();
  const load = useCallback((signal: AbortSignal) => advancedExplorerApi.traces(hash, signal), [hash]);
  const resource = useResource(load, { pollInterval: 15000 });
  useRealtimeRefresh(affectsReorganizedData, resource.reload);
  const tree = useMemo(() => prepareTraceRows(resource.data?.traces ?? []), [resource.data]);
  const [visible, setVisible] = useState(500);
  return <ResourceView {...resource} retry={resource.reload} name={t("explorer.labels.trace")}>{data => !data.available ? <EmptyState title={traceStatusLabel(data.status, locale)} description={traceMessage(data.reason, locale)} action={<Button variant="secondary" onClick={resource.reload}>{t("explorer.trace.refresh")}</Button>} /> : <>
    <p className="muted">{t("explorer.trace.description")}</p>
    <div className={styles.tree} role="region" aria-label={t("explorer.trace.treeAria")} tabIndex={0}><ol className={styles.traceList}>{tree.rows.slice(0, visible).map(({ trace, visualDepth }) => <li key={trace.traceAddress}><details className={`${styles.call} ${trace.error ? styles.failed : ''}`}><summary><svg width={visualDepth * 18 + 18} height="32" className={styles.branch} aria-hidden="true"><path d={visualDepth === 0 ? 'M 8 8 V 24' : `M ${visualDepth * 18 - 8} 0 V 16 H ${visualDepth * 18 + 8}`} fill="none" stroke="currentColor" /></svg><span className={styles.callSummary}><Badge tone={trace.error ? 'danger' : trace.valueBearing ? 'success' : 'accent'}>{trace.callType ?? trace.type}</Badge><span className="mono">{trace.traceAddress}</span><span className="muted">{t("explorer.trace.depth", { depth: formatBigInteger(trace.depth, locale) })}</span>{trace.error && <Badge tone="danger">{t("explorer.trace.executionError")}</Badge>}</span></summary><div className={styles.callDetails}><dl><dt>{t("explorer.fields.from")}</dt><dd>{trace.fromAddress ? <AddressLink address={trace.fromAddress} full /> : t("explorer.labels.unavailable")}</dd><dt>{t("explorer.fields.to")}</dt><dd>{trace.toAddress ? <AddressLink address={trace.toAddress} full /> : t("explorer.labels.unavailable")}</dd><dt>{t("explorer.fields.value")}</dt><dd>{trace.value === null ? t("explorer.labels.unavailable") : `${formatTokenAmount(trace.value, 18, 18, locale)} ETH`}</dd><dt>{t("explorer.fields.gasUsed")}</dt><dd>{trace.gasUsed === null ? t("explorer.labels.unavailable") : formatGas(trace.gasUsed, locale)}</dd>{trace.error && <><dt>{t("explorer.trace.error")}</dt><dd>{t("explorer.trace.errorDescription")}</dd></>}</dl>{trace.input !== null && <CodePanel title={t("explorer.trace.input")} value={trace.input} />}{trace.output !== null && <CodePanel title={t("explorer.trace.output")} value={trace.output} />}</div></details></li>)}</ol></div>
    {tree.rows.length > visible && <Button variant="secondary" onClick={() => setVisible(value => value + 500)}>{t("explorer.trace.more", { count: formatBigInteger(tree.rows.length - visible, locale) })}</Button>}{tree.omitted > 0 && <p className="muted">{t("explorer.trace.omitted", { count: formatBigInteger(tree.omitted, locale) })}</p>}
    <Card title={t("explorer.trace.internalCount", { count: formatBigInteger(data.internalCalls.length, locale) })}>{data.internalCalls.length === 0 ? <EmptyState title={t("explorer.trace.noInternal")} description={t("explorer.trace.noInternalDescription")} /> : <Table label={t("explorer.trace.internal")}><thead><tr><th>{t("explorer.trace.path")}</th><th>{t("explorer.trace.type")}</th><th>{t("explorer.fields.from")}</th><th>{t("explorer.fields.to")}</th><th>{t("explorer.trace.ethValue")}</th><th>{t("explorer.fields.gasUsed")}</th></tr></thead><tbody>{data.internalCalls.slice(0, 1000).map(trace => <tr key={trace.traceAddress}><td className="mono">{trace.traceAddress}</td><td>{trace.callType ?? trace.type}</td><td>{trace.fromAddress ? <AddressLink address={trace.fromAddress} /> : t("explorer.labels.unavailable")}</td><td>{trace.toAddress ? <AddressLink address={trace.toAddress} /> : t("explorer.labels.unavailable")}</td><td>{trace.value === null ? t("explorer.labels.unavailable") : formatTokenAmount(trace.value, 18, 18, locale)}</td><td>{trace.gasUsed === null ? t("explorer.labels.unavailable") : formatGas(trace.gasUsed, locale)}</td></tr>)}</tbody></Table>}{data.internalCalls.length > 1000 && <p className="muted">{t("explorer.trace.bounded")}</p>}</Card>
  </>}</ResourceView>;
}
