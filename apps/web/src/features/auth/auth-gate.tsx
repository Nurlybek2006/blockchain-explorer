'use client';
import { Fragment, useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/providers/auth-provider';
import { Skeleton } from '@/components/ui';
import { useTranslation } from '@/hooks/use-translation';
export function AuthGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { status, user } = useAuth(); const router = useRouter();
  useEffect(() => { if (status === 'anonymous') router.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`); }, [status, router]);
  if (status !== 'authenticated') return <div className="page-stack"><p className="eyebrow">{t('common.workspace')}</p><Skeleton rows={5} /></div>;
  return <Fragment key={user?.id}>{children}</Fragment>;
}
