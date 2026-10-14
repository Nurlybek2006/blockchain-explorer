'use client';
import { Fragment, useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/providers/auth-provider';
import { Skeleton } from '@/components/ui';
export function AuthGate({ children }: { children: ReactNode }) {
  const { status, user } = useAuth(); const router = useRouter();
  useEffect(() => { if (status === 'anonymous') router.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`); }, [status, router]);
  if (status !== 'authenticated') return <div className="page-stack"><p className="eyebrow">Your workspace</p><Skeleton rows={5} /></div>;
  return <Fragment key={user?.id}>{children}</Fragment>;
}
