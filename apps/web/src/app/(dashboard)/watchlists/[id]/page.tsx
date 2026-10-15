import type { Metadata } from 'next';
import { getServerTranslation } from '@/i18n/server';
import { WatchlistDetail } from '@/features/watchlists/watchlist-detail';

export async function generateMetadata(): Promise<Metadata> { const { t } = await getServerTranslation(); return { title: t('watchlists.details') }; }
export default async function WatchlistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WatchlistDetail key={id} id={id} />;
}
