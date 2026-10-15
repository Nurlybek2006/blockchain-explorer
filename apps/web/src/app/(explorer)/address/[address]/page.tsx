import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isEthereumAddress } from '@blockchain-explorer/contracts/browser';
import { AddressPage } from '@/features/explorer/address-page';
import { parseExplorerPagination } from '@/lib/utils/search';
import { getServerTranslation } from '@/i18n/server';

type Props = { params: Promise<{ address: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
export async function generateMetadata({ params }: Pick<Props, 'params'>): Promise<Metadata> { const { address } = await params; const { t } = await getServerTranslation(); return { title: isEthereumAddress(address) ? t('explorer.metadata.address', { address: `${address.slice(0, 10)}…` }) : t('explorer.labels.address') }; }
export default async function Page({ params, searchParams }: Props) {
  const { address } = await params;
  if (!isEthereumAddress(address)) notFound();
  const query = parseExplorerPagination(await searchParams);
  return <AddressPage key={`${address}:${query.page}:${query.limit}`} address={address.toLowerCase()} {...query} />;
}
