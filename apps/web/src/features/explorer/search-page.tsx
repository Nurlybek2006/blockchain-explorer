'use client';
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
  const parsed = parseExplorerSearch(query);
  const load = useCallback((signal: AbortSignal) => advancedExplorerApi.search(query.trim(), signal), [query]);
  const resource = useResource(load, { enabled: parsed.kind !== 'invalid' });
  return <div className={styles.stack}><PageHeading eyebrow="EXPLORER" title="Search the blockchain" description="Find indexed blocks by number or hash, transactions, contracts, tokens, and addresses." /><Card><SearchForm />{parsed.kind === 'invalid' ? <EmptyState title={query ? 'No matching input format' : 'Start with a block, hash, or address'} description={parsed.message} /> : <ResourceView {...resource} name="Search result" retry={resource.reload}>{result => <div className={styles.searchResult}><p>Indexed {result.type}</p><Link className={styles.mono} href={result.destination}>{result.value} →</Link></div>}</ResourceView>}</Card></div>;
}
