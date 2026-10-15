'use client';

import { useTranslation } from '@/hooks/use-translation';
import { pluralCategory } from '@/i18n/translator';
import Link from 'next/link';
import { useCallback } from 'react';
import { Badge, Card, StatCard } from '@/components/ui';
import { useResource } from '@/hooks/use-resource';
import { explorerApi } from '@/lib/api/explorer.api';
import { formatBigInteger, formatBlockNumber } from '@/lib/format';
import { BlocksTable } from './data-tables';
import { ResourceView } from './resource-view';
import { SearchForm } from './search-form';
import { useRealtime, useRealtimeRefresh } from '@/providers/realtime-provider';
import { affectsExplorerOverview } from '@/features/realtime/resource-events';
import { LiveIndicator } from '@/features/realtime/live-status';
import { networkDisplay } from '@/features/realtime/status-display';
import styles from './explorer.module.css';

export function ExplorerOverview() {
  const { t, locale } = useTranslation();
  const { network, networkUnavailable } = useRealtime();
  const load = useCallback(async (signal: AbortSignal) => {
    const [stats, blocks] = await Promise.all([explorerApi.stats(signal), explorerApi.blocks(1, 8, signal)]);
    return { stats, blocks };
  }, []);
  const resource = useResource(load, { pollInterval: 15_000 });
  useRealtimeRefresh(affectsExplorerOverview, resource.reload);
  return <div className={styles.stack}>
    <section className={styles.hero}><div className={styles.heroContent}><Badge tone="accent">{t("explorer.overview.eyebrow")}</Badge><h1>{t("explorer.overview.headlineFirst")}<br />{t("explorer.overview.headlineSecond")}</h1><p>{t("explorer.overview.description")}</p><SearchForm /></div></section>
    <ResourceView {...resource} retry={resource.reload}>{({ stats, blocks }) => <>
      <div className={styles.stats}><StatCard label={t("explorer.overview.latestBlock")} value={stats.latestBlock ? <Link href={`/blocks/${stats.latestBlock.number}`}>{formatBlockNumber(stats.latestBlock.number, locale)}</Link> : t("explorer.labels.notIndexed")} note={t("explorer.overview.network")} /><StatCard label={t("explorer.overview.indexedBlocks")} value={formatBigInteger(String(stats.blocks), locale)} /><StatCard label={t("explorer.labels.transactions")} value={formatBigInteger(String(stats.transactions), locale)} /><StatCard label={t("explorer.labels.tokens")} value={formatBigInteger(String(stats.tokens), locale)} /><StatCard label={t("explorer.overview.tokenTransfers")} value={formatBigInteger(String(stats.tokenTransfers), locale)} /><StatCard label={t("realtime.network.lag")} value={network?.lag === null || !network ? t("explorer.labels.unknown") : t(pluralCategory(locale, BigInt(network.lag) === 1n ? 1 : 2) === "one" ? "realtime.network.blockCountOne" : "realtime.network.blockCount", { count: formatBlockNumber(network.lag, locale) })} note={networkUnavailable ? t("realtime.network.refreshFailed") : network ? networkDisplay(network.status, locale).label : t("realtime.network.loading")} /></div>
      <Card title={t("explorer.overview.latestBlocks")} action={<div className={styles.actions}><LiveIndicator /><Link href="/blocks">{t("explorer.overview.allBlocks")}</Link></div>}><BlocksTable blocks={blocks.data} /></Card>
    </>}</ResourceView>
  </div>;
}
