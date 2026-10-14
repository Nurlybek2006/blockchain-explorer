import type { Metadata } from 'next';
import { WatchlistDetail } from '@/features/watchlists/watchlist-detail';

export const metadata: Metadata = { title: 'Watchlist details' };
export default async function WatchlistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WatchlistDetail key={id} id={id} />;
}
