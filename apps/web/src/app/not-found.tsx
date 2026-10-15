'use client';
import Link from 'next/link';
import { EmptyState } from '@/components/ui';
import { useTranslation } from '@/hooks/use-translation';
export default function NotFound() { const { t } = useTranslation(); return <EmptyState title={t('common.notFound.title')} description={t('common.notFound.description')} action={<Link href="/" className="button button-primary">{t('common.backExplorer')} ↗</Link>} />; }
