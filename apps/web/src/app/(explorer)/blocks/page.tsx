import type { Metadata } from 'next';
import { BlocksPage } from '@/features/explorer/blocks-page';
import { parseExplorerPagination } from '@/lib/utils/search';

export const metadata: Metadata = { title: 'Blocks' };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = parseExplorerPagination(await searchParams);
  return <BlocksPage key={`${query.page}:${query.limit}`} {...query} />;
}
