'use client';

import { useCallback } from 'react';
import { Card, PageHeading, Pagination } from '@/components/ui';
import { useResource } from '@/hooks/use-resource';
import { explorerApi } from '@/lib/api/explorer.api';
import { formatBigInteger } from '@/lib/format';
import { BlocksTable } from './data-tables';
import { ResourceView } from './resource-view';
import styles from './explorer.module.css';

export function BlocksPage({ page, limit }: { page: number; limit: number }) {
  const load = useCallback((signal: AbortSignal) => explorerApi.blocks(page, limit, signal), [page, limit]);
  const resource = useResource(load, { pollInterval: page === 1 ? 15_000 : undefined });
  return <div className={styles.stack}><PageHeading eyebrow="EXPLORER" title="Blocks" description="Indexed Sepolia blocks, ordered from newest to oldest." /><ResourceView {...resource} retry={resource.reload}>{(data) => <Card title={`${formatBigInteger(String(data.pagination.total))} indexed blocks`}><BlocksTable blocks={data.data} extended /><Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} href={(p) => `/blocks?page=${p}&limit=${limit}`} /></Card>}</ResourceView></div>;
}
