'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import type { PortfolioResponse } from '@blockchain-explorer/contracts';
import { AddressLink, Badge, Button, Card, EmptyState, ErrorState, Modal, PageHeading, Pagination, Skeleton } from '@/components/ui';
import { useResource } from '@/hooks/use-resource';
import { portfolioApi } from '@/lib/api/portfolio.api';
import { useToast } from '@/providers/toast-provider';
import { NameForm } from './forms';
import { changeClass, valuationDisplay } from './portfolio-display';
import styles from './portfolio.module.css';

function PortfolioCard({ portfolio }: { portfolio: PortfolioResponse }) {
  const resource = useResource(useCallback((signal: AbortSignal) => portfolioApi.valuation(portfolio.id, signal), [portfolio.id]), { pollInterval: 60000 });
  const display = resource.data ? valuationDisplay(resource.data.summary) : null;
  return <Card>
    <div className={styles.cardHeading}><Link href={`/portfolio/${portfolio.id}`} className={styles.name}>{portfolio.name}</Link>{portfolio.isPrimary && <Badge>Primary</Badge>}</div>
    <AddressLink address={portfolio.walletAddress} />
    {resource.error ? <ErrorState error={resource.error} retry={resource.reload} /> : !display || !resource.data ? <Skeleton /> : <>
      <p className={styles.total} title={resource.data.summary.totalValueUsd ?? 'Total valuation unavailable'}>{display.total}</p>
      <div className={styles.cardMetrics}><span className={changeClass(resource.data.summary.change24hPercent)}>{display.change} <small className="muted">24h</small></span><span className="muted">{resource.data.summary.assetCount} assets</span></div>
      <p className="muted">{display.valueNote}</p>{display.stale && <Badge>Stale pricing</Badge>}
    </>}
    <Link href={`/portfolio/${portfolio.id}`} className={styles.openLink}>View portfolio →</Link>
  </Card>;
}
export function PortfolioList({ page }: { page: number }) {
  const [creating, setCreating] = useState(false);
  const router = useRouter();
  const { notify } = useToast();
  const resource = useResource(useCallback((signal: AbortSignal) => portfolioApi.list(page, signal), [page]));
  return <div className="page-stack">
    <PageHeading eyebrow="Your workspace" title="Portfolio" description="Track your Ethereum wallets, holdings and market value." action={<Button onClick={() => setCreating(true)}>Add wallet</Button>} />
    {resource.error ? <ErrorState error={resource.error} retry={resource.reload} /> : !resource.data ? <div className="grid-three"><Skeleton /><Skeleton /><Skeleton /></div> : !resource.data.items.length ? <EmptyState title={page === 1 ? 'Add your first Ethereum wallet' : 'No portfolios on this page'} description="Connect a public wallet address to start tracking its balances." action={page === 1 ? <Button onClick={() => setCreating(true)}>Create portfolio</Button> : <Link href="/portfolio">Return to first page</Link>} /> : <>
      <div className="grid-three">{resource.data.items.map(portfolio => <PortfolioCard key={portfolio.id} portfolio={portfolio} />)}</div>
      <Pagination page={page} totalPages={resource.data.totalPages} onPageChange={next => router.push(`/portfolio?page=${next}`)} />
    </>}
    {creating && <Modal title="Create portfolio" onClose={() => setCreating(false)}><NameForm wallet submitLabel="Add wallet" onSubmit={async (name, walletAddress) => { const result = await portfolioApi.create({ name, walletAddress }); setCreating(false); notify('Portfolio created. Wallet balances are syncing.', 'success'); router.push(`/portfolio/${result.id}`); }} /></Modal>}
  </div>;
}
