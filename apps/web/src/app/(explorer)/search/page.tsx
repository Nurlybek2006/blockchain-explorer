import type { Metadata } from 'next';
import { SearchPage } from '@/features/explorer/search-page';

export const metadata: Metadata = { title: 'Search' };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { q } = await searchParams;
  return <SearchPage query={typeof q === 'string' ? q : ''} />;
}
