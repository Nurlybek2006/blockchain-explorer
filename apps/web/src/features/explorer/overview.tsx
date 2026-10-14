'use client';

import Link from 'next/link';
import { useCallback } from 'react';
import { Badge, Card, StatCard } from '@/components/ui';
import { useResource } from '@/hooks/use-resource';
import { explorerApi } from '@/lib/api/explorer.api';
import { formatBigInteger, formatBlockNumber } from '@/lib/format';
import { BlocksTable } from './data-tables';
import { ResourceView } from './resource-view';
import { SearchForm } from './search-form';
import styles from './explorer.module.css';

export function ExplorerOverview() {
  const load = useCallback(async (signal: AbortSignal) => {
    const [stats, blocks] = await Promise.all([explorerApi.stats(signal), explorerApi.blocks(1, 8, signal)]);
    return { stats, blocks };
  }, []);
  const resource = useResource(load, { pollInterval: 15_000 });
  return <div className={styles.stack}>
    <section className={styles.hero}><div className={styles.heroContent}><Badge tone="accent">SEPOLIA EXPLORER</Badge><h1>Every block.<br />A clearer picture.</h1><p>Explore Ethereum activity, follow token transfers, and turn your wallets into a portfolio you can understand.</p><SearchForm /></div></section>
    <ResourceView {...resource} retry={resource.reload}>{({ stats, blocks }) => <>
      <div className={styles.stats}><StatCard label="Latest Block" value={stats.latestBlock ? <Link href={`/blocks/${stats.latestBlock.number}`}>{formatBlockNumber(stats.latestBlock.number)}</Link> : 'Not indexed'} note="Sepolia network" /><StatCard label="Indexed Blocks" value={formatBigInteger(String(stats.blocks))} /><StatCard label="Transactions" value={formatBigInteger(String(stats.transactions))} /><StatCard label="Tokens" value={formatBigInteger(String(stats.tokens))} /><StatCard label="Token Transfers" value={formatBigInteger(String(stats.tokenTransfers))} /></div>
      <Card title="Latest blocks" action={<div className={styles.actions}><span className={styles.live}><span className={styles.liveDot} />Updates every 15s</span><Link href="/blocks">View all blocks →</Link></div>}><BlocksTable blocks={blocks.data} /></Card>
    </>}</ResourceView>
  </div>;
}
