import type { Metadata } from 'next';
import { ExplorerOverview } from '@/features/explorer/overview';
import { getServerTranslation } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation();
  return { title: t('explorer.metadata.home'), description: t('explorer.metadata.description') };
}

export default function Home() { return <ExplorerOverview />; }
