'use client';

import { useCallback } from 'react';
import { Card, PageHeading, Pagination } from '@/components/ui';
import { useResource } from '@/hooks/use-resource';
import { explorerApi } from '@/lib/api/explorer.api';
import { formatBigInteger } from '@/lib/format';
import { TokensTable } from './data-tables';
import { ResourceView } from './resource-view';
import styles from './explorer.module.css';

export function TokensPage({ page, limit }: { page: number; limit: number }) {
  const load = useCallback((signal: AbortSignal) => explorerApi.tokens(page, limit, signal), [page, limit]);
  const resource = useResource(load);
  return <div className={styles.stack}><PageHeading eyebrow="EXPLORER" title="Tokens" description="ERC-20 contracts discovered through indexed transfer activity." /><ResourceView {...resource} retry={resource.reload}>{(data) => <Card title={`${formatBigInteger(String(data.pagination.total))} indexed tokens`}><TokensTable tokens={data.data} /><Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} href={(p) => `/tokens?page=${p}&limit=${limit}`} /></Card>}</ResourceView></div>;
}
