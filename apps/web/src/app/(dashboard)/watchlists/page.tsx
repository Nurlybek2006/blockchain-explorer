import type { Metadata } from 'next';
import { Watchlists } from '@/features/watchlists/watchlists';

export const metadata: Metadata = { title: 'Watchlists' };
export default async function WatchlistsPage({ searchParams }: { searchParams: Promise<{ page?: string | string[] }> }) {
  const query = await searchParams;
  const page = typeof query.page === 'string' && /^\d+$/.test(query.page) && Number.isSafeInteger(Number(query.page)) && Number(query.page) > 0 ? Math.min(Number(query.page), 10000) : 1;
  return <Watchlists key={page} page={page} />;
}
