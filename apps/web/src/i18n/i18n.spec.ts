import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, createLocaleCookie, readLocaleCookie, resolveLocale } from './config';
import { dictionaries, createTranslator, pluralCategory } from './translator';
import { getApiErrorKey, getLocalizedApiError } from './errors';
import { ApiError } from '@/lib/api/api-error';
import { localizedMetadata } from './metadata';
import { formatAddress, formatBigInteger, formatDateTime, formatDecimal, formatPercentage, formatRelativeTime, formatTokenAmount, formatUsd } from '@/lib/format';

function leaves(value: unknown, prefix = ''): Map<string, string> {
  if (typeof value === 'string') return new Map([[prefix, value]]);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`Invalid dictionary at ${prefix}`);
  const result = new Map<string, string>();
  for (const [key, child] of Object.entries(value)) {
    for (const [path, text] of leaves(child, prefix ? `${prefix}.${key}` : key)) result.set(path, text);
  }
  return result;
}
function placeholders(text: string): string[] { return [...new Set([...text.matchAll(/\{([^{}]+)\}/g)].map(match => match[1]))].sort(); }

describe('complete, strict KK/EN dictionaries', () => {
  it('defaults to Kazakh independently of browser language', () => {
    expect(DEFAULT_LOCALE).toBe('kk'); expect(SUPPORTED_LOCALES).toEqual(['kk', 'en']);
    expect(resolveLocale(undefined)).toBe('kk'); expect(resolveLocale('ru')).toBe('kk');
  });
  it('requires exact key parity, nonempty messages and matching interpolation placeholders', () => {
    const english = leaves(dictionaries.en), kazakh = leaves(dictionaries.kk);
    expect([...kazakh.keys()].sort()).toEqual([...english.keys()].sort());
    expect(english.size).toBeGreaterThan(400);
    for (const [key, message] of english) {
      const localized = kazakh.get(key); expect(localized, key).toBeDefined();
      expect(localized?.trim().length, key).toBeGreaterThan(0);
      expect(placeholders(localized ?? ''), key).toEqual(placeholders(message));
    }
  });
  it('selects English and Kazakh translations without altering shared routes', () => {
    expect(createTranslator('en')('navigation.blocks')).toBe('Blocks');
    expect(createTranslator('kk')('navigation.blocks')).toBe('Блоктар');
    expect(createTranslator('kk')('navigation.portfolio')).toBe('Портфель');
  });
  it('interpolates typed parameters without injecting markup or leaving placeholders', () => {
    expect(createTranslator('en')('common.pageOf', { page: 2, total: 7 })).toBe('Page 2 of 7');
    const text = createTranslator('kk')('common.pageOf', { page: 2, total: 7 });
    expect(text).toContain('2'); expect(text).toContain('7'); expect(text).not.toMatch(/\{.+\}/);
    expect(createTranslator('kk')('common.copyValue', { value: '<script>' })).toContain('<script>');
  });
  it('fails loudly for unexpected runtime keys and missing interpolation parameters', () => {
    expect(() => Reflect.apply(createTranslator('kk'), undefined, ['missing.translation'])).toThrow('Missing translation');
    expect(() => Reflect.apply(createTranslator('en'), undefined, ['common.pageOf'])).toThrow('Missing interpolation parameter');
  });
  it('keeps English singular/plural and Kazakh count grammar centralized', () => {
    expect(pluralCategory('en', 1)).toBe('one'); expect(pluralCategory('en', 2)).toBe('other');
    expect(['one', 'other']).toContain(pluralCategory('kk', 1));
  });
  it('updates search, public resource and protected metadata while preserving technical values', () => {
    expect(localizedMetadata('/search', 'kk').title).toBe('Іздеу | Blockchain Explorer');
    expect(localizedMetadata('/search', 'en').title).toBe('Search | Blockchain Explorer');
    expect(localizedMetadata('/blocks/9007199254740993', 'kk').title).toContain('9007199254740993');
    expect(localizedMetadata('/portfolio', 'kk').title).toContain('Портфель');
    expect(localizedMetadata('/watchlists/list-id', 'kk').title).toContain(createTranslator('kk')('watchlists.details'));
    expect(localizedMetadata('/watchlists/list-id', 'en').title).toContain(createTranslator('en')('watchlists.details'));
  });
});

describe('locale preference persistence', () => {
  it.each(['en', 'kk'] as const)('persists and restores %s with site-wide SameSite=Lax cookie', (locale) => {
    const cookie = createLocaleCookie(locale);
    expect(cookie).toContain('Path=/'); expect(cookie).toContain('SameSite=Lax'); expect(cookie).toContain('Max-Age=31536000');
    expect(readLocaleCookie(cookie)).toBe(locale);
    expect(readLocaleCookie(`session=unchanged; locale=${locale}`)).toBe(locale);
  });
  it('uses secure cookies on HTTPS and never writes session/JWT data', () => {
    expect(createLocaleCookie('en', true)).toContain('; Secure');
    expect(createLocaleCookie('kk')).not.toMatch(/HttpOnly|Bearer|refresh|session=/);
  });
  it.each(['', 'locale=ru', 'locale=%E0%A4%A', 'other_locale=en', 'locale=EN'])('invalid or missing persisted preference falls back safely (%s)', (cookie) => {
    expect(readLocaleCookie(cookie)).toBe('kk');
  });
});

