'use client';
import { useTranslation } from '@/hooks/use-translation';
import Link from 'next/link';
import { useCallback } from 'react';
import { Card, EmptyState, PageHeading } from '@/components/ui';
import { useResource } from '@/hooks/use-resource';
import { advancedExplorerApi } from '@/lib/api/advanced-explorer.api';
import { parseExplorerSearch } from '@/lib/utils/search';
import { SearchForm } from './search-form';
import { ResourceView } from './resource-view';
import styles from './explorer.module.css';
export function SearchPage({ query }: { query: string }) {
  const { t } = useTranslation();
  const parsed = parseExplorerSearch(query);
  const load = useCallback((signal: AbortSignal) => advancedExplorerApi.search(query.trim(), signal), [query]);
  const resource = useResource(load, { enabled: parsed.kind !== 'invalid' });
  return <div className={styles.stack}><PageHeading eyebrow={t("explorer.labels.explorer")} title={t("explorer.search.title")} description={t("explorer.search.description")} /><Card><SearchForm />{parsed.kind === 'invalid' ? <EmptyState title={query ? t("explorer.search.invalidTitle") : t("explorer.search.start")} description={t(parsed.code === 'too-long' ? 'explorer.search.tooLong' : 'explorer.search.invalid')} /> : <ResourceView {...resource} name={t("explorer.resource.searchResult")} retry={resource.reload}>{result => <div className={styles.searchResult}><p>{t('explorer.search.result', { type: t(`explorer.labels.${result.type}`) })}</p><Link className={styles.mono} href={result.destination}>{result.value} →</Link></div>}</ResourceView>}</Card></div>;
}
