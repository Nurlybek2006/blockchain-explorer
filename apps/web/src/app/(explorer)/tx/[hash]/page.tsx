import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TransactionPage } from '@/features/explorer/transaction-page';
import { getServerTranslation } from '@/i18n/server';

type Props = { params: Promise<{ hash: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> { const { hash } = await params; const { t } = await getServerTranslation(); return { title: /^0x[0-9a-fA-F]{64}$/.test(hash) ? t('explorer.metadata.transaction', { hash: `${hash.slice(0, 12)}…` }) : t('explorer.labels.transaction') }; }
export default async function Page({ params }: Props) {
  const { hash } = await params;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) notFound();
  return <TransactionPage key={hash} hash={hash.toLowerCase()} />;
}
