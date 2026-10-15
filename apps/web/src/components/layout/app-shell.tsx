'use client';
import { useEffect, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { Navigation } from './navigation';
import { ReorgNotice } from '@/features/realtime/live-status';
import { useTranslation } from '@/hooks/use-translation';
import { localizedMetadata } from '@/i18n/metadata';

export function AppShell({ children }: { children: ReactNode }) {
  const { t, locale } = useTranslation();
  const pathname = usePathname();
  useEffect(() => {
    if (pathname === null) return;
    const metadata = localizedMetadata(pathname, locale);
    document.title = metadata.title;
    document.querySelector<HTMLMetaElement>('meta[name="description"]')?.setAttribute('content', metadata.description);
  }, [pathname, locale]);
  return <><a className="skip-link" href="#main-content">{t('common.skipContent')}</a><div className="app-shell"><Navigation /><main id="main-content" className="main-content"><ReorgNotice />{children}<footer className="app-footer"><span>Blockchain Explorer</span><span>{t('common.footer')}</span></footer></main></div></>;
}
