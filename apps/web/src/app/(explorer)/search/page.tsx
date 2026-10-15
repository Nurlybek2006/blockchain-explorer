import type { Metadata } from 'next';
import { SearchPage } from '@/features/explorer/search-page';
import { getServerTranslation } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> { const { t } = await getServerTranslation(); return { title: t('explorer.metadata.search') }; }
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { q } = await searchParams;
  return <SearchPage query={typeof q === 'string' ? q : ''} />;
}
