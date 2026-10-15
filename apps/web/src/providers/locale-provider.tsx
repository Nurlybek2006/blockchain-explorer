'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createLocaleCookie } from '@/i18n/config';
import { createTranslator } from '@/i18n/translator';
import type { Locale, Translator } from '@/i18n/types';

interface LocaleContextValue {
  locale: Locale;
  setLocale(locale: Locale): void;
  t: Translator;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ initialLocale, children }: { initialLocale: Locale; children?: ReactNode }) {
  // The server cookie snapshot also supplies the first client render.
  const [locale, updateLocale] = useState(initialLocale);
  const setLocale = useCallback((next: Locale) => {
    try { document.cookie = createLocaleCookie(next, window.location.protocol === 'https:'); }
    catch { /* Cookie restrictions must not prevent switching the current interface. */ }
    updateLocale(next);
  }, []);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  const value = useMemo(() => ({ locale, setLocale, t: createTranslator(locale) }), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) throw new Error('LocaleProvider is required');
  return value;
}
