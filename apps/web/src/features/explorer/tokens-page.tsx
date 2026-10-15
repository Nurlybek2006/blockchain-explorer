'use client';

import { useTranslation } from '@/hooks/use-translation';
import { pluralCategory } from '@/i18n/translator';
import { useCallback } from 'react';
import { Card, PageHeading, Pagination } from '@/components/ui';
import { useResource } from '@/hooks/use-resource';
import { explorerApi } from '@/lib/api/explorer.api';
import { formatBigInteger } from '@/lib/format';
import { TokensTable } from './data-tables';
import { ResourceView } from './resource-view';
import styles from './explorer.module.css';

export function TokensPage({ page, limit }: { page: number; limit: number }) {
  const { t, locale } = useTranslation();
  const load = useCallback((signal: AbortSignal) => explorerApi.tokens(page, limit, signal), [page, limit]);
  const resource = useResource(load);
  return <div className={styles.stack}><PageHeading eyebrow={t("explorer.labels.explorer")} title={t("explorer.labels.tokens")} description={t("explorer.token.listDescription")} /><ResourceView {...resource} retry={resource.reload}>{(data) => <Card title={t(pluralCategory(locale, data.pagination.total) === "one" ? "explorer.token.indexedCountOne" : "explorer.token.indexedCount", { count: formatBigInteger(String(data.pagination.total), locale) })}><TokensTable tokens={data.data} /><Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} href={(p) => `/tokens?page=${p}&limit=${limit}`} /></Card>}</ResourceView></div>;
}
