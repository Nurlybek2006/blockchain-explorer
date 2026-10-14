import Link from 'next/link';
import type { Metadata } from 'next';
import { Card, EmptyState, PageHeading } from '@/components/ui';
import { SearchForm } from '@/features/explorer/search-form';
import { parseExplorerSearch } from '@/lib/utils/search';
import styles from '@/features/explorer/explorer.module.css';

export const metadata: Metadata = { title: 'Search' };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { q } = await searchParams;
  const result = parseExplorerSearch(typeof q === 'string' ? q : '');
  return <div className={styles.stack}><PageHeading eyebrow="EXPLORER" title="Search the blockchain" description="Find a block, transaction, address, or token on Sepolia." /><Card><SearchForm />{result.kind === 'invalid' ? <EmptyState title={q ? 'No matching input format' : 'Start with a block, hash, or address'} description={result.message} /> : <div className={styles.searchResult}><p>{result.kind === 'block' ? 'Block number' : result.kind === 'transaction' ? 'Transaction hash' : 'Ethereum address'}</p><Link className={styles.mono} href={result.href}>{result.value} →</Link>{result.kind === 'address' && <p><Link href={`/token/${result.value}`}>Open token details instead</Link></p>}</div>}</Card></div>;
}
