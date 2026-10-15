import { describe, expect, it } from 'vitest';
import { parseExplorerPagination, parseExplorerSearch } from './search';
import { createTranslator } from '@/i18n/translator';

describe('Explorer search', () => {
  it('preserves huge block numbers and normalizes leading zeros', () => {
    expect(parseExplorerSearch(' 000123456789012345678901234567890 ')).toEqual({ kind: 'block', value: '123456789012345678901234567890', href: '/blocks/123456789012345678901234567890' });
  });
  it('routes a valid transaction hash', () => {
    const hash = `0x${'AB'.repeat(32)}`;
    expect(parseExplorerSearch(hash)).toEqual({ kind: 'transaction', value: hash.toLowerCase(), href: `/tx/${hash.toLowerCase()}` });
  });
  it('routes a token or wallet address to address details', () => {
    const address = `0x${'CD'.repeat(20)}`;
    expect(parseExplorerSearch(address).kind).toBe('address');
  });
  it.each(['', '-1', '0x123', '1.5', '0x' + 'z'.repeat(40), '<script>'])('rejects %s', (value) => {
    expect(parseExplorerSearch(value).kind).toBe('invalid');
  });
  it('bounds pagination input', () => {
    expect(parseExplorerPagination({ page: '3', limit: '50' })).toEqual({ page: 3, limit: 50 });
    expect(parseExplorerPagination({ page: 'NaN', limit: '101' })).toEqual({ page: 1, limit: 20 });
    expect(parseExplorerPagination({ page: ['2', '3'], limit: '0' })).toEqual({ page: 1, limit: 20 });
  });
  it('returns stable validation codes that the UI translates in both locales', () => {
    expect(parseExplorerSearch('x'.repeat(257))).toEqual({ kind: 'invalid', code: 'too-long' });
    expect(parseExplorerSearch('not an address')).toEqual({ kind: 'invalid', code: 'invalid-format' });
    for (const locale of ['kk', 'en'] as const) {
      const t = createTranslator(locale);
      expect(t('explorer.search.tooLong')).toContain('256');
      expect(t('explorer.search.invalid')).toContain('Ethereum');
      expect(t('explorer.search.result', { type: t('explorer.labels.contract') })).not.toContain('{type}');
    }
    expect(createTranslator('kk')('explorer.labels.contract')).toBe('Смарт-келісімшарт');
    expect(createTranslator('en')('explorer.labels.contract')).toBe('Smart contract');
  });
});
