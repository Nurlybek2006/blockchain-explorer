import type { Metadata } from 'next';
import { BlocksPage } from '@/features/explorer/blocks-page';
import { parseExplorerPagination } from '@/lib/utils/search';
import { getServerTranslation } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> { const { t } = await getServerTranslation(); return { title: t('explorer.metadata.blocks') }; }
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = parseExplorerPagination(await searchParams);
  return <BlocksPage key={`${query.page}:${query.limit}`} {...query} />;
}
