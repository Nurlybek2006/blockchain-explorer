import type { Locale } from './types';

export const SUPPORTED_LOCALES = ['kk', 'en'] as const satisfies readonly Locale[];
export const DEFAULT_LOCALE: Locale = 'kk';
export const LOCALE_COOKIE_NAME = 'locale';
export const LOCALE_COOKIE_MAX_AGE = 31_536_000;

export function isLocale(value: unknown): value is Locale { return value === 'kk' || value === 'en'; }
export function resolveLocale(value: unknown): Locale { return isLocale(value) ? value : DEFAULT_LOCALE; }
export function createLocaleCookie(locale: Locale, secure = false): string {
  return `${LOCALE_COOKIE_NAME}=${locale}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax${secure ? '; Secure' : ''}`;
}
export function readLocaleCookie(cookie: string): Locale {
  for (const part of cookie.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== LOCALE_COOKIE_NAME) continue;
    try { return resolveLocale(decodeURIComponent(part.slice(separator + 1).trim())); }
    catch { return DEFAULT_LOCALE; }
  }
  return DEFAULT_LOCALE;
}

export function intlLocale(locale: Locale): string { return locale === 'kk' ? 'kk-KZ' : 'en-US'; }
