import type { en } from './locales/en';

export type Locale = 'kk' | 'en';
export type DictionaryShape<T> = { readonly [K in keyof T]: T[K] extends string ? string : DictionaryShape<T[K]> };
type LeafKeys<T> = { [K in keyof T & string]: T[K] extends string ? K : `${K}.${LeafKeys<T[K]>}` }[keyof T & string];
type ValueAt<T, Key extends string> = Key extends `${infer Head}.${infer Tail}`
  ? Head extends keyof T ? ValueAt<T[Head], Tail> : never : Key extends keyof T ? T[Key] : never;
type Placeholders<Text> = Text extends `${string}{${infer Key}}${infer Rest}` ? Key | Placeholders<Rest> : never;
export type TranslationKey = LeafKeys<typeof en>;
export type PlainTranslationKey = {
  [K in TranslationKey]: [Placeholders<ValueAt<typeof en, K>>] extends [never] ? K : never;
}[TranslationKey];
export type TranslationParameters<K extends TranslationKey> = { [P in Placeholders<ValueAt<typeof en, K>>]: string | number | bigint };
type Arguments<K extends TranslationKey> = [Placeholders<ValueAt<typeof en, K>>] extends [never]
  ? [parameters?: undefined] : [parameters: TranslationParameters<K>];
export type Translator = <K extends TranslationKey>(key: K, ...args: Arguments<K>) => string;
