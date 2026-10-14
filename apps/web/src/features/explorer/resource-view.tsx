'use client';

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
  if (error instanceof ApiError && error.status === 404) return <EmptyState title={`${name ?? 'Resource'} not found`} description="This resource has not been indexed on Sepolia, or is no longer available." action={<Link href="/">Back to Explorer</Link>} />;
  if (error) return <ErrorState error={error} retry={retry} />;
  if (data === undefined || data === null) return loading ? <Skeleton rows={6} /> : <EmptyState title="No data available" />;
  return <>{children(data)}</>;
}
