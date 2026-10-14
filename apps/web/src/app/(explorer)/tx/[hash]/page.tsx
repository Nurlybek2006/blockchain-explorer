import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TransactionPage } from '@/features/explorer/transaction-page';

type Props = { params: Promise<{ hash: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> { const { hash } = await params; return { title: /^0x[0-9a-fA-F]{64}$/.test(hash) ? `Transaction ${hash.slice(0, 12)}…` : 'Transaction' }; }
export default async function Page({ params }: Props) {
  const { hash } = await params;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) notFound();
  return <TransactionPage key={hash} hash={hash.toLowerCase()} />;
}
