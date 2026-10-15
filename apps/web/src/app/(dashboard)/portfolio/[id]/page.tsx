import type { Metadata } from 'next';
import { getServerTranslation } from '@/i18n/server';
import { PortfolioDetail } from '@/features/portfolio/portfolio-detail';

export async function generateMetadata(): Promise<Metadata> { const { t } = await getServerTranslation(); return { title: t('portfolio.details') }; }
export default async function PortfolioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PortfolioDetail key={id} id={id} />;
}
