'use client';
import { Badge } from '@/components/ui';
import { useTranslation } from '@/hooks/use-translation';
import { formatBlockNumber, formatDateTime } from '@/lib/format';
import { useRealtime } from '@/providers/realtime-provider';
import { connectionDisplay, networkDisplay } from './status-display';
import styles from './realtime.module.css';

export function LiveIndicator() {
  const { locale } = useTranslation();
  const { state } = useRealtime(), display = connectionDisplay(state, locale);
  return <span role="status"><Badge tone={display.tone}>{display.label}</Badge></span>;
}

export function NetworkStatusWidget() {
  const { t, locale } = useTranslation();
  const { network, networkUnavailable } = useRealtime(), status = network ? networkDisplay(network.status, locale) : null;
  return <div className={styles.network} aria-label={t('realtime.network.aria')}><div><strong>{network?.networkName ?? 'Sepolia'}</strong><LiveIndicator /></div><span title={network ? t('realtime.network.tooltip', { block: network.rpcLatestBlock === null ? t('explorer.labels.unknown') : formatBlockNumber(network.rpcLatestBlock, locale), time: formatDateTime(network.updatedAt, locale) }) : undefined}>{network ? t('realtime.network.summary', { block: network.indexedBlock === null ? t('explorer.labels.unknown') : formatBlockNumber(network.indexedBlock, locale), lag: network.lag === null ? t('explorer.labels.unknown') : formatBlockNumber(network.lag, locale) }) : t(networkUnavailable ? 'realtime.network.unavailable' : 'realtime.network.loading')}</span>{status && <span className={styles.indexer}>{status.label}{networkUnavailable ? ` · ${t('realtime.network.refreshFailed')}` : ''}</span>}</div>;
}

export function ReorgNotice() {
  const { t, locale } = useTranslation();
  const { reorg } = useRealtime();
  return reorg === null ? null : <div className={styles.notice} role="status">{t('realtime.network.reorg', { block: formatBlockNumber(reorg, locale) })}</div>;
}
