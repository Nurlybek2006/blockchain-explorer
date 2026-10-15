import type { Metadata } from 'next';
import { getServerTranslation } from '@/i18n/server';
import { PortfolioList } from '@/features/portfolio/portfolio-list';

export async function generateMetadata(): Promise<Metadata> { const { t } = await getServerTranslation(); return { title: t('portfolio.title') }; }
export default async function PortfolioPage({ searchParams }: { searchParams: Promise<{ page?: string | string[] }> }) {
  const query = await searchParams;
  const page = typeof query.page === 'string' && /^\d+$/.test(query.page) && Number.isSafeInteger(Number(query.page)) && Number(query.page) > 0 ? Math.min(Number(query.page), 10000) : 1;
  return <PortfolioList key={page} page={page} />;
}
