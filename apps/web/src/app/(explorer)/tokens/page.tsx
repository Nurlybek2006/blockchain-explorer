import type { Metadata } from 'next';
import { TokensPage } from '@/features/explorer/tokens-page';
import { parseExplorerPagination } from '@/lib/utils/search';

export const metadata: Metadata = { title: 'ERC-20 Tokens' };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = parseExplorerPagination(await searchParams);
  return <TokensPage key={`${query.page}:${query.limit}`} {...query} />;
}
