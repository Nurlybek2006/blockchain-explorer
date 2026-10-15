import type { Metadata } from 'next';
import { TokensPage } from '@/features/explorer/tokens-page';
import { parseExplorerPagination } from '@/lib/utils/search';
import { getServerTranslation } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> { const { t } = await getServerTranslation(); return { title: t('explorer.metadata.tokens') }; }
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = parseExplorerPagination(await searchParams);
  return <TokensPage key={`${query.page}:${query.limit}`} {...query} />;
}
