import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BlockPage } from '@/features/explorer/block-page';

type Props = { params: Promise<{ number: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> { const { number } = await params; return { title: /^\d+$/.test(number) ? `Block #${number}` : 'Block' }; }
export default async function Page({ params }: Props) {
  const { number } = await params;
  if (!/^\d+$/.test(number)) notFound();
  return <BlockPage key={number} number={BigInt(number).toString()} />;
}
