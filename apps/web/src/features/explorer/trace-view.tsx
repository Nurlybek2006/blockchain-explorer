'use client';
import { useCallback, useMemo, useState } from 'react';
import { AddressLink, Badge, Button, Card, EmptyState, Table } from '@/components/ui';
import { useResource } from '@/hooks/use-resource';
import { advancedExplorerApi } from '@/lib/api/advanced-explorer.api';
import { formatGas, formatTokenAmount } from '@/lib/format';
import { traceMessage } from '@/features/realtime/status-display';
import { affectsReorganizedData } from '@/features/realtime/resource-events';
import { useRealtimeRefresh } from '@/providers/realtime-provider';
import { CodePanel } from './code-panel';
import { ResourceView } from './resource-view';
import { prepareTraceRows } from './trace-tree';
import styles from './advanced.module.css';
export function TraceView({ hash }: { hash: string }) {
  const load = useCallback((signal: AbortSignal) => advancedExplorerApi.traces(hash, signal), [hash]);
  const resource = useResource(load, { pollInterval: 15000 });
  useRealtimeRefresh(affectsReorganizedData, resource.reload);
  const tree = useMemo(() => prepareTraceRows(resource.data?.traces ?? []), [resource.data]);
  const [visible, setVisible] = useState(500);
  return <ResourceView {...resource} retry={resource.reload} name="Trace">{data => !data.available ? <EmptyState title={`Trace ${data.status.replaceAll('_', ' ')}`} description={traceMessage(data.reason)} action={<Button variant="secondary" onClick={resource.reload}>Refresh trace status</Button>} /> : <>
    <p className="muted">Call execution from the configured RPC provider. Depth and trace paths preserve the normalized call hierarchy.</p>
    <div className={styles.tree} role="region" aria-label="Transaction call tree" tabIndex={0}><ol className={styles.traceList}>{tree.rows.slice(0, visible).map(({ trace, visualDepth }) => <li key={trace.traceAddress}><details className={`${styles.call} ${trace.error ? styles.failed : ''}`}><summary><svg width={visualDepth * 18 + 18} height="32" className={styles.branch} aria-hidden="true"><path d={visualDepth === 0 ? 'M 8 8 V 24' : `M ${visualDepth * 18 - 8} 0 V 16 H ${visualDepth * 18 + 8}`} fill="none" stroke="currentColor" /></svg><span className={styles.callSummary}><Badge tone={trace.error ? 'danger' : trace.valueBearing ? 'success' : 'accent'}>{trace.callType ?? trace.type}</Badge><span className="mono">{trace.traceAddress}</span><span className="muted">Depth {trace.depth}</span>{trace.error && <Badge tone="danger">Error / revert</Badge>}</span></summary><div className={styles.callDetails}><dl><dt>From</dt><dd>{trace.fromAddress ? <AddressLink address={trace.fromAddress} full /> : 'Unavailable'}</dd><dt>To</dt><dd>{trace.toAddress ? <AddressLink address={trace.toAddress} full /> : 'Unavailable'}</dd><dt>Value</dt><dd>{trace.value === null ? 'Unavailable' : `${formatTokenAmount(trace.value, 18, 18)} ETH`}</dd><dt>Gas used</dt><dd>{trace.gasUsed === null ? 'Unavailable' : formatGas(trace.gasUsed)}</dd>{trace.error && <><dt>Error</dt><dd>{trace.error}</dd></>}</dl>{trace.input !== null && <CodePanel title="Input" value={trace.input} />}{trace.output !== null && <CodePanel title="Output" value={trace.output} />}</div></details></li>)}</ol></div>
    {tree.rows.length > visible && <Button variant="secondary" onClick={() => setVisible(value => value + 500)}>Show more calls ({tree.rows.length - visible} remaining)</Button>}{tree.omitted > 0 && <p className="muted">{tree.omitted} additional calls are available through the trace API; this view is bounded to 5,000 calls.</p>}
    <Card title={`Value-bearing internal calls (${data.internalCalls.length})`}>{data.internalCalls.length === 0 ? <EmptyState title="No value-bearing internal calls" description="Root execution, failed calls, DELEGATECALL and STATICCALL values are excluded." /> : <Table label="Value-bearing internal calls"><thead><tr><th>Trace path</th><th>Type</th><th>From</th><th>To</th><th>ETH value</th><th>Gas used</th></tr></thead><tbody>{data.internalCalls.slice(0, 1000).map(trace => <tr key={trace.traceAddress}><td className="mono">{trace.traceAddress}</td><td>{trace.callType ?? trace.type}</td><td>{trace.fromAddress ? <AddressLink address={trace.fromAddress} /> : 'Unavailable'}</td><td>{trace.toAddress ? <AddressLink address={trace.toAddress} /> : 'Unavailable'}</td><td>{trace.value === null ? 'Unavailable' : formatTokenAmount(trace.value, 18, 18)}</td><td>{trace.gasUsed === null ? 'Unavailable' : formatGas(trace.gasUsed)}</td></tr>)}</tbody></Table>}{data.internalCalls.length > 1000 && <p className="muted">Showing the first 1,000 value-bearing calls.</p>}</Card>
  </>}</ResourceView>;
}
