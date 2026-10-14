import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isEthereumAddress } from '@blockchain-explorer/contracts/browser';
import { ContractPage } from '@/features/explorer/contract-page';
import { parseExplorerPagination } from '@/lib/utils/search';
type Props = { params: Promise<{ address: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
export async function generateMetadata({ params }: Pick<Props, 'params'>): Promise<Metadata> { const { address } = await params; return { title: isEthereumAddress(address) ? `Contract ${address.slice(0, 10)}…` : 'Contract' }; }
export default async function Page({ params, searchParams }: Props) { const { address } = await params; if (!isEthereumAddress(address)) notFound(); const query = parseExplorerPagination(await searchParams); return <ContractPage key={`${address}:${query.page}:${query.limit}`} address={address.toLowerCase()} {...query} />; }
