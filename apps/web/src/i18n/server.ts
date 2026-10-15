import { cookies } from 'next/headers';
import { LOCALE_COOKIE_NAME, resolveLocale } from './config';
import { createTranslator } from './translator';

export async function getServerLocale() { return resolveLocale((await cookies()).get(LOCALE_COOKIE_NAME)?.value); }
export async function getServerTranslation() {
  const locale = await getServerLocale();
  return { locale, t: createTranslator(locale) };
}
