import { en } from './locales/en';
import { kk } from './locales/kk';
import type { Locale, TranslationKey, TranslationParameters, Translator } from './types';

export const dictionaries = { kk, en };

function message(locale: Locale, key: string): string {
  let value: unknown = dictionaries[locale];
  for (const part of key.split('.')) {
    if (typeof value !== 'object' || value === null || !(part in value)) throw new Error(`Missing translation: ${locale}/${key}`);
    value = Object.getOwnPropertyDescriptor(value, part)?.value;
  }
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing translation: ${locale}/${key}`);
  return value;
}

export function createTranslator(locale: Locale): Translator {
  const translate: Translator = (key, ...args) => {
    const parameters = args[0];
    return message(locale, key).replace(/\{([^{}]+)\}/g, (_match: string, name: string) => {
      const value: unknown = parameters ? Object.getOwnPropertyDescriptor(parameters, name)?.value : undefined;
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') throw new Error(`Missing interpolation parameter: ${key}/${name}`);
      return String(value);
    });
  };
  return translate;
}

export function pluralCategory(locale: Locale, count: number): Intl.LDMLPluralRule {
  return new Intl.PluralRules(locale === 'kk' ? 'kk-KZ' : 'en-US').select(count);
}

export type { Locale, TranslationKey, TranslationParameters, Translator };
