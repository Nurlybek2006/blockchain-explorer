'use client';
import { Badge } from '@/components/ui';
import { formatBlockNumber } from '@/lib/format';
import { useRealtime } from '@/providers/realtime-provider';
import { connectionDisplay, networkDisplay } from './status-display';
import styles from './realtime.module.css';
export function LiveIndicator() { const { state } = useRealtime(), display = connectionDisplay(state); return <span role="status"><Badge tone={display.tone}>{display.label}</Badge></span>; }
export function NetworkStatusWidget() {
  const { network, networkUnavailable } = useRealtime(), status = network ? networkDisplay(network.status) : null;
  return <div className={styles.network} aria-label="Live network state"><div><strong>{network?.networkName ?? 'Sepolia'}</strong><LiveIndicator /></div><span title={network ? `RPC latest ${network.rpcLatestBlock ?? 'unknown'} · Updated ${network.updatedAt}` : undefined}>{network ? `Indexed ${network.indexedBlock === null ? 'unknown' : formatBlockNumber(network.indexedBlock)} · Lag ${network.lag === null ? 'unknown' : formatBlockNumber(network.lag)}` : networkUnavailable ? 'Network status unavailable' : 'Loading network status…'}</span>{status && <span className={styles.indexer}>{status.label}{networkUnavailable ? ' · refresh failed' : ''}</span>}</div>;
}
export function ReorgNotice() { const { reorg } = useRealtime(); return reorg === null ? null : <div className={styles.notice} role="status">Chain reorganized after block {formatBlockNumber(reorg)}. Explorer data is being refreshed.</div>; }