describe('locale-aware exact financial formatting', () => {
  it('groups huge blockchain integers with Intl without numeric rounding', () => {
    const number = '900719925474099312345';
    expect(formatBigInteger(number, 'en')).toBe('900,719,925,474,099,312,345');
    expect(formatBigInteger(number, 'kk').replace(/[^\d]/g, '')).toBe(number);
  });
  it('formats English/Kazakh USD without losing exact integer/fraction precision', () => {
    const number = '900719925474099312345.125';
    expect(formatUsd(number, 'en')).toBe('$900,719,925,474,099,312,345.13');
    expect(formatUsd(number, 'kk').replace(/[^\d]/g, '')).toBe('90071992547409931234513');
    expect(formatUsd('1234.56', 'kk')).toContain('1 234,56');
  });
  it('distinguishes missing prices, real zero, negative and nonzero sub-cent prices', () => {
    expect(formatUsd(null, 'kk')).toBe('—'); expect(formatUsd('0', 'kk')).toContain('0,00');
    expect(formatUsd('-1234.567', 'kk')).toContain('-'); expect(formatUsd('0.000001', 'kk')).toContain('<');
  });
  it('uses localized exact token decimal separator and percentage symbols', () => {
    expect(formatTokenAmount('123456789', 6, 6, 'kk')).toBe('123,456789');
    expect(formatTokenAmount('1', 18, 6, 'kk')).toBe('<0,000001');
    expect(formatPercentage('2.345', 'kk')).toContain('+2,35');
  });
  it('localizes full decimal fractions for allocation and snapshot tables without rounding', () => {
    expect(formatDecimal('1234.123456789012345678', 'en')).toBe('1,234.123456789012345678');
    expect(formatDecimal('1234.123456789012345678', 'kk')).toBe('1 234,123456789012345678');
    expect(formatDecimal('-0.000000000000000001', 'kk')).toBe('-0,000000000000000001');
  });
  it('uses a deterministic UTC timezone for both locales', () => {
    const date = '2026-10-14T12:00:00Z';
    expect(formatDateTime(date, 'en')).toContain('12:00:00 UTC');
    expect(formatDateTime(date, 'kk')).toContain('12:00:00 UTC');
    expect(formatDateTime('bad', 'kk')).toBe('—');
  });
  it('localizes relative time and keeps future/invalid values bounded', () => {
    const now = Date.parse('2026-10-14T12:00:12Z'), value = '2026-10-14T12:00:00Z';
    expect(formatRelativeTime(value, now, 'en')).toBe('12 seconds ago');
    expect(formatRelativeTime(value, now, 'kk')).toBe('12 секунд бұрын');
    expect(formatRelativeTime('bad', now, 'kk')).toBe('—');
    expect(formatRelativeTime('2026-10-14T13:00:00Z', now, 'kk')).toBe('0 секунд бұрын');
  });
  it('preserves raw hashes, addresses and technical identifiers', () => {
    const address = `0x${'a'.repeat(40)}`;
    expect(formatAddress(address)).toBe('0xaaaa…aaaa');
    const json = JSON.stringify(dictionaries.kk);
    for (const value of ['Ethereum', 'Sepolia', 'ABI', 'Gas']) expect(json).toContain(value);
  });
});

describe('localized safe API errors', () => {
  it.each([400, 401, 403, 404, 409, 413, 415, 429, 500, 503])('maps HTTP %s without displaying private English backend payloads', (status) => {
    const error = new ApiError(status, `http_${status}`, 'SQL password stack trace');
    expect(getLocalizedApiError(error, 'kk')).not.toContain('SQL');
    expect(getLocalizedApiError(error, 'en')).not.toContain('password');
    expect(getLocalizedApiError(error, 'kk')).not.toBe(getLocalizedApiError(error, 'en'));
  });
  it('distinguishes login credentials and duplicate registration from generic HTTP failures', () => {
    expect(getApiErrorKey(new ApiError(401, 'http_401', ''), 'login')).toBe('errors.invalidCredentials');
    expect(getApiErrorKey(new ApiError(409, 'http_409', ''), 'register')).toBe('errors.emailExists');
    expect(getApiErrorKey(new ApiError(409, 'http_409', ''), 'watchlist-item')).toBe('watchlists.duplicate');
  });
  it.each(['timeout', 'network', 'contract', 'invalid_json', 'account_changed'])('maps known client error %s and ignores raw messages', (code) => {
    expect(getLocalizedApiError(new ApiError(0, code, 'private-key'), 'kk')).not.toContain('private-key');
  });
  it('contains unknown provider failures and empty inputs', () => {
    expect(getLocalizedApiError(new Error('provider credentials'), 'kk')).toBe('Қате орын алды. Қайталап көріңіз.');
    expect(getLocalizedApiError(null, 'en')).toBe('Something went wrong. Please try again.');
  });
});
