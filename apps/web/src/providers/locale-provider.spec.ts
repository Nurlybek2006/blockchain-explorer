import { createElement, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LocaleProvider } from './locale-provider';
import { useTranslation } from '@/hooks/use-translation';
import { LanguageSwitcher } from '@/components/layout/language-switcher';
import { ErrorState, Skeleton, StatusBadge, Table } from '@/components/ui-base';
import { CopyButton, Pagination } from '@/components/ui-controls';
import NotFound from '@/app/not-found';
import { ApiError } from '@/lib/api/client';
import type { Locale } from '@/i18n/types';

function render(locale: Locale, children: ReactNode): string {
  return renderToString(createElement(LocaleProvider, { initialLocale: locale }, children));
}

function LocaleSnapshot() {
  const { locale, t } = useTranslation();
  return createElement('p', { lang: locale }, t('navigation.overview'));
}

describe('locale provider and shared interface SSR', () => {
  it('uses the same Kazakh snapshot for every initial render', () => {
    const first = render('kk', createElement(LocaleSnapshot));
    expect(first).toBe('<p lang="kk">Шолу</p>');
    expect(render('kk', createElement(LocaleSnapshot))).toBe(first);
  });

  it('renders a saved English server snapshot directly', () => {
    expect(render('en', createElement(LocaleSnapshot))).toBe('<p lang="en">Overview</p>');
  });

  it.each(['kk', 'en'] as const)('marks only %s selected with localized switcher accessibility', locale => {
    const html = render(locale, createElement(LanguageSwitcher));
    const selectedLabel = locale === 'kk' ? 'Қазақ тіліне ауысу' : 'Switch to English';
    expect(html).toContain(`lang="${locale}" aria-pressed="true" aria-label="${selectedLabel}"`);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toContain(locale === 'kk' ? 'Интерфейс тілі' : 'Interface language');
  });

  it('localizes loading, table and transaction status accessibility', () => {
    const html = render('kk', createElement('div', null,
      createElement(Skeleton, { rows: 2 }),
      createElement(Table, null, createElement('tbody')),
      createElement(StatusBadge, { status: 'success' }),
      createElement(StatusBadge, { status: 'failed' }),
      createElement(StatusBadge, { status: 'pending' }),
    ));
    expect(html).toContain('aria-label="Жүктелуде"');
    expect(html).toContain('Деректер кестесі');
    for (const status of ['Сәтті', 'Сәтсіз', 'Күтілуде']) expect(html).toContain(status);
    expect(html).not.toContain('Loading');
  });

  it('localizes API errors and never exposes their raw message', () => {
    const html = render('kk', createElement(ErrorState, { error: new ApiError(403, 'http_403', 'private backend detail'), retry: () => undefined }));
    expect(html).toContain('Бұл бетті жүктеу мүмкін болмады');
    expect(html).toContain('Қайталап көру');
    expect(html).not.toContain('private backend detail');
  });

  it.each(['kk', 'en'] as const)('localizes pagination without changing route targets in %s', locale => {
    const html = render(locale, createElement(Pagination, { page: 2, totalPages: 3, href: page => `/blocks?page=${page}` }));
    expect(html).toContain(locale === 'kk' ? '3 беттің 2-беті' : 'Page 2 of 3');
    expect(html).toContain('href="/blocks?page=1"');
    expect(html).toContain('href="/blocks?page=3"');
  });

  it('keeps technical address values unchanged in copy accessibility', () => {
    const address = '0x1234567890abcdef';
    const html = render('kk', createElement(CopyButton, { value: address }));
    expect(html).toContain(`aria-label="${address} көшіру"`);
    expect(html).toContain('title="Көшіру"');
  });

  it.each(['kk', 'en'] as const)('renders the localized 404 and preserved home route in %s', locale => {
    const html = render(locale, createElement(NotFound));
    expect(html).toContain(locale === 'kk' ? 'Бет табылмады' : 'Page not found');
    expect(html).toContain('href="/"');
  });
});
