'use client';
import { useTranslation } from '@/hooks/use-translation';

export function LanguageSwitcher() {
  const { t, locale, setLocale } = useTranslation();
  return <div className="language-switcher" role="group" aria-label={t('navigation.language')}>
    <button type="button" lang="kk" aria-pressed={locale === 'kk'} aria-label={t('navigation.selectKazakh')} title={t('navigation.selectKazakh')} onClick={() => setLocale('kk')}>{t('navigation.kazakhShort')}</button>
    <button type="button" lang="en" aria-pressed={locale === 'en'} aria-label={t('navigation.selectEnglish')} title={t('navigation.selectEnglish')} onClick={() => setLocale('en')}>{t('navigation.englishShort')}</button>
  </div>;
}
