import type { Metadata } from 'next';
import { PortfolioDetail } from '@/features/portfolio/portfolio-detail';

export const metadata: Metadata = { title: 'Portfolio details' };
export default async function PortfolioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PortfolioDetail key={id} id={id} />;
}
