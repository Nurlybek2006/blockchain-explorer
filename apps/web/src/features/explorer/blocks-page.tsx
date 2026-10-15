'use client';

import { useTranslation } from '@/hooks/use-translation';
import { pluralCategory } from '@/i18n/translator';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeading, Pagination } from '@/components/ui';
import { useResource } from '@/hooks/use-resource';
import { explorerApi } from '@/lib/api/explorer.api';
import { formatBigInteger } from '@/lib/format';
import { BlocksTable } from './data-tables';
import { ResourceView } from './resource-view';
import { useRealtime, useRealtimeRefresh } from '@/providers/realtime-provider';
import { affectsExplorerOverview, affectsReorganizedData } from '@/features/realtime/resource-events';
import styles from './explorer.module.css';

export function BlocksPage({ page, limit }: { page: number; limit: number }) {
  const { t, locale } = useTranslation();
  const load = useCallback((signal: AbortSignal) => explorerApi.blocks(page, limit, signal), [page, limit]);
  const resource = useResource(load, { pollInterval: page === 1 ? 15_000 : undefined });
  const { subscribe } = useRealtime();
  const [newBlocks, setNewBlocks] = useState(false);
  useRealtimeRefresh(page === 1 ? affectsExplorerOverview : affectsReorganizedData, resource.reload);
  useEffect(() => subscribe(event => { if (page > 1 && event.type === 'block.indexed') setNewBlocks(true); }), [subscribe, page]);
  return <div className={styles.stack}><PageHeading eyebrow={t("explorer.labels.explorer")} title={t("explorer.labels.blocks")} description={t("explorer.blocks.description")} />{page > 1 && newBlocks && <Card><Link href={`/blocks?page=1&limit=${limit}`}>{t("explorer.blocks.newBlocks")}</Link></Card>}<ResourceView {...resource} retry={resource.reload}>{(data) => <Card title={t(pluralCategory(locale, data.pagination.total) === "one" ? "explorer.blocks.indexedCountOne" : "explorer.blocks.indexedCount", { count: formatBigInteger(String(data.pagination.total), locale) })}><BlocksTable blocks={data.data} extended /><Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} href={(p) => `/blocks?page=${p}&limit=${limit}`} /></Card>}</ResourceView></div>;
}
