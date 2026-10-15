'use client';

import { useTranslation } from '@/hooks/use-translation';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { ApiError } from '@/lib/api/client';

export function ResourceView<T>({ data, error, loading, retry, name, children }: {
  data: T | null | undefined;
  error: unknown;
  loading: boolean;
  retry: () => void;
  name?: string;
  children: (data: T) => ReactNode;
}) {
  const { t } = useTranslation();
  if (error instanceof ApiError && error.status === 404) return <EmptyState title={t('explorer.resource.notFound', { name: name ?? t('explorer.resource.defaultName') })} description={t("explorer.resource.notFoundDescription")} action={<Link href="/">{t("explorer.resource.back")}</Link>} />;
  if (error) return <ErrorState error={error} retry={retry} />;
  if (data === undefined || data === null) return loading ? <Skeleton rows={6} /> : <EmptyState title={t("explorer.resource.noData")} />;
  return <>{children(data)}</>;
}
